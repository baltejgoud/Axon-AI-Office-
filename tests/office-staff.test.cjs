// The café's ambient staff: two chefs and a barista on scripted routines. Not coworkers.
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
const routines = require('../src/renderer/src/features/office/scene/staff/routines.ts');
const { OfficeSimulation } = require('../src/renderer/src/features/office/simulation/OfficeSimulation.ts');
const agents = require('../src/renderer/src/features/office/data/officeAgents.ts');
const search = require('../src/renderer/src/features/office/shell/search.ts');

const DT = 0.05;
/** Runs the routines for `seconds` with `waiting` pickups taken, returning the last state of `id`. */
function after(staff, seconds, id, waiting = []) {
  let states = staff.update(0, waiting);
  for (let i = 0; i < Math.round(seconds / DT); i++) states = staff.update(DT, waiting);
  return states.find((s) => s.id === id);
}

test('the grill chef stirs, flips the pan, stirs again and seasons, with the flames on', () => {
  const at = (t) => after(new routines.StaffRoutines(), t, 'chef-grill');
  assert.equal(at(3).action, 'stir');
  assert.equal(at(7).action, 'flip');
  assert.equal(at(7).holding, 'pan');
  assert.equal(at(10).action, 'stir');
  assert.equal(at(15.5).action, 'season');
  assert.ok(at(1).cooking && at(15.5).cooking);
  // A full loop brings him back to the range.
  assert.equal(at(20).action, 'stir');
});

test('the prep chef chops, carries to the pass and plates, then goes back to chopping', () => {
  const at = (t) => after(new routines.StaffRoutines(), t, 'chef-prep');
  assert.equal(at(4).action, 'chop');
  assert.equal(at(4).holding, 'knife');
  assert.ok(at(8.5).walking);
  assert.equal(at(11).action, 'plate');
  assert.equal(at(11).holding, 'plate');
  assert.equal(at(16.5).action, 'chop');
});

test('the barista wipes the bar until someone waits for coffee, then pulls a shot at the nearest machine', () => {
  const staff = new routines.StaffRoutines();
  assert.equal(after(staff, 5, 'barista').action, 'wipe');
  let brewing = 0;
  let where = null;
  for (let i = 0; i < 60; i++) {
    const barista = staff.update(DT, ['cafe-counter-2']).find((s) => s.id === 'barista');
    if (barista.action === 'brew') {
      brewing++;
      where = barista.x;
    }
  }
  assert.ok(brewing > 10, `brewing for ${brewing} frames of the first three seconds`);
  assert.ok(Math.abs(where - routines.MACHINES.west) < 0.05, 'at the west machine');
  // One shot per coffee break: she goes back to wiping while the same person still waits.
  assert.equal(after(staff, 8, 'barista', ['cafe-counter-2']).action, 'wipe');
  // The east pickups are served from the east machine.
  const next = after(staff, 3, 'barista', ['cafe-machine']);
  assert.equal(next.action, 'brew');
  assert.ok(Math.abs(next.x - routines.MACHINES.east) < 0.05);
});

test('staff stay where coworkers cannot walk, and are not coworkers', () => {
  const office = new OfficeSimulation({ agentIds: [] });
  const staff = new routines.StaffRoutines();
  for (let i = 0; i < 6000; i++)
    for (const s of staff.update(DT, i % 400 < 100 ? ['cafe-machine'] : i % 400 < 200 ? ['cafe-counter-2'] : []))
      assert.ok(!office.grid.isFree(s), `${s.id} at ${s.x.toFixed(2)}, ${s.z.toFixed(2)} is on walkable floor`);
  for (const id of routines.STAFF_IDS) assert.ok(!agents.OFFICE_AGENTS.some((a) => a.id === id), id);
  for (const word of ['chef', 'barista', 'kitchen'])
    for (const found of search.searchCoworkers(word, agents.OFFICE_AGENTS))
      assert.ok(!routines.STAFF_IDS.includes(found.id), `${word} finds ${found.id}`);
  assert.equal(agents.OFFICE_AGENTS.length, 208);
});

test('with reduced motion the staff hold still', () => {
  const staff = new routines.StaffRoutines(true);
  const first = staff.update(0, []).map((s) => JSON.stringify(s));
  for (let i = 0; i < 1200; i++) staff.update(DT, i % 200 < 100 ? ['cafe-machine'] : []);
  assert.deepEqual(staff.update(DT, []).map((s) => JSON.stringify(s)), first);
});
