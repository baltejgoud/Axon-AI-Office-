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

test('the campus grows 12 m each way and every district keeps its size', () => {
  assert.deepEqual({ ...layout.ROOM }, { minX: -62, maxX: 62, minZ: -38, maxZ: 38 });
  const size = (id) => {
    const b = districts.districtById(id).bounds;
    return [b.maxX - b.minX, b.maxZ - b.minZ];
  };
  assert.deepEqual(size('commons'), [40, 32]);
  const kept = {
    engineering: [35, 62],
    product: [32, 18.5],
    design: [13, 17],
    leadership: [19, 17],
    'ai-data': [35, 19],
    business: [32, 16.5],
    'people-ops': [35, 20]
  };
  for (const [id, wd] of Object.entries(kept)) assert.deepEqual(size(id), wd, id);
  const r = layout.ROOM;
  for (const d of districts.DISTRICTS) {
    const b = d.bounds;
    assert.ok(
      b.minX - r.minX >= 2 && r.maxX - b.maxX >= 2 && b.minZ - r.minZ >= 2 && r.maxZ - b.maxZ >= 2,
      d.id
    );
  }
});

test('the Commons holds all its rooms, and every Commons spot sits inside it', () => {
  const commons = districts.districtById('commons').bounds;
  const own = layout.POINTS_OF_INTEREST.filter((p) => !p.district);
  for (const poi of own) assert.ok(inside(poi.position, commons), poi.id);
  const zones = new Set(own.map((p) => p.zoneId));
  for (const zone of ['chat', 'workspaces', 'knowledge', 'files', 'agents', 'cafe', 'reception'])
    assert.ok(zones.has(zone), zone);
});

test('the bigger Commons has room for more people', () => {
  const count = (pred) => layout.POINTS_OF_INTEREST.filter(pred).length;
  assert.ok(count((p) => p.type === 'cafe-seat' && !p.district) >= 19, 'café seats');
  assert.ok(count((p) => p.type === 'lounge' && p.zoneId === 'chat') >= 7, 'lounge seats');
  assert.ok(count((p) => p.type === 'lounge' && p.zoneId === 'knowledge') >= 3, 'reading nooks');
  assert.ok(count((p) => p.group === 'meeting-room') >= 7, 'planning A');
  assert.ok(count((p) => p.group === 'planning-room') >= 6, 'planning B');
  const sofas = layout.FURNITURE.filter((f) => f.kind === 'sofa' && f.x < -11 && f.z < -6 && f.x > -20);
  assert.ok(sofas.length >= 3, 'lounge sofas');
  assert.equal(layout.FURNITURE.filter((f) => f.kind === 'bookshelf-tall').length, 2);
  assert.equal(layout.FURNITURE.filter((f) => f.kind === 'cabinet-wall').length, 1);
});

const coffee = require('../src/renderer/src/features/office/campus/coffee.ts');

test('a coffee station in every district but the Commons, two in Engineering', () => {
  const count = {};
  for (const s of coffee.COFFEE_STATIONS) count[s.district] = (count[s.district] ?? 0) + 1;
  for (const d of districts.DISTRICTS.filter((x) => x.id !== 'commons')) assert.ok(count[d.id] >= 1, d.id);
  assert.equal(count.engineering, 2);
  assert.equal(count.commons, undefined);
  for (const s of coffee.COFFEE_STATIONS) {
    assert.ok(layout.FURNITURE.some((f) => f.id === s.id && f.kind === 'coffee-station'), s.id);
    for (const id of coffee.stationSpots(s.id)) assert.equal(layout.poiById(id).district, s.district, id);
  }
});

test('the nearest coffee is the café for the Commons and a station far away', () => {
  const cafe = layout.poiById('cafe-machine').position;
  const at = (id) => layout.poiById(layout.HOME_DESKS[id]).position;
  assert.equal(coffee.nearestCoffee(at('research-analyst'), cafe), 'cafe');
  const far = at('frontend-developer');
  const pick = coffee.nearestCoffee(far, cafe, 'engineering');
  const d = (p) => Math.hypot(p.x - far.x, p.z - far.z);
  const own = coffee.COFFEE_STATIONS.filter((s) => s.district === 'engineering');
  const best = Math.min(d(cafe), ...own.map(d));
  assert.equal(d(pick === 'cafe' ? cafe : own.find((s) => s.id === pick)), best);
  assert.notEqual(pick, 'cafe');
});

test('each executive office is furnished', () => {
  for (let i = 0; i < 10; i++) {
    for (const kind of ['exec-desk', 'exec-credenza', 'exec-rug'])
      assert.ok(layout.FURNITURE.some((f) => f.kind === kind && f.id.endsWith(`-${i}`)), `${kind} ${i}`);
    assert.equal(
      layout.FURNITURE.filter((f) => f.kind === 'armchair' && f.id.startsWith(`exec-armchair-${i}-`)).length,
      2
    );
    assert.equal(layout.FURNITURE.find((f) => f.id === `desk-exec-${i}-seat`).kind, 'exec-chair');
  }
  const art = layout.FURNITURE.filter((f) => f.kind === 'wall-art' || f.kind === 'ledge-art');
  assert.equal(art.length, 10);
  const backRow = layout.WALLS.filter((w) => /^exec-back-[0-4]$/.test(w.id));
  assert.equal(backRow.length, 5);
  assert.ok(backRow.every((w) => w.kind === 'solid'));
});

test('podGrid fits every department in its cell', () => {
  assert.deepEqual(hood.podGrid(14, 9.9, 18.9), { cols: 2, rows: 2 });
  assert.deepEqual(hood.podGrid(10, 8.9, 18.5), { cols: 2, rows: 2 });
  assert.deepEqual(hood.podGrid(10, 5.25, 13.9), { cols: 1, rows: 3 });
  assert.deepEqual(hood.podGrid(14, 9.13, 16.33), { cols: 2, rows: 2 });
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

const tiers = require('../src/renderer/src/features/office/scene/people/tiers.ts');
const P = (id, x, mustBeFull = false, canBeCrowd = true) => ({ id, x, z: 0, mustBeFull, canBeCrowd });

test('full tier keeps required people and fills the rest by distance', () => {
  const people = [P('a', 50, true, false), P('b', 1), P('c', 2), P('d', 30)];
  assert.deepEqual([...tiers.chooseFullTier(people, { x: 0, z: 0 }, 3, new Set())].sort(), ['a', 'b', 'c']);
});

test('required people exceed the budget rather than being dropped', () => {
  const people = [P('a', 1, true, false), P('b', 2, true, false), P('c', 0)];
  assert.deepEqual([...tiers.chooseFullTier(people, { x: 0, z: 0 }, 1, new Set())].sort(), ['a', 'b']);
});

test('hysteresis keeps someone already shown', () => {
  const people = [P('near', 10), P('kept', 12)];
  assert.deepEqual([...tiers.chooseFullTier(people, { x: 0, z: 0 }, 1, new Set(['kept']))], ['kept']);
});

const search = require('../src/renderer/src/features/office/shell/search.ts');
const top = (q) => search.searchCoworkers(q, agents.OFFICE_AGENTS)[0]?.name;

test('search finds people by name or specialty', () => {
  assert.equal(top('front-end'), 'Frontend Developer');
  assert.equal(top('frontend'), 'Frontend Developer');
  assert.equal(top('front end'), 'Frontend Developer');
  assert.equal(top('business analyst'), 'Business Analyst');
  assert.equal(top('sre'), 'Site Reliability Engineer (SRE)');
  assert.equal(top('files'), 'Files Agent');
  assert.equal(top('cto'), 'Chief Technology Officer (CTO)');
  assert.deepEqual(search.searchCoworkers('', agents.OFFICE_AGENTS), []);
  assert.deepEqual(search.searchCoworkers('   ', agents.OFFICE_AGENTS), []);
});

test('search can find a whole department', () => {
  const names = search.searchCoworkers('security', agents.OFFICE_AGENTS, 10).map((a) => a.department);
  assert.ok(names.filter((d) => d === 'Security').length >= 5, names.join(', '));
});

test('pods and their chairs stay inside their department', () => {
  const inCell = (x, z, b) =>
    x >= b.minX - 0.01 && x <= b.maxX + 0.01 && z >= b.minZ - 0.01 && z <= b.maxZ + 0.01;
  for (const poi of layout.POINTS_OF_INTEREST.filter((p) => p.type === 'desk' && p.department)) {
    const cell = layout.DEPARTMENT_BOUNDS[poi.department];
    assert.ok(inCell(poi.position.x, poi.position.z, cell), `${poi.id} outside ${poi.department}`);
    assert.ok(inCell(poi.approach.x, poi.approach.z, cell), `${poi.id} approach outside ${poi.department}`);
  }
});
