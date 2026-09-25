// The office day: a rhythm that follows the clock, standups at team boards, lunch, and chats.
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
const day = require('../src/renderer/src/features/office/simulation/dayRhythm.ts');

test('the day has a shape: coffee on arrival, standups, two breaks, lunch, a wind-down', () => {
  const phase = (hour) => day.rhythmAt(hour).phase;
  assert.equal(phase(7), 'early');
  assert.equal(phase(9), 'arrival');
  assert.equal(phase(9.75), 'standups');
  assert.equal(phase(10.5), 'morning-break');
  assert.equal(phase(11), 'focus');
  assert.equal(phase(12.5), 'lunch');
  assert.equal(phase(14), 'focus');
  assert.equal(phase(15.25), 'afternoon-break');
  assert.equal(phase(16.5), 'focus');
  assert.equal(phase(18), 'wind-down');
  assert.equal(phase(21), 'evening');
});

test('coffee peaks on arrival and at the breaks; lunch empties desks more than any other time', () => {
  const coffee = (hour) => day.rhythmAt(hour).weights.coffee ?? 1;
  assert.ok(coffee(9) > coffee(11) && coffee(10.5) > coffee(11) && coffee(15.25) > coffee(16));
  const lunch = day.rhythmAt(12.5);
  assert.ok(lunch.lunch > 0 && day.rhythmAt(11).lunch === 0);
  for (const hour of [7, 9, 9.75, 10.5, 11, 14, 15.25, 18, 21]) assert.ok(day.rhythmAt(hour).away < lunch.away, `${hour}`);
  assert.ok(lunch.deskLunch > 0.3 && lunch.deskLunch < 0.7, 'most people eat at their desk, not everyone');
});

test('standups gather often in their window, now and then through the working day, never at night', () => {
  const every = (hour) => day.rhythmAt(hour).standupEvery;
  assert.ok(every(9.75) !== null && every(9.75) <= 60);
  assert.ok(every(11) !== null && every(11) > every(9.75));
  assert.equal(every(12.5), null);
  assert.equal(every(7), null);
  assert.equal(every(21), null);
});

test('without a clock the office keeps a plain working rhythm', () => {
  const plain = day.rhythmAt(null);
  assert.equal(plain.phase, 'focus');
  assert.deepEqual(plain.weights, {});
  assert.equal(plain.away, 1);
  assert.equal(plain.lunch, 0);
  assert.equal(plain.standupEvery, null);
  assert.equal(plain.deskLunch, 0);
});

const { OfficeSimulation } = require('../src/renderer/src/features/office/simulation/OfficeSimulation.ts');
const layout = require('../src/renderer/src/features/office/simulation/layout.ts');
const catalog = require('../src/renderer/src/features/office/data/coworkerCatalog.ts');
const commons = require('../src/renderer/src/features/office/campus/commons.ts');
const CORE = Object.keys(commons.CORE_HOME_DESKS);
const SPECIALISTS = catalog.SPECIALIST_ROLES.map((role) => role.id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const departmentOf = (id) => layout.poiById(layout.HOME_DESKS[id]).department;
const typeOf = (poiId) => (poiId ? layout.poiById(poiId).type : null);

function run(office, seconds, each, dt = 1 / 20) {
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    office.step(dt);
    if (each && each(office) === false) return true;
  }
  return false;
}

test('at standup time a team gathers at its board: one walks the board, the rest stand in an arc and take turns', () => {
  const office = new OfficeSimulation({ agentIds: SPECIALISTS, seed: 5, clock: () => 9.75 });
  let seen = null;
  run(office, 240, (o) => {
    const views = o.views().filter((v) => typeOf(v.poiId) === 'standup' && v.speed === 0);
    if (views.length >= 2) {
      seen = views;
      return false;
    }
  });
  assert.ok(seen, 'a standup formed');
  const department = layout.poiById(seen[0].poiId).department;
  for (const view of seen) assert.equal(departmentOf(view.id), department, 'only their own team');
  // Once everyone is there, exactly one person talks at a time; the others listen or laugh.
  let checked = 0;
  run(office, 60, (o) => {
    const group = o.views().filter((v) => departmentOf(v.id) === department && typeOf(v.poiId) === 'standup');
    if (group.length < 2 || group.some((v) => v.speed > 0)) return;
    const talking = group.filter((v) => v.behavior === 'talking');
    assert.ok(talking.length <= 1, 'one voice at a time');
    for (const v of group) assert.ok(['talking', 'listening', 'laughing'].includes(v.behavior), v.behavior);
    for (const v of group) if (v.behavior !== 'talking') assert.ok(v.attention, 'listeners look at someone');
    checked++;
  });
  assert.ok(checked > 100, `watched the standup (${checked})`);
  // It ends, and everyone goes back to their desk.
  const ended = run(office, 300, (o) =>
    o.views().every((v) => departmentOf(v.id) !== department || typeOf(v.poiId) !== 'standup') ? false : undefined
  );
  assert.ok(ended, 'the standup broke up');
});

test('no standups without a clock, at lunch or at night; and never from the Commons core team', () => {
  for (const clock of [undefined, () => 12.5, () => 21]) {
    const office = new OfficeSimulation({ agentIds: [...CORE, ...SPECIALISTS.slice(0, 60)], seed: 3, clock });
    run(office, 400, (o) => {
      assert.ok(o.views().every((v) => typeOf(v.poiId) !== 'standup'));
    }, 1 / 10);
  }
  const office = new OfficeSimulation({ agentIds: CORE, seed: 3, clock: () => 9.75 });
  run(office, 300, (o) => assert.ok(o.views().every((v) => typeOf(v.poiId) !== 'standup')), 1 / 10);
});

test('a real task pulls someone out of a standup, and the rest carry on or break up', () => {
  const office = new OfficeSimulation({ agentIds: SPECIALISTS, seed: 5, clock: () => 9.75 });
  let who = null;
  run(office, 240, (o) => {
    const v = o.views().find((view) => typeOf(view.poiId) === 'standup' && view.speed === 0);
    if (v) {
      who = v.id;
      return false;
    }
  });
  assert.ok(who);
  office.setTaskStatus(who, 'working');
  const home = layout.HOME_DESKS[who];
  assert.ok(run(office, 60, (o) => (o.view(who).poiId === home && o.view(who).sit > 0.95 ? false : undefined)));
});

test('coffee with company: two people near each other face each other and take turns', () => {
  const office = new OfficeSimulation({ agentIds: CORE, seed: 11 });
  let pairs = 0;
  run(office, 1800, (o) => {
    const views = o.views();
    for (const v of views) {
      if (v.behavior !== 'talking' || !v.attention) continue;
      const partner = views.find((w) => w.id !== v.id && dist(w.position, v.attention) < 0.05);
      if (!partner || !['listening', 'laughing'].includes(partner.behavior)) continue;
      if (typeOf(v.poiId) === 'desk' || typeOf(partner.poiId) === 'desk') continue;
      assert.ok(dist(v.position, partner.position) < 2.7, 'they are together');
      assert.ok(partner.attention && dist(partner.attention, v.position) < 0.05, 'the listener looks back');
      pairs++;
    }
  }, 1 / 10);
  assert.ok(pairs > 20, `chats happened (${pairs} frames)`);
});

test('lunch: people from the Commons eat off a plate at a café seat; others eat at their desk', () => {
  const office = new OfficeSimulation({ agentIds: [...CORE, ...SPECIALISTS], seed: 2, clock: () => 12.5 });
  let cafe = 0;
  let deskLunches = 0;
  run(office, 900, (o) => {
    for (const v of o.views()) {
      if (v.behavior === 'eating' && v.heldItem === 'plate' && typeOf(v.poiId) === 'cafe-seat') cafe++;
    }
    deskLunches = Math.max(deskLunches, layout.DESK_SETUPS.filter((s) => o.lunchAt(s.poiId)).length);
  }, 1 / 5);
  assert.ok(cafe > 0, 'someone ate in the café');
  assert.ok(deskLunches > 40, `lunch on many desks (${deskLunches})`);
  // Only the person actually sitting there has lunch on their desk.
  for (const setup of layout.DESK_SETUPS)
    if (office.lunchAt(setup.poiId)) assert.equal(office.occupantsOf(setup.poiId).length, 1);
});

test('outside lunch nobody has lunch on their desk', () => {
  const office = new OfficeSimulation({ agentIds: SPECIALISTS.slice(0, 80), seed: 2, clock: () => 16 });
  run(office, 600, (o) => assert.ok(layout.DESK_SETUPS.every((s) => !o.lunchAt(s.poiId))), 1 / 5);
});

test('lunch lets more people away from their desks, within its own budget', () => {
  const office = new OfficeSimulation({ agentIds: [...CORE, ...SPECIALISTS], seed: 4, clock: () => 12.5 });
  let most = 0;
  run(office, 900, (o) => {
    most = Math.max(most, o.awayCount());
  }, 1 / 5);
  assert.ok(most > 12 && most <= 18, `at most eighteen away at lunch (${most})`);
});

const placement = require('../src/renderer/src/features/office/campus/deskPlacement.ts');

test('every desk has room for lunch within reach, clear of its screens and its owner\'s things', () => {
  let missing = 0;
  for (const setup of layout.DESK_SETUPS) {
    const poi = layout.poiById(setup.poiId);
    const surface = placement.surfaceOf(setup.poiId, poi.district);
    const lunch = placement.lunchPlacement(setup.equipment, setup.props, surface);
    if (!lunch) {
      missing++;
      continue;
    }
    assert.ok(lunch.x - lunch.w / 2 >= surface.minX - 1e-9 && lunch.x + lunch.w / 2 <= surface.maxX + 1e-9);
    assert.ok(lunch.z - lunch.d / 2 >= surface.minZ - 1e-9 && lunch.z + lunch.d / 2 <= surface.maxZ + 1e-9);
    assert.ok(Math.abs(lunch.x) <= 0.62, `${setup.poiId}: within reach`);
    const others = [
      ...placement.equipmentPlacements(setup.equipment, surface),
      ...placement.propPlacements(setup.equipment, setup.props, surface)
    ];
    for (const other of others)
      assert.ok(
        !(Math.abs(lunch.x - other.x) * 2 < lunch.w + other.w && Math.abs(lunch.z - other.z) * 2 < lunch.d + other.d),
        `${setup.poiId}: lunch overlaps ${other.item}`
      );
  }
  assert.ok(missing <= layout.DESK_SETUPS.length * 0.05, `${missing} desks without room for lunch`);
});

test('every department has room to stand up at its board, and nothing tall hides the team from view', () => {
  const boards = layout.POINTS_OF_INTEREST.filter((p) => p.type === 'whiteboard' && p.department);
  const departments = new Set(boards.map((p) => p.department));
  assert.ok(departments.size >= 20);
  for (const department of departments) {
    const spots = layout.POINTS_OF_INTEREST.filter((p) => p.type === 'standup' && p.department === department);
    assert.ok(spots.length >= 2, `${department}: ${spots.length} places`);
    for (const spot of spots) {
      // Turned in toward the middle of the arc, never with their back to the viewer.
      assert.ok(Math.cos(spot.facing) > -0.2, `${spot.id} faces away`);
      // No tree in the two metres toward the viewer.
      for (const item of layout.FURNITURE.filter((f) => f.kind === 'tree'))
        for (let t = 0.3; t <= 2.4; t += 0.15) {
          const x = spot.position.x + Math.sin(0.42) * t;
          const z = spot.position.z + Math.cos(0.42) * t;
          assert.ok(!(Math.abs(item.x - x) < item.w / 2 && Math.abs(item.z - z) < item.d / 2), `${spot.id} behind ${item.id}`);
        }
    }
  }
});
