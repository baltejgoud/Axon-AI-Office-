import { createServer, type Server } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

/** How long a browser sign-in may take before Axon stops waiting. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
export const base64url = (bytes: Buffer) => bytes.toString('base64url');
/** A PKCE verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}
export const randomState = () => base64url(randomBytes(16));

/** What a sign-in says when the user declines, it comes back wrong, or it takes too long. */
export interface LoopbackMessages {
  declined: string;
  failed: string;
  timedOut: string;
}

/**
 * A browser sign-in that comes back to Axon: listens on 127.0.0.1 on a free port, opens the
 * authorization page (built once the redirect URI is known, so a client can be registered for
 * it), and waits for /callback with the right state. Aborting `signal` stops the wait.
 */
export async function loopbackAuthorize(input: {
  authorizationUrl: (redirectUri: string) => string | Promise<string>;
  openExternal: (url: string) => Promise<void> | void;
  state: string;
  signal: AbortSignal;
  messages: LoopbackMessages;
  timeoutMs?: number;
}): Promise<{ code: string; redirectUri: string }> {
  let server: Server | null = null;
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(input.messages.timedOut)), input.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      if (input.signal.aborted) return fail(new Error('Sign-in cancelled.'));
      input.signal.addEventListener('abort', () => fail(new Error('Sign-in cancelled.')), { once: true });
      let redirectUri = '';
      server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') { response.writeHead(404).end(); return; }
        const ok = url.searchParams.get('state') === input.state && !!url.searchParams.get('code');
        response.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(ok));
        if (ok) {
          clearTimeout(timer);
          resolve({ code: url.searchParams.get('code')!, redirectUri });
        } else fail(new Error(url.searchParams.get('error') === 'access_denied' ? input.messages.declined : input.messages.failed));
      });
      server.on('error', fail);
      server.listen(0, '127.0.0.1', () => {
        redirectUri = `http://127.0.0.1:${(server!.address() as { port: number }).port}/callback`;
        Promise.resolve()
          .then(() => input.authorizationUrl(redirectUri))
          .then((url) => input.openExternal(url))
          .catch(fail);
      });
    });
  } finally {
    (server as Server | null)?.close();
  }
}

const page = (ok: boolean) => `<!doctype html><meta charset="utf-8"><title>Axon</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#222">
<p>${ok ? 'Signed in. You can close this tab and go back to Axon.' : 'Sign-in did not complete. Go back to Axon and try again.'}</p></body>`;
