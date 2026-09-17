// Pure ingest helpers. No git, no network, no Electron. Used by ingest.cjs and by tests.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

const CATEGORIES = ['design', 'engineering', 'workflow', 'review', 'content', 'integration', 'other'];

// Order matters: first category whose keyword matches wins (spec §5).
const KEYWORDS = [
  ['review', ['review', 'audit', 'over-engineer', 'debt', 'critique', 'lint']],
  ['workflow', ['brainstorm', 'plan', 'tdd', 'debug', 'worktree', 'branch', 'subagent', 'agents', 'executing', 'finishing', 'dispatch', 'verification']],
  ['design', ['design', 'ui', 'ux', 'brand', 'logo', 'banner', 'slide', 'color', 'typography', 'figma', 'canvas', 'artifact']],
  ['content', ['write', 'writing', 'changelog', 'comms', 'research', 'blog', 'seo', 'copy', 'content', 'document', 'invoice']],
  ['engineering', ['code', 'typescript', 'api', 'service', 'cli', 'sdk', 'test', 'contract', 'ink', 'migration']]
];

function categorize(s) {
  const declared = String(s.category || '').toLowerCase();
  if (CATEGORIES.includes(declared)) return declared;
  if (s.requires.some((r) => r.startsWith('mcp:')) || s.path.includes('composio-skills/')) return 'integration';
  // Name + description only: paths like "skills/x" or ".agents/skills/x" would otherwise match every skill.
  const hay = `${s.name} ${s.description}`.toLowerCase();
  for (const [category, words] of KEYWORDS)
    if (words.some((w) => new RegExp(`\\b${w.replace(/[-]/g, '\\-')}`).test(hay))) return category;
  return 'other';
}

function flattenRequires(value) {
  if (!value || typeof value !== 'object') return [];
  const out = [];
  for (const [key, v] of Object.entries(value)) for (const item of Array.isArray(v) ? v : [v]) out.push(`${key}:${item}`);
  return out;
}

function pathRank(path) {
  if (path.startsWith('skills/')) return 0;
  if (path.startsWith('.claude/skills/')) return 1;
  return 2;
}

function dedupe(entries) {
  const byName = new Map();
  for (const entry of entries) {
    const current = byName.get(entry.name);
    if (!current || pathRank(entry.path) < pathRank(current.path) ||
      (pathRank(entry.path) === pathRank(current.path) && entry.path.length < current.path.length)) byName.set(entry.name, entry);
  }
  return [...byName.values()];
}

const MAX_BODY = 64000;
const SKIP_DIRS = new Set(['node_modules', '.git']);
const SCRIPT_EXT = /\.(py|sh|cjs|mjs|js|ts)$/i;

function findSkillFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'SKILL.md') out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function hasScripts(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).some(
    (e) => (e.isDirectory() && e.name === 'scripts') || (e.isFile() && SCRIPT_EXT.test(e.name))
  );
}

function buildCatalog(root, slug) {
  const parsed = [];
  for (const file of findSkillFiles(root)) {
    const fm = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (!fm || typeof fm.data.name !== 'string' || !fm.data.name.trim()) continue;
    const dir = path.dirname(file);
    const rel = path.relative(root, dir).split(path.sep).join('/');
    if (fm.body.length > MAX_BODY) throw new Error(`${slug}/${fm.data.name}: body exceeds ${MAX_BODY} characters (${fm.body.length})`);
    parsed.push({
      name: fm.data.name.trim(),
      description: String(fm.data.description || '').trim(),
      path: rel,
      category: fm.data.category,
      requires: flattenRequires(fm.data.requires),
      hasScripts: hasScripts(dir),
      body: fm.body
    });
  }
  const skills = [];
  const bodies = {};
  for (const s of dedupe(parsed).sort((a, b) => a.name.localeCompare(b.name))) {
    const id = `${slug}/${s.name}`;
    if (bodies[id] !== undefined) throw new Error(`Duplicate skill id after dedupe: ${id}`);
    bodies[id] = s.body;
    skills.push({
      id, source: slug, path: s.path, name: s.name, description: s.description,
      category: categorize(s), requires: s.requires, hasScripts: s.hasScripts,
      supported: s.requires.length === 0 && !s.hasScripts, bytes: s.body.length
    });
  }
  return { skills, bodies };
}

module.exports = { parseFrontmatter, categorize, flattenRequires, dedupe, buildCatalog, CATEGORIES, MAX_BODY };
