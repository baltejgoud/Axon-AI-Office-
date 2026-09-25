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

const { PAINTERS, paintSeed } = require('../src/renderer/src/features/office/scene/room/screenPainters.ts');
const { seeded } = require('../src/renderer/src/features/office/scene/room/kit.ts');

/** Paints an app with a pen that records every shape's bounding box. */
function record(app, variant) {
  const shapes = [];
  const box = (kind, color, x, y, w, h) => shapes.push({ kind, color, x, y, w, h });
  const pen = {
    rect: (color, x, y, w, h) => box('rect', color, x, y, w, h),
    round: (color, x, y, w, h) => box('round', color, x, y, w, h),
    dot: (color, x, y, r) => box('dot', color, x - r, y - r, r * 2, r * 2),
    line: (color, width, points) => {
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const pad = width / 2;
      box(
        'line',
        color,
        Math.min(...xs) - pad,
        Math.min(...ys) - pad,
        Math.max(...xs) - Math.min(...xs) + width,
        Math.max(...ys) - Math.min(...ys) + width
      );
    }
  };
  PAINTERS[app](pen, seeded(paintSeed(app, variant)), variant);
  return shapes;
}

test('every app is painted, inside its tile, the same every time, and its two variants differ', () => {
  for (const app of apps.SCREEN_APPS) {
    const [zero, one] = [record(app, 0), record(app, 1)];
    for (const [variant, shapes] of [
      [0, zero],
      [1, one]
    ]) {
      assert.ok(shapes.length >= 12, `${app} ${variant} draws ${shapes.length} shapes`);
      for (const s of shapes)
        assert.ok(
          s.x >= -0.5 && s.y >= -0.5 && s.x + s.w <= 256.5 && s.y + s.h <= 160.5,
          `${app} ${variant}: ${s.kind} at ${s.x.toFixed(1)},${s.y.toFixed(1)} ${s.w.toFixed(1)}x${s.h.toFixed(1)}`
        );
    }
    assert.deepEqual(record(app, 0), zero, `${app} paints the same way twice`);
    assert.notDeepEqual(zero, one, `${app}'s variants differ`);
  }
});

test("nothing small straddles a scroll band's edge, so the wrap is seamless", () => {
  for (const [app, band] of Object.entries(apps.SCROLL))
    for (const variant of [0, 1])
      for (const s of record(app, variant)) {
        if (s.h > 20 || s.x + s.w <= band.left || s.x >= band.right) continue;
        const inside = s.y >= band.top - 0.01 && s.y + s.h <= band.bottom + 0.01;
        const outside = s.y + s.h <= band.top + 0.01 || s.y >= band.bottom - 0.01;
        assert.ok(
          inside || outside,
          `${app} ${variant}: ${s.kind} at y ${s.y.toFixed(1)}+${s.h.toFixed(1)} crosses ${band.top}..${band.bottom}`
        );
      }
});

const THREE = require('three');
const { DeskScreens } = require('../src/renderer/src/features/office/scene/room/screens.ts');

test('every desk screen is one instance of one mesh, showing its own app', () => {
  const at = (x) => new THREE.Matrix4().makeTranslation(x, 1, 0);
  const screens = new DeskScreens(
    [
      { deskId: 'a', app: 'editor', variant: 0, matrix: at(0) },
      { deskId: 'a', app: 'browser-devtools', variant: 0, matrix: at(1) },
      { deskId: 'b', app: 'design', variant: 1, matrix: at(2) }
    ],
    new THREE.DataTexture(new Uint8Array(4), 1, 1)
  );
  const meshes = [];
  screens.object.traverse((o) => o.isMesh && meshes.push(o));
  assert.equal(meshes.length, 1);
  assert.equal(meshes[0].name, 'screens');
  assert.equal(meshes[0].count, 3);
  const geometry = meshes[0].geometry;
  const tile = geometry.getAttribute('screenTile');
  const design = apps.tileOf('design', 1);
  assert.deepEqual([tile.getX(2), tile.getY(2)], [design.x, design.y]);
  const band = geometry.getAttribute('screenBand');
  const { left, top, right, bottom } = apps.SCROLL.editor;
  assert.deepEqual([band.getX(0), band.getY(0), band.getZ(0), band.getW(0)], [left, top, right, bottom]);
  assert.deepEqual([band.getX(2), band.getY(2), band.getZ(2), band.getW(2)], [0, 0, 0, 0]);
  assert.equal(geometry.getAttribute('screenMotion').getX(0), apps.SCROLL.editor.speed);
  assert.equal(geometry.getAttribute('screenCursor').getZ(0), 1, 'the editor has a light cursor');
  assert.equal(geometry.getAttribute('screenCursor').getZ(2), 0, 'the design canvas has none');
  screens.dispose();
});

test('the status strip follows the desk owner, and screens brighten while someone works there', () => {
  const screens = new DeskScreens(
    [
      { deskId: 'a', app: 'editor', variant: 0, matrix: new THREE.Matrix4() },
      { deskId: 'b', app: 'kanban', variant: 1, matrix: new THREE.Matrix4() }
    ],
    new THREE.DataTexture(new Uint8Array(4), 1, 1)
  );
  const status = { a: 'working', b: undefined };
  const strip = screens.mesh.geometry.getAttribute('screenStatus');
  screens.update(
    0.1,
    1,
    () => 'active',
    (desk) => status[desk]
  );
  assert.deepEqual([strip.getX(0), strip.getX(1)], [1, 0]);
  status.a = 'completed';
  screens.update(
    0.1,
    2,
    () => 'active',
    (desk) => status[desk]
  );
  assert.equal(screens.stripOf('a'), 3);
  screens.update(
    0.1,
    2 + apps.DONE_FOR + 0.5,
    () => 'active',
    (desk) => status[desk]
  );
  assert.equal(screens.stripOf('a'), 0, 'the green strip goes after a while');
  status.b = 'error';
  screens.update(
    0.1,
    30,
    () => 'active',
    (desk) => status[desk]
  );
  assert.equal(screens.stripOf('b'), 4);
  for (let i = 0; i < 60; i++)
    screens.update(
      0.1,
      31 + i * 0.1,
      () => 'active',
      (desk) => status[desk]
    );
  const color = new THREE.Color();
  screens.mesh.getColorAt(0, color);
  assert.ok(color.r > 0.95, `screen brightness ${color.r}`);
  screens.dispose();
});

/** Hue in degrees, saturation and brightness (HSV) of a #rrggbb colour. */
function hsv(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d) hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (hue * 60 + 360) % 360, saturation: max ? d / max : 0, value: max };
}

test('no app paints a full-width bar in a status colour where the status strip goes', () => {
  // Working blue, waiting amber, done green, error red (screens.ts STRIP).
  const statusHues = [217, 38, 142, 0];
  for (const app of apps.SCREEN_APPS)
    for (const variant of [0, 1])
      for (const s of record(app, variant)) {
        if (s.w < 154 || s.y + s.h <= 160 * 0.9 || !/^#[0-9a-f]{6}$/i.test(s.color)) continue;
        const { hue, saturation, value } = hsv(s.color);
        if (saturation < 0.35 || value < 0.3) continue;
        const near = statusHues.find((h) => Math.min(Math.abs(hue - h), 360 - Math.abs(hue - h)) < 25);
        assert.equal(
          near,
          undefined,
          `${app} ${variant}: a ${s.color} bar at y ${s.y} looks like a status strip`
        );
      }
});
