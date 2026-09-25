# Role Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every monitor and laptop in the classic office shows its owner's real app (design canvas, code editor, sprint board, CRM pipeline…), with a status strip while that coworker works on one of the user's tasks.

**Architecture:** A pure catalogue (`screenApps.ts`) maps each person to a main and second app and lays out one sheet of tiles. Pure painters (`screenPainters.ts`) draw each app through a tiny `Pen` interface; `screenSheet.ts` runs them onto one canvas. `DeskScreens` (`screens.ts`) draws every screen in the office as one `InstancedMesh`, picking its tile, scrolling a band of it and drawing the status strip in a patched `MeshBasicMaterial`.

**Tech Stack:** TypeScript, three.js 0.186 (WebGL2), Canvas 2D, `node --test` with the repo's TypeScript require hook, Electron desktop check.

**Spec:** `docs/superpowers/specs/2026-09-25-office-role-screens-design.md`

## Global Constraints

- Work on branch `feat/office-real-models`; all paths below are relative to the repo root `D:\Baltej IDE`.
- No new npm dependencies. three.js stays at 0.186.
- The renderer's CSP is `default-src 'self'`: canvases and `CanvasTexture` only; no network images.
- Office budgets in `tests/office-desktop.cjs` must keep passing: whole-campus draw calls ≤ 733, triangles ≤ 2.3M.
- Prettier: `{ "singleQuote": true, "printWidth": 110, "trailingComma": "none", "semi": true }`. Run `npx prettier --check <files>` before each commit.
- Unit tests are `.cjs` files run with `node --test`, loading TypeScript through the require hook already used in `tests/office-look.test.cjs` (copy its first 15 lines).
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Specialists' `role` field is their department name; their job title is `name` (e.g. `"Database Administrator (DBA)"`). Keyword rules read `name`.
- Screen tiles are 256 × 160 px (the whole visible screen); the sheet is 2048 × 1120 (8 × 7 tiles; 27 apps × 2 variants = 54 used). Scrolling wraps inside a per-app band, not the whole tile. (This refines the spec's 256 × 320 tiles; Task 1 updates the spec.)

## File Structure

| File | Responsibility |
|---|---|
| Create `src/renderer/src/features/office/scene/room/screenApps.ts` | Pure: app list, who sees what, spare-desk fallback, hardware flavour, sheet layout, scroll bands, cursor spots, strip codes |
| Create `src/renderer/src/features/office/scene/room/screenPainters.ts` | Pure: `Pen` interface and one painter per app (both variants) |
| Create `src/renderer/src/features/office/scene/room/screenSheet.ts` | DOM: paints every app onto one cached canvas through a canvas-backed `Pen` |
| Modify `src/renderer/src/features/office/scene/room/screens.ts` | `DeskScreens`: one instanced mesh, per-instance tile/band/motion/cursor/status, shader patch |
| Modify `src/renderer/src/features/office/scene/room/desks.ts` | Screens carry `{ app, variant }`; hardware colour from the main app |
| Modify `src/renderer/src/features/office/scene/room/buildOffice.ts` | Owner lookup per desk, sheet texture, `status` into `update`, `stripOf` |
| Modify `src/renderer/src/features/office/scene/OfficeScene.ts` | Desk status lookup, debug handle additions |
| Create `tests/office-screens.test.cjs` | Unit tests for the three pure/three-only units |
| Modify `tests/office-desktop.cjs` | Role close-ups, one-draw-call and strip assertions, sheet dump |

---

### Task 1: Screen app catalogue and who sees what

**Files:**
- Create: `src/renderer/src/features/office/scene/room/screenApps.ts`
- Create: `tests/office-screens.test.cjs`
- Modify: `docs/superpowers/specs/2026-09-25-office-role-screens-design.md` (Rendering section)

**Interfaces:**
- Consumes: `hashString(value: string): number` (unsigned 32-bit) from `src/renderer/src/features/office/simulation/random.ts`; `AgentStatus` from `data/officeAgents.ts`; `ScreenFlavor` from `scene/room/materials.ts`.
- Produces:
  - `SCREEN_APPS` (readonly tuple of 27 names), `type ScreenApp`
  - `interface ScreenPair { main: ScreenApp; second: ScreenApp | null }`, `interface DeskScreenApps extends ScreenPair { variant: 0 | 1 }`
  - `interface ScreenOwner { id: string; name: string; department: string }`
  - `screenAppsFor(owner: ScreenOwner): DeskScreenApps`, `knownScreenOwner(owner: ScreenOwner): boolean`
  - `spareDeskApps(flavor: ScreenFlavor, deskId: string): DeskScreenApps`
  - `hardwareFlavor(app: ScreenApp): ScreenFlavor`
  - `SHEET = { tileWidth: 256, tileHeight: 160, columns: 8, width: 2048, height: 1120 }`, `tileOf(app, variant): { x: number; y: number }`
  - `interface ScrollBand { left: number; top: number; right: number; bottom: number; speed: number }`, `SCROLL: Partial<Record<ScreenApp, ScrollBand>>`
  - `CURSOR: Partial<Record<ScreenApp, { x: number; y: number; light: boolean }>>`
  - `DONE_FOR = 20`, `stripCode(status: AgentStatus | undefined, secondsSinceChange: number): 0 | 1 | 2 | 3 | 4`

- [ ] **Step 1: Write the failing tests**

Create `tests/office-screens.test.cjs`:

```js
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
  assert.equal(OFFICE_AGENTS.filter((p) => apps.screenAppsFor(p).second === null).length, 1, 'only reception has one screen');
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

test('all 27 apps are on someone\'s desk, and both variants are used', () => {
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
      assert.ok(x + apps.SHEET.tileWidth <= apps.SHEET.width && y + apps.SHEET.tileHeight <= apps.SHEET.height, app);
      assert.ok(!seen.has(`${x},${y}`), `${app} ${variant} has its own tile`);
      seen.add(`${x},${y}`);
    }
  for (const [app, band] of Object.entries(apps.SCROLL)) {
    assert.ok(band.left >= 0 && band.right <= apps.SHEET.tileWidth && band.left < band.right, app);
    assert.ok(band.top >= 0 && band.bottom <= apps.SHEET.tileHeight && band.top < band.bottom, app);
    assert.ok(band.speed > 0, app);
  }
  for (const [app, spot] of Object.entries(apps.CURSOR))
    assert.ok(spot.x > 0 && spot.x < apps.SHEET.tileWidth && spot.y > 0 && spot.y < apps.SHEET.tileHeight, app);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/office-screens.test.cjs`
Expected: FAIL — `Cannot find module '../src/renderer/src/features/office/scene/room/screenApps.ts'`.

- [ ] **Step 3: Write `screenApps.ts`**

Create `src/renderer/src/features/office/scene/room/screenApps.ts`:

```ts
import type { AgentStatus } from '../../data/officeAgents';
import { hashString } from '../../simulation/random';
import type { ScreenFlavor } from './materials';

/**
 * What every desk screen shows: the app its owner works in, from their department and job title
 * (docs/superpowers/specs/2026-09-25-office-role-screens-design.md). Pure rules and layout; the
 * pictures are in screenPainters.ts and the drawing in screens.ts.
 */

export const SCREEN_APPS = [
  'editor',
  'terminal',
  'browser-devtools',
  'browser',
  'sql',
  'simulator',
  'monitoring',
  'security',
  'tests',
  'notebook',
  'bi',
  'engine',
  'chain',
  'enterprise',
  'design',
  'moodboard',
  'kanban',
  'roadmap',
  'video',
  'pipeline',
  'tickets',
  'calendar',
  'candidates',
  'spreadsheet',
  'slides',
  'email',
  'document'
] as const;

export type ScreenApp = (typeof SCREEN_APPS)[number];

export interface ScreenPair {
  main: ScreenApp;
  /** The second screen's app, or null for someone who only ever has one screen. */
  second: ScreenApp | null;
}

export interface DeskScreenApps extends ScreenPair {
  /** Which of the app's two pictures: neighbours with the same job do not show the same screen. */
  variant: 0 | 1;
}

/** What the screens need to know about a desk's owner. */
export interface ScreenOwner {
  id: string;
  /** The job title ("Database Administrator (DBA)"); a specialist's `role` is only their department. */
  name: string;
  department: string;
}

const DEPARTMENT_APPS: Readonly<Record<string, ScreenPair>> = {
  'Web & Frontend': { main: 'editor', second: 'browser-devtools' },
  'Backend & APIs': { main: 'editor', second: 'terminal' },
  'Architecture & General Engineering': { main: 'editor', second: 'document' },
  Mobile: { main: 'editor', second: 'simulator' },
  'Cloud & Infrastructure': { main: 'terminal', second: 'monitoring' },
  Security: { main: 'security', second: 'terminal' },
  'QA & Release': { main: 'tests', second: 'kanban' },
  'AI, ML & Data': { main: 'notebook', second: 'bi' },
  'Emerging Tech': { main: 'editor', second: 'terminal' },
  'Platforms & Enterprise': { main: 'enterprise', second: 'editor' },
  Design: { main: 'design', second: 'moodboard' },
  'Product Management': { main: 'kanban', second: 'roadmap' },
  'Project Management': { main: 'kanban', second: 'roadmap' },
  'Engineering Management': { main: 'kanban', second: 'video' },
  'Sales Management': { main: 'pipeline', second: 'email' },
  'Customer Success': { main: 'tickets', second: 'email' },
  'Marketing Management': { main: 'calendar', second: 'bi' },
  'HR & People': { main: 'candidates', second: 'calendar' },
  'Strategy & Innovation': { main: 'slides', second: 'spreadsheet' },
  'Operations Management': { main: 'spreadsheet', second: 'email' },
  'General Management': { main: 'slides', second: 'email' },
  'Executive Leadership': { main: 'slides', second: 'video' }
};

/** The core team in the Commons, by id. */
const CORE_APPS: Readonly<Record<string, ScreenPair>> = {
  receptionist: { main: 'calendar', second: null },
  'research-analyst': { main: 'document', second: 'browser' },
  writer: { main: 'document', second: 'browser' },
  'knowledge-librarian': { main: 'document', second: 'browser' },
  designer: { main: 'design', second: 'moodboard' },
  'product-coach': { main: 'kanban', second: 'roadmap' },
  'ops-coordinator': { main: 'spreadsheet', second: 'email' },
  'files-agent': { main: 'document', second: 'email' },
  'marketing-strategist': { main: 'calendar', second: 'bi' }
};

const DATABASE = /\b(database|dba)\b/i;
const CHAIN = /\b(blockchain|web3|smart contract|crypto|defi)\b/i;
const IMMERSIVE = /\b(game|gameplay|ar|vr|xr|3d|metaverse|graphics)\b/i;

/** Whether the table covers this person: a core-team id or a known department. */
export function knownScreenOwner(owner: ScreenOwner): boolean {
  return owner.id in CORE_APPS || owner.department in DEPARTMENT_APPS;
}

export function screenAppsFor(owner: ScreenOwner): DeskScreenApps {
  return { ...pairFor(owner), variant: (hashString(`screen:${owner.id}`) & 1) as 0 | 1 };
}

function pairFor({ id, name, department }: ScreenOwner): ScreenPair {
  const core = CORE_APPS[id];
  if (core) return core;
  if (department === 'Backend & APIs' && DATABASE.test(name)) return { main: 'sql', second: 'terminal' };
  if (department === 'Emerging Tech') {
    if (CHAIN.test(name)) return { main: 'chain', second: 'editor' };
    if (IMMERSIVE.test(name)) return { main: 'engine', second: 'editor' };
  }
  return DEPARTMENT_APPS[department] ?? { main: 'document', second: 'email' };
}

const FLAVOR_APP: Readonly<Record<ScreenFlavor, ScreenApp>> = {
  code: 'editor',
  data: 'bi',
  design: 'design',
  document: 'document'
};

/** A desk nobody owns (a spare or visitor desk) shows its district's old flavour, as an app. */
export function spareDeskApps(flavor: ScreenFlavor, deskId: string): DeskScreenApps {
  return { main: FLAVOR_APP[flavor], second: null, variant: (hashString(`screen:${deskId}`) & 1) as 0 | 1 };
}

const LIGHT_HARDWARE: ReadonlySet<ScreenApp> = new Set(['design', 'moodboard']);
const DARK_APPS: ReadonlySet<ScreenApp> = new Set([
  'editor',
  'terminal',
  'sql',
  'simulator',
  'monitoring',
  'security',
  'notebook',
  'engine',
  'chain'
]);

/** Hardware to match the main app: light casings for designers, dark keyboards for dark apps. */
export function hardwareFlavor(app: ScreenApp): ScreenFlavor {
  if (LIGHT_HARDWARE.has(app)) return 'design';
  if (DARK_APPS.has(app)) return 'code';
  return app === 'bi' ? 'data' : 'document';
}

/** The screen sheet: one tile per app and variant, each a whole visible screen in pixels. */
export const SHEET = { tileWidth: 256, tileHeight: 160, columns: 8, width: 2048, height: 1120 } as const;

/** Where an app's picture is on the sheet: the tile's top-left corner, in sheet pixels. */
export function tileOf(app: ScreenApp, variant: 0 | 1): { x: number; y: number } {
  const index = SCREEN_APPS.indexOf(app) * 2 + variant;
  return {
    x: (index % SHEET.columns) * SHEET.tileWidth,
    y: Math.floor(index / SHEET.columns) * SHEET.tileHeight
  };
}

/**
 * A part of the screen whose content scrolls (a code pane, a log, a ticket list), in tile pixels
 * with y down, and its speed in pixels per second. The painter draws that part so it repeats every
 * (bottom - top) pixels, so the wrap is seamless.
 */
export interface ScrollBand {
  left: number;
  top: number;
  right: number;
  bottom: number;
  speed: number;
}

export const SCROLL: Partial<Record<ScreenApp, ScrollBand>> = {
  editor: { left: 60, top: 21, right: 232, bottom: 147, speed: 5 },
  terminal: { left: 0, top: 14, right: 256, bottom: 154, speed: 9 },
  tests: { left: 0, top: 28, right: 256, bottom: 140, speed: 4 },
  tickets: { left: 0, top: 28, right: 256, bottom: 140, speed: 3 },
  email: { left: 0, top: 22, right: 96, bottom: 148, speed: 2 },
  security: { left: 0, top: 42, right: 170, bottom: 154, speed: 3 },
  notebook: { left: 0, top: 14, right: 256, bottom: 154, speed: 3 }
};

/** Where a typing cursor blinks while the owner works on a real task, in tile pixels. */
export const CURSOR: Partial<Record<ScreenApp, { x: number; y: number; light: boolean }>> = {
  editor: { x: 150, y: 95, light: true },
  terminal: { x: 70, y: 150, light: true },
  sql: { x: 118, y: 33, light: true },
  notebook: { x: 120, y: 26, light: false },
  document: { x: 150, y: 71, light: false }
};

/** Seconds a finished task's green strip stays on its owner's screens. */
export const DONE_FOR = 20;

/** The status strip under a screen: 0 none, 1 working, 2 waiting for the user, 3 done, 4 error. */
export function stripCode(status: AgentStatus | undefined, secondsSinceChange: number): 0 | 1 | 2 | 3 | 4 {
  switch (status) {
    case 'working':
      return 1;
    case 'waiting':
      return 2;
    case 'completed':
      return secondsSinceChange < DONE_FOR ? 3 : 0;
    case 'error':
      return 4;
    default:
      return 0;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/office-screens.test.cjs`
Expected: PASS, 7 tests. If `gameplay-programmer` or another id is reported missing, print the real ids with
`node -e` over `OFFICE_AGENTS` and correct the test's id (not the rules).

- [ ] **Step 5: Update the spec's rendering notes**

In `docs/superpowers/specs/2026-09-25-office-role-screens-design.md`, replace the whole `- **Screen sheet**: …` bullet with:

```markdown
- **Screen sheet**: one 2048 × 1120 canvas (`scene/room/screenSheet.ts` paints it once, on first use).
  Each tile is a whole visible screen, 256 × 160. 8 columns × 7 rows = 56 tiles, enough for 27 apps ×
  2 variants. An app that scrolls names a band (its code pane, log or list); only that band scrolls,
  wrapping inside itself, and its painter draws the band so it repeats every band height.
```

and replace `The sheet is about 18 MB of GPU memory (24 MB with mipmaps)` with `The sheet is about 9 MB of GPU memory (12 MB with mipmaps)`.

- [ ] **Step 6: Typecheck, format and commit**

Run: `npx tsc --noEmit && npx prettier --check src/renderer/src/features/office/scene/room/screenApps.ts tests/office-screens.test.cjs`
Expected: no output from tsc; "All matched files use Prettier code style!"

```bash
git add src/renderer/src/features/office/scene/room/screenApps.ts tests/office-screens.test.cjs docs/superpowers/specs/2026-09-25-office-role-screens-design.md
git commit -m "feat(office): screen apps for every role, and the sheet they live on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Paint every app

**Files:**
- Create: `src/renderer/src/features/office/scene/room/screenPainters.ts`
- Create: `src/renderer/src/features/office/scene/room/screenSheet.ts`
- Modify: `tests/office-screens.test.cjs` (append)

**Interfaces:**
- Consumes: `SCREEN_APPS`, `ScreenApp`, `SCROLL`, `CURSOR`, `SHEET`, `tileOf` from Task 1; `seeded(seed: number): () => number` from `scene/room/kit.ts`; `hashString` from `simulation/random.ts`.
- Produces:
  - `interface Pen { rect(color, x, y, w, h); round(color, x, y, w, h, radius); dot(color, x, y, radius); line(color, width, points) }` (all numbers in tile pixels, y down, `points: readonly (readonly [number, number])[]`)
  - `type Painter = (pen: Pen, random: () => number, variant: 0 | 1) => void`
  - `PAINTERS: Record<ScreenApp, Painter>`, `paintSeed(app: ScreenApp, variant: 0 | 1): number`
  - `screenSheet(): HTMLCanvasElement` (cached; DOM only)

- [ ] **Step 1: Append the failing painter tests**

Append to `tests/office-screens.test.cjs`:

```js
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
      box('line', color, Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + width, Math.max(...ys) - Math.min(...ys) + width);
    }
  };
  PAINTERS[app](pen, seeded(paintSeed(app, variant)), variant);
  return shapes;
}

test('every app is painted, inside its tile, the same every time, and its two variants differ', () => {
  for (const app of apps.SCREEN_APPS) {
    const [zero, one] = [record(app, 0), record(app, 1)];
    for (const [variant, shapes] of [[0, zero], [1, one]]) {
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

test('nothing small straddles a scroll band\'s edge, so the wrap is seamless', () => {
  for (const [app, band] of Object.entries(apps.SCROLL))
    for (const variant of [0, 1])
      for (const s of record(app, variant)) {
        if (s.h > 20 || s.x + s.w <= band.left || s.x >= band.right) continue;
        const inside = s.y >= band.top - 0.01 && s.y + s.h <= band.bottom + 0.01;
        const outside = s.y + s.h <= band.top + 0.01 || s.y >= band.bottom - 0.01;
        assert.ok(inside || outside, `${app} ${variant}: ${s.kind} at y ${s.y.toFixed(1)}+${s.h.toFixed(1)} crosses ${band.top}..${band.bottom}`);
      }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/office-screens.test.cjs`
Expected: FAIL — `Cannot find module '.../screenPainters.ts'`.

- [ ] **Step 3: Write `screenPainters.ts`**

Create `src/renderer/src/features/office/scene/room/screenPainters.ts`:

```ts
import { hashString } from '../../simulation/random';
import type { ScreenApp } from './screenApps';

/**
 * One picture per app, in two variants: the real app's layout and colours, text as lines (at the
 * office's zoom words would not be legible). Painters draw through a `Pen` in tile pixels (256 × 160,
 * y down), so they need no DOM and can be tested; screenSheet.ts runs them onto a canvas. Where an
 * app scrolls (see SCROLL in screenApps.ts), its band is drawn as rows that repeat every band height.
 */

export interface Pen {
  rect(color: string, x: number, y: number, w: number, h: number): void;
  round(color: string, x: number, y: number, w: number, h: number, radius: number): void;
  dot(color: string, x: number, y: number, radius: number): void;
  line(color: string, width: number, points: readonly (readonly [number, number])[]): void;
}

export type Painter = (pen: Pen, random: () => number, variant: 0 | 1) => void;

/** The seed an app's variant is painted with. */
export const paintSeed = (app: ScreenApp, variant: 0 | 1): number => hashString(`${app}:${variant}`);

const W = 256;
const H = 160;
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const AVATARS = ['#fca5a5', '#93c5fd', '#fcd34d', '#a7f3d0'];

/** A line of text: a bar three pixels tall. */
const text = (pen: Pen, color: string, x: number, y: number, width: number) =>
  pen.rect(color, x, y, Math.max(2, width), 3);

/** `rows` lines of text, `gap` apart, each a random share (at least `shortest`) of `width`. */
function lines(
  pen: Pen,
  random: () => number,
  color: string,
  x: number,
  y: number,
  width: number,
  rows: number,
  gap: number,
  shortest = 0.35
): void {
  for (let i = 0; i < rows; i++) text(pen, color, x, y + i * gap, width * (shortest + random() * (1 - shortest)));
}

const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)];

/** An app window: background, a 10 px title bar and its three buttons. */
function frame(pen: Pen, background: string, bar: string): void {
  pen.rect(background, 0, 0, W, H);
  pen.rect(bar, 0, 0, W, 10);
  pen.dot('#ff5f57', 6, 5, 2);
  pen.dot('#febc2e', 13, 5, 2);
  pen.dot('#28c840', 20, 5, 2);
}

/** A random walk across `w`, for graphs. */
function walk(random: () => number, x: number, y: number, w: number, h: number): [number, number][] {
  const points: [number, number][] = [];
  let v = 0.5;
  for (let i = 0; i <= 24; i++) {
    v = Math.min(0.95, Math.max(0.05, v + (random() - 0.5) * 0.25));
    points.push([x + (w * i) / 24, y + h - v * h]);
  }
  return points;
}

export const PAINTERS: Record<ScreenApp, Painter> = {
  editor(pen, random, variant) {
    const syntax = variant
      ? ['#c586c0', '#9cdcfe', '#ce9178', '#dcdcaa', '#4ec9b0']
      : ['#569cd6', '#9cdcfe', '#ce9178', '#b5cea8', '#6a9955'];
    pen.rect('#1e1e1e', 0, 0, W, H);
    pen.rect('#333333', 0, 0, 10, H);
    for (const y of [6, 20, 34, 48]) pen.rect('#858585', 3, y, 4, 4);
    pen.rect('#252526', 10, 0, 50, H);
    pen.rect('#37373d', 10, 14 + 8 * Math.floor(random() * 10), 50, 7);
    for (let i = 0; i < 16; i++) text(pen, '#8a8a8a', i % 3 === 0 ? 16 : 22, 16 + i * 8, 14 + random() * 22);
    pen.rect('#2d2d2d', 60, 0, W - 60, 14);
    pen.rect('#1e1e1e', 60, 0, 46, 14);
    text(pen, '#cccccc', 66, 6, 30);
    text(pen, '#8a8a8a', 112, 6, 28);
    // The code pane scrolls: 18 rows of 7 px fill its band (21..147) exactly.
    let indent = 0;
    for (let i = 0; i < 18; i++) {
      const y = 23 + i * 7;
      text(pen, '#5a5a5a', 62, y, 7);
      indent = Math.max(0, Math.min(3, indent + (random() < 0.3 ? 1 : random() < 0.35 ? -1 : 0)));
      let x = 74 + indent * 8;
      const words = 1 + Math.floor(random() * 4);
      for (let w = 0; w < words && x < 222; w++) {
        const width = Math.min(6 + random() * 24, 228 - x);
        text(pen, pick(random, syntax), x, y, width);
        x += width + 3;
      }
    }
    pen.rect('#252526', 232, 14, 24, 136);
    for (let y = 18; y < 146; y += 3) pen.rect('#4b4b4b', 236, y, 4 + random() * 14, 1);
    pen.rect(variant ? '#16825d' : '#007acc', 0, 150, W, 10);
    text(pen, '#ffffff', 6, 154, 34);
    text(pen, '#ffffff', 196, 154, 52);
  },

  terminal(pen, random, variant) {
    frame(pen, '#0c0c0c', '#2b2b2b');
    const output = variant
      ? ['#d3d7cf', '#d3d7cf', '#8ae234', '#fce94f', '#729fcf']
      : ['#cccccc', '#cccccc', '#cccccc', '#16c60c', '#f9f1a5', '#e74856'];
    // 20 rows of 7 px fill the band (14..154).
    for (let i = 0; i < 20; i++) {
      const y = 16 + i * 7;
      if (random() < 0.22) {
        text(pen, '#16c60c', 6, y, 12);
        text(pen, '#3b78ff', 20, y, 18);
        text(pen, '#f2f2f2', 42, y, 24 + random() * 100);
      } else {
        text(pen, '#767676', 6, y, 18);
        text(pen, pick(random, output), 28, y, 30 + random() * 190);
      }
    }
    if (variant) {
      pen.rect('#16c60c', 0, 155, W, 5);
      pen.rect('#0c0c0c', 4, 156, 40, 3);
    }
  },

  'browser-devtools'(pen, random, variant) {
    const brand = variant ? '#7c3aed' : '#2563eb';
    frame(pen, '#ffffff', '#dee1e6');
    pen.round('#f1f3f4', 30, 12, 196, 8, 4);
    text(pen, '#5f6368', 38, 15, 70);
    pen.rect('#111827', 0, 22, W, 10);
    text(pen, '#ffffff', 8, 26, 24);
    for (let i = 0; i < 4; i++) text(pen, '#9ca3af', 150 + i * 24, 26, 16);
    pen.rect(variant ? '#ede9fe' : '#dbeafe', 0, 32, W, 30);
    pen.rect('#111827', 20, 38, 110, 5);
    lines(pen, random, '#6b7280', 20, 47, 120, 2, 5);
    pen.round(brand, 20, 55, 36, 6, 3);
    pen.round('#ffffff', 160, 36, 76, 22, 3);
    pen.rect(brand, 166, 42, 30, 10);
    for (let i = 0; i < 3; i++) {
      const x = 16 + i * 78;
      pen.round('#f3f4f6', x, 66, 70, 24, 3);
      pen.rect(pick(random, ['#fca5a5', '#93c5fd', '#86efac', '#fcd34d']), x + 4, 70, 18, 16);
      lines(pen, random, '#9ca3af', x + 26, 72, 40, 3, 5);
    }
    pen.rect('#242424', 0, 94, W, 66);
    pen.rect('#333333', 0, 94, W, 9);
    ['#a8c7fa', '#9aa0a6', '#9aa0a6', '#9aa0a6'].forEach((color, i) => text(pen, color, 6 + i * 34, 97, 24));
    for (let i = 0; i < 7; i++) {
      const y = 107 + i * 7;
      const indent = 6 + Math.floor(random() * 4) * 8;
      text(pen, '#5db0d7', indent, y, 16);
      text(pen, '#f28b54', indent + 20, y, 14 + random() * 20);
      text(pen, '#9aa0a6', indent + 60, y, 20 + random() * 40);
    }
    pen.rect('#303134', 170, 103, 1, 57);
    lines(pen, random, '#9aa0a6', 176, 108, 70, 7, 7);
  },

  browser(pen, random, variant) {
    frame(pen, '#ffffff', '#dee1e6');
    pen.round('#f1f3f4', 30, 12, 196, 8, 4);
    text(pen, '#5f6368', 38, 15, 90);
    pen.rect(variant ? '#1a1a1a' : '#0f766e', 0, 22, W, 12);
    text(pen, '#ffffff', 10, 27, 40);
    pen.rect('#111111', 30, 42, 150, 6);
    pen.rect('#111111', 30, 51, 100, 6);
    text(pen, '#9ca3af', 30, 61, 60);
    pen.rect(pick(random, ['#bfdbfe', '#fde68a', '#bbf7d0', '#fecaca']), 30, 68, 150, 36);
    lines(pen, random, '#4b5563', 30, 110, 150, 7, 6);
    for (let i = 0; i < 3; i++) {
      pen.rect('#e5e7eb', 196, 44 + i * 30, 44, 22);
      text(pen, '#6b7280', 196, 69 + i * 30, 20 + random() * 20);
    }
  },

  sql(pen, random, variant) {
    pen.rect('#1e1f22', 0, 0, W, H);
    pen.rect('#2b2d30', 0, 0, W, 10);
    pen.round('#6aab73', 6, 2, 10, 6, 2);
    pen.round('#56a8f5', 20, 2, 10, 6, 2);
    const keywords = [20, 24, 30, 34, 26];
    const values = ['#bcbec4', '#bcbec4', '#6aab73', '#bcbec4', '#2aacb8'];
    keywords.forEach((width, i) => {
      const y = 16 + i * 8;
      text(pen, '#6f737a', 4, y, 8);
      text(pen, '#cf8e6d', 16, y, width);
      text(pen, values[i], 20 + width, y, 20 + random() * 70);
    });
    pen.rect('#2b2d30', 0, 58, W, 10);
    text(pen, '#bcbec4', 6, 61, 40);
    text(pen, variant ? '#f75464' : '#6aab73', 200, 61, 40);
    const columns = [4, 44, 110, 170, 214];
    pen.rect('#2b2d30', 0, 68, W, 9);
    columns.forEach((x) => text(pen, '#dfe1e5', x + 2, 71, 26));
    for (let r = 0; r < 11; r++) {
      const y = 79 + r * 7;
      if (r % 2) pen.rect('#232427', 0, y - 2, W, 7);
      columns.forEach((x, c) =>
        text(pen, c === 0 ? '#6f737a' : c === 3 ? '#2aacb8' : '#bcbec4', x + 2, y, 10 + random() * 26)
      );
    }
  },

  simulator(pen, random, variant) {
    pen.rect('#1e1e1e', 0, 0, W, H);
    pen.rect('#252526', 0, 0, 36, H);
    lines(pen, random, '#8a8a8a', 5, 8, 26, 18, 8);
    const syntax = ['#fc5fa3', '#67b7a4', '#d0bf69', '#a167e6', '#ffffff'];
    for (let i = 0; i < 19; i++) {
      const y = 8 + i * 7;
      let x = 42 + Math.floor(random() * 3) * 8;
      for (let w = 0; w < 3 && x < 150; w++) {
        const width = Math.min(6 + random() * 20, 156 - x);
        text(pen, pick(random, syntax), x, y, width);
        x += width + 3;
      }
    }
    const app = variant ? '#34c759' : '#0a84ff';
    pen.rect('#2d2d2d', 164, 0, 92, H);
    pen.round('#0b0b0b', 186, 8, 48, 146, 8);
    pen.round('#ffffff', 189, 13, 42, 136, 5);
    pen.rect(app, 189, 18, 42, 14);
    text(pen, '#ffffff', 194, 23, 22);
    for (let i = 0; i < 6; i++) {
      const y = 36 + i * 16;
      pen.dot(pick(random, ['#ff9f0a', '#bf5af2', '#64d2ff', '#ff375f']), 197, y + 5, 4);
      text(pen, '#1c1c1e', 204, y + 2, 20);
      text(pen, '#8e8e93', 204, y + 7, 14);
    }
    pen.rect('#f2f2f7', 189, 134, 42, 12);
    for (let i = 0; i < 4; i++) pen.dot(i === 0 ? app : '#8e8e93', 195 + i * 10, 140, 2);
  },

  monitoring(pen, random, variant) {
    pen.rect('#111217', 0, 0, W, H);
    pen.rect('#181b1f', 0, 0, W, 10);
    text(pen, '#ccccdc', 6, 4, 50);
    pen.round('#3d71d9', 210, 2, 40, 6, 2);
    const panel = (x: number, y: number, w: number, h: number) => {
      pen.round('#181b1f', x, y, w, h, 2);
      text(pen, '#ccccdc', x + 4, y + 3, 30);
    };
    panel(4, 14, 122, 66);
    pen.line('#73bf69', 1.5, walk(random, 8, 26, 114, 48));
    pen.line('#f2cc0c', 1.5, walk(random, 8, 26, 114, 48));
    panel(130, 14, 122, 66);
    pen.line(variant ? '#ff9830' : '#5794f2', 1.5, walk(random, 134, 26, 114, 48));
    const stats: [string, string][] = [
      ['#73bf69', '#1a3d1a'],
      ['#f2cc0c', '#3d3510'],
      [variant ? '#f2495c' : '#73bf69', '#1a2d1a']
    ];
    stats.forEach(([fg, bg], i) => {
      const x = 4 + i * 84;
      pen.round(bg, x, 84, 80, 30, 2);
      pen.rect(fg, x + 8, 92, 40, 12);
      text(pen, fg, x + 8, 108, 24);
    });
    panel(4, 118, 248, 38);
    for (let i = 0; i < 24; i++) {
      const h = 6 + random() * 20;
      pen.rect(i % 7 === 6 ? '#f2495c' : '#5794f2', 10 + i * 10, 152 - h, 6, h);
    }
  },

  security(pen, random, variant) {
    pen.rect('#0b1020', 0, 0, W, H);
    pen.rect('#131a2e', 0, 0, W, 10);
    pen.dot('#ef4444', 8, 5, 3);
    text(pen, '#e2e8f0', 16, 4, 50);
    ['#ef4444', '#f59e0b', '#3b82f6'].forEach((color, i) => {
      const x = 4 + i * 56;
      pen.round('#131a2e', x, 14, 52, 24, 2);
      pen.rect(color, x + 4, 18, 22, 10);
      text(pen, '#94a3b8', x + 4, 32, 36);
    });
    // The alert list scrolls: 8 rows of 14 px fill its band (42..154).
    const severity = ['#ef4444', '#f59e0b', '#f59e0b', '#3b82f6', '#3b82f6', '#64748b'];
    for (let i = 0; i < 8; i++) {
      const y = 42 + i * 14;
      pen.rect(i % 2 ? '#0f1629' : '#0b1020', 0, y, 170, 14);
      pen.dot(pick(random, severity), 8, y + 7, 3);
      text(pen, '#e2e8f0', 16, y + 3, 50 + random() * 60);
      text(pen, '#64748b', 16, y + 8, 30 + random() * 40);
      pen.round(pick(random, ['#7f1d1d', '#78350f', '#1e3a8a']), 136, y + 3, 28, 7, 3);
    }
    pen.round('#131a2e', 174, 14, 78, 142, 2);
    for (let i = 0; i < 40; i++) pen.dot('#1e293b', 182 + random() * 62, 30 + random() * 70, 3 + random() * 4);
    for (let i = 0; i < 7; i++) pen.dot(pick(random, ['#ef4444', '#f59e0b']), 184 + random() * 58, 34 + random() * 62, 1.5);
    if (variant) for (let i = 0; i < 5; i++) text(pen, '#94a3b8', 180, 112 + i * 8, 40 + random() * 26);
    else pen.line('#ef4444', 1.5, [[180, 150], [200, 130], [215, 138], [230, 116], [246, 120]]);
  },

  tests(pen, random, variant) {
    const passing = variant ? 0.92 : 0.85;
    frame(pen, '#ffffff', '#e5e7eb');
    pen.rect('#f3f4f6', 0, 10, W, 16);
    pen.rect('#16a34a', 6, 15, 150 * passing, 6);
    pen.rect('#dc2626', 6 + 150 * passing, 15, 150 * (1 - passing), 6);
    text(pen, '#374151', 164, 16, 60);
    // 16 rows of 7 px fill the band (28..140).
    for (let i = 0; i < 16; i++) {
      const y = 30 + i * 7;
      const failed = random() > passing;
      pen.dot(failed ? '#dc2626' : '#16a34a', 10, y + 1.5, 2);
      text(pen, failed ? '#991b1b' : '#374151', random() < 0.3 ? 24 : 16, y, 40 + random() * 120);
      text(pen, '#9ca3af', 220, y, 20);
    }
    pen.rect('#111827', 0, 142, W, 18);
    text(pen, '#4ade80', 6, 147, 50);
    text(pen, '#f87171', 60, 147, 20);
    text(pen, '#d1d5db', 84, 147, 70);
    text(pen, '#d1d5db', 6, 153, 90);
  },

  notebook(pen, random, variant) {
    frame(pen, '#ffffff', '#f5f5f5');
    pen.rect('#eeeeee', 0, 10, W, 4);
    // Two code-and-plot pairs of 70 px fill the band (14..154).
    for (let pair = 0; pair < 2; pair++) {
      const y = 14 + pair * 70;
      text(pen, '#303f9f', 4, y + 4, 14);
      pen.rect('#f7f7f7', 22, y + 2, 228, 30);
      pen.rect('#e0e0e0', 22, y + 2, 1, 30);
      for (let r = 0; r < 4; r++) {
        let x = r ? 36 : 28;
        for (let w = 0; w < 3; w++) {
          const width = 8 + random() * 26;
          text(pen, pick(random, ['#008000', '#0000ff', '#ba2121', '#212121', '#aa22ff']), x, y + 6 + r * 6, width);
          x += width + 3;
        }
      }
      const top = y + 37;
      text(pen, '#d84315', 4, top + 2, 14);
      pen.rect('#e0e0e0', 40, top + 2, 1, 26);
      pen.rect('#e0e0e0', 40, top + 28, 150, 1);
      const steep = 3 + random();
      const loss: [number, number][] = [];
      for (let i = 0; i <= 20; i++) loss.push([40 + (i / 20) * 150, top + 4 + 22 * (1 - Math.exp(-(i / 20) * steep))]);
      pen.line(variant ? '#1f77b4' : '#ff7f0e', 1.5, loss);
      if (variant) pen.line('#2ca02c', 1.5, loss.map(([x, ly]) => [x, Math.min(top + 27, ly + 3)] as [number, number]));
      lines(pen, random, '#616161', 200, top + 6, 44, 3, 6);
    }
  },

  bi(pen, random, variant) {
    pen.rect('#f4f6f9', 0, 0, W, H);
    pen.rect(variant ? '#1e1b4b' : '#0f172a', 0, 0, 36, H);
    for (let i = 0; i < 6; i++) pen.round(i === 1 ? '#6366f1' : '#334155', 8, 10 + i * 16, 20, 8, 2);
    text(pen, '#0f172a', 44, 6, 60);
    const kpi = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'];
    kpi.forEach((color, i) => {
      const x = 44 + i * 53;
      pen.round('#ffffff', x, 16, 49, 28, 3);
      text(pen, '#94a3b8', x + 4, 20, 24);
      pen.rect('#0f172a', x + 4, 27, 26 + random() * 12, 7);
      pen.rect(color, x + 4, 38, 14, 3);
    });
    pen.round('#ffffff', 44, 48, 130, 106, 3);
    text(pen, '#334155', 50, 53, 40);
    for (let i = 0; i < 10; i++) {
      const h = 20 + random() * 60;
      pen.rect(i % 3 === 2 ? '#a5b4fc' : '#6366f1', 52 + i * 12, 148 - h, 8, h);
    }
    pen.round('#ffffff', 178, 48, 74, 106, 3);
    const shares = [0.34 + random() * 0.08, 0.24 + random() * 0.06, 0.18 + random() * 0.04];
    shares.push(1 - shares.reduce((a, b) => a + b, 0));
    let start = 0;
    shares.forEach((share, i) => {
      const arc: [number, number][] = [];
      for (let s = 0; s <= 12; s++) {
        const a = (start + share * (s / 12)) * Math.PI * 2 - Math.PI / 2;
        arc.push([215 + Math.cos(a) * 20, 90 + Math.sin(a) * 20]);
      }
      pen.line(kpi[i], 9, arc);
      start += share;
    });
    lines(pen, random, '#64748b', 186, 122, 56, 4, 7);
  },

  engine(pen, random, variant) {
    pen.rect('#383838', 0, 0, W, H);
    pen.rect('#2a2a2a', 0, 0, W, 10);
    ['#9e9e9e', '#9e9e9e', '#57a64a'].forEach((color, i) => pen.rect(color, 110 + i * 12, 2, 8, 6));
    pen.rect('#303030', 0, 10, 46, 110);
    lines(pen, random, '#c4c4c4', 6, 16, 34, 13, 8);
    pen.rect(variant ? '#7fb3e6' : '#9ec4e8', 48, 10, 160, 55);
    pen.rect(variant ? '#5f8f4e' : '#8a8a7a', 48, 65, 160, 55);
    for (let i = 0; i < 4; i++) {
      const s = 14 + random() * 14;
      const x = 60 + i * 32 + random() * 10;
      const y = 72 - s * 0.3;
      pen.rect(pick(random, ['#d98c4a', '#c9c9c9', '#4a90d9', '#b35c5c']), x, y, s, s);
      pen.rect('#00000033', x + s, y + 3, 5, s - 3);
    }
    pen.dot('#ffe07a', 190, 22, 6);
    pen.line('#ff5555', 1, [[128, 92], [128, 80]]);
    pen.line('#55ff55', 1, [[128, 92], [140, 98]]);
    pen.line('#5577ff', 1, [[128, 92], [118, 99]]);
    pen.rect('#303030', 210, 10, 46, 110);
    for (let i = 0; i < 9; i++) {
      const y = 16 + i * 11;
      text(pen, '#c4c4c4', 214, y, 14);
      pen.rect('#1e1e1e', 232, y - 1, 20, 6);
    }
    pen.rect('#2a2a2a', 0, 122, W, 38);
    for (let i = 0; i < 9; i++) {
      pen.rect(pick(random, ['#4a90d9', '#d98c4a', '#57a64a', '#9e9e9e', '#b35c5c']), 6 + i * 28, 128, 22, 18);
      text(pen, '#c4c4c4', 6 + i * 28, 150, 18);
    }
  },

  chain(pen, random, variant) {
    const accent = variant ? '#a855f7' : '#22d3ee';
    pen.rect('#0f172a', 0, 0, W, H);
    pen.rect('#111c33', 0, 0, W, 12);
    pen.dot(variant ? '#a855f7' : '#f7931a', 8, 6, 4);
    text(pen, '#e2e8f0', 16, 5, 40);
    pen.round('#1e293b', 120, 3, 128, 7, 3);
    for (let i = 0; i < 4; i++) {
      const x = 6 + i * 62;
      pen.round('#1e293b', x, 18, 56, 40, 3);
      pen.rect(accent, x + 4, 22, 20, 5);
      lines(pen, random, '#94a3b8', x + 4, 31, 46, 4, 6);
      if (i < 3) pen.rect('#334155', x + 56, 37, 6, 2);
    }
    pen.rect('#111c33', 0, 64, W, 9);
    [6, 70, 150, 206].forEach((x) => text(pen, '#94a3b8', x, 67, 28));
    for (let r = 0; r < 12; r++) {
      const y = 76 + r * 7;
      text(pen, '#38bdf8', 6, y, 50);
      text(pen, '#e2e8f0', 70, y, 40 + random() * 30);
      text(pen, '#94a3b8', 150, y, 30 + random() * 20);
      text(pen, random() < 0.8 ? '#4ade80' : '#f87171', 206, y, 24);
    }
  },

  enterprise(pen, random, variant) {
    const brand = variant ? '#0a6ed1' : '#0176d3';
    pen.rect('#f3f3f3', 0, 0, W, H);
    pen.rect(brand, 0, 0, W, 12);
    pen.dot('#ffffff', 8, 6, 3);
    for (let i = 0; i < 5; i++) text(pen, '#dbeafe', 20 + i * 30, 5, 22);
    pen.round('#ffffff', 6, 16, 244, 26, 3);
    pen.round(variant ? '#f59e0b' : '#7f56d9', 12, 21, 16, 16, 3);
    pen.rect('#16325c', 34, 22, 90, 6);
    text(pen, '#706e6b', 34, 32, 60);
    pen.round(brand, 200, 22, 44, 9, 3);
    ['#0176d3', '#706e6b', '#706e6b'].forEach((color, i) => text(pen, color, 12 + i * 40, 47, 30));
    pen.rect(brand, 12, 52, 30, 2);
    pen.round('#ffffff', 6, 58, 244, 64, 3);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 2; c++) {
        const x = 14 + c * 120;
        const y = 64 + r * 14;
        text(pen, '#706e6b', x, y, 34);
        text(pen, '#080707', x, y + 5, 40 + random() * 50);
      }
    pen.round('#ffffff', 6, 126, 244, 30, 3);
    text(pen, '#16325c', 12, 130, 60);
    for (let i = 0; i < 2; i++) {
      text(pen, brand, 12, 138 + i * 7, 50);
      text(pen, '#706e6b', 90, 138 + i * 7, 60 + random() * 20);
    }
  },

  design(pen, random, variant) {
    pen.rect('#e5e5e5', 0, 0, W, H);
    pen.rect('#2c2c2c', 0, 0, W, 10);
    for (let i = 0; i < 5; i++) pen.rect(i === 1 ? '#0d99ff' : '#b3b3b3', 6 + i * 10, 3, 6, 4);
    pen.rect('#ffffff', 0, 10, 46, 150);
    lines(pen, random, '#b3b3b3', 6, 16, 16, 2, 6);
    for (let i = 0; i < 12; i++) {
      const y = 30 + i * 9;
      const nested = i % 4 ? 6 : 0;
      if (i === 3) pen.rect('#e5f4ff', 0, y - 2, 46, 8);
      pen.rect(pick(random, ['#b3b3b3', '#9747ff', '#0d99ff']), 6 + nested, y, 4, 4);
      text(pen, '#333333', 14 + nested, y, 16 + random() * 10);
    }
    pen.rect('#ffffff', 210, 10, 46, 150);
    for (let i = 0; i < 8; i++) {
      const y = 16 + i * 12;
      text(pen, '#8c8c8c', 214, y, 12);
      pen.round('#f5f5f5', 228, y - 2, 24, 7, 2);
    }
    ['#9747ff', '#0d99ff', '#f24e1e', '#ffc700', '#0fa958'].forEach((color, i) =>
      pen.round(color, 214 + (i % 3) * 13, 116 + Math.floor(i / 3) * 12, 10, 10, 2)
    );
    const brand = pick(random, ['#9747ff', '#f24e1e', '#0fa958', '#0d99ff']);
    const artboard = (x: number, y: number, w: number, h: number, selected: boolean) => {
      text(pen, '#8c8c8c', x, y - 6, 24);
      pen.round('#ffffff', x, y, w, h, 3);
      pen.rect(brand, x, y, w, h * 0.16);
      text(pen, '#ffffff', x + 4, y + 3, w * 0.3);
      pen.round(pick(random, ['#ffd6a5', '#caffbf', '#bdb2ff', '#ffadad']), x + 5, y + h * 0.22, w - 10, h * 0.3, 2);
      lines(pen, random, '#c4c4c4', x + 5, y + h * 0.58, w - 10, 3, 5);
      pen.round(brand, x + 5, y + h - 12, w * 0.5, 7, 3);
      if (!selected) return;
      const blue = '#0d99ff';
      pen.rect(blue, x - 2, y - 2, w + 4, 1);
      pen.rect(blue, x - 2, y + h + 1, w + 4, 1);
      pen.rect(blue, x - 2, y - 2, 1, h + 4);
      pen.rect(blue, x + w + 1, y - 2, 1, h + 4);
      for (const [hx, hy] of [[x - 3, y - 3], [x + w, y - 3], [x - 3, y + h], [x + w, y + h]]) pen.rect(blue, hx, hy, 3, 3);
    };
    if (variant) {
      artboard(60, 28, 64, 110, false);
      artboard(136, 28, 64, 110, true);
    } else {
      artboard(56, 30, 100, 70, true);
      artboard(162, 30, 40, 70, false);
      artboard(56, 112, 146, 40, false);
    }
  },

  moodboard(pen, random, variant) {
    const palette = variant
      ? ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51']
      : ['#ffcdb2', '#ffb4a2', '#e5989b', '#b5838d', '#6d6875'];
    pen.rect(variant ? '#1f1f1f' : '#f5f0e8', 0, 0, W, H);
    pen.rect('#2c2c2c', 0, 0, W, 10);
    palette.forEach((color, i) => {
      pen.round(color, 8 + i * 30, 16, 26, 26, 3);
      text(pen, variant ? '#d4d4d4' : '#6b6b6b', 8 + i * 30, 46, 20);
    });
    const tiles: [number, number, number, number][] = [
      [164, 16, 40, 58],
      [208, 16, 42, 28],
      [208, 48, 42, 26],
      [8, 56, 60, 44],
      [72, 56, 46, 44],
      [122, 78, 60, 40],
      [186, 78, 64, 40],
      [8, 104, 110, 48],
      [122, 122, 128, 30]
    ];
    for (const [x, y, w, h] of tiles) {
      pen.round(pick(random, palette), x, y, w, h, 3);
      if (random() < 0.5) pen.dot(pick(random, palette), x + w * 0.6, y + h * 0.45, Math.min(w, h) * 0.25);
    }
    pen.rect(variant ? '#f5f5f5' : '#1f1f1f', 14, 116, 60, 8);
    lines(pen, random, variant ? '#a3a3a3' : '#6b6b6b', 14, 130, 90, 3, 6);
  },

  kanban(pen, random, variant) {
    pen.rect('#f4f5f7', 0, 0, W, H);
    pen.rect(variant ? '#1868db' : '#0052cc', 0, 0, W, 12);
    text(pen, '#ffffff', 6, 5, 30);
    for (let i = 0; i < 4; i++) pen.dot(pick(random, ['#ffab00', '#36b37e', '#ff5630', '#6554c0']), 200 + i * 12, 6, 4);
    text(pen, '#172b4d', 6, 17, 60);
    const labels = ['#36b37e', '#ff5630', '#6554c0', '#ffab00', '#00b8d9'];
    for (let c = 0; c < 4; c++) {
      const x = 6 + c * 62;
      pen.round('#ebecf0', x, 24, 58, 132, 3);
      text(pen, '#5e6c84', x + 4, 28, 26);
      const cards = 2 + Math.floor(random() * 3);
      for (let k = 0; k < cards; k++) {
        const y = 36 + k * 30;
        pen.round('#ffffff', x + 3, y, 52, 26, 2);
        pen.rect(pick(random, labels), x + 6, y + 3, 16, 3);
        lines(pen, random, '#172b4d', x + 6, y + 9, 44, 2, 5);
        pen.dot(pick(random, AVATARS), x + 49, y + 21, 3);
        text(pen, '#6b778c', x + 6, y + 20, 14);
      }
    }
  },

  roadmap(pen, random, variant) {
    frame(pen, '#ffffff', '#f3f4f6');
    pen.rect('#f9fafb', 0, 10, 60, 150);
    for (let m = 0; m < 6; m++) {
      const x = 60 + m * 32;
      pen.rect('#e5e7eb', x, 10, 1, 150);
      text(pen, '#6b7280', x + 4, 14, 16);
    }
    const colours = variant
      ? ['#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b']
      : ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
    for (let r = 0; r < 9; r++) {
      const y = 26 + r * 14;
      text(pen, '#374151', 6, y + 3, 30 + random() * 20);
      const start = 62 + random() * 110;
      pen.round(pick(random, colours), start, y, Math.min(20 + random() * 60, 252 - start), 9, 3);
    }
    const today = 110 + random() * 60;
    pen.rect('#ef4444', today, 20, 1.5, 138);
    pen.dot('#ef4444', today + 0.75, 20, 3);
  },

  video(pen, random, variant) {
    pen.rect('#1c1c1c', 0, 0, W, H);
    const columns = variant ? 3 : 2;
    const tiles = columns * 2;
    const w = (W - 8 - (columns - 1) * 4) / columns;
    const h = (138 - 12) / 2;
    const backgrounds = ['#3a4a5c', '#4a3a5c', '#3a5c4a', '#5c4a3a', '#2f3e46', '#52414a'];
    for (let i = 0; i < tiles; i++) {
      const x = 4 + (i % columns) * (w + 4);
      const y = 4 + Math.floor(i / columns) * (h + 4);
      pen.round(backgrounds[i], x, y, w, h, 3);
      const cx = x + w / 2;
      pen.round(pick(random, ['#2563eb', '#16a34a', '#9333ea', '#ea580c', '#475569']), cx - w * 0.22, y + h * 0.62, w * 0.44, h * 0.38, 6);
      pen.dot(pick(random, SKINS), cx, y + h * 0.45, Math.min(w, h) * 0.17);
      text(pen, '#ffffff', x + 4, y + h - 7, 24);
      if (i === 1) {
        pen.rect('#22c55e', x, y, w, 1.5);
        pen.rect('#22c55e', x, y + h - 1.5, w, 1.5);
      }
    }
    pen.rect('#111111', 0, 142, W, 18);
    for (let i = 0; i < 4; i++) pen.dot(i === 3 ? '#ef4444' : '#3c3c3c', 98 + i * 20, 151, 6);
  },

  pipeline(pen, random, variant) {
    pen.rect('#f6f7fb', 0, 0, W, H);
    pen.rect(variant ? '#ff7a59' : '#0b5cab', 0, 0, W, 12);
    text(pen, '#ffffff', 6, 5, 40);
    ['#93c5fd', '#a5b4fc', '#c4b5fd', '#fcd34d', '#86efac'].forEach((color, s) => {
      const x = 4 + s * 50;
      pen.rect(color, x, 16, 46, 3);
      text(pen, '#374151', x, 22, 28);
      text(pen, '#6b7280', x, 28, 18);
      const deals = 3 - Math.floor(s / 2) + Math.floor(random() * 2);
      for (let d = 0; d < deals; d++) {
        const y = 36 + d * 29;
        pen.round('#ffffff', x, y, 46, 25, 2);
        text(pen, '#111827', x + 3, y + 4, 30 + random() * 10);
        pen.rect('#16a34a', x + 3, y + 11, 10 + random() * 30, 4);
        text(pen, '#9ca3af', x + 3, y + 18, 20);
      }
    });
  },

  tickets(pen, random, variant) {
    frame(pen, '#ffffff', variant ? '#03363d' : '#1f2937');
    pen.rect('#f8f9f9', 0, 10, W, 18);
    ['#d1fae5', '#e0e7ff', '#fef3c7'].forEach((color, i) => pen.round(color, 6 + i * 44, 14, 40, 9, 4));
    const priority = ['#dc2626', '#f59e0b', '#f59e0b', '#16a34a', '#3b82f6'];
    const status = ['#fee2e2', '#dbeafe', '#dcfce7', '#fef3c7'];
    // 8 rows of 14 px fill the band (28..140).
    for (let i = 0; i < 8; i++) {
      const y = 28 + i * 14;
      pen.rect(i % 2 ? '#fafafa' : '#ffffff', 0, y, W, 14);
      pen.dot(pick(random, priority), 9, y + 7, 3);
      text(pen, '#111827', 18, y + 3, 60 + random() * 70);
      text(pen, '#9ca3af', 18, y + 8, 30 + random() * 50);
      pen.round(pick(random, status), 178, y + 3, 34, 8, 4);
      pen.dot(pick(random, AVATARS), 232, y + 7, 4);
    }
    pen.rect('#f3f4f6', 0, 142, W, 18);
    text(pen, '#6b7280', 6, 149, 80);
  },

  calendar(pen, random, variant) {
    frame(pen, '#ffffff', '#f1f3f4');
    for (let h = 0; h < 8; h++) text(pen, '#70757a', 6, 30 + h * 16, 14);
    for (let d = 0; d < 5; d++) {
      const x = 36 + d * 44;
      pen.rect('#dadce0', x, 14, 1, 146);
      text(pen, '#70757a', x + 6, 16, 14);
      if (d === 2) pen.dot('#1a73e8', x + 30, 18, 4);
    }
    for (let h = 0; h < 8; h++) pen.rect('#f1f3f4', 36, 28 + h * 16, 220, 1);
    const colours = variant
      ? ['#7986cb', '#33b679', '#f6bf26', '#e67c73', '#8e24aa']
      : ['#039be5', '#0b8043', '#f4511e', '#8e24aa', '#e67c73'];
    for (let d = 0; d < 5; d++) {
      let y = 28 + Math.floor(random() * 2) * 16;
      while (y < 140) {
        const h = 12 + Math.floor(random() * 3) * 8;
        if (y + h > 156) break;
        pen.round(pick(random, colours), 38 + d * 44, y + 1, 40, h - 2, 2);
        text(pen, '#ffffff', 41 + d * 44, y + 4, 24);
        y += h + Math.floor(random() * 3) * 16;
      }
    }
    pen.rect('#ea4335', 36, 84 + random() * 30, 220, 1.2);
  },

  candidates(pen, random, variant) {
    pen.rect('#f8fafc', 0, 0, W, H);
    pen.rect(variant ? '#16a34a' : '#7c3aed', 0, 0, W, 12);
    text(pen, '#ffffff', 6, 5, 50);
    const hair = ['#2b2220', '#6b4423', '#c8a165', '#1c1c1c', '#a0522d'];
    ['#e0e7ff', '#fef3c7', '#dcfce7', '#fce7f3'].forEach((background, s) => {
      const x = 4 + s * 63;
      pen.round(background, x, 16, 59, 140, 3);
      text(pen, '#475569', x + 4, 20, 30);
      // The funnel narrows toward the offer.
      const count = 4 - s + (s === 3 ? 1 : 0);
      for (let c = 0; c < count; c++) {
        const y = 28 + c * 31;
        pen.round('#ffffff', x + 3, y, 53, 27, 3);
        pen.dot(pick(random, hair), x + 12, y + 9, 6);
        pen.dot(pick(random, SKINS), x + 12, y + 11, 5);
        lines(pen, random, '#0f172a', x + 21, y + 5, 32, 2, 6, 0.5);
        const stars = 2 + Math.floor(random() * 4);
        for (let st = 0; st < 5; st++) pen.dot(st < stars ? '#f59e0b' : '#e2e8f0', x + 9 + st * 7, y + 21, 2);
      }
    });
  },

  spreadsheet(pen, random, variant) {
    const brand = variant ? '#107c41' : '#188038';
    pen.rect('#ffffff', 0, 0, W, H);
    pen.rect(brand, 0, 0, W, 10);
    text(pen, '#ffffff', 6, 4, 40);
    pen.rect('#f8f9fa', 0, 10, W, 10);
    for (let i = 0; i < 10; i++) pen.rect('#5f6368', 6 + i * 12, 13, 7, 4);
    pen.rect('#f8f9fa', 0, 20, W, 8);
    pen.rect('#f8f9fa', 0, 20, 14, 140);
    for (let c = 0; c < 8; c++) {
      pen.rect('#dadce0', 14 + c * 30, 20, 1, 140);
      text(pen, '#5f6368', 26 + c * 30, 22, 6);
    }
    for (let r = 0; r < 19; r++) {
      const y = 28 + r * 7;
      pen.rect('#e8eaed', 14, y, 242, 1);
      text(pen, '#5f6368', 3, y + 2, 8);
      for (let c = 0; c < 5; c++) {
        const width = 6 + random() * 18;
        if (random() < 0.85) text(pen, c === 0 ? '#202124' : '#3c4043', c === 0 ? 17 : 14 + (c + 1) * 30 - width - 3, y + 2, width);
      }
    }
    pen.rect('#1a73e8', 44, 48, 30, 1.5);
    pen.rect('#1a73e8', 44, 55, 30, 1.5);
    pen.round('#ffffff', 170, 60, 80, 60, 2);
    pen.rect('#dadce0', 170, 60, 80, 1);
    pen.rect('#dadce0', 170, 119, 80, 1);
    for (let i = 0; i < 6; i++) {
      const h = 10 + random() * 36;
      pen.rect(i % 2 ? '#fbbc04' : '#4285f4', 178 + i * 12, 114 - h, 8, h);
    }
  },

  slides(pen, random, variant) {
    const brand = variant ? '#c43e1c' : '#1a73e8';
    pen.rect('#f1f3f4', 0, 0, W, H);
    pen.rect(variant ? '#c43e1c' : '#f4b400', 0, 0, W, 10);
    text(pen, '#ffffff', 6, 4, 40);
    pen.rect('#ffffff', 0, 10, W, 8);
    for (let i = 0; i < 9; i++) pen.rect('#5f6368', 6 + i * 11, 12, 6, 4);
    for (let i = 0; i < 5; i++) {
      const y = 22 + i * 27;
      pen.rect(i === 1 ? '#1a73e8' : '#dadce0', 5, y - 1, 42, 25);
      pen.rect('#ffffff', 6, y, 40, 23);
      pen.rect(pick(random, ['#1a73e8', '#34a853', '#ea4335', '#fbbc04']), 9, y + 3, 20, 3);
      lines(pen, random, '#bdc1c6', 9, y + 9, 30, 2, 5);
    }
    pen.rect('#ffffff', 56, 24, 192, 108);
    pen.rect(brand, 56, 24, 192, 18);
    pen.rect('#ffffff', 64, 30, 90, 6);
    lines(pen, random, '#5f6368', 66, 52, 70, 5, 9);
    for (let i = 0; i < 5; i++) pen.dot('#5f6368', 62, 53.5 + i * 9, 1.5);
    for (let i = 0; i < 5; i++) {
      const h = 14 + random() * 44;
      pen.rect(i === 3 ? brand : '#9aa0a6', 156 + i * 17, 124 - h, 11, h);
    }
    pen.rect('#ffffff', 56, 136, 192, 20);
    lines(pen, random, '#9aa0a6', 62, 141, 120, 2, 6);
  },

  email(pen, random, variant) {
    const brand = variant ? '#0f6cbd' : '#c5221f';
    pen.rect('#ffffff', 0, 0, W, H);
    pen.rect(brand, 0, 0, W, 10);
    text(pen, '#ffffff', 6, 4, 34);
    pen.round('#ffffff55', 70, 2, 110, 6, 3);
    pen.rect('#f6f8fc', 0, 10, 96, 12);
    pen.round(variant ? '#0f6cbd' : '#c2e7ff', 4, 12, 40, 8, 4);
    // The inbox scrolls: 9 rows of 14 px fill its band (22..148, the list column only).
    for (let i = 0; i < 9; i++) {
      const y = 22 + i * 14;
      const unread = random() < 0.35;
      pen.rect(unread ? '#ffffff' : '#f2f6fc', 0, y, 96, 14);
      pen.rect('#e5e7eb', 0, y + 13, 96, 1);
      if (unread) pen.dot('#1a73e8', 5, y + 7, 2);
      text(pen, unread ? '#111827' : '#4b5563', 10, y + 3, 30 + random() * 20);
      text(pen, '#9ca3af', 76, y + 3, 14);
      text(pen, '#6b7280', 10, y + 8, 40 + random() * 40);
    }
    pen.rect('#e5e7eb', 96, 10, 1, 150);
    pen.rect('#111827', 104, 16, 100, 6);
    pen.dot(pick(random, AVATARS), 110, 34, 5);
    text(pen, '#111827', 120, 30, 50);
    text(pen, '#9ca3af', 120, 36, 70);
    lines(pen, random, '#374151', 104, 48, 140, 8, 7);
    pen.round('#f3f4f6', 104, 110, 100, 30, 3);
    pen.rect(pick(random, ['#bfdbfe', '#fde68a']), 108, 114, 30, 22);
    lines(pen, random, '#6b7280', 142, 116, 56, 3, 6);
    pen.round(brand, 104, 146, 36, 9, 4);
  },

  document(pen, random, variant) {
    pen.rect('#f8f9fa', 0, 0, W, H);
    pen.rect(variant ? '#2b579a' : '#ffffff', 0, 0, W, 12);
    pen.rect(variant ? '#ffffff' : '#4285f4', 6, 3, 8, 6);
    text(pen, variant ? '#ffffff' : '#202124', 18, 5, 40);
    pen.rect('#edf2fa', 0, 12, W, 9);
    for (let i = 0; i < 12; i++) pen.rect('#444746', 6 + i * 11, 15, 6, 4);
    lines(pen, random, '#5f6368', 8, 30, 40, 6, 9);
    pen.rect('#ffffff', 60, 24, 150, 136);
    pen.rect('#dadce0', 60, 24, 150, 1);
    pen.rect('#202124', 72, 36, 90, 7);
    text(pen, '#5f6368', 72, 48, 50);
    let y = 58;
    for (let p = 0; p < 4 && y < 150; p++) {
      if (p === 2) {
        pen.rect('#202124', 72, y, 60, 5);
        y += 10;
      }
      const rows = 2 + Math.floor(random() * 3);
      for (let r = 0; r < rows && y < 152; r++, y += 6) text(pen, '#3c4043', 72, y, r === rows - 1 ? 40 + random() * 60 : 124);
      y += 5;
    }
    if (variant || random() < 0.6) {
      pen.round('#fef7e0', 214, 60, 38, 28, 2);
      pen.dot('#f9ab00', 220, 66, 3);
      lines(pen, random, '#5f6368', 218, 73, 30, 2, 5);
    }
  }
};
```

- [ ] **Step 4: Write `screenSheet.ts`**

Create `src/renderer/src/features/office/scene/room/screenSheet.ts`:

```ts
import { SCREEN_APPS, SHEET, tileOf } from './screenApps';
import { PAINTERS, paintSeed, type Pen } from './screenPainters';
import { seeded } from './kit';

let sheet: HTMLCanvasElement | null = null;

/** Every app in both variants, painted once onto one canvas (see SHEET for the layout). */
export function screenSheet(): HTMLCanvasElement {
  if (sheet) return sheet;
  const canvas = document.createElement('canvas');
  canvas.width = SHEET.width;
  canvas.height = SHEET.height;
  const g = canvas.getContext('2d')!;
  const pen = canvasPen(g);
  for (const app of SCREEN_APPS)
    for (const variant of [0, 1] as const) {
      const { x, y } = tileOf(app, variant);
      g.save();
      g.beginPath();
      g.rect(x, y, SHEET.tileWidth, SHEET.tileHeight);
      g.clip();
      g.translate(x, y);
      PAINTERS[app](pen, seeded(paintSeed(app, variant)), variant);
      g.restore();
    }
  return (sheet = canvas);
}

function canvasPen(g: CanvasRenderingContext2D): Pen {
  return {
    rect(color, x, y, w, h) {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    },
    round(color, x, y, w, h, radius) {
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x, y, w, h, radius);
      g.fill();
    },
    dot(color, x, y, radius) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, radius, 0, Math.PI * 2);
      g.fill();
    },
    line(color, width, points) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/office-screens.test.cjs`
Expected: PASS, 9 tests. If a painter is reported outside its tile or straddling a band, fix that painter's coordinates (not the test).

- [ ] **Step 6: Typecheck, format and commit**

Run: `npx tsc --noEmit && npx prettier --write src/renderer/src/features/office/scene/room/screenPainters.ts src/renderer/src/features/office/scene/room/screenSheet.ts && npx prettier --check tests/office-screens.test.cjs`

```bash
git add src/renderer/src/features/office/scene/room/screenPainters.ts src/renderer/src/features/office/scene/room/screenSheet.ts tests/office-screens.test.cjs
git commit -m "feat(office): a picture of every role's app, painted into one sheet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One screen mesh with tiles, scrolling and the status strip

**Files:**
- Modify: `src/renderer/src/features/office/scene/room/screens.ts` (replace the file)
- Modify: `tests/office-screens.test.cjs` (append)

**Interfaces:**
- Consumes: `tileOf`, `SCROLL`, `CURSOR`, `SHEET`, `stripCode`, `ScreenApp` (Task 1); `hashString` (`simulation/random.ts`); `AgentStatus` (`data/officeAgents.ts`); `ScreenState` (`simulation/types.ts`).
- Produces:
  - `interface ScreenSlot { deskId: string; app: ScreenApp; variant: 0 | 1; matrix: THREE.Matrix4 }`
  - `class DeskScreens { readonly object: THREE.Group; readonly mesh: THREE.InstancedMesh; constructor(slots: readonly ScreenSlot[], sheet: THREE.Texture); update(dt: number, elapsed: number, state: (deskId: string) => ScreenState, status: (deskId: string) => AgentStatus | undefined): void; stripOf(deskId: string): number; dispose(): void }` — the mesh is named `'screens'`; it takes ownership of `sheet` and disposes it.
  - Geometry attributes on `mesh.geometry`: `screenTile` (2), `screenBand` (4: left, top, right, bottom), `screenMotion` (2: speed, phase), `screenCursor` (3: x, y, shade 0 none / 1 light / 2 dark), `screenStatus` (1).

- [ ] **Step 1: Append the failing tests**

Append to `tests/office-screens.test.cjs`:

```js
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
  screens.update(0.1, 1, () => 'active', (desk) => status[desk]);
  assert.deepEqual([strip.getX(0), strip.getX(1)], [1, 0]);
  status.a = 'completed';
  screens.update(0.1, 2, () => 'active', (desk) => status[desk]);
  assert.equal(screens.stripOf('a'), 3);
  screens.update(0.1, 2 + apps.DONE_FOR + 0.5, () => 'active', (desk) => status[desk]);
  assert.equal(screens.stripOf('a'), 0, 'the green strip goes after a while');
  status.b = 'error';
  screens.update(0.1, 30, () => 'active', (desk) => status[desk]);
  assert.equal(screens.stripOf('b'), 4);
  for (let i = 0; i < 60; i++) screens.update(0.1, 31 + i * 0.1, () => 'active', (desk) => status[desk]);
  const color = new THREE.Color();
  screens.mesh.getColorAt(0, color);
  assert.ok(color.r > 0.95, `screen brightness ${color.r}`);
  screens.dispose();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/office-screens.test.cjs`
Expected: FAIL — the old `DeskScreens` has no `mesh`, no `screenTile` attribute (`TypeError` or assertion on `meshes.length`).

- [ ] **Step 3: Replace `screens.ts`**

Replace the contents of `src/renderer/src/features/office/scene/room/screens.ts` with:

```ts
import * as THREE from 'three';
import type { AgentStatus } from '../../data/officeAgents';
import type { ScreenState } from '../../simulation/types';
import { hashString } from '../../simulation/random';
import { CURSOR, SCROLL, SHEET, stripCode, tileOf, type ScreenApp } from './screenApps';

export interface ScreenSlot {
  deskId: string;
  app: ScreenApp;
  variant: 0 | 1;
  /** Places a unit plane: position, facing and the screen's width and height. */
  matrix: THREE.Matrix4;
}

/** Screen brightness per state; the picture is multiplied by this grey. */
const LEVEL: Record<ScreenState, number> = { off: 0.09, on: 0.62, active: 1 };
/** Strip colours for codes 1–4: working, waiting for the user, done, error. */
const STRIP = ['#3b82f6', '#f59e0b', '#22c55e', '#ef4444'];
/** While the owner works on a real task, content scrolls this much faster. */
const BUSY_SCROLL = 3;

/**
 * Every laptop and monitor screen in the office, as one instanced mesh: one draw call. Each screen
 * shows its tile of the screen sheet (its owner's app), scrolls its app's band, blinks a cursor and
 * shows the status strip while its owner works on one of the user's tasks, and is dark when the desk
 * is empty, lit when someone works there, brighter while a real task runs.
 */
export class DeskScreens {
  readonly object = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private readonly time = { value: 0 };
  private readonly statusAttribute: THREE.InstancedBufferAttribute;
  private readonly entries: {
    deskId: string;
    level: number;
    code: number;
    status: AgentStatus | undefined;
    since: number;
  }[] = [];
  private readonly color = new THREE.Color();

  /** Takes ownership of `sheet`: it is disposed with the screens. */
  constructor(slots: readonly ScreenSlot[], sheet: THREE.Texture) {
    const count = slots.length;
    const tile = new Float32Array(count * 2);
    const band = new Float32Array(count * 4);
    const motion = new Float32Array(count * 2);
    const cursor = new Float32Array(count * 3);
    slots.forEach((slot, i) => {
      const origin = tileOf(slot.app, slot.variant);
      tile.set([origin.x, origin.y], i * 2);
      const scroll = SCROLL[slot.app];
      if (scroll) band.set([scroll.left, scroll.top, scroll.right, scroll.bottom], i * 4);
      // Each screen starts at its own point in its loop, so a row of screens never scrolls in step.
      motion.set([scroll?.speed ?? 0, hashString(`scroll:${slot.deskId}:${i}`) % 160], i * 2);
      const spot = CURSOR[slot.app];
      if (spot) cursor.set([spot.x, spot.y, spot.light ? 1 : 2], i * 3);
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('screenTile', new THREE.InstancedBufferAttribute(tile, 2));
    geometry.setAttribute('screenBand', new THREE.InstancedBufferAttribute(band, 4));
    geometry.setAttribute('screenMotion', new THREE.InstancedBufferAttribute(motion, 2));
    geometry.setAttribute('screenCursor', new THREE.InstancedBufferAttribute(cursor, 3));
    this.statusAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.statusAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('screenStatus', this.statusAttribute);

    const material = new THREE.MeshBasicMaterial({ map: sheet });
    const strip = STRIP.map((hex) => new THREE.Color(hex));
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.uniforms.uStrip = { value: strip };
      patchScreenShader(shader);
    };
    material.customProgramCacheKey = () => 'desk-screens';

    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.name = 'screens';
    slots.forEach((slot, i) => {
      this.mesh.setMatrixAt(i, slot.matrix);
      this.mesh.setColorAt(i, this.color.setScalar(LEVEL.off));
      this.entries.push({ deskId: slot.deskId, level: LEVEL.off, code: 0, status: undefined, since: 0 });
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.object.add(this.mesh);
  }

  update(
    dt: number,
    elapsed: number,
    state: (deskId: string) => ScreenState,
    status: (deskId: string) => AgentStatus | undefined
  ): void {
    // Wrapped so the shader's float time stays precise however long the office has been open.
    this.time.value = elapsed % 3600;
    const ease = 1 - Math.exp(-dt * 4);
    let colours = false;
    let strips = false;
    this.entries.forEach((entry, i) => {
      const now = status(entry.deskId);
      if (now !== entry.status) {
        entry.status = now;
        entry.since = elapsed;
      }
      const code = stripCode(now, elapsed - entry.since);
      if (code !== entry.code) {
        entry.code = code;
        this.statusAttribute.setX(i, code);
        strips = true;
      }
      const target = LEVEL[state(entry.deskId)];
      if (Math.abs(target - entry.level) < 0.002) return;
      entry.level += (target - entry.level) * ease;
      this.mesh.setColorAt(i, this.color.setScalar(entry.level));
      colours = true;
    });
    if (colours && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (strips) this.statusAttribute.needsUpdate = true;
  }

  /** The strip a desk's screens show now (0 none, 1 working, 2 waiting, 3 done, 4 error). */
  stripOf(deskId: string): number {
    return this.entries.find((entry) => entry.deskId === deskId)?.code ?? 0;
  }

  dispose(): void {
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/**
 * The screen shader: `MeshBasicMaterial` whose map lookup picks the instance's tile and scrolls its
 * band (wrapping inside the band), then, after the brightness, a blinking cursor while working and
 * the status strip along the bottom 7%.
 */
function patchScreenShader(shader: { vertexShader: string; fragmentShader: string }): void {
  const f = (n: number) => n.toFixed(1);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec2 screenTile;
attribute vec4 screenBand;
attribute vec2 screenMotion;
attribute vec3 screenCursor;
attribute float screenStatus;
varying vec2 vScreenUv;
varying vec2 vScreenTile;
varying vec4 vScreenBand;
varying vec2 vScreenMotion;
varying vec3 vScreenCursor;
varying float vScreenStatus;`
    )
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
vScreenUv = uv;
vScreenTile = screenTile;
vScreenBand = screenBand;
vScreenMotion = screenMotion;
vScreenCursor = screenCursor;
vScreenStatus = screenStatus;`
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uTime;
uniform vec3 uStrip[4];
varying vec2 vScreenUv;
varying vec2 vScreenTile;
varying vec4 vScreenBand;
varying vec2 vScreenMotion;
varying vec3 vScreenCursor;
varying float vScreenStatus;`
    )
    .replace(
      '#include <map_fragment>',
      `vec2 screenPx = vec2(vScreenUv.x * ${f(SHEET.tileWidth)}, (1.0 - vScreenUv.y) * ${f(SHEET.tileHeight)});
vec2 samplePx = screenPx;
float scrollSpeed = vScreenMotion.x * (vScreenStatus > 0.5 && vScreenStatus < 1.5 ? ${f(BUSY_SCROLL)} : 1.0);
if (scrollSpeed > 0.0 && screenPx.x > vScreenBand.x && screenPx.x < vScreenBand.z && screenPx.y > vScreenBand.y && screenPx.y < vScreenBand.w) {
  float span = vScreenBand.w - vScreenBand.y;
  samplePx.y = vScreenBand.y + mod(screenPx.y - vScreenBand.y + vScreenMotion.y + uTime * scrollSpeed, span);
}
samplePx = clamp(samplePx, vec2(0.5), vec2(${f(SHEET.tileWidth - 0.5)}, ${f(SHEET.tileHeight - 0.5)}));
vec2 sheetScale = vec2(1.0 / ${f(SHEET.width)}, 1.0 / ${f(SHEET.height)});
vec2 sheetUv = vec2((vScreenTile.x + samplePx.x) * sheetScale.x, 1.0 - (vScreenTile.y + samplePx.y) * sheetScale.y);
// Mip level from the unscrolled position, so the wrap line does not pick a blurry mip.
vec2 gradientUv = vec2((vScreenTile.x + screenPx.x) * sheetScale.x, 1.0 - (vScreenTile.y + screenPx.y) * sheetScale.y);
diffuseColor *= textureGrad(map, sheetUv, dFdx(gradientUv), dFdy(gradientUv));`
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
if (vScreenStatus > 0.5 && vScreenStatus < 1.5 && vScreenCursor.z > 0.5 && fract(uTime * 1.6) < 0.5 &&
    abs(screenPx.x - vScreenCursor.x) < 1.5 && abs(screenPx.y - vScreenCursor.y) < 3.0)
  diffuseColor.rgb = vScreenCursor.z < 1.5 ? vec3(0.9) : vec3(0.05);
if (vScreenStatus > 0.5 && vScreenUv.y < 0.07) {
  int code = int(vScreenStatus + 0.5);
  vec3 strip = uStrip[code - 1];
  if (code == 1) strip = mix(strip, vec3(1.0), 0.55 * smoothstep(0.7, 1.0, fract(vScreenUv.x * 0.8 - uTime * 0.35)));
  if (code == 2) strip *= 0.7 + 0.3 * sin(uTime * 4.0);
  diffuseColor.rgb = strip;
}`
    );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/office-screens.test.cjs`
Expected: PASS, 11 tests. (`npx tsc --noEmit` will now fail in `buildOffice.ts`, which still passes flavours; Task 4 fixes it. Do not commit until Task 4's typecheck passes — commit Tasks 3 and 4 together if you are executing them back to back, or run Task 4 before this commit.)

- [ ] **Step 5: Format; commit together with Task 4**

Run: `npx prettier --write src/renderer/src/features/office/scene/room/screens.ts && npx prettier --check tests/office-screens.test.cjs`
Leave the commit to Task 4 Step 7, since the repository does not typecheck between the two tasks.

---

### Task 4: Wire the owners' apps into the office

**Files:**
- Modify: `src/renderer/src/features/office/scene/room/desks.ts:4-6,128-175,425-468`
- Modify: `src/renderer/src/features/office/scene/room/buildOffice.ts` (imports, `OfficeRoom`, the stations loop, `update`)
- Modify: `src/renderer/src/features/office/scene/OfficeScene.ts` (debug handle interface and object, `deskStatus`, room update call)
- Modify: `tests/office-desktop.cjs` (role close-ups, before and after)

**Interfaces:**
- Consumes: Task 1 `screenAppsFor`, `spareDeskApps`, `hardwareFlavor`, `DeskScreenApps`, `ScreenApp`; Task 2 `screenSheet()`; Task 3 `DeskScreens`, `ScreenSlot`.
- Produces:
  - `workstation(setup: DeskSetup, surface: Surface, screens: DeskScreenApps): Workstation` (the third parameter is new and required)
  - `OfficeRoom.update(dt, elapsed, screens, busy, status: (deskId: string) => AgentStatus | undefined)` and `OfficeRoom.stripOf(deskId: string): number`
  - Debug handle (`window.__axonOffice`): `deskPoint(agentId): { x: number; z: number }`, `screenSheet(): string` (PNG data URL), `screenStrip(agentId): number`, `setStatus(agentId, status): void`, and `breakdown()` reports the screens mesh under the key `'screens'`.

- [ ] **Step 1: Add `deskPoint` to the debug handle and role close-ups to the desktop check (before any visual change)**

In `src/renderer/src/features/office/scene/OfficeScene.ts`, in `interface OfficeDebugHandle` add after `focus(x: number, z: number, span: number): void;`:

```ts
  /** Where someone's own desk is, for close-ups. */
  deskPoint(agentId: string): { x: number; z: number };
```

and in the handle object, after the `focus: (x, z, span) => this.cameraRig.focus({ x, z }, span),` line:

```ts
        deskPoint: (agentId) => {
          const { x, z } = poiById(HOME_DESKS[agentId]).position;
          return { x, z };
        },
```

In `tests/office-desktop.cjs`, directly after the loop that snaps `p2-desk`, `p2-pods` and `p2-people` (the `for (const [name, x, z, span] of [` block ending with `await snap(\`${name}.png\`);` and its closing `}`), add:

```js
      // Role screens: one person per role family, close enough to see their monitors.
      for (const id of [
        'frontend-developer',
        'database-administrator',
        'site-reliability-engineer',
        'security-engineer',
        'machine-learning-engineer',
        'game-developer',
        'ui-ux-designer',
        'product-manager',
        'sales-manager',
        'talent-acquisition-manager',
        'marketing-manager',
        'chief-executive-officer'
      ]) {
        const point = await evaluate(`window.__axonOffice.deskPoint(${JSON.stringify(id)})`);
        await evaluate(`window.__axonOffice.focus(${point.x}, ${point.z}, 5)`);
        await pause(1500);
        await snap(`screens-${id}.png`);
      }
```

- [ ] **Step 2: Capture the "before" screenshots**

Task 3's new `screens.ts` does not typecheck with the old `buildOffice.ts`, so set it aside, build the office as it is today, and run the check:

```bash
git stash push src/renderer/src/features/office/scene/room/screens.ts
npx tsc --noEmit
npm run build
npx electron tests/office-desktop.cjs
```

Expected: `OFFICE_CHECK_PASS`. Then copy the close-ups aside and restore Task 3's file:

```bash
mkdir -p test-results/office-before
cp test-results/office/screens-*.png test-results/office/p2-desk.png test-results/office/p2-pods.png test-results/office-before/
git stash pop
```

- [ ] **Step 3: Give workstations their owner's apps**

In `src/renderer/src/features/office/scene/room/desks.ts`:

Replace the materials import line `import { GEOMETRY, PALETTE, box, lampGlow, mat, part, type ScreenFlavor } from './materials';` with:

```ts
import { GEOMETRY, PALETTE, box, lampGlow, mat, part } from './materials';
import { hardwareFlavor, type DeskScreenApps, type ScreenApp } from './screenApps';
```

Replace `function display(width: number, height: number, flavor: ScreenFlavor): THREE.Mesh {` and its body's `mesh.userData.screen = flavor;` line with:

```ts
function display(width: number, height: number, app: ScreenApp, variant: 0 | 1): THREE.Mesh {
```

```ts
  mesh.userData.screen = { app, variant };
```

In `monitor`, replace the signature and first two lines:

```ts
/** A slim-bezel monitor on a neck and an oval foot, tipped back a little. Faces +z. */
function monitor(app: ScreenApp, variant: 0 | 1): { object: THREE.Group; display: THREE.Mesh } {
  const light = hardwareFlavor(app) === 'design';
  const casing = light ? '#d9dce1' : '#2a2f37';
  const screen = display(0.54, 0.3, app, variant);
```

and in the same function replace `const stand = flavor === 'design' ? '#c3c7cd' : '#3a3f47';` with `const stand = light ? '#c3c7cd' : '#3a3f47';`.

In `laptop`, replace the signature and screen line:

```ts
function laptop(
  app: ScreenApp,
  variant: 0 | 1,
  raised: 'riser' | 'stand'
): { object: THREE.Group; display: THREE.Mesh } {
  const body = PALETTE.metal;
  const screen = display(0.29, 0.18, app, variant);
```

In `workstation`, replace the signature, its doc comment and the first lines through `const dark = …`:

```ts
/**
 * The screens, keyboard, mouse and personal things on one desk, in the seat's frame: the person
 * sits at the origin looking toward +z. Screens turn to face them and show the owner's apps: a
 * laptop beside a monitor, or the right of two monitors, is the second screen.
 */
export function workstation(setup: DeskSetup, surface: Surface, screens: DeskScreenApps): Workstation {
  const g = new THREE.Group();
  const displays: THREE.Mesh[] = [];
  const flavor = hardwareFlavor(screens.main);
  const accent = setup.accent ?? PALETTE.white;
  const dark = flavor === 'code' || flavor === 'data';
  const appOf = (item: string): ScreenApp =>
    item === 'monitor-right' || (item === 'laptop' && setup.equipment === 'laptop-monitor')
      ? (screens.second ?? screens.main)
      : screens.main;
```

Inside the switch, replace `const built = laptop(flavor, setup.equipment === 'laptop' ? 'riser' : 'stand');` with

```ts
        const built = laptop(appOf('laptop'), screens.variant, setup.equipment === 'laptop' ? 'riser' : 'stand');
```

and in the `default:` branch replace `const built = monitor(flavor);` with

```ts
        const built = monitor(appOf(placement.item), screens.variant);
```

`workstation` has one caller (`buildOffice.ts`), which always passes a surface, so `surface` loses its `= POD_DESK` default. `POD_DESK` stays imported: `SURFACE_Y` still uses it.

- [ ] **Step 4: Build the screens from owners in `buildOffice.ts`**

In `src/renderer/src/features/office/scene/room/buildOffice.ts`:

Add `HOME_DESKS` to the existing import from `'../../simulation/layout'` (the list that already has `DESK_SETUPS`), remove `type ScreenFlavor` from the `./materials` import list, and add:

```ts
import { OFFICE_AGENTS, type AgentStatus } from '../../data/officeAgents';
import { screenAppsFor, spareDeskApps, type ScreenApp } from './screenApps';
import { screenSheet } from './screenSheet';
```

In `interface OfficeRoom`, replace the `update(` declaration with:

```ts
  update(
    dt: number,
    elapsed: number,
    screens: (deskId: string) => ScreenState,
    busy: (poiId: string) => boolean,
    status: (deskId: string) => AgentStatus | undefined
  ): void;
  /** The status strip a desk's screens show now (0 none, 1 working, 2 waiting, 3 done, 4 error). */
  stripOf(deskId: string): number;
```

Replace the stations loop header (`const stations: …` through `const station = workstation(setup, surfaceOf(setup.poiId, seat.district));`) with:

```ts
  // Each desk's screens show its owner's apps; a spare desk keeps its district's flavour.
  const owners = new Map(Object.entries(HOME_DESKS).map(([agentId, deskId]) => [deskId, agentId]));
  const agents = new Map(OFFICE_AGENTS.map((agent) => [agent.id, agent]));
  const stations: { deskId: string; displays: THREE.Mesh[] }[] = [];
  for (const setup of DESK_SETUPS) {
    const seat = poiById(setup.poiId);
    const owner = agents.get(owners.get(setup.poiId) ?? '');
    const apps = owner ? screenAppsFor(owner) : spareDeskApps(setup.flavor ?? 'code', setup.poiId);
    const station = workstation(setup, surfaceOf(setup.poiId, seat.district), apps);
```

Replace the slot push and `DeskScreens` construction:

```ts
      const { app, variant } = display.userData.screen as { app: ScreenApp; variant: 0 | 1 };
      slots.push({ deskId, app, variant, matrix: display.matrixWorld.clone() });
      display.removeFromParent();
    }
  const sheet = new THREE.CanvasTexture(screenSheet());
  sheet.colorSpace = THREE.SRGBColorSpace;
  sheet.anisotropy = 4;
  const screens = new DeskScreens(slots, sheet);
```

(this replaces the old `slots.push({ deskId, flavor: …, matrix: … }); display.removeFromParent(); }` and `const screens = new DeskScreens(slots);`).

In the returned object, replace `update(dt, elapsed, screenState, busy) {` and its first line with:

```ts
    stripOf: (deskId) => screens.stripOf(deskId),
    update(dt, elapsed, screenState, busy, status) {
      screens.update(dt, elapsed, screenState, status);
```

- [ ] **Step 5: Feed desk status from `OfficeScene` and extend the debug handle**

In `src/renderer/src/features/office/scene/OfficeScene.ts`:

Add the import `import { screenSheet } from './room/screenSheet';`.

In `interface OfficeDebugHandle`, after the `deskPoint` line added in Step 1, add:

```ts
  /** The screen sheet as a PNG data URL, to look at every app at once. */
  screenSheet(): string;
  /** The status strip on someone's desk screens (0 none, 1 working, 2 waiting, 3 done, 4 error). */
  screenStrip(agentId: string): number;
  /** Sets someone's task status the way the office store does. */
  setStatus(agentId: string, status: AgentStatus): void;
```

In the handle object, after `deskPoint: …`, add:

```ts
        screenSheet: () => screenSheet().toDataURL('image/png'),
        screenStrip: (agentId) => this.room.stripOf(HOME_DESKS[agentId]),
        setStatus: (agentId, status) => this.updateAgentStatus(agentId, status),
```

In `breakdown`, replace the `const key = object.name.startsWith('crowd')` expression with:

```ts
            const key = object.name.startsWith('crowd')
              ? 'crowd'
              : object.name === 'screens'
                ? 'screens'
                : object.parent === this.room.root
                  ? `room:${(object.material as THREE.MeshStandardMaterial).color?.getHexString?.() ?? '?'}`
                  : 'characters';
```

Add a field and a method to the class (next to `updateAgentStatus`):

```ts
  /** Whose desk each desk is, for the screens' status strip. */
  private readonly deskOwners = new Map(Object.entries(HOME_DESKS).map(([agentId, deskId]) => [deskId, agentId]));

  private deskStatus(deskId: string): AgentStatus | undefined {
    const owner = this.deskOwners.get(deskId);
    return owner ? this.statuses.get(owner) : undefined;
  }
```

and pass it to the room in the frame loop (the `this.room.update(` call):

```ts
    this.room.update(
      dt,
      this.elapsed,
      (deskId) => this.simulation.screenState(deskId),
      (poiId) => this.simulation.occupantsOf(poiId).length > 0,
      (deskId) => this.deskStatus(deskId)
    );
```

If `AgentStatus` is not yet imported in `OfficeScene.ts`, add it to the existing `../data/officeAgents` import.

- [ ] **Step 6: Typecheck, unit tests, build**

Run:

```bash
npx tsc --noEmit
node --test tests/*.test.cjs
npm run build
```

Expected: tsc silent; all unit tests pass (the previous 236 plus 11 in `office-screens.test.cjs`); build succeeds.

- [ ] **Step 7: Format and commit Tasks 3 and 4**

```bash
npx prettier --write src/renderer/src/features/office/scene/room/desks.ts src/renderer/src/features/office/scene/room/buildOffice.ts src/renderer/src/features/office/scene/OfficeScene.ts
npx prettier --check src/renderer/src/features/office/scene/room/screens.ts
git add src/renderer/src/features/office/scene/room/screens.ts src/renderer/src/features/office/scene/room/desks.ts src/renderer/src/features/office/scene/room/buildOffice.ts src/renderer/src/features/office/scene/OfficeScene.ts tests/office-screens.test.cjs tests/office-desktop.cjs
git commit -m "feat(office): every desk shows its owner's work, in one draw call

Each monitor and laptop shows its owner's app (a design canvas, a code
editor and terminal, a sprint board, a CRM pipeline...) from one sheet
of pictures, through one instanced mesh. Code panes, logs and lists
scroll; while a coworker works on one of the user's tasks their screens
scroll faster, blink a cursor and carry a status strip (blue working,
amber waiting, green done, red error).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Check it in the real app, and show the before and after

**Files:**
- Modify: `tests/office-desktop.cjs` (assertions after the campus budget checks)

**Interfaces:**
- Consumes: the debug handle additions from Task 4 (`breakdown().screens`, `screenSheet()`, `screenStrip()`, `setStatus()`, `deskPoint()`).
- Produces: `test-results/office/screen-sheet.png`, `test-results/office/screens-status-working.png`, the `screens-*.png` close-ups, and `test-results/office-screens-before-after.png`.

- [ ] **Step 1: Add the assertions**

In `tests/office-desktop.cjs`, directly after the line `assert.ok(tiers.full <= 40, \`full rigs ${tiers.full}\`);`, add:

```js
      // Role screens: every desk screen is one draw call; the sheet is saved for review.
      const parts = await evaluate('window.__axonOffice.breakdown()');
      assert.equal(parts.screens?.meshes, 1, 'every desk screen is one draw call');
      const sheet = await evaluate('window.__axonOffice.screenSheet()');
      fs.writeFileSync(path.join(output, 'screen-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
```

Directly after the role close-up loop added in Task 4 Step 1, add:

```js
      // The status strip follows the owner's real task status, then goes back to nothing.
      for (const [status, code] of [['working', 1], ['waiting', 2], ['completed', 3], ['error', 4], ['idle', 0]]) {
        await evaluate(`window.__axonOffice.setStatus('frontend-developer', '${status}')`);
        await waitFor(`window.__axonOffice.screenStrip('frontend-developer') === ${code}`, `${status} strip`);
        if (status === 'working') {
          const desk = await evaluate(`window.__axonOffice.deskPoint('frontend-developer')`);
          await evaluate(`window.__axonOffice.focus(${desk.x}, ${desk.z}, 4)`);
          await pause(1500);
          await snap('screens-status-working.png');
        }
      }
```

- [ ] **Step 2: Run the desktop check**

Check power first (fps readings only count on mains): in PowerShell, `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus` should print `Online`.

Run:

```bash
npm run build
npx electron tests/office-desktop.cjs
```

Expected: `OFFICE_CHECK_PASS`, with `CAMPUS_STATS` draw calls at most the previous 446 minus 3 (four screen meshes became one) and triangles unchanged within a few hundred.

- [ ] **Step 3: Review the pictures**

Open `test-results/office/screen-sheet.png` and check all 54 tiles read as their app. Open three or four `test-results/office/screens-*.png` close-ups and `screens-status-working.png`. Fix any painter that reads wrongly (coordinates in `screenPainters.ts`; rerun `node --test tests/office-screens.test.cjs` after each fix).

- [ ] **Step 4: Compose the before/after sheet**

Run:

```bash
python - <<'EOF'
from PIL import Image, ImageDraw
names = ['frontend-developer', 'ui-ux-designer', 'product-manager', 'sales-manager']
box = (30, 270, 1815, 1176)
w, h = (box[2] - box[0]) // 2, (box[3] - box[1]) // 2
sheet = Image.new('RGB', (w * 2 + 36, 40 + (h + 12) * len(names)), '#ffffff')
draw = ImageDraw.Draw(sheet)
draw.text((12, 12), 'Before', fill='#111111')
draw.text((24 + w, 12), 'After (role screens)', fill='#111111')
for i, name in enumerate(names):
    for j, folder in enumerate(['test-results/office-before', 'test-results/office']):
        im = Image.open(f'{folder}/screens-{name}.png').crop(box).resize((w, h))
        sheet.paste(im, (12 + j * (w + 12), 40 + i * (h + 12)))
sheet.save('test-results/office-screens-before-after.png')
EOF
```

Expected: `test-results/office-screens-before-after.png` exists. Show it to the user.

- [ ] **Step 5: Commit**

```bash
npx prettier --check tests/office-desktop.cjs
git add tests/office-desktop.cjs
git commit -m "test(office): role screens are one draw call, and the status strip follows the owner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
