/**
 * Turning what the web sends into text a model can use: character sets, HTML to readable text,
 * and the result list of DuckDuckGo's plain HTML search page. Pure functions; no network.
 */

/* ------------------------------- entities -------------------------------- */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', bull: '•', middot: '·',
  deg: '°', plusmn: '±', times: '×', divide: '÷', euro: '€', pound: '£',
  yen: '¥', cent: '¢', sect: '§', para: '¶', micro: 'µ', iexcl: '¡',
  iquest: '¿', frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²',
  sup3: '³', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  minus: '−', le: '≤', ge: '≥', ne: '≠', infin: '∞', hearts: '♥',
  shy: '', zwnj: '', zwj: '', lrm: '', rlm: ''
};

/** Entities in text decoded: &amp; &#8217; &#x2019; and the common named ones. Anything unknown is left as it was. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,10});/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
      return code === 0xa0 ? ' ' : String.fromCodePoint(code);
    }
    return NAMED[entity] ?? NAMED[entity.toLowerCase()] ?? whole;
  });
}

/** Markup removed, entities decoded, whitespace collapsed: for a snippet or a title. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/* ------------------------------- characters ------------------------------ */

/** The charset a Content-Type header names. */
export function headerCharset(contentType: string): string | null {
  const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return match ? match[1].toLowerCase() : null;
}

/** The charset a byte-order mark, or an HTML/XML declaration in the first kilobytes, names. */
export function sniffCharset(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const meta =
    /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(head) ?? /<\?xml[^>]+encoding\s*=\s*["']([a-z0-9_:.-]+)["']/i.exec(head);
  return meta ? meta[1].toLowerCase() : null;
}

/** Bytes as text, in the charset the header, the page itself or (failing both) UTF-8 says. */
export function decodeText(bytes: Uint8Array, contentType: string): string {
  const label = headerCharset(contentType) ?? sniffCharset(bytes) ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/* ---------------------------- HTML to readable text ---------------------- */

export interface PageLink {
  text: string;
  url: string;
}
export interface PageText {
  title: string;
  text: string;
  links: PageLink[];
}

/** Dropped with everything inside them, always. */
const ALWAYS_SKIP = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed', 'select', 'button',
  'head', 'dialog', 'audio', 'video', 'math', 'map', 'datalist', 'noframes', 'noembed', 'textarea', 'xmp', 'applet'
]);
/** Page furniture, dropped when there is more to the page than this. */
const STRUCTURE_SKIP = new Set(['nav', 'footer', 'aside', 'form']);
/** Elements whose inside is not markup: skipped straight to the closing tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'xmp', 'noembed', 'noframes', 'iframe', 'title']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const PARAGRAPH = new Set(['p', 'blockquote', 'pre', 'table', 'figure', 'dl', 'hr']);
const LINE = new Set([
  'div', 'section', 'article', 'main', 'header', 'hgroup', 'tr', 'br', 'dt', 'dd', 'figcaption', 'summary', 'details',
  'address', 'fieldset', 'legend', 'caption', 'thead', 'tbody', 'tfoot', 'center', 'menu', 'dir', 'body', 'html'
]);
const HEADING = /^h([1-6])$/;
const ROLE_FURNITURE = /\brole\s*=\s*["']?(?:navigation|contentinfo|complementary)\b/i;
/** The most links looked at, and the most a page's text lists. */
const LINKS_LOOKED_AT = 300;

const closers = new Map<string, RegExp>();
const closerOf = (name: string): RegExp => {
  let re = closers.get(name);
  if (!re) {
    re = new RegExp(`</${name}(?=[\\s/>])`, 'gi');
    closers.set(name, re);
  }
  return re;
};

/** A tag's attributes by name (lower case), values decoded. */
function attributes(raw: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of raw.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))
    if (!found.has(m[1].toLowerCase())) found.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  return found;
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: string;
  /** Where the tag ends (after its `>`). */
  end: number;
}

/** The tag starting at `start` (a `<` followed by a letter or `/`), or null if it never ends. */
function readTag(html: string, start: number): Tag | null {
  let i = start + 1;
  const closing = html[i] === '/';
  if (closing) i++;
  const nameMatch = /^[A-Za-z][^\s/>]*/.exec(html.slice(i, i + 40));
  if (!nameMatch) return null;
  const name = nameMatch[0].toLowerCase();
  i += nameMatch[0].length;
  const attrsStart = i;
  let quote = '';
  for (; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') break;
  }
  if (i >= html.length) return null;
  const attrs = html.slice(attrsStart, i);
  return { name, closing, selfClosing: attrs.endsWith('/'), attrs, end: i + 1 };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function convert(html: string, base: URL | null, dropStructure: boolean): PageText {
  const out: string[] = [];
  /** What the output ends with: nothing yet, a soft space, or this many newlines. */
  let empty = true;
  let space = false;
  let newlines = 0;
  let title = '';
  let firstHeading = '';
  let pos = 0;
  let skip: { name: string; depth: number } | null = null;
  let pre = 0;
  let cell = 0;
  const lists: { ordered: boolean; count: number }[] = [];
  const anchors: { href: string | null; start: number }[] = [];
  const headings: { start: number }[] = [];
  const links: PageLink[] = [];
  const seen = new Set<string>();
  let looked = 0;

  const put = (piece: string) => {
    if (!piece) return;
    out.push(piece);
    empty = false;
    newlines = 0;
    space = piece.endsWith(' ');
  };
  const trimSpace = () => {
    if (!space) return;
    const last = out.length - 1;
    out[last] = out[last].replace(/ +$/, '');
    if (!out[last]) out.pop();
    space = false;
  };
  const lineBreak = (count: number) => {
    if (empty) return;
    trimSpace();
    if (newlines < count) {
      out.push('\n'.repeat(count - newlines));
      newlines = count;
    }
  };
  const text = (raw: string) => {
    if (skip || !raw) return;
    const decoded = decodeEntities(raw);
    if (pre) {
      const piece = decoded.replace(/\r\n?/g, '\n');
      if (!piece) return;
      out.push(piece);
      empty = false;
      newlines = Math.min(2, /\n*$/.exec(piece)![0].length);
      space = false;
      return;
    }
    let piece = decoded.replace(/\s+/g, ' ');
    if (!piece) return;
    if (piece[0] === ' ' && (empty || newlines > 0 || space)) piece = piece.slice(1);
    if (!piece) return;
    put(piece);
  };
  const addLink = (href: string, label: string) => {
    if (!label || looked++ >= LINKS_LOOKED_AT) return;
    const target = href.trim();
    if (!target || target.startsWith('#') || /^(?:javascript|mailto|tel|data|sms):/i.test(target)) return;
    let url: URL;
    try {
      url = base ? new URL(target, base) : new URL(target);
    } catch {
      return;
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return;
    url.hash = '';
    if (base && url.href === new URL(base.href.split('#')[0]).href) return;
    if (seen.has(url.href)) return;
    seen.add(url.href);
    links.push({ text: clip(label.replace(/[[\]]/g, ''), 80), url: url.href });
  };

  while (pos < html.length) {
    const lt = html.indexOf('<', pos);
    if (lt < 0) {
      text(html.slice(pos));
      break;
    }
    if (lt > pos) text(html.slice(pos, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      pos = end < 0 ? html.length : end + 3;
      continue;
    }
    const next = html[lt + 1] ?? '';
    if (next === '!' || next === '?') {
      const end = html.indexOf('>', lt + 1);
      pos = end < 0 ? html.length : end + 1;
      continue;
    }
    if (!/[A-Za-z/]/.test(next) || (next === '/' && !/[A-Za-z]/.test(html[lt + 2] ?? ''))) {
      // A "<" that opens nothing (a < b), or a broken close tag.
      if (next === '/') {
        const end = html.indexOf('>', lt + 1);
        pos = end < 0 ? html.length : end + 1;
      } else {
        text('<');
        pos = lt + 1;
      }
      continue;
    }
    const tag = readTag(html, lt);
    if (!tag) {
      text(html.slice(lt));
      break;
    }
    pos = tag.end;
    const { name } = tag;

    // Elements whose inside is not markup: jump to the closing tag, keeping a page title.
    if (!tag.closing && RAW_TEXT.has(name) && !tag.selfClosing) {
      const closer = closerOf(name);
      closer.lastIndex = pos;
      const found = closer.exec(html);
      const inner = found ? html.slice(pos, found.index) : html.slice(pos);
      if (name === 'title' && !title && (!skip || skip.name === 'head')) title = stripTags(inner);
      if (found) {
        const end = html.indexOf('>', found.index);
        pos = end < 0 ? html.length : end + 1;
      } else pos = html.length;
      continue;
    }

    if (skip) {
      if (skip.name === 'head' && name === 'body' && !tag.closing) skip = null; // </head> is optional
      else {
        if (name === skip.name && !VOID.has(name) && !tag.selfClosing) {
          skip.depth += tag.closing ? -1 : 1;
          if (skip.depth === 0) skip = null;
        }
        continue;
      }
    }

    if (tag.closing) {
      if (name === 'a') {
        const anchor = anchors.pop();
        if (anchor?.href) addLink(anchor.href, out.slice(anchor.start).join('').replace(/\s+/g, ' ').trim());
      } else if (HEADING.test(name)) {
        const heading = headings.pop();
        if (heading && !firstHeading && name === 'h1')
          firstHeading = out.slice(heading.start).join('').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
        lineBreak(2);
      } else if (name === 'ul' || name === 'ol') {
        lists.pop();
        lineBreak(lists.length ? 1 : 2);
      } else if (name === 'pre') {
        pre = Math.max(0, pre - 1);
        lineBreak(2);
      } else if (name === 'code') {
        if (!pre) put('`');
      } else if (PARAGRAPH.has(name)) lineBreak(2);
      else if (LINE.has(name)) lineBreak(1);
      continue;
    }

    // Opening tags: furniture and hidden things are dropped with everything in them.
    let drop = ALWAYS_SKIP.has(name) || (dropStructure && STRUCTURE_SKIP.has(name));
    if (!drop && tag.attrs.length > 5) {
      if (dropStructure && ROLE_FURNITURE.test(tag.attrs)) drop = true;
      else if (/(?:^|\s)hidden(?:[\s=/]|$)/i.test(tag.attrs) && attributes(tag.attrs).has('hidden')) drop = true;
    }
    if (drop) {
      if (!VOID.has(name) && !tag.selfClosing) skip = { name, depth: 1 };
      continue;
    }

    if (name === 'a') {
      anchors.push({ href: attributes(tag.attrs).get('href') ?? null, start: out.length });
    } else if (HEADING.test(name)) {
      lineBreak(2);
      headings.push({ start: out.length });
      put(`${'#'.repeat(Number(name[1]))} `);
    } else if (name === 'ul' || name === 'ol') {
      lists.push({ ordered: name === 'ol', count: 0 });
      lineBreak(lists.length > 1 ? 1 : 2);
    } else if (name === 'li') {
      lineBreak(1);
      const list = lists[lists.length - 1];
      put(`${'  '.repeat(Math.max(0, lists.length - 1))}${list?.ordered ? `${++list.count}. ` : '- '}`);
    } else if (name === 'pre') {
      lineBreak(2);
      pre++;
    } else if (name === 'code') {
      if (!pre) put('`');
    } else if (name === 'hr') {
      lineBreak(2);
      put('---');
      lineBreak(2);
    } else if (name === 'tr') {
      cell = 0;
      lineBreak(1);
    } else if (name === 'td' || name === 'th') {
      if (cell++ > 0) {
        trimSpace();
        put(' | ');
      }
    } else if (PARAGRAPH.has(name)) lineBreak(2);
    else if (LINE.has(name)) lineBreak(1);
  }

  const body = out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title: title || firstHeading, text: body, links };
}

/**
 * A page as readable text: headings as `#`, lists as `-`, links kept as their text (and listed
 * separately), scripts, styles, menus, footers, sidebars and forms gone. `base` is the page's own
 * address, for turning its relative links into whole ones.
 */
export function htmlToText(html: string, base?: string | URL): PageText {
  let baseUrl: URL | null = null;
  try {
    baseUrl = base ? new URL(base) : null;
  } catch {
    baseUrl = null;
  }
  const strict = convert(html, baseUrl, true);
  if (strict.text.length >= 400) return strict;
  // Little left: the page may be built inside a <form> (older .NET sites do this) or have an
  // unclosed <nav>. Read it again keeping furniture, and use that if it found more.
  const lenient = convert(html, baseUrl, false);
  return lenient.text.length > strict.text.length ? { ...lenient, title: strict.title || lenient.title } : strict;
}

/* ------------------------------ DuckDuckGo ------------------------------- */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const httpOnly = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

/** The page a DuckDuckGo result link leads to: its `uddg` address, or the link itself. Null for ads and DuckDuckGo's own pages. */
export function duckDuckGoTarget(href: string): string | null {
  let url: URL;
  try {
    url = new URL(decodeEntities(href).trim(), 'https://duckduckgo.com/');
  } catch {
    return null;
  }
  if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) {
    if (url.pathname === '/l' || url.pathname.startsWith('/l/')) return httpOnly(url.searchParams.get('uddg'));
    return null; // /y.js and friends are ads
  }
  if (url.searchParams.has('ad_domain') || url.searchParams.has('ad_provider')) return null;
  return httpOnly(url.href);
}

/** What DuckDuckGo says when it takes you for a robot. */
const CHALLENGE = /anomaly-modal|bots use DuckDuckGo too|challenge-form|id="challenge"/i;

/** The results on DuckDuckGo's plain HTML results page, ads left out. `challenged` is set when it asks for a human instead. */
export function parseDuckDuckGo(html: string): { hits: SearchHit[]; challenged: boolean } {
  const anchors = [...html.matchAll(/<a\b[^>]*\bclass\s*=\s*["'][^"']*\bresult__a\b[^"']*["'][^>]*>/gi)];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  let previousEnd = 0;
  anchors.forEach((match, index) => {
    const tagEnd = match.index + match[0].length;
    const regionEnd = anchors[index + 1]?.index ?? html.length;
    const before = html.slice(Math.max(previousEnd, match.index - 1500), match.index);
    previousEnd = tagEnd;
    const container = [...before.matchAll(/<div\b[^>]*\bclass\s*=\s*["']([^"']*\bresult\b[^"']*)["']/gi)].at(-1);
    if (container && /\bresult--ad\b/.test(container[1])) return;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[0]);
    const url = href ? duckDuckGoTarget(href[1] ?? href[2]) : null;
    if (!url || seen.has(url)) return;
    const closeAt = html.indexOf('</a>', tagEnd);
    const title = stripTags(html.slice(tagEnd, closeAt < 0 || closeAt > regionEnd ? regionEnd : closeAt));
    if (!title) return;
    const snippet = /<(a|div|td|span)\b[^>]*\bclass\s*=\s*["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i.exec(
      html.slice(tagEnd, regionEnd)
    );
    seen.add(url);
    hits.push({ title, url, snippet: snippet ? stripTags(snippet[2]) : '' });
  });
  return { hits, challenged: !hits.length && CHALLENGE.test(html) };
}
