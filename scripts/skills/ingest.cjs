#!/usr/bin/env node
// Dev-time only. Clones each source in skills.sources.json and regenerates src/skills/*.
// The app itself never runs git or touches the network.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildCatalog } = require('./ingest-core.cjs');

const root = path.resolve(__dirname, '..', '..');
const outDir = path.join(root, 'src', 'skills');
const sources = JSON.parse(fs.readFileSync(path.join(root, 'skills.sources.json'), 'utf8'));

const allSkills = [];
const allBodies = {};
const info = [];
const licenses = ['# Third-party skill licenses', '', 'Skills bundled in `src/skills/` are copied from the repositories below. Each remains under its own license.', ''];

for (const source of sources) {
  if (!/^[a-z0-9-]+$/.test(source.slug)) throw new Error(`Bad slug: ${source.slug}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `axon-ingest-${source.slug}-`));
  console.log(`Cloning ${source.url} …`);
  try {
    execFileSync('git', ['clone', '--depth', '1', '--quiet', source.url, tmp], { stdio: 'inherit' });
    const commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const { skills, bodies } = buildCatalog(tmp, source.slug);
    allSkills.push(...skills);
    Object.assign(allBodies, bodies);
    info.push({ slug: source.slug, url: source.url, license: source.license, commit, skillCount: skills.length });
    const licenseFile = fs.readdirSync(tmp).find((f) => /^LICENSE/i.test(f));
    licenses.push(`## ${source.slug}`, '', `- Repository: ${source.url}`, `- Commit: ${commit}`, `- License: ${source.license}`, '');
    if (licenseFile) licenses.push('```', fs.readFileSync(path.join(tmp, licenseFile), 'utf8').trim(), '```', '');
    else licenses.push('_No LICENSE file present at the recorded commit._', '');
    console.log(`  ${skills.length} skills @ ${commit.slice(0, 7)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

allSkills.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sources: info, skills: allSkills }, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'bodies.json'), JSON.stringify(allBodies) + '\n');
fs.writeFileSync(path.join(outDir, 'LICENSES.md'), licenses.join('\n'));
console.log(`Wrote ${allSkills.length} skills to ${outDir}`);
