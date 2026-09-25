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

const THREE = require('three');
const batching = require('../src/renderer/src/features/office/scene/room/batching.ts');
const materials = require('../src/renderer/src/features/office/scene/room/materials.ts');

test('plain colours of one finish merge into one vertex-coloured mesh; glowing and see-through stay apart', () => {
  const root = new THREE.Group();
  const add = (color, options, x = 0) => root.add(materials.box(color, [1, 1, 1], [x, 0, 0], options));
  add('#ff0000');
  add('#00ff00', undefined, 2);
  add('#0000ff', { roughness: 0.82 }, 4);
  add('#ffffff', { emissive: '#ffcc00', emissiveIntensity: 0.6 });
  add('#d6ebf2', { transparent: true, opacity: 0.3 });
  batching.batchStatic(root);
  const meshes = root.children.filter((c) => c.isMesh);
  assert.equal(meshes.length, 3);
  const painted = meshes.find((m) => m.geometry.getAttribute('color'));
  assert.ok(painted.material.vertexColors);
  const colours = new Set();
  const attr = painted.geometry.getAttribute('color');
  for (let i = 0; i < attr.count; i++)
    colours.add([attr.getX(i), attr.getY(i), attr.getZ(i)].map((v) => v.toFixed(2)).join());
  assert.equal(colours.size, 3);
  // Each box keeps its place: the merged mesh spans all three.
  painted.geometry.computeBoundingBox();
  assert.ok(Math.abs(painted.geometry.boundingBox.max.x - 4.5) < 1e-6);
  assert.equal(painted.geometry.index.count, 36 * 3);
  assert.equal(batching.surfaceKey(materials.mat('#123456', { map: new THREE.Texture() })), null);
});

test('batching copies interleaved attributes (as loaded models have them) value by value', () => {
  // A downloaded model's positions and normals share one buffer: x y z nx ny nz per vertex.
  const box = new THREE.BoxGeometry(1, 1, 1);
  const count = box.getAttribute('position').count;
  const data = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    data.set([box.getAttribute('position').getX(i), box.getAttribute('position').getY(i), box.getAttribute('position').getZ(i)], i * 6);
    data.set([box.getAttribute('normal').getX(i), box.getAttribute('normal').getY(i), box.getAttribute('normal').getZ(i)], i * 6 + 3);
  }
  const buffer = new THREE.InterleavedBuffer(data, 6);
  const model = new THREE.BufferGeometry();
  model.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  model.setAttribute('normal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
  model.setIndex(box.getIndex());
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(model, materials.mat('#336699'));
  mesh.position.x = 10;
  root.add(mesh);
  batching.batchStatic(root);
  const merged = root.children.find((c) => c.isMesh);
  merged.geometry.computeBoundingBox();
  // The unit box, where it was: no normals read as positions, nothing stretched across the room.
  const { min, max } = merged.geometry.boundingBox;
  assert.deepEqual(
    [min.x, max.x, min.y, max.y, min.z, max.z].map((v) => +v.toFixed(6)),
    [9.5, 10.5, -0.5, 0.5, -0.5, 0.5]
  );
  const normals = merged.geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++)
    assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 1e-5);
});

test('batching leaves no empty groups behind, but keeps groups that still hold something that moves', () => {
  const root = new THREE.Group();
  const nested = new THREE.Group();
  const deeper = new THREE.Group();
  deeper.add(materials.box('#ff0000', [1, 1, 1], [0, 0, 0]));
  nested.add(deeper, materials.box('#00ff00', [1, 1, 1], [1, 0, 0]));
  const machine = new THREE.Group();
  const light = materials.box('#ffffff', [0.1, 0.1, 0.1], [0, 0, 0], { emissive: '#ffcc00' });
  light.userData.dynamic = true;
  machine.add(materials.box('#333333', [1, 1, 1], [0, 0, 0]), light);
  root.add(nested, machine);
  batching.batchStatic(root);
  let groups = 0;
  root.traverse((o) => {
    if (o !== root && !o.isMesh) groups++;
  });
  assert.equal(groups, 1, 'only the machine holding its light is left');
  assert.ok(machine.parent === root && light.parent === machine);
});
