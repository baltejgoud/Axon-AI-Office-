// Pure ingest helpers. No git, no network, no Electron. Used by ingest.cjs and by tests.
'use strict';

function unquote(v) {
  return v.replace(/^["']|["']$/g, '');
}

function parseScalar(raw) {
  const v = raw.trim();
  if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
  return unquote(v);
}

/** Minimal YAML subset: scalars, quoted scalars, [lists], ">" / "|" block scalars, one level of nested maps. */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const lines = m[1].split(/\r?\n/);
  const data = {};
  let i = 0;
  while (i < lines.length) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) { i += 1; continue; }
    const [, key, rawVal] = kv;
    const val = rawVal.trim();
    if (/^[>|]-?$/.test(val)) {
      const buf = [];
      i += 1;
      while (i < lines.length && (lines[i] === '' || /^\s/.test(lines[i]))) { buf.push(lines[i].trim()); i += 1; }
      data[key] = val.startsWith('>') ? buf.join(' ').replace(/\s+/g, ' ').trim() : buf.join('\n').trim();
      continue;
    }
    if (val === '') {
      const nested = {};
      i += 1;
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        const nk = lines[i].trim().match(/^([\w-]+):\s*(.*)$/);
        if (nk) nested[nk[1]] = parseScalar(nk[2]);
        i += 1;
      }
      data[key] = nested;
      continue;
    }
    data[key] = parseScalar(val);
    i += 1;
  }
  return { data, body: m[2].trim() };
}

module.exports = { parseFrontmatter };
