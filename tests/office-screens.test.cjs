// Role screens: who sees which app, the sheet's layout, the painters and the screen mesh.
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
const apps = require('../src/renderer/src/features/office/scene/room/screenApps.ts');
const { OFFICE_AGENTS } = require('../src/renderer/src/features/office/data/officeAgents.ts');
const { HOME_DESKS, DESK_SETUPS } = require('../src/renderer/src/features/office/simulation/layout.ts');

const agent = (id) => OFFICE_AGENTS.find((a) => a.id === id);
const pair = (id) => {
  const { main, second } = apps.screenAppsFor(agent(id));
  return [main, second];
};

test('everyone in the office has screens from the agreed table, the same every time', () => {
  for (const person of OFFICE_AGENTS) {
    assert.ok(apps.knownScreenOwner(person), `${person.id} (${person.department}) is in the table`);
    const first = apps.screenAppsFor(person);
    assert.ok(apps.SCREEN_APPS.includes(first.main), person.id);
    assert.ok(first.second === null || apps.SCREEN_APPS.includes(first.second), person.id);
    assert.deepEqual(apps.screenAppsFor(person), first, `${person.id} is stable`);
  }
  assert.equal(
    OFFICE_AGENTS.filter((p) => apps.screenAppsFor(p).second === null).length,
    1,
    'only reception has one screen'
  );
});

test('each role sees its own work', () => {
  assert.deepEqual(pair('frontend-developer'), ['editor', 'browser-devtools']);
  assert.deepEqual(pair('database-administrator'), ['sql', 'terminal']);
  assert.deepEqual(pair('site-reliability-engineer'), ['terminal', 'monitoring']);
  assert.deepEqual(pair('security-engineer'), ['security', 'terminal']);
  assert.deepEqual(pair('qa-engineer'), ['tests', 'kanban']);
  assert.deepEqual(pair('machine-learning-engineer'), ['notebook', 'bi']);
  assert.deepEqual(pair('blockchain-developer'), ['chain', 'editor']);
  assert.deepEqual(pair('game-developer'), ['engine', 'editor']);
  assert.deepEqual(pair('gameplay-programmer'), ['engine', 'editor']);
  assert.deepEqual(pair('robotics-engineer'), ['editor', 'terminal']);
  assert.deepEqual(pair('software-architect'), ['editor', 'document']);
  assert.deepEqual(pair('salesforce-developer'), ['enterprise', 'editor']);
  assert.deepEqual(pair('ui-ux-designer'), ['design', 'moodboard']);
  assert.deepEqual(pair('product-manager'), ['kanban', 'roadmap']);
  assert.deepEqual(pair('engineering-manager'), ['kanban', 'video']);
  assert.deepEqual(pair('sales-manager'), ['pipeline', 'email']);
  assert.deepEqual(pair('customer-success-manager'), ['tickets', 'email']);
  assert.deepEqual(pair('marketing-manager'), ['calendar', 'bi']);
  assert.deepEqual(pair('talent-acquisition-manager'), ['candidates', 'calendar']);
  assert.deepEqual(pair('strategy-manager'), ['slides', 'spreadsheet']);
  assert.deepEqual(pair('chief-executive-officer'), ['slides', 'video']);
  assert.deepEqual(pair('receptionist'), ['calendar', null]);
  assert.deepEqual(pair('writer'), ['document', 'browser']);
  assert.deepEqual(pair('designer'), ['design', 'moodboard']);
});

test("all 27 apps are on someone's desk, and both variants are used", () => {
  const used = new Set();
  const variants = new Set();
  for (const person of OFFICE_AGENTS) {
    const { main, second, variant } = apps.screenAppsFor(person);
    used.add(main);
    if (second) used.add(second);
    variants.add(variant);
  }
  assert.equal(apps.SCREEN_APPS.length, 27);
  assert.deepEqual([...used].sort(), [...apps.SCREEN_APPS].sort());
  assert.deepEqual([...variants].sort(), [0, 1]);
});

test('every home desk is a furnished desk, and spare desks keep their district flavour', () => {
  const desks = new Set(DESK_SETUPS.map((setup) => setup.poiId));
  for (const [id, desk] of Object.entries(HOME_DESKS)) assert.ok(desks.has(desk), `${id}'s desk ${desk}`);
  assert.equal(apps.spareDeskApps('code', 'x').main, 'editor');
  assert.equal(apps.spareDeskApps('data', 'x').main, 'bi');
  assert.equal(apps.spareDeskApps('design', 'x').main, 'design');
  assert.equal(apps.spareDeskApps('document', 'x').main, 'document');
  assert.equal(apps.spareDeskApps('code', 'x').second, null);
});

test('hardware matches the main app', () => {
  assert.equal(apps.hardwareFlavor('design'), 'design');
  assert.equal(apps.hardwareFlavor('moodboard'), 'design');
  assert.equal(apps.hardwareFlavor('editor'), 'code');
  assert.equal(apps.hardwareFlavor('terminal'), 'code');
  assert.equal(apps.hardwareFlavor('bi'), 'data');
  assert.equal(apps.hardwareFlavor('kanban'), 'document');
});

test('the sheet holds every app twice without overlap, and bands and cursors sit inside a tile', () => {
  const seen = new Set();
  for (const app of apps.SCREEN_APPS)
    for (const variant of [0, 1]) {
      const { x, y } = apps.tileOf(app, variant);
      assert.ok(x >= 0 && y >= 0, app);
      assert.ok(
        x + apps.SHEET.tileWidth <= apps.SHEET.width && y + apps.SHEET.tileHeight <= apps.SHEET.height,
        app
      );
      assert.ok(!seen.has(`${x},${y}`), `${app} ${variant} has its own tile`);
      seen.add(`${x},${y}`);
    }
  for (const [app, band] of Object.entries(apps.SCROLL)) {
    assert.ok(band.left >= 0 && band.right <= apps.SHEET.tileWidth && band.left < band.right, app);
    assert.ok(band.top >= 0 && band.bottom <= apps.SHEET.tileHeight && band.top < band.bottom, app);
    assert.ok(band.speed > 0, app);
  }
  for (const [app, spot] of Object.entries(apps.CURSOR))
    assert.ok(
      spot.x > 0 && spot.x < apps.SHEET.tileWidth && spot.y > 0 && spot.y < apps.SHEET.tileHeight,
      app
    );
});

test('the status strip: working, waiting and error while they last; done for 20 seconds', () => {
  assert.equal(apps.stripCode(undefined, 0), 0);
  assert.equal(apps.stripCode('idle', 0), 0);
  assert.equal(apps.stripCode('working', 500), 1);
  assert.equal(apps.stripCode('waiting', 500), 2);
  assert.equal(apps.stripCode('completed', 5), 3);
  assert.equal(apps.stripCode('completed', apps.DONE_FOR + 0.1), 0);
  assert.equal(apps.stripCode('error', 500), 4);
});
