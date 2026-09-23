// Office life simulation: pure logic, no rendering. Proves the behaviour the 3D office shows.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../src/renderer/src/features/office/simulation/OfficeSimulation.ts');
const layout = require('../src/renderer/src/features/office/simulation/layout.ts');

const { OfficeSimulation, WALK_SPEED } = sim;
const ANALYST = 'research-analyst';
const commons = require('../src/renderer/src/features/office/campus/commons.ts');
// The core team in the Commons; the specialists are covered per department below.
const ALL = Object.keys(commons.CORE_HOME_DESKS);
const DESK_MODES = ['typing', 'reading', 'thinking'];
const CAFE_PICKUP = ['cafe-machine', 'cafe-counter-1', 'cafe-counter-2'];
const catalog = require('../src/renderer/src/features/office/data/coworkerCatalog.ts');
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Walking tops out at pace * task factor; sitting/standing slides at most ~0.7 m in 0.65 s (smoothstep peak 1.5x).
const MAX_SPEED = 2.4;

function run(office, seconds, dt, each) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    office.step(dt);
    if (each && each(office) === false) return true;
  }
  return false;
}

function runUntil(office, predicate, limit, dt = 1 / 60) {
  return run(office, limit, dt, () => !predicate(office));
}

test('every department works at its own desks, reachable from the café', () => {
  assert.equal(new Set(catalog.SPECIALIST_ROLES.map((role) => role.id)).size, 199);
  for (const group of catalog.SPECIALIST_GROUPS) {
    const ids = catalog.SPECIALIST_ROLES.filter((role) => role.group === group).map((role) => role.id);
    const office = new OfficeSimulation({ agentIds: [...ALL, ...ids], seed: 17 });
    assert.equal(office.views().length, ALL.length + ids.length);
    const home = layout.HOME_DESKS[ids[0]];
    assert.ok(
      office.grid.findPath(layout.poiById(home).approach, layout.poiById('cafe-machine').approach),
      group
    );
    for (const id of ids) {
      assert.ok(
        layout.DESK_SETUPS.some((setup) => setup.poiId === layout.HOME_DESKS[id]),
        id
      );
      office.setTaskStatus(id, 'working');
    }
    run(office, 1, 0.1);
    for (const id of ids) assert.equal(office.screenState(layout.HOME_DESKS[id]), 'active', id);
  }
});

test('largest department runs with distinct seats and furniture-safe paths', () => {
  const ids = catalog.SPECIALIST_ROLES.filter((role) => role.group === 'AI, ML & Data').map(
    (role) => role.id
  );
  const office = new OfficeSimulation({ agentIds: [...ALL, ...ids], seed: 42 });
  run(office, 20 * 60, 0.1, (o) => {
    const seats = new Set();
    for (const view of o.views()) {
      if (view.poiId) {
        assert.ok(!seats.has(view.poiId), `seat conflict: ${view.poiId}`);
        seats.add(view.poiId);
      }
      if (view.behavior === 'walking')
        assert.ok(o.grid.isFree(view.position), `${view.id} walks through furniture`);
    }
  });
});

test('every spot is on walkable floor; Commons routes and sampled campus routes stay clear of furniture', () => {
  const office = new OfficeSimulation({ agentIds: [] });
  const grid = office.grid;
  for (const poi of layout.POINTS_OF_INTEREST) {
    assert.ok(
      grid.isFree(poi.approach),
      `${poi.id} approach ${JSON.stringify(poi.approach)} is inside furniture`
    );
    assert.ok(dist(poi.approach, poi.position) < 1, `${poi.id} sits too far from where it is approached`);
  }
  const clear = (from, to, label) => {
    const path = grid.findPath(from, to);
    assert.ok(path, `no route ${label}`);
    for (let i = 1; i < path.length; i++)
      assert.ok(grid.isClearLine(path[i - 1], path[i]), `route ${label} cuts through furniture at leg ${i}`);
  };
  const commonsSpots = layout.POINTS_OF_INTEREST.filter((poi) => !poi.district);
  for (const desk of Object.values(commons.CORE_HOME_DESKS)) {
    assert.ok(
      layout.DESK_SETUPS.some((setup) => setup.poiId === desk),
      `${desk} has no workstation`
    );
    for (const poi of commonsSpots)
      clear(layout.poiById(desk).approach, poi.approach, `${desk} -> ${poi.id}`);
  }
  const desks = Object.values(layout.HOME_DESKS);
  const spots = layout.POINTS_OF_INTEREST;
  for (let i = 0; i < 40; i++) {
    const desk = desks[(i * 37) % desks.length];
    const spot = spots[(i * 101 + 13) % spots.length];
    clear(layout.poiById(desk).approach, spot.approach, `${desk} -> ${spot.id}`);
  }
});

test('research analyst: desk -> café -> pause -> back to desk -> sits -> types, never teleporting', () => {
  const office = new OfficeSimulation({ agentIds: [ANALYST], seed: 7 });
  office.setTaskStatus(ANALYST, 'idle');
  office.step(1 / 60);
  let view = office.view(ANALYST);
  assert.equal(view.poiId, 'desk-analyst');
  assert.equal(view.sit, 1);
  assert.ok(DESK_MODES.includes(view.behavior));

  assert.ok(office.requestActivity(ANALYST, 'coffee'));
  const seen = [];
  const note = (label) => seen[seen.length - 1] !== label && seen.push(label);
  let previous = view.position;
  const dt = 1 / 60;
  const done = runUntil(
    office,
    (o) => {
      view = o.view(ANALYST);
      assert.ok(
        dist(previous, view.position) <= MAX_SPEED * dt + 1e-9,
        `jumped ${dist(previous, view.position)} m in one frame`
      );
      if (view.behavior === 'walking') {
        assert.ok(o.grid.isFree(view.position), `walked into furniture at ${JSON.stringify(view.position)}`);
        assert.ok(view.speed <= WALK_SPEED + 1e-9, 'ambient walking should be unhurried');
        note('walking');
      }
      previous = view.position;
      if (CAFE_PICKUP.includes(view.poiId) && view.behavior === 'waiting') note('at café');
      if (view.heldItem === 'cup') note('cup');
      const home = view.poiId === 'desk-analyst' && view.sit === 1 && DESK_MODES.includes(view.behavior);
      if (home && seen.includes('cup')) note('typing at desk');
      return home && seen.includes('cup') && view.heldItem === null;
    },
    240
  );
  assert.ok(done, `trip did not finish; saw ${seen.join(' > ')}`);
  const order = ['walking', 'at café', 'cup', 'typing at desk'].map((label) => seen.indexOf(label));
  assert.ok(
    order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])),
    `out of order: ${seen.join(' > ')}`
  );
  assert.ok(seen.lastIndexOf('walking') > seen.indexOf('cup'), 'she should walk back after getting coffee');
});

test('a real task pulls her back from the café to her desk, and she works until it ends', () => {
  const office = new OfficeSimulation({ agentIds: [ANALYST], seed: 3 });
  office.setTaskStatus(ANALYST, 'idle');
  office.requestActivity(ANALYST, 'coffee');
  assert.ok(
    runUntil(
      office,
      (o) => CAFE_PICKUP.includes(o.view(ANALYST).poiId) && o.view(ANALYST).behavior !== 'walking',
      60
    )
  );

  office.setTaskStatus(ANALYST, 'working');
  office.step(1 / 60);
  let view = office.view(ANALYST);
  assert.equal(view.onTask, true);
  assert.equal(view.behavior, 'walking', 'the coffee break ends immediately');
  let fastest = 0;
  const arrived = runUntil(
    office,
    (o) => {
      view = o.view(ANALYST);
      fastest = Math.max(fastest, view.speed);
      return view.poiId === 'desk-analyst' && view.sit === 1;
    },
    40
  );
  assert.ok(arrived, 'she should be back at her desk well within 40 s');
  assert.ok(fastest > WALK_SPEED, 'real work gets a brisker walk');

  const modes = new Set();
  run(office, 600, 1 / 20, (o) => {
    view = o.view(ANALYST);
    assert.equal(view.poiId, 'desk-analyst', 'no coffee breaks while a task is running');
    assert.ok(DESK_MODES.includes(view.behavior), `unexpected ${view.behavior} while working`);
    assert.equal(o.screenState('desk-analyst'), 'active');
    modes.add(view.behavior);
  });
  assert.ok(modes.has('typing') && modes.has('reading'), `desk work should vary, saw ${[...modes]}`);

  office.setTaskStatus(ANALYST, 'completed');
  office.step(1 / 60);
  assert.equal(office.view(ANALYST).behavior, 'celebrating');
  assert.equal(office.view(ANALYST).onTask, false);
  assert.equal(office.screenState('desk-analyst'), 'on', 'the screen calms down once the task is done');
  assert.ok(
    runUntil(office, (o) => o.view(ANALYST).behavior !== 'celebrating', 4),
    'the celebration is brief'
  );
});

test('an error stops the work instead of typing on', () => {
  const office = new OfficeSimulation({ agentIds: [ANALYST], seed: 4 });
  office.setTaskStatus(ANALYST, 'idle');
  office.setTaskStatus(ANALYST, 'working');
  run(office, 5, 1 / 30);
  office.setTaskStatus(ANALYST, 'error');
  office.step(1 / 30);
  assert.equal(office.view(ANALYST).behavior, 'thinking');
  assert.equal(office.screenState('desk-analyst'), 'on');
});

test('a task that arrives while she is getting up from her desk sits her straight back down', () => {
  const office = new OfficeSimulation({ agentIds: [ANALYST], seed: 5 });
  office.setTaskStatus(ANALYST, 'idle');
  office.requestActivity(ANALYST, 'coffee');
  run(office, 0.25, 1 / 60);
  assert.ok(office.view(ANALYST).sit < 1, 'she has started to stand');
  office.setTaskStatus(ANALYST, 'working');
  let walked = false;
  run(office, 3, 1 / 60, (o) => {
    walked ||= o.view(ANALYST).behavior === 'walking';
  });
  assert.equal(walked, false);
  assert.equal(office.view(ANALYST).poiId, 'desk-analyst');
  assert.equal(office.view(ANALYST).sit, 1);
});

test('a task from the lounge: she stands up first, then walks to her desk', () => {
  const office = new OfficeSimulation({ agentIds: [ANALYST], seed: 6 });
  office.setTaskStatus(ANALYST, 'idle');
  office.requestActivity(ANALYST, 'lounge');
  assert.ok(
    runUntil(office, (o) => o.view(ANALYST).poiId?.startsWith('lounge') && o.view(ANALYST).sit === 1, 60)
  );
  office.setTaskStatus(ANALYST, 'working');
  const sits = [];
  runUntil(
    office,
    (o) => {
      sits.push(o.view(ANALYST).sit);
      return o.view(ANALYST).behavior === 'walking';
    },
    5
  );
  assert.ok(
    sits.some((value) => value > 0.2 && value < 0.9),
    'there is a visible stand-up, not a pop'
  );
  assert.ok(
    runUntil(office, (o) => o.view(ANALYST).poiId === 'desk-analyst' && o.view(ANALYST).sit === 1, 40)
  );
});

test('the office opens mid-task at the desk, and does not replay a finished task', () => {
  const office = new OfficeSimulation({ agentIds: ['writer', 'designer'], seed: 1 });
  office.setTaskStatus('writer', 'working');
  office.setTaskStatus('designer', 'completed');
  office.step(1 / 60);
  assert.equal(office.view('writer').poiId, 'desk-writer');
  assert.equal(office.screenState('desk-writer'), 'active');
  assert.notEqual(office.view('designer').behavior, 'celebrating');
});

test('movement does not depend on frame rate', () => {
  const positions = [1 / 30, 1 / 144].map((dt) => {
    const office = new OfficeSimulation({ agentIds: [ANALYST], seed: 11 });
    office.setTaskStatus(ANALYST, 'idle');
    office.requestActivity(ANALYST, 'coffee');
    run(office, 6, dt);
    return office.view(ANALYST).position;
  });
  assert.ok(
    dist(positions[0], positions[1]) < 0.06,
    `30 fps and 144 fps diverged by ${dist(positions[0], positions[1])} m`
  );
});

test('the same seed replays the same office', () => {
  const snapshot = () => {
    const office = new OfficeSimulation({ agentIds: ALL, seed: 21 });
    for (const id of ALL) office.setTaskStatus(id, 'idle');
    run(office, 180, 1 / 20);
    return JSON.stringify(office.views().map((v) => [v.id, v.poiId, v.behavior, v.position.x.toFixed(3)]));
  };
  assert.equal(snapshot(), snapshot());
});

test('thirty minutes of office life: busy but calm, no stacking, no walking through furniture', () => {
  const office = new OfficeSimulation({ agentIds: ALL, seed: 42 });
  for (const id of ALL) office.setTaskStatus(id, 'idle');
  const dt = 1 / 20;
  const atDesk = Object.fromEntries(ALL.map((id) => [id, 0]));
  const walkingFor = Object.fromEntries(ALL.map((id) => [id, 0]));
  const frozenFor = Object.fromEntries(ALL.map((id) => [id, 0]));
  const lastPosition = {};
  const behaviours = new Set();
  const visitedTypes = new Set();
  let meetingSeen = false;
  let visitSeen = false;
  run(office, 30 * 60, dt, (o) => {
    const occupied = new Map();
    for (const view of o.views()) {
      behaviours.add(view.behavior);
      if (view.poiId) {
        assert.ok(
          !occupied.has(view.poiId),
          `${view.id} and ${occupied.get(view.poiId)} share ${view.poiId}`
        );
        occupied.set(view.poiId, view.id);
        visitedTypes.add(layout.poiById(view.poiId).type);
        if (layout.poiById(view.poiId).type === 'meeting' && view.sit === 1) meetingSeen = true;
        if (layout.poiById(view.poiId).type === 'visit' && view.behavior === 'talking') visitSeen = true;
      }
      if (view.behavior === 'walking') {
        assert.ok(
          o.grid.isFree(view.position),
          `${view.id} walked into furniture at ${JSON.stringify(view.position)}`
        );
        walkingFor[view.id] += dt;
        assert.ok(walkingFor[view.id] < 60, `${view.id} has been walking for a minute without arriving`);
        const moved = lastPosition[view.id] ? dist(lastPosition[view.id], view.position) : 1;
        frozenFor[view.id] = moved < 1e-4 ? frozenFor[view.id] + dt : 0;
        assert.ok(
          frozenFor[view.id] < 2,
          `${view.id} stood frozen mid-walk at ${JSON.stringify(view.position)}`
        );
      } else {
        walkingFor[view.id] = 0;
        frozenFor[view.id] = 0;
      }
      lastPosition[view.id] = view.position;
      if (view.poiId === layout.HOME_DESKS[view.id] && view.sit === 1) atDesk[view.id] += dt;
    }
  });
  const share = Object.values(atDesk).reduce((a, b) => a + b, 0) / (ALL.length * 30 * 60);
  assert.ok(share > 0.5 && share < 0.92, `time at own desk was ${(share * 100).toFixed(0)}%`);
  for (const id of ALL) assert.ok(atDesk[id] > 5 * 60, `${id} barely worked (${atDesk[id].toFixed(0)} s)`);
  assert.ok(meetingSeen, 'no meeting happened in thirty minutes');
  assert.ok(visitSeen, 'nobody stopped by a coworker in thirty minutes');
  for (const type of ['cafe', 'whiteboard', 'bookshelf', 'printer', 'lounge'])
    assert.ok(visitedTypes.has(type), `nobody used a ${type} spot`);
  for (const behaviour of ['walking', 'typing', 'reading', 'coffee', 'meeting', 'talking', 'whiteboard'])
    assert.ok(behaviours.has(behaviour), `never saw ${behaviour}`);
});

test('across many seeds, with real tasks coming and going, nobody gets stuck, stacked or inside furniture', () => {
  const dt = 1 / 20;
  for (let seed = 1; seed <= 12; seed++) {
    const office = new OfficeSimulation({ agentIds: ALL, seed });
    for (const id of ALL) office.setTaskStatus(id, 'idle');
    const walking = {};
    const frozen = {};
    const last = {};
    run(office, 20 * 60, dt, (o) => {
      const tick = Math.round(o.time / dt);
      if (tick % 2400 === 1200) o.setTaskStatus(ALL[((tick / 2400 + seed) % ALL.length) | 0], 'working');
      if (tick % 2400 === 2000) for (const id of ALL) o.setTaskStatus(id, 'completed');
      const seats = new Set();
      for (const view of o.views()) {
        if (view.poiId) {
          assert.ok(!seats.has(view.poiId), `seed ${seed}: two people on ${view.poiId}`);
          seats.add(view.poiId);
        }
        if (view.behavior !== 'walking') {
          walking[view.id] = frozen[view.id] = 0;
        } else {
          assert.ok(o.grid.isFree(view.position), `seed ${seed}: ${view.id} inside furniture`);
          walking[view.id] = (walking[view.id] ?? 0) + dt;
          const moved = last[view.id] ? dist(last[view.id], view.position) : 1;
          frozen[view.id] = moved < 1e-4 ? (frozen[view.id] ?? 0) + dt : 0;
          assert.ok(walking[view.id] < 60, `seed ${seed}: ${view.id} walked a minute without arriving`);
          assert.ok(frozen[view.id] < 2, `seed ${seed}: ${view.id} froze mid-walk`);
        }
        last[view.id] = view.position;
      }
    });
  }
});

test('reduced motion keeps everyone at their desks; work still starts', () => {
  const office = new OfficeSimulation({ agentIds: ALL, seed: 9, reducedMotion: true });
  for (const id of ALL) office.setTaskStatus(id, 'idle');
  run(office, 10 * 60, 1 / 10, (o) => {
    for (const view of o.views())
      assert.notEqual(view.behavior, 'walking', `${view.id} walked under reduced motion`);
  });
  office.setTaskStatus('writer', 'working');
  office.step(1 / 10);
  assert.equal(office.screenState('desk-writer'), 'active');
});

const agents = require('../src/renderer/src/features/office/data/officeAgents.ts');

test('207 people: at most twelve away from their desks, and a step stays cheap', () => {
  const ids = agents.OFFICE_AGENTS.map((a) => a.id);
  const office = new OfficeSimulation({ agentIds: ids, seed: 5 });
  for (const id of ids) office.setTaskStatus(id, 'idle');
  let peak = 0;
  const walking = {};
  run(office, 15 * 60, 1 / 10, (o) => {
    peak = Math.max(peak, o.awayCount());
    assert.ok(o.awayCount() <= 12, `${o.awayCount()} away`);
    for (const view of o.views()) {
      if (view.behavior !== 'walking') {
        walking[view.id] = 0;
        continue;
      }
      assert.ok(o.grid.isFree(view.position), `${view.id} walked into furniture`);
      walking[view.id] = (walking[view.id] ?? 0) + 0.1;
      assert.ok(walking[view.id] < 90, `${view.id} walked for ninety seconds without arriving`);
    }
  });
  assert.ok(peak >= 6, `the office should be lively; peak away was ${peak}`);
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const started = performance.now();
    office.step(1 / 60);
    worst = Math.max(worst, performance.now() - started);
  }
  assert.ok(worst < 8, `worst step ${worst.toFixed(2)} ms`);
});

test('specialists only visit people in their own department, and stay in their district', () => {
  const ids = agents.OFFICE_AGENTS.map((a) => a.id);
  const byId = new Map(agents.OFFICE_AGENTS.map((a) => [a.id, a]));
  const office = new OfficeSimulation({ agentIds: ids, seed: 11 });
  for (const id of ids) office.setTaskStatus(id, 'idle');
  let visits = 0;
  run(office, 20 * 60, 1 / 10, (o) => {
    for (const view of o.views()) {
      const person = byId.get(view.id);
      if (person.district === 'commons' || !view.poiId) continue;
      const spot = layout.poiById(view.poiId);
      if (spot.type === 'visit') {
        visits++;
        assert.equal(layout.poiById(spot.hostDeskId).department, person.department, view.id);
      }
      if (spot.type === 'whiteboard' || spot.type === 'open-area')
        assert.equal(spot.district, person.district, `${view.id} at ${spot.id}`);
    }
  });
  assert.ok(visits > 0, 'nobody visited a colleague in twenty minutes');
});
