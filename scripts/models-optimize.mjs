// Prepares the office's 3D models: each original in source_assets/originals/quaternius is cleaned up
// (duplicate data merged, unused data dropped, vertices welded) and written to
// src/renderer/public/models/office/, where the app loads it from. Simplifying does not help these
// models: their hard edges split every vertex, so the simplifier cannot remove any triangles.
//   npm run models:optimize
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ORIGINALS = path.join(ROOT, 'source_assets/originals/quaternius');
const OUT = path.join(ROOT, 'src/renderer/public/models/office');
const CLI = path.join(ROOT, 'node_modules/@gltf-transform/cli/bin/cli.js');

/** Every model the office uses. */
const MODELS = [
  'desk',
  'office-chair',
  'couch-medium-teal',
  'couch-l-grey',
  'armchair-teal',
  'armchair-grey',
  'table-round-small',
  'bar-stool',
  'desk-lamp',
  'bookcase-books',
  'plant-snake',
  'plant-monstera',
  'plant-monstera-small',
  'plant-banana',
  'plant-broadleaf',
  'plant-cactus-pot',
  'cactus'
];

const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { stdio: 'pipe' });

fs.mkdirSync(OUT, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-models-'));
for (const name of MODELS) {
  const source = path.join(ORIGINALS, `${name}.glb`);
  const target = path.join(OUT, `${name}.glb`);
  const a = path.join(temp, `${name}-a.glb`);
  const b = path.join(temp, `${name}-b.glb`);
  run('dedup', source, a);
  run('prune', a, b);
  run('weld', b, a);
  fs.copyFileSync(a, target);
  const before = fs.statSync(source).size;
  const after = fs.statSync(target).size;
  console.log(`${name.padEnd(22)} ${String(before).padStart(8)} -> ${String(after).padStart(8)} bytes`);
}
fs.rmSync(temp, { recursive: true, force: true });
