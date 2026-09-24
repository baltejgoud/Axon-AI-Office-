// The low-poly look: quality setting, contact shadows and wall slabs.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        resolveJsonModule: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../src/renderer/src/features/office/scene/render/quality.ts');

test('Auto quality steps down after 4 s of steady slow frames, and never back up', () => {
  const auto = new quality.AutoQuality();
  for (let i = 0; i < 200; i++) auto.sample(40, 1 / 60, false);
  assert.equal(auto.level, 'high', 'a moving camera never counts');
  for (let i = 0; i < 180; i++) auto.sample(40, 1 / 60, true);
  assert.equal(auto.level, 'high', 'three seconds is not enough');
  for (let i = 0; i < 70; i++) auto.sample(40, 1 / 60, true);
  assert.equal(auto.level, 'balanced');
  for (let i = 0; i < 600; i++) auto.sample(60, 1 / 60, true);
  assert.equal(auto.level, 'balanced');
});

test('a fast frame resets the slow streak', () => {
  const auto = new quality.AutoQuality();
  for (let i = 0; i < 200; i++) auto.sample(40, 1 / 60, true);
  auto.sample(58, 1 / 60, true);
  for (let i = 0; i < 200; i++) auto.sample(40, 1 / 60, true);
  assert.equal(auto.level, 'high');
});

test('quality preference defaults to auto without storage', () => {
  assert.equal(quality.qualityPreference(), 'auto');
});

const grounding = require('../src/renderer/src/features/office/scene/room/grounding.ts');

test('contact shadows sit under standing furniture, not under rugs, screens or pendants', () => {
  const at = (kind, w = 1, d = 1, round = false) =>
    grounding.groundShadow({ id: 'x', kind, x: 0, z: 0, w, d, rotation: 0, round, blocks: true });
  assert.equal(at('rug'), null);
  assert.equal(at('wall-screen'), null);
  assert.equal(at('pendant-lamp'), null);
  assert.deepEqual(at('sofa', 2, 1), { w: 2.3, d: 1.3, round: false });
  assert.deepEqual(at('cafe-table', 0.9, 0.9, true), { w: 1.2, d: 1.2, round: true });
});

const walls = require('../src/renderer/src/features/office/scene/room/walls.ts');

test('perimeter walls thicken outward, keeping their inner face; inner walls stay put', () => {
  const room = { minX: -62, maxX: 62, minZ: -38, maxZ: 38 };
  const west = { id: 'w', kind: 'solid', from: { x: -62, z: -38 }, to: { x: -62, z: 38 }, height: 2.7 };
  const back = { id: 'b', kind: 'solid', from: { x: -62, z: -38 }, to: { x: 62, z: -38 }, height: 2.7 };
  const front = { id: 'f', kind: 'low', from: { x: -62, z: 38 }, to: { x: 62, z: 38 }, height: 0.32 };
  const inner = { id: 'i', kind: 'solid', from: { x: -19.4, z: -15 }, to: { x: 19.4, z: -15 }, height: 2.7 };
  for (const wall of [west, back, front]) {
    const slab = walls.wallSlab(wall, room);
    assert.equal(slab.thickness, 0.3, wall.id);
    assert.ok(Math.abs(slab.offset - 0.07) < 1e-9, `${wall.id}: inner face stays 0.08 m from the line`);
  }
  assert.deepEqual(walls.wallSlab(inner, room), { thickness: 0.16, offset: 0 });
});
