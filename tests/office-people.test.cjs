// Who everyone looks like: deterministic, varied within a pod, dressed for their district.
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
const appearance = require('../src/renderer/src/features/office/scene/agents/appearance.ts');
const agents = require('../src/renderer/src/features/office/data/officeAgents.ts');

const specialists = agents.OFFICE_AGENTS.filter((a) => a.district !== 'commons');

test('the same id always gets the same look', () => {
  const a = appearance.generateAppearance('frontend-developer', 'engineering', '#2f5bd3');
  const b = appearance.generateAppearance('frontend-developer', 'engineering', '#2f5bd3');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, appearance.generateAppearance('frontend-developer', 'engineering', '#2f5bd3', 1));
});

test('everyone in the catalog has a complete look', () => {
  for (const agent of agents.OFFICE_AGENTS) {
    const look = appearance.appearanceFor(agent.id);
    assert.ok(look, agent.id);
    for (const key of ['skin', 'hair', 'hairStyle', 'shirt', 'trousers', 'shoes', 'accent', 'top'])
      assert.ok(look[key], `${agent.id} ${key}`);
    assert.ok(look.height >= 1.55 && look.height <= 1.9, `${agent.id} height ${look.height}`);
  }
});

test('nobody in the same pod shares hairstyle and top colour', () => {
  const byDepartment = new Map();
  for (const agent of specialists) {
    const list = byDepartment.get(agent.department) ?? [];
    list.push(agent.id);
    byDepartment.set(agent.department, list);
  }
  for (const [department, ids] of byDepartment)
    for (let start = 0; start < ids.length; start += 4) {
      const pod = ids.slice(start, start + 4).map((id) => {
        const look = appearance.appearanceFor(id);
        return `${look.hairStyle}|${look.jacket ?? look.shirt}`;
      });
      assert.equal(new Set(pod).size, pod.length, `${department} pod ${start / 4}: ${pod.join(', ')}`);
    }
});

test('specialists are dressed for their district', () => {
  for (const agent of specialists) {
    const look = appearance.appearanceFor(agent.id);
    assert.ok(
      appearance.DRESS_CODES[agent.district].tops.includes(look.top),
      `${agent.id} wears ${look.top}`
    );
  }
  for (const agent of specialists.filter((a) => a.district === 'leadership'))
    assert.ok(['suit', 'blazer'].includes(appearance.appearanceFor(agent.id).top), agent.id);
});

test('the catalog is visibly varied', () => {
  const looks = agents.OFFICE_AGENTS.map((a) => appearance.appearanceFor(a.id));
  assert.ok(new Set(looks.map((l) => l.hairStyle)).size >= 8);
  assert.ok(new Set(looks.map((l) => l.skin)).size >= 6);
  assert.ok(new Set(looks.map((l) => l.top)).size >= 6);
  assert.ok(looks.some((l) => l.beard) && looks.some((l) => l.headphones) && looks.some((l) => l.glasses));
});

const { PortraitQueue } = require('../src/renderer/src/features/office/scene/people/portraitQueue.ts');

test('portraits are queued once, in order, with urgent requests first', () => {
  const queue = new PortraitQueue();
  for (const id of ['a', 'b', 'c', 'a']) queue.request(id);
  queue.request('c', true);
  queue.request('d', true);
  assert.deepEqual(queue.take(2), ['d', 'c']);
  assert.deepEqual(queue.take(5), ['a', 'b']);
  queue.request('a');
  assert.equal(queue.size, 0);
});

const lighting = require('../src/renderer/src/features/office/scene/room/lighting.ts');

test('time of day: bright at noon, golden at sunset, lamps on in the evening, never dark', () => {
  const noon = lighting.lightingAt(12);
  const sunset = lighting.lightingAt(18.5);
  const night = lighting.lightingAt(23);
  assert.equal(noon.sunColor, '#fff3df');
  assert.ok(noon.lamps < 0.3 && night.lamps > 0.9);
  assert.equal(sunset.sunColor, '#ffc27d');
  for (let hour = 0; hour < 24; hour += 0.5) {
    const l = lighting.lightingAt(hour);
    assert.ok(l.hemisphere >= 1.3 && l.sun >= 1.0, `too dark at ${hour}`);
    assert.match(l.sky, /^#[0-9a-f]{6}$/);
  }
  assert.deepEqual(lighting.lightingAt(24), lighting.lightingAt(0));
});

const { DISTRICTS } = require('../src/renderer/src/features/office/campus/districts.ts');

test('every district dresses in colours that go with its own', () => {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const gap = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  for (const district of DISTRICTS) {
    const near = appearance.DRESS_CODES[district.id].colours.filter((c) => gap(c, district.color) < 80);
    assert.ok(near.length >= 2, `${district.id}: ${near.join(', ')}`);
  }
});

const THREE = require('three');
const rig = require('../src/renderer/src/features/office/scene/agents/HumanoidRig.ts');
const shapes = require('../src/renderer/src/features/office/scene/agents/bodyShapes.ts');

const trianglesOf = (root) => {
  let count = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const g = object.geometry;
    count += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return count;
};

test('people stay within their triangle budget: close-up figures and the instanced crowd', () => {
  const looks = Object.values(appearance.APPEARANCES);
  for (const [detail, budget] of [
    ['full', 7000],
    ['low', 3300]
  ]) {
    const average = looks.reduce((sum, look) => sum + trianglesOf(rig.buildHumanoid(look, detail).root), 0) / looks.length;
    assert.ok(average <= budget, `${detail}: ${Math.round(average)} triangles a person`);
  }
});

test('close-up hands have a thumb, and the two hands mirror each other', () => {
  const full = shapes.bodyShapes('full');
  const low = shapes.bodyShapes('low');
  const box = (g) => new THREE.Box3().setFromBufferAttribute(g.getAttribute('position'));
  // The thumb reaches forward (+z) past the palm, which the crowd's simpler hands do not.
  assert.ok(box(full.hand[1]).max.z > 0.045);
  assert.ok(box(low.hand[1]).max.z < 0.04);
  const left = box(full.hand[1]);
  const right = box(full.hand[-1]);
  assert.ok(Math.abs(left.min.x + right.max.x) < 1e-6 && Math.abs(left.max.x + right.min.x) < 1e-6);
});

test('hair is smooth, never faceted, on close-up people and in the crowd', () => {
  for (const hairStyle of ['short', 'curly', 'afro', 'bob', 'braids']) {
    const look = { ...appearance.APPEARANCES.receptionist, hairStyle, beard: '#3b2a20' };
    rig.buildHumanoid(look, 'low').root.traverse((object) => {
      if (object instanceof THREE.Mesh) assert.equal(object.material.flatShading, false, hairStyle);
    });
  }
});
