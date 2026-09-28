#!/usr/bin/env node
// Dev-time only. Reads each source in skills.sources.json and regenerates src/skills/*.
// A source is a GitHub repository pinned to the commit we reviewed, or a folder in this repository
// ("path") holding our own skills. The app itself never runs git or touches the network.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildCatalog } = require('./ingest-core.cjs');

const root = path.resolve(__dirname, '..', '..');
const outDir = path.join(root, 'src', 'skills');
const sources = JSON.parse(fs.readFileSync(path.join(root, 'skills.sources.json'), 'utf8'));

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** The pinned commit, fetched alone: the catalog changes only when the pin does. */
function fetchPinned(source, dir) {
  if (!/^[0-9a-f]{40}$/.test(source.commit || '')) throw new Error(`${source.slug}: pin a full commit SHA`);
  git('init', '--quiet', dir);
  git('-C', dir, 'fetch', '--depth', '1', '--quiet', source.url, source.commit);
  git('-C', dir, 'checkout', '--quiet', 'FETCH_HEAD');
  return git('-C', dir, 'rev-parse', 'HEAD');
}

const allSkills = [];
const allBodies = {};
const info = [];
const licenses = ['# Third-party skill licenses', '', 'Skills bundled in `src/skills/` are copied from the repositories below. Each remains under its own license.', ''];

for (const source of sources) {
  if (!/^[a-z0-9-]+$/.test(source.slug)) throw new Error(`Bad slug: ${source.slug}`);
  const local = source.path ? path.join(root, source.path) : null;
  const tmp = local ? null : fs.mkdtempSync(path.join(os.tmpdir(), `axon-ingest-${source.slug}-`));
  const dir = local ?? tmp;
  console.log(local ? `Reading ${source.path} …` : `Fetching ${source.url} @ ${source.commit.slice(0, 7)} …`);
  try {
    const commit = local ? git('-C', root, 'rev-parse', 'HEAD') : fetchPinned(source, dir);
    const { skills, bodies } = buildCatalog(dir, source.slug);
    allSkills.push(...skills);
    Object.assign(allBodies, bodies);
    const url = source.url ?? source.path;
    info.push({ slug: source.slug, url, license: source.license, commit, skillCount: skills.length });
    const licenseFile = fs.readdirSync(dir).find((f) => /^LICENSE/i.test(f));
    licenses.push(`## ${source.slug}`, '', `- ${local ? 'Folder' : 'Repository'}: ${url}`, `- Commit: ${commit}`, `- License: ${source.license}`, '');
    if (licenseFile) licenses.push('```', fs.readFileSync(path.join(dir, licenseFile), 'utf8').trim(), '```', '');
    else licenses.push('_No LICENSE file present at the recorded commit._', '');
    console.log(`  ${skills.length} skills @ ${commit.slice(0, 7)}`);
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

allSkills.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sources: info, skills: allSkills }, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'bodies.json'), JSON.stringify(allBodies) + '\n');
fs.writeFileSync(path.join(outDir, 'LICENSES.md'), licenses.join('\n'));
console.log(`Wrote ${allSkills.length} skills to ${outDir}`);
