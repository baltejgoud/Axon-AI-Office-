// The campus: districts, generated layout, navigation at scale, rendering tiers and search.
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
const districts = require('../src/renderer/src/features/office/campus/districts.ts');
const agents = require('../src/renderer/src/features/office/data/officeAgents.ts');
const catalog = require('../src/renderer/src/features/office/data/coworkerCatalog.ts');

test('every catalog department belongs to exactly one district', () => {
  const listed = districts.DISTRICTS.flatMap((d) => d.departments);
  assert.equal(new Set(listed).size, listed.length);
  assert.deepEqual([...listed].sort(), [...catalog.SPECIALIST_GROUPS].sort());
  assert.equal(catalog.SPECIALIST_GROUPS.length, 22);
});

test('all 207 coworkers have a district and department', () => {
  assert.equal(agents.OFFICE_AGENTS.length, 207);
  for (const a of agents.OFFICE_AGENTS) {
    assert.ok(districts.districtById(a.district), a.id);
    assert.ok(a.department, a.id);
  }
  assert.equal(agents.OFFICE_AGENTS.filter((a) => a.district === 'commons').length, 8);
});

test('district colours are dark enough for white text and for text on white', () => {
  const lum = (hex) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const d of districts.DISTRICTS) assert.ok(1.05 / (lum(d.color) + 0.05) >= 4.5, `${d.id} ${d.color}`);
});

test('district rectangles do not overlap and keep a 2.4 m corridor', () => {
  const list = districts.DISTRICTS;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].bounds;
      const b = list[j].bounds;
      const gapX = Math.max(b.minX - a.maxX, a.minX - b.maxX);
      const gapZ = Math.max(b.minZ - a.maxZ, a.minZ - b.maxZ);
      assert.ok(Math.max(gapX, gapZ) >= 2.4, `${list[i].id} / ${list[j].id}`);
    }
});

const layout = require('../src/renderer/src/features/office/simulation/layout.ts');
const hood = require('../src/renderer/src/features/office/campus/neighbourhoods.ts');
const nav = require('../src/renderer/src/features/office/simulation/navigation.ts');
const inside = (p, b) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;

test('podGrid fits every department in its cell', () => {
  assert.deepEqual(hood.podGrid(14, 9.9, 18.9), { cols: 2, rows: 2 });
  assert.deepEqual(hood.podGrid(10, 8.9, 18.5), { cols: 1, rows: 3 });
  assert.deepEqual(hood.podGrid(17, 35, 19), { cols: 4, rows: 2 });
});

test('every coworker has a unique home desk with a workstation', () => {
  const desks = agents.OFFICE_AGENTS.map((a) => layout.HOME_DESKS[a.id]);
  assert.ok(desks.every(Boolean));
  assert.equal(new Set(desks).size, 207);
  const setups = new Set(layout.DESK_SETUPS.map((s) => s.poiId));
  for (const desk of desks) assert.ok(setups.has(desk), desk);
});

test('specialists sit in their own district and department', () => {
  for (const a of agents.OFFICE_AGENTS.filter((x) => x.district !== 'commons')) {
    const poi = layout.poiById(layout.HOME_DESKS[a.id]);
    assert.equal(poi.district, a.district, a.id);
    assert.equal(poi.department, a.department, a.id);
    assert.ok(inside(poi.position, districts.districtById(a.district).bounds), a.id);
  }
});

test('blocking furniture never overlaps and stays inside the campus', () => {
  const rects = layout.FURNITURE.filter((f) => f.blocks && !/-seat$/.test(f.id))
    .map((f) => {
      const turned = Math.abs(Math.sin(f.rotation)) > 0.5;
      const hw = (turned ? f.d : f.w) / 2;
      const hd = (turned ? f.w : f.d) / 2;
      return { id: f.id, minX: f.x - hw, maxX: f.x + hw, minZ: f.z - hd, maxZ: f.z + hd };
    })
    .sort((a, b) => a.minX - b.minX);
  const room = layout.ROOM;
  for (const r of rects)
    assert.ok(r.minX > room.minX && r.maxX < room.maxX && r.minZ > room.minZ && r.maxZ < room.maxZ, r.id);
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length && rects[j].minX < rects[i].maxX - 0.01; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlap = a.minZ < b.maxZ - 0.01 && b.minZ < a.maxZ - 0.01;
      assert.ok(!overlap, `${a.id} overlaps ${b.id}`);
    }
});

test('every department has an anchor inside its district', () => {
  for (const d of districts.DISTRICTS)
    for (const dep of d.departments) assert.ok(inside(layout.DEPARTMENT_ANCHORS[dep], d.bounds), dep);
});

test('spot ids are unique', () => {
  const ids = layout.POINTS_OF_INTEREST.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('nav grid builds quickly at campus size', () => {
  const started = performance.now();
  const grid = new nav.NavGrid(nav.obstaclesFrom(layout.WALLS, layout.FURNITURE));
  const ms = performance.now() - started;
  console.log(`nav grid ${grid.cols}x${grid.rows} in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 600, `${ms} ms`);
});

test('every spot is walkable and reachable from reception', () => {
  const grid = new nav.NavGrid(nav.obstaclesFrom(layout.WALLS, layout.FURNITURE));
  const mask = grid.reachableFrom(layout.poiById('visit-desk-reception').approach);
  for (const poi of layout.POINTS_OF_INTEREST) {
    assert.ok(grid.isFree(poi.approach), `${poi.id} approach inside furniture`);
    assert.ok(grid.isReachable(mask, poi.approach), `${poi.id} unreachable`);
  }
});
