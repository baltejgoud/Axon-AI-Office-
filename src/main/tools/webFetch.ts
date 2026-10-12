import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { brotliDecompress, gunzip, inflate, inflateRaw } from 'node:zlib';

/**
 * How Axon fetches from the web for a coworker. The one rule that matters: a coworker (or a page
 * that tricked one) must never reach this computer or its network. So the address is checked where
 * the connection is made, not only in the link: the name is resolved by our own lookup, which
 * refuses private answers, so a name that points somewhere private (or changes its answer between
 * a check and the connection) cannot get through. Redirects are followed by hand and every hop is
 * checked again. No cookies, no sign-in headers, no referrer.
 */

export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_BYTES = 3 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
/** Of an error page, how much is read (for a hint such as a rate-limit notice). */
const ERROR_BODY_BYTES = 256 * 1024;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export type WebFetchFailure =
  | 'invalid'
  | 'protocol'
  | 'credentials'
  | 'blocked'
  | 'timeout'
  | 'aborted'
  | 'too-large'
  | 'type'
  | 'redirects'
  | 'dns'
  | 'network'
  | 'tls';

/** Why a fetch did not happen, worded for the coworker (and, through them, for you). */
export class WebFetchError extends Error {
  /** Set so a refusal survives being passed through the network layer. */
  readonly code = 'AXON_WEB_FETCH';
  constructor(
    readonly kind: WebFetchFailure,
    message: string
  ) {
    super(message);
    this.name = 'WebFetchError';
  }
}

const PRIVATE_ADDRESS =
  "That address is on a private or local network (this computer, a home or company network), so I won't open it. I only read public websites.";

/* ------------------------------ addresses ------------------------------ */

const ipv4Parts = (text: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = [m[1], m[2], m[3], m[4]].map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
};
const ipv4Number = ([a, b, c, d]: number[]): number => (((a << 24) | (b << 16) | (c << 8) | d) >>> 0);

/** IPv4 ranges that are not the public internet: this host, private, shared (CGNAT), loopback, link-local, test, multicast, reserved. */
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];
const BLOCKED_V4_RANGES = BLOCKED_V4.map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (ipv4Number(ipv4Parts(base)!) & mask) >>> 0, mask };
});
const blockedV4 = (n: number): boolean =>
  BLOCKED_V4_RANGES.some((range) => ((n & range.mask) >>> 0) === range.network);

/** An IPv6 address as eight 16-bit groups; null when it isn't one. */
function ipv6Groups(input: string): number[] | null {
  let text = input.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const lastColon = text.lastIndexOf(':');
  if (lastColon < 0) return null;
  if (text.includes('.')) {
    const v4 = ipv4Parts(text.slice(lastColon + 1));
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (part: string) => (part === '' ? [] : part.split(':'));
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null;
  const groups = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

const embeddedV4 = (high: number, low: number): boolean => blockedV4((((high << 16) | low) >>> 0));

function blockedV6(g: number[]): boolean {
  // NAT64: 64:ff9b::/96 carries an IPv4 address (the local-use block does not). Its first group is
  // 0x0064, so it is read before the ::/8 rule below.
  if (g[0] === 0x64 && g[1] === 0xff9b)
    return g.slice(2, 6).every((x) => x === 0) ? embeddedV4(g[6], g[7]) : true;
  // ::/8 holds the unspecified address, ::1 and the old IPv4-compatible forms. Only IPv4-mapped
  // addresses (::ffff:a.b.c.d) are real traffic, and they are as private as the IPv4 inside.
  if (g[0] >> 8 === 0) {
    const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
    return mapped ? embeddedV4(g[6], g[7]) : true;
  }
  // Only global unicast (2000::/3) is the public internet; this refuses unique-local (fc00::/7),
  // link-local (fe80::/10), site-local, multicast and everything unassigned.
  if (g[0] >> 13 !== 1) return true;
  if (g[0] === 0x2002) return embeddedV4(g[1], g[2]); // 6to4 carries an IPv4 address
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) return true; // Teredo, documentation
  return false;
}

/** True for any address that is not the public internet. Anything that is not an address at all is refused too. */
export function isBlockedAddress(address: string): boolean {
  const bare = address.trim().replace(/^\[(.*)\]$/, '$1');
  const kind = isIP(bare);
  if (kind === 4) return blockedV4(ipv4Number(ipv4Parts(bare)!));
  if (kind === 6) {
    const groups = ipv6Groups(bare);
    return !groups || blockedV6(groups);
  }
  return true;
}

/** Names that mean "this machine" or "a network at home or work", whatever they resolve to. */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.lan', '.intranet', '.corp', '.home', '.private'];

/** True for a host name (or address) that is never a public website. */
export function isBlockedHostname(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.+$/, '');
  if (!name) return true;
  if (name.startsWith('[') || isIP(name)) return isBlockedAddress(name);
  if (name === 'localhost' || LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  // A bare name ("router", "metadata") only resolves through this computer's own network.
  if (!name.includes('.')) return true;
  // No public name ends in a number: that is an address written in a form the URL parser did not settle.
  return /^(?:0x[0-9a-f]*|\d+)$/.test(name.slice(name.lastIndexOf('.') + 1));
}

/**
 * The address a coworker asked for, if it is a public web address; otherwise the reason it isn't.
 * Link tricks (decimal, hex or octal forms of 127.0.0.1) are already plain numbers by the time the
 * URL parser is done with them.
 */
export function publicUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input.trim()) : input;
  } catch {
    throw new WebFetchError('invalid', 'That does not look like a web address. Use a full link that starts with http:// or https://.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new WebFetchError('protocol', 'I can only open web addresses that start with http:// or https://.');
  if (url.username || url.password)
    throw new WebFetchError('credentials', 'I cannot open an address with a username or password in it.');
  if (isBlockedHostname(url.hostname)) throw new WebFetchError('blocked', PRIVATE_ADDRESS);
  return url;
}

/** A way to turn a name into addresses; the system's, unless a test supplies one. */
export type Resolver = (
  hostname: string,
  options: LookupOptions & { all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void
) => void;

/**
 * The lookup every connection is made with. It refuses a name if ANY of its answers is private, so
 * a name cannot point at this computer or its network, and it is the answer used to connect, so the
 * name cannot answer differently afterwards.
 */
export function guardedLookup(resolve: Resolver = dnsLookup as unknown as Resolver): LookupFunction {
  return (hostname, options, callback) => {
    const wanted = typeof options === 'object' && options ? options : {};
    resolve(hostname, { ...wanted, all: true }, (error, addresses) => {
      if (error) return callback(error, '', 0);
      const found = Array.isArray(addresses) ? addresses : [];
      if (!found.length || found.some((entry) => isBlockedAddress(entry.address)))
        return callback(new WebFetchError('blocked', PRIVATE_ADDRESS) as unknown as NodeJS.ErrnoException, '', 0);
      if (wanted.all) return callback(null, found);
      callback(null, found[0].address, found[0].family);
    });
  };
}

/* ------------------------------- transport ------------------------------- */

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  /** The body as it came (still compressed, if it was). */
  body: AsyncIterable<Uint8Array>;
  destroy(): void;
}
export interface TransportInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  lookup: LookupFunction;
}
/** Makes one request; the real one is node:http(s), a test supplies its own. */
export type Transport = (target: URL, init: TransportInit) => Promise<RawResponse>;

/** The real network: node:http and node:https, one connection per request. Exported so a test can drive it against a local server. */
export const defaultTransport: Transport = (target, init) =>
  new Promise((resolve, reject) => {
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(
      target,
      {
        method: init.method,
        headers: init.headers,
        lookup: init.lookup,
        signal: init.signal,
        // A connection of its own for every request: nothing is kept between requests or sites.
        agent: false
      },
      (response) =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: response,
          destroy: () => response.destroy()
        })
    );
    request.on('error', reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });

/* --------------------------------- fetch --------------------------------- */

export interface FetchOptions {
  method?: 'GET' | 'POST';
  /** Added to the browser-like defaults. Only our own search calls set these; they are never sent on to a redirect. */
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Looks at a successful response's type before its body is downloaded: the reason to refuse it, or null. */
  accept?: (mimeType: string) => string | null;
  /** Tests supply these; the real network is used otherwise. */
  transport?: Transport;
  resolver?: Resolver;
}

export interface FetchResult {
  /** Where the answer came from, after any redirects. */
  url: URL;
  status: number;
  headers: IncomingHttpHeaders;
  /** The body, decompressed. */
  body: Buffer;
  /** The type without its parameters, in lower case: "text/html". */
  mimeType: string;
  /** The type as sent, with its charset. */
  contentType: string;
  /** The addresses followed on the way, after the first. */
  redirects: string[];
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const headerValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('Aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/** What went wrong, in words for a coworker. */
function explain(error: unknown, signal: AbortSignal, yours?: AbortSignal): WebFetchError {
  if (error instanceof WebFetchError) return error;
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (cause instanceof WebFetchError) return cause;
  if (yours?.aborted) return new WebFetchError('aborted', 'The task was stopped before the page finished loading.');
  const code = (error as NodeJS.ErrnoException | null)?.code ?? '';
  const name = (error as Error | null)?.name ?? '';
  if (signal.aborted || name === 'AbortError' || name === 'TimeoutError')
    return new WebFetchError('timeout', 'That site took too long to answer (over 20 seconds), so I gave up.');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NODATA')
    return new WebFetchError('dns', 'I could not find that website. Check the address for typos, or your internet connection.');
  if (/CERT|SELF_SIGNED|ALTNAME|UNABLE_TO_VERIFY|SSL|TLS/i.test(code))
    return new WebFetchError('tls', "That site's security certificate is not valid, so I did not open it.");
  if (code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_OUT_OF_RANGE')
    return new WebFetchError('too-large', 'That page is too large to read (over 3 MB).');
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'].includes(code))
    return new WebFetchError('network', 'I could not connect to that site. It may be down, or your internet connection is not working.');
  return new WebFetchError('network', `I could not load that page${(error as Error | null)?.message ? ` (${(error as Error).message})` : ''}.`);
}

/** Reads a body, giving up past `limit` bytes. */
async function readBody(response: RawResponse, limit: number, partial: boolean): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    const piece = Buffer.from(chunk);
    if (total + piece.length > limit) {
      if (partial) {
        chunks.push(piece.subarray(0, limit - total));
        total = limit;
        break;
      }
      throw new WebFetchError('too-large', 'That page is too large to read (over 3 MB).');
    }
    chunks.push(piece);
    total += piece.length;
  }
  return Buffer.concat(chunks, total);
}

type Decompress = (buffer: Buffer, options: { maxOutputLength: number }, done: (error: Error | null, result: Buffer) => void) => void;

/** The body with its compression (gzip, deflate or brotli) undone, never past `limit` bytes however well it compressed. */
async function decompress(buffer: Buffer, encoding: string, limit: number): Promise<Buffer> {
  const steps = encoding
    .split(',')
    .map((step) => step.trim().toLowerCase())
    .filter((step) => step && step !== 'identity')
    .reverse();
  let current = buffer;
  const options = { maxOutputLength: limit };
  const run = (fn: Decompress, input: Buffer) =>
    new Promise<Buffer>((resolve, reject) => fn(input, options, (error, result) => (error ? reject(error) : resolve(result))));
  for (const step of steps) {
    if (step === 'gzip' || step === 'x-gzip') current = await run(gunzip as unknown as Decompress, current);
    else if (step === 'br') current = await run(brotliDecompress as unknown as Decompress, current);
    else if (step === 'deflate') {
      // "deflate" is zlib-wrapped by the standard, raw by some servers.
      try {
        current = await run(inflate as unknown as Decompress, current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw error;
        current = await run(inflateRaw as unknown as Decompress, current);
      }
    } else throw new WebFetchError('type', `That page uses a compression (${step}) I cannot read.`);
  }
  return current;
}

/** A readable reason for a failed response. */
export function statusReason(status: number): string {
  if (status === 404 || status === 410) return 'That page was not found (it may have moved or been removed).';
  if (status === 401 || status === 403)
    return 'That site would not let me in. The page may need a sign-in, or it blocks automated readers.';
  if (status === 429) return 'That site is limiting how often I can ask. Try again in a little while.';
  if (status >= 500) return `That site had a problem answering (error ${status}). It may work if you try again later.`;
  return `That site answered with an unexpected error (${status}).`;
}

/**
 * Fetches one public web address and returns its (decompressed) body. Throws WebFetchError for
 * everything that is not an answer: private addresses, a bad link, a timeout, a page too big or of a
 * kind the caller does not accept. HTTP errors (404, 429 …) are returned, with the start of their body.
 */
export async function safeFetch(input: string | URL, options: FetchOptions = {}): Promise<FetchResult> {
  const limit = options.maxBytes ?? MAX_BYTES;
  const transport = options.transport ?? defaultTransport;
  const lookup = guardedLookup(options.resolver);
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
    ...(options.signal ? [options.signal] : [])
  ]);
  // Headers of our own (a search key) go to the first address only; a redirect would carry them elsewhere.
  const maxRedirects = options.headers ? 0 : (options.maxRedirects ?? MAX_REDIRECTS);
  let url = publicUrl(input);
  let method: string = options.method ?? 'GET';
  let body = options.body;
  const redirects: string[] = [];
  try {
    for (let hop = 0; ; hop++) {
      const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,application/json;q=0.8,*/*;q=0.5',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br'
      };
      for (const [name, value] of Object.entries(options.headers ?? {})) headers[name.toLowerCase()] = value;
      if (body !== undefined && !headers['content-length'])
        headers['content-length'] = String(Buffer.byteLength(body));
      const response = await abortable(transport(url, { method, headers, body, signal, lookup }), signal);
      try {
        if (REDIRECTS.has(response.status)) {
          const location = headerValue(response.headers.location);
          response.destroy();
          if (!location) throw new WebFetchError('network', 'That link redirects without saying where to.');
          if (hop >= maxRedirects)
            throw new WebFetchError('redirects', maxRedirects ? 'That link redirects too many times, so I stopped following it.' : 'That address redirected somewhere else, which I do not follow here.');
          let next: URL;
          try {
            next = new URL(location, url);
          } catch {
            throw new WebFetchError('invalid', 'That link redirects to an address that is not valid.');
          }
          // Every hop is checked like the first one: a public page may send you somewhere private.
          url = publicUrl(next);
          redirects.push(url.href);
          if (response.status !== 307 && response.status !== 308) {
            method = 'GET';
            body = undefined;
          }
          continue;
        }

        const rawType = headerValue(response.headers['content-type']);
        const mimeType = rawType.split(';')[0].trim().toLowerCase();
        const ok = response.status >= 200 && response.status < 300;
        if (ok) {
          const refused = options.accept?.(mimeType);
          if (refused) throw new WebFetchError('type', refused);
          const declared = Number(headerValue(response.headers['content-length']));
          if (Number.isFinite(declared) && declared > limit)
            throw new WebFetchError('too-large', 'That page is too large to read (over 3 MB).');
        }
        const wire = await abortable(readBody(response, ok ? limit : ERROR_BODY_BYTES, !ok), signal);
        const encoding = headerValue(response.headers['content-encoding']);
        let decoded: Buffer;
        try {
          decoded = await decompress(wire, encoding, ok ? limit : ERROR_BODY_BYTES);
        } catch (error) {
          // A failed response may be cut mid-stream; only a good one has to be complete.
          if (ok || (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw error;
          decoded = Buffer.alloc(0);
        }
        response.destroy();
        return { url, status: response.status, headers: response.headers, body: decoded, mimeType, contentType: rawType, redirects };
      } catch (error) {
        response.destroy();
        throw error;
      }
    }
  } catch (error) {
    throw explain(error, signal, options.signal);
  }
}
