# Office polish — Part A: Campus polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 40 × 32 m Commons with rooms twice the size, a coffee station in every district, world signs instead of floating cards, furnished executive offices, and a tidier message box with a short model chip and one-line district chips.

**Architecture:** The campus stays generated data (`campus/*` → `simulation/layout.ts`). The campus bounds grow and every district except the Commons moves outward, keeping its size. `campus/commons.ts` is re-authored for the bigger rooms, keeping the spot ids the simulation and tests rely on. Coffee stations are a new layout module with its own furniture kind and spots. The simulation sends each person to the nearest coffee venue. Signs are pure data (`campus/signs.ts`: positions, text, zoom scale, visibility), drawn by one `SignLayer` (`scene/room/signs.ts`) using a shared text atlas, and picked in `OfficeScene`. The HTML district, department and room labels are removed; person tags stay. Composer and chip changes are small React and CSS edits backed by two pure helpers (`shortModelName`, `fitChips`).

**Tech Stack:** three r186, React 18, Zustand, `node:test` with the TS transpile hook (see the top of `tests/office-campus.test.cjs`), Electron desktop check `tests/office-desktop.cjs`.

**Spec:** [docs/superpowers/specs/2026-09-24-office-polish-teamwork-reception-design.md](../specs/2026-09-24-office-polish-teamwork-reception-design.md) §3 and §4.

## Global Constraints

- Art direction (spec §3):
  - procedural low-poly shapes built like `scene/room/furniture.ts`;
  - colours from `PALETTE` or the district colour, flat, with no photographic textures;
  - sign text drawn into canvas textures in the UI font, white on the district colour.
- New lamps use `lampGlow.*()`, so the time-of-day rig drives them (`LAMP_BASE`).
- Whole-campus draw calls stay within 10% of the baseline measured before Task 1: **666 calls at 60 fps** (desktop check, 1600 × 960, `ff2d470` + spec commit), so **≤ 733**, and under the existing hard limit of 900.
- 60 fps at 1920 × 1080 (read from `window.__axonOffice.stats()` in the desktop check).
- Every coworker keeps exactly one home desk. Tests hold these invariants:
  - no blocking furniture overlaps, and nothing sits outside the campus;
  - every spot is free floor and reachable from `visit-desk-reception`.
- Spot ids the simulation and tests use stay as they are:
  - `cafe-machine`, `cafe-counter-1`, `cafe-counter-2`, `cafe-stool-*`, `cafe-t*-a/b`;
  - `lounge-sofa-*` (sofa seat height depends on the prefix), `library-reading`, `shelf-1`, `shelf-2`, `printer`, `file-cabinet`;
  - `collab-w/e/n/s`, `collab-wb-1/2`, `meeting-n*/s*`, `meeting-w`, `meeting-wb`, `open-window`, `open-cafe`, `open-front`;
  - every `desk-*` id in `CORE_HOME_DESKS`.
- Ops Coordinator stays at `desk-reception` in Part A.
- `OFFICE_AGENTS.length` stays 207 in Part A.
- Tests run with `TEMP`/`TMP` set to `D:\axon-tmp`. Every task ends with `npm run typecheck` and `npm test` green.
- Commit after each task on `feature/look-and-shell` with a `feat(office): …` message ending in the `Co-Authored-By` trailer.

## Deviations from the spec (recorded in the spec's revisions in Task 7)

1. **Campus bounds are `x ∈ [−62, 62]`, `z ∈ [−38, 38]`** (spec: ±61, ±37). This keeps the 2 m margin between districts and the outer walls that exists today.
2. **Signs face the viewer's side (+z) like the walls**, and hanging signs lean 0.2 rad toward the camera. They are not turned to the camera's yaw, because signs square to the architecture read better in isometric. **Growth limits are per kind** (district up to 9×), because 3.5× leaves district text at about 6 px in the whole-campus view in a 1366 px window.
3. **Library shelves are 2.6 m tall** (spec: 3 m), because the Commons back wall is 2.7 m.
4. **Short model names allow up to 16 characters** (spec: 14), so "Gemini 2.5 Flash" is not cut.
5. **The coffee venue is chosen by straight-line distance** from the home desk (spec: by path). Districts are open rectangles and the stations stand at their edges, so it picks the same venue, and it avoids hundreds of A* searches at start-up.
6. **Department signs only in districts with two or more departments** (19 signs). Design, AI & Data and Leadership are one department each and are named by their district sign.
7. **The name bands on department boards are removed** because the hanging signs name the department. Part B draws the board faces.

## File map

| File | Responsibility |
|---|---|
| `features/office/campus/districts.ts` | new bounds, `sign` position per district |
| `features/office/simulation/layout.ts` | `ROOM` ±62/±38, corridor trees, coffee stations, sign posts |
| `features/office/campus/commons.ts` | the 40 × 32 m Commons, `COMMONS_ROOMS`, `ROOM_SIGN_POINTS`, hotspots |
| `features/office/simulation/types.ts` | `ZoneId` + `'reception'`; `PoiType` + `'cafe-stand'`; group + `'planning-room'` |
| `features/office/campus/builder.ts` | new `FurnitureKind`s; `FurnitureItem.busyWith` |
| `features/office/campus/coffee.ts` (new) | station list, `buildCoffeeStations`, `nearestCoffee`, `stationSpots` |
| `features/office/campus/neighbourhoods.ts` | executive office furnishing |
| `features/office/campus/signs.ts` (new) | `SIGNS`, `signScale`, `signOpacity`, `titleAbbreviation` (pure) |
| `features/office/scene/room/furniture.ts` | builders for the new kinds (split into `executive.ts`, `commonsProps.ts` to keep files < ~400 lines as touched) |
| `features/office/scene/room/executive.ts` (new) | exec desk, exec chair, exec credenza, wall art, ledge art, exec rug |
| `features/office/scene/room/commonsProps.ts` (new) | tall bookshelf with ladder, cabinet wall, pastry case, sorting table, reading table, bike rack, coat rack, coffee station, steam |
| `features/office/scene/room/buildOffice.ts` | decor on the new back wall; remove board name bands; `busyWith` lights; steam |
| `features/office/scene/room/signs.ts` (new) | `SignLayer`: atlas, instanced quads, zoom scaling, picking |
| `features/office/scene/OfficeScene.ts` | sign layer, sign picking and hover, library hotspot, hotspot positions, debug handle |
| `features/office/simulation/OfficeSimulation.ts` | nearest coffee venue; stations; `planning-room` meetings |
| `features/office/shell/SceneLabels.tsx`, `OfficeCanvas.tsx`, `DepartmentMenu.tsx` | tags only; sign clicks; Reception in the room list |
| `features/office/shell/chipFit.ts` (new), `DistrictChips.tsx`, `shell.css` | one-line chips with "More" |
| `src/shared/models.ts` (new), `chat/ModelSelect.tsx`, `activity/AgentComposer.tsx`, `office.css` | model chip, hint, spacing |
| `tests/office-campus.test.cjs`, `tests/office-sim.test.cjs`, `tests/office-chrome.test.cjs` (new), `tests/office-desktop.cjs` | tests |

---

### Task 1: The campus grows; districts move outward

**Files:**
- Modify: `src/renderer/src/features/office/campus/districts.ts` (bounds)
- Modify: `src/renderer/src/features/office/simulation/layout.ts` (`ROOM`, corridor trees)
- Test: `tests/office-campus.test.cjs`

**Interfaces:**
- Produces: `ROOM = { minX: -62, maxX: 62, minZ: -38, maxZ: 38 }`. District bounds:

| id | bounds (minX, maxX, minZ, maxZ) |
|---|---|
| commons | −20, 20, −15, 17 |
| engineering | −60, −25, −31, 31 |
| product | −16, 16, −36, −17.5 |
| design | 25, 38, −36, −19 |
| leadership | 41, 60, −36, −19 |
| ai-data | 25, 60, −11, 8 |
| business | −16, 16, 19.5, 36 |
| people-ops | 25, 60, 16, 36 |

- [ ] **Step 1: Write the failing test** (append to `tests/office-campus.test.cjs`, after `layout` is required):

```js
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
    assert.ok(b.minX - r.minX >= 2 && r.maxX - b.maxX >= 2 && b.minZ - r.minZ >= 2 && r.maxZ - b.maxZ >= 2, d.id);
  }
});
```

- [ ] **Step 2: Run it and see it fail.** Run `node --test tests/office-campus.test.cjs`. Expected: FAIL on the `ROOM` deep-equal.
- [ ] **Step 3: Implement.**
  - Set the bounds in the table above and `ROOM` in `layout.ts`.
  - Move the corridor trees into the new corridors:
    - `x = −22.5` at `z ∈ {−29, −20, −4, 4, 20, 29}`;
    - `x = 22.5` at `z ∈ {−29, −20, −4, 4, 20, 29}`;
    - `z = −15` at `x ∈ {31.5, 44, 55}`;
    - `z = 12` at `x ∈ {31, 42.5, 54}`.
  - Keep them clear of the future coffee stations (Task 3 lists their spots).
  - The old Commons content still fits inside the bigger Commons, so nothing else moves yet.
- [ ] **Step 4: Run the tests.**
  - Run `npm test`. Expected: PASS, including the reachability and overlap tests.
  - The "nav grid builds quickly" test logs about 620 × 380 cells.
- [ ] **Step 5: Typecheck and commit.** `npm run typecheck`, then `git commit -m "feat(office): grow the campus and move the districts outward"`.

---

### Task 2: The Commons at 40 × 32 m

**Files:**
- Modify: `campus/commons.ts` (rewrite of `buildCommons`, `COMMONS_ROOMS`; new `ROOM_SIGN_POINTS`, `FILES_HOTSPOT`, `LIBRARY_HOTSPOT`, `COMMONS_BACK_Z`)
- Modify: `simulation/types.ts`:
  - `ZoneId` gains `'reception'`;
  - `PointOfInterest.group` gains `'planning-room'`.
- Modify: `campus/builder.ts` (kinds `bookshelf-tall`, `cabinet-wall`, `pastry-case`, `sorting-table`, `reading-table`, `bike-rack`, `coat-rack`; field `busyWith?: string[]`)
- Create: `scene/room/commonsProps.ts` (builders for those kinds)
- Modify: `scene/room/furniture.ts` (dispatch the new kinds to `commonsProps.ts`)
- Modify: `scene/room/buildOffice.ts`:
  - `wallDecor()` uses `COMMONS_BACK_Z` and the new room positions;
  - lights come from `item.busyWith`, not a hard-coded printer/café check.
- Modify: `simulation/OfficeSimulation.ts`:
  - meetings choose `meeting-room` (always with the Product Coach), otherwise `planning-room` 40%, `meeting-room` 30%, `collab-table` 30%;
  - lounge seats for the Librarian include `zoneId === 'knowledge'` (unchanged rule).
- Modify: `scene/OfficeScene.ts`:
  - `ROOM_SIGNS` becomes `ROOM_SIGN_POINTS` (from `commons.ts`);
  - the Files hotspot moves to `FILES_HOTSPOT`;
  - a `LIBRARY_HOTSPOT` click calls `onLibraryClick`.
- Modify: `OfficeCanvas.tsx`: `world.onLibraryClick = () => openOverlay('knowledge')`.
- Modify: `shell/DepartmentMenu.tsx`: `COMMONS_ROOMS` gains `{ name: 'Reception', zone: 'reception' }`.
- Modify: `shell/SceneLabels.tsx`: `ROOM_ICONS.reception = ConciergeBell`. It is removed with the labels in Task 5; it's added here so the file typechecks.
- Modify: `scene/cameraRig.ts`: `OPENING = { point: { x: 0, z: 1 }, span: 52 }`.
- Test: `tests/office-campus.test.cjs`, `tests/office-sim.test.cjs`

**Interfaces:**
- Produces from `commons.ts`:

```ts
export const COMMONS_BACK_Z = -15;
export const COMMONS_ROOMS: Readonly<Record<ZoneId, Vec2>>; // camera focus per room, incl. reception
/** Where each room's hanging sign hangs (bottom-centre of the panel), for Task 5. */
export const ROOM_SIGN_POINTS: Readonly<Record<Exclude<ZoneId, 'agents'>, { x: number; y: number; z: number }>>;
export const FILES_HOTSPOT: { x: number; z: number; w: number; d: number; h: number };
export const LIBRARY_HOTSPOT: { x: number; z: number; w: number; d: number; h: number };
```

**Layout** (starting coordinates; the layout tests have the final say, so adjust by a few decimetres where they fail):

| Room (zone) | Floor | Walls | Contents (ids kept where they exist) |
|---|---|---|---|
| Lounge (`chat`) | x −19.4…−11, z −15…−6 | glass on the east side (x −11); front open | three sofas in a U round a 1 m coffee table and a 6.8 × 6 m rug (back sofa at (−15.6, −13.9), side sofas at x −18.7 and −12.4, turned); seats `lounge-sofa-1…3` on the back sofa and `-4…5`, `-6…7` on the side sofas; two bean bags at the front left; two floor lamps; Marketing desk on the back wall at (−12.1, −14.5) with `desk-marketing` in front of it |
| Planning A (`workspaces`, group `meeting-room`) | x −11…−4.6 | glass east (x −4.6), glass front with a door at x −8.8…−7.2 | 2.8 × 1.3 table at (−7.8, −10.9); `meeting-n1…3` / `meeting-s1…3` 1.05 m from its centre line; `meeting-w` at the west end; `desk-product` (meeting chair) at the east end; wall screen and whiteboard on the back wall; `meeting-wb` in front of it |
| Planning B (`workspaces`, group `planning-room`) | x −4.6…1.4 | glass east (x 1.4), glass front with a door at x −2.4…−0.8 | 2.6 × 1.2 table at (−1.6, −10.9); `planning-n1…3`, `planning-s1…3`; screen, whiteboard, plant |
| Library (`knowledge`) | x 1.4…12.2 | glass front with a door at x 5.9…7.5; glass east (x 12.2) | two `bookshelf-tall` (4.6 × 0.45, 2.6 m high, rolling ladder) against the back wall; three reading nooks along the west glass (`library-reading`, `-2`, `-3`: armchair seats facing east, each with a `reading-table`); a quiet table (2.4 × 1.1) with four chairs; Librarian desk against the east glass with `desk-librarian`; `shelf-1…4` spots in front of the shelves |
| Files room (`files`) | x 12.2…19.4 | glass front with a door at x 14.8…16.4; glass east (x 19.4) | `cabinet-wall` (6.8 × 0.6, 2.4 m) along the back wall; `file-cabinet` spot in front of it; printer against the west glass with the `printer` spot; `sorting-table`; Files Agent desk against the east glass with `desk-files` |
| Collaboration corner (`workspaces`, group `collab-table`) | x −19.4…−12, z −4…3 | open | round table at (−15.8, −0.4) with `collab-w/e/n/s` at today's offsets; whiteboard with `collab-wb-1/2`; low cabinet; plants; `open-window` spot |
| Core team pods (`agents`) | around (−0.6, −0.3) | open | pod A at (−3.2, −0.3), pod B at (2.0, −0.3), seats and visit spots at today's offsets from their pod |
| Café (`cafe`) | x 7.5…19.4, z −4.5…7 | open | counter (4.6 m) at (14, −3.6) with `cafe-machine`, `cafe-counter-1/2` 0.8 m in front; `pastry-case` beside it; island with `cafe-stool-1…3`; **six** tables (`cafe-t1…t6`, two chairs each); a long communal table with four more seats (`cafe-c1…c4`); pendant lamps (`lampGlow.table()`); `open-cafe` |
| Lobby and reception (`reception`) | z 8…17 | open | reception desk at (0, 13.2) with `desk-reception` behind it (seat 0.7 m behind the desk centre) and its visit spot 1.05 m in front; entry mat; two benches; `bike-rack`; `coat-rack`; plants; `open-front` |

- Wall decor (`buildOffice.wallDecor`), at `innerBack = COMMONS_BACK_Z + WALL_THICKNESS / 2 + 0.01`:
  - slats and framed art on the Lounge back wall;
  - the clock above the Marketing desk.
- `busyWith`:
  - the café counter uses `['cafe-machine', 'cafe-counter-1', 'cafe-counter-2']`;
  - the printer uses `['printer']`;
  - `buildOffice` animates the item's light when any of those spots is occupied.
- Hotspots:
  - `FILES_HOTSPOT` covers the cabinet wall (6.8 × 0.8 m, 2.4 m high);
  - `LIBRARY_HOTSPOT` covers both tall shelves (10 × 0.8 m, 2.6 m high).

- [ ] **Step 1: Write the failing tests** (`tests/office-campus.test.cjs`):

```js
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
```

- [ ] **Step 2: Run and see them fail.** Run `node --test tests/office-campus.test.cjs`. Expected: FAIL (`reception` zone missing, and too few café seats).
- [ ] **Step 3: Implement the layout.**
  - Rewrite `buildCommons` from the table above.
  - Add the kinds to `FurnitureKind`, and to `SEAT_FOOTPRINT` where they are seats (none are).
  - Add the builders in `commonsProps.ts`, each a `THREE.Group` centred on its footprint with its front toward local +z, in the style of `furniture.ts`:
    - **`bookshelf-tall`:** the `bookshelf` look at 2.6 m with 6 shelves, plus a brass rail at 2.35 m and a leaning ladder (two rails and 7 rungs) at a seeded bay.
    - **`cabinet-wall`:** a grid of drawer units 0.6 m wide × 4 high, in `#e6e2da` with `#cfc9be` seams and metal pulls; a small paper label on every other unit; a walnut cornice.
    - **`pastry-case`:** a counter base with a glass box (the `PALETTE.glass` material at 0.25 opacity) holding three rows of coloured low-poly pastries (spheres and flattened cylinders).
    - **`sorting-table`:** a desk top with three stacks of paper and two folders.
    - **`reading-table`:** the `side-table` with a small lamp (`lampGlow.table()` shade).
    - **`bike-rack`:** a steel loop rack with two low-poly bikes (torus wheels, box frames in two accent colours).
    - **`coat-rack`:** a pole, three hooks and two coats (tapered boxes).
- [ ] **Step 4: Update the simulation.**
  - Meeting venue choice as above.
  - `agentProfiles.ts` initial scenes keep their ids.
  - `office-sim.test.cjs`: the Commons test (`every spot is on walkable floor; Commons routes…`) and the analyst café test need no id changes. Any new failure is a real layout fault: fix the layout, not the test.
- [ ] **Step 5: Run the tests.** `npm test`. Expected: PASS. If a spot is "inside furniture" or "unreachable", move the named item or spot by 0.1–0.3 m and rerun.
- [ ] **Step 6: Look at it.**
  - Run `npm run build`, then `npx electron tests/office-desktop.cjs`. The check still asserts the old labels; Task 7 updates it. If it fails only on the label assertions, open `test-results/office/office-desktop.png` and `campus-pods.png` anyway.
  - Look for rooms reading as twice the size, sofas in a U, and the café with its tables.
- [ ] **Step 7: Typecheck and commit.** `git commit -m "feat(office): a 40 x 32 m Commons with bigger lounge, café, library and Files room"`.

---

### Task 3: A coffee station in every district

**Files:**
- Create: `campus/coffee.ts`
- Modify: `campus/builder.ts` (kind `coffee-station`)
- Modify: `simulation/types.ts` (`PoiType` + `'cafe-stand'`)
- Modify: `simulation/layout.ts` (call `buildCoffeeStations(builder)` before `finish()`)
- Modify: `scene/room/commonsProps.ts`:
  - `coffeeStation(item)`: a 1.6 × 0.6 counter, the existing coffee machine (export `coffeeMachine` from `furniture.ts`), a stack of cups and a small plant;
  - `steam()`: three small translucent spheres, `userData.dynamic`.
- Modify: `scene/room/buildOffice.ts`: animate the station light and steam while `busyWith` spots are occupied. The steam rises 0.4 m over 1.6 s and fades, looping; the café machine gets the same steam.
- Modify: `simulation/OfficeSimulation.ts`:
  - `AgentState.coffee: string` (`'cafe'` or a station id), set at construction with `nearestCoffee(home.position, poiById('cafe-machine').position)`;
  - `'coffee'` leaves `commonsOnly`;
  - a station plan claims one of its pickups, waits 4–7 s, takes a cup, then either drinks at the pickup (50%) or at a stand spot (`cafe-stand`), then leaves.
- Test: `tests/office-campus.test.cjs`, `tests/office-sim.test.cjs`

**Interfaces:**

```ts
export interface CoffeeStation { id: string; district: DistrictId; x: number; z: number; rotation: number }
export const COFFEE_STATIONS: readonly CoffeeStation[];
/** Spot ids of a station: two pickups, then two standing spots. */
export function stationSpots(id: string): [pickup1: string, pickup2: string, stand1: string, stand2: string];
/** 'cafe' or the id of the closest station, by straight-line distance from `from`. */
export function nearestCoffee(from: Vec2, cafe: Vec2): string;
export function buildCoffeeStations(b: LayoutBuilder): void;
```

Station ids and positions (rotation 0 faces +z, and the pickups stand 0.9 m in front on the facing side):

| id | district | x, z | rotation |
|---|---|---|---|
| `coffee-engineering-north` | engineering | −42.5, −37.2 | 0 |
| `coffee-engineering-south` | engineering | −42.5, 37.2 | π |
| `coffee-product` | product | −19.3, −27 | π/2 |
| `coffee-business` | business | −19.3, 27.5 | π/2 |
| `coffee-design` | design | 30, −14.6 | π |
| `coffee-leadership` | leadership | 50, −14.6 | π |
| `coffee-ai-data` | ai-data | 36, 11.0 | π |
| `coffee-people-ops` | people-ops | 48, 13.0 | 0 |

- Stations stand in the corridor, clear of the district's own furniture (the first positions for Design, Leadership, AI & Data and People & Ops put stand spots on the district edge; the layout tests caught it). `nearestCoffee` only considers the person's **own district's** stations and the café, so nobody takes coffee in another district. Pickups: `${id}-pickup-1/2`, 0.45 m either side of the machine, facing the counter.
- Stand spots: `${id}-stand-1/2`, 1.8 m in front, 0.8 m apart, facing each other.
- All four spots are tagged with the station's `district`. The item is `busyWith` its two pickups.

- [ ] **Step 1: Write the failing tests.** In `tests/office-campus.test.cjs`:

```js
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
  const pick = coffee.nearestCoffee(far, cafe);
  const d = (p) => Math.hypot(p.x - far.x, p.z - far.z);
  const best = Math.min(d(cafe), ...coffee.COFFEE_STATIONS.map(d));
  assert.equal(d(pick === 'cafe' ? cafe : coffee.COFFEE_STATIONS.find((s) => s.id === pick)), best);
  assert.notEqual(pick, 'cafe');
});
```

  In `tests/office-sim.test.cjs`:

```js
const coffee = require('../src/renderer/src/features/office/campus/coffee.ts');

test('coffee breaks go to the nearest station or the café', () => {
  const agents = require('../src/renderer/src/features/office/data/officeAgents.ts').OFFICE_AGENTS;
  const cafe = layout.poiById('cafe-machine').position;
  const districtsSeen = new Set();
  for (const person of agents.filter((a) => a.district !== 'commons')) {
    if (districtsSeen.has(person.district)) continue;
    districtsSeen.add(person.district);
    const office = new OfficeSimulation({ agentIds: [person.id], seed: 5 });
    office.step(1 / 60);
    assert.ok(office.requestActivity(person.id, 'coffee'), person.id);
    const expected = coffee.nearestCoffee(layout.poiById(layout.HOME_DESKS[person.id]).position, cafe);
    let pickup = null;
    runUntil(
      office,
      (o) => {
        const v = o.view(person.id);
        if (v.poiId && layout.poiById(v.poiId).type === 'cafe' && v.behavior === 'waiting') pickup = v.poiId;
        return pickup !== null;
      },
      300,
      0.05
    );
    assert.ok(pickup, `${person.id} never reached coffee`);
    if (expected === 'cafe') assert.ok(CAFE_PICKUP.includes(pickup), `${person.id} at ${pickup}`);
    else assert.ok(pickup.startsWith(`${expected}-pickup`), `${person.id} at ${pickup}, expected ${expected}`);
  }
  assert.equal(districtsSeen.size, 7);
});
```

- [ ] **Step 2: Run them and see them fail.** Run `node --test tests/office-campus.test.cjs tests/office-sim.test.cjs`. Expected: FAIL, `coffee.ts` not found.
- [ ] **Step 3: Implement** `coffee.ts`, the furniture kind and builder, the steam, and the simulation change.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, and the "207 people: at most twelve away" test still holds.
- [ ] **Step 5: Typecheck and commit.** `git commit -m "feat(office): a coffee station in every district, and coffee breaks go to the nearest"`.

---

### Task 4: Executive offices

**Files:**
- Modify: `campus/builder.ts`:
  - kinds `exec-desk`, `exec-chair`, `exec-credenza`, `wall-art`, `ledge-art`, `exec-rug`;
  - `SEAT_FOOTPRINT['exec-chair'] = 0.62`.
- Modify: `campus/neighbourhoods.ts` (`packLeadership`).
- Create: `scene/room/executive.ts` (builders).
- Modify: `scene/room/furniture.ts`:
  - dispatch the new kinds;
  - `SEAT_HEIGHT['exec-chair'] = 0.5`.
- Test: `tests/office-campus.test.cjs`

**Layout per office** (`width` = 3.8, `depth` = 7; `top` is the office's back edge, `cx` its centre, `left` its left edge):
- **Back wall:** `solid` for the back row (row 0). The front row keeps glass, plus a `ledge-art` (3.4 × 0.12, non-blocking) at `(cx, top + 0.12)`: a walnut panel 1.0 m high with a ledge and a framed picture leaning on it.
- **Art:** `wall-art` (1.1 × 0.04, non-blocking) at `(cx, top + 0.1)` for the back row. A walnut frame hung at 1.6 m with a seeded abstract (three to four flat colour blocks from a muted palette).
- **Credenza:** `exec-credenza` (1.6 × 0.45) at `(cx, top + 0.4)`: walnut, with a row of books (the `BOOK_COLORS` style) on the left half and a table lamp (`lampGlow.table()` shade on a brass stem) on the right.
- **Desk and chair:**
  - `exec-desk` (1.8 × 0.85) at `(cx, top + 2.9)`: a walnut top 0.05 thick, two panel legs and a modesty panel;
  - desk seat `desk-exec-<i>` at `(cx, top + 2.15)` facing front, with an `exec-chair`: a high back, dark leather `#4a3326` at roughness 0.55, a chrome five-star base;
  - visit spot at `(cx, top + 3.9)` as today.
- **Seating:** two armchairs at `(cx + 1.25, top + 4.45)` facing front and `(cx + 1.25, top + 6.15)` facing back, with a round 0.6 m `coffee-table` between them at `(cx + 1.25, top + 5.3)`. The walkway from the door to the desk stays clear (x from `cx − 1.9` to `cx + 0.82`).
- **Rug:** `exec-rug` (3.2 × 5.4, non-blocking) at `(cx, top + 3.9)`. A base colour, a 0.18 m border and a centre medallion, from 4 seeded palettes (burgundy/cream, navy/sand, forest/gold, charcoal/rust).
- The corner plant stays; the old single armchair goes.

- [ ] **Step 1: Write the failing test:**

```js
test('each executive office is furnished', () => {
  for (let i = 0; i < 10; i++) {
    for (const kind of ['exec-desk', 'exec-credenza', 'exec-rug'])
      assert.ok(layout.FURNITURE.some((f) => f.kind === kind && f.id.endsWith(`-${i}`)), `${kind} ${i}`);
    assert.equal(layout.FURNITURE.filter((f) => f.kind === 'armchair' && f.id.startsWith(`exec-armchair-${i}-`)).length, 2);
    assert.equal(layout.FURNITURE.find((f) => f.id === `desk-exec-${i}-seat`).kind, 'exec-chair');
  }
  const art = layout.FURNITURE.filter((f) => f.kind === 'wall-art' || f.kind === 'ledge-art');
  assert.equal(art.length, 10);
  const backRow = layout.WALLS.filter((w) => /^exec-back-[0-4]$/.test(w.id));
  assert.ok(backRow.every((w) => w.kind === 'solid'));
});
```

- [ ] **Step 2: Run it and see it fail.** Run `node --test tests/office-campus.test.cjs`.
- [ ] **Step 3: Implement** the layout and the builders.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (overlap and reachability included).
- [ ] **Step 5: Typecheck and commit.** `git commit -m "feat(office): furnished executive offices"`.

---

### Task 5: World signs replace the floating cards

**Files:**
- Modify: `campus/districts.ts` (`sign: Vec2` on each district: where its pylon stands)
- Modify: `campus/builder.ts` (kind `sign-post`, 0.3 × 0.3, blocking)
- Modify: `simulation/layout.ts` (a `sign-post` item at each district's `sign`)
- Create: `campus/signs.ts` (pure)
- Create: `scene/room/signs.ts` (`SignLayer`)
- Modify: `scene/room/buildOffice.ts` (remove `departmentSigns()`)
- Modify: `scene/OfficeScene.ts`:
  - own the `SignLayer`;
  - update it when `metresPerPixel` changes by more than 3%;
  - pick signs after people and before hotspots;
  - `onSignClick` and hover (pointer cursor, the sign grows ×1.06);
  - debug handle `signs()` and `signPoint(id)`.
- Modify: `shell/SceneLabels.tsx`: tags only; drop the `onDistrict`, `onDepartment` and `onRoom` props.
- Modify: `OfficeCanvas.tsx`: route `onSignClick` through a ref to the latest `chooseDistrict`, `chooseDepartment` and `chooseRoom`.
- Modify: `shell/shell.css`: remove the `.office-district-card`, `.office-department-label` and `.office-zone-label` styles.
- Test: `tests/office-campus.test.cjs`

**Interfaces** (`campus/signs.ts`):

```ts
export type SignKind = 'district' | 'department' | 'room' | 'nameplate';
export interface SignSpec {
  id: string;            // 'district:engineering', 'department:Backend & APIs', 'room:knowledge', 'nameplate:desk-exec-0'
  kind: SignKind;
  target: string;        // DistrictId, department name, ZoneId, or desk id
  title: string;         // 'Engineering', 'Backend & APIs', 'Library', 'CEO'
  subtitle?: string;     // district head-count: '76 people'
  color: string;         // panel colour (district colour; rooms use the Commons colour)
  x: number; y: number; z: number; // bottom-centre of the panel
  width: number; height: number;   // panel size at scale 1, metres
  letter: number;        // font size of the title at scale 1, metres (on-screen text size = letter · scale · 0.77 / metresPerPixel)
  hanging: boolean;      // leans 0.2 rad toward the camera, with two cables above
  maxScale: number;      // growth limit (departments: never wider than their department)
}
export const SIGNS: readonly SignSpec[];
export function signScale(sign: SignSpec, metresPerPixel: number): number;
export function signOpacity(kind: SignKind, tier: 'far' | 'middle' | 'near'): number;
export function titleAbbreviation(roleName: string): string;
```

Constants and rules:
- **District sign:** 2.4 × 0.8 m, `letter` 0.36, `maxScale` 9, mounted at `y` 2.6 on its post, not hanging.
- **Department sign:** 2.6 × 0.55 m, `letter` 0.2, hanging, `y` 2.7, at the department's back strip: `(anchor.x, bounds.minZ + 1.1)`. `maxScale = departmentWidth / 2.6`.
- **Room sign:** 1.8 × 0.45 m, `letter` 0.18, hanging, `maxScale` 3, at `ROOM_SIGN_POINTS`.
- **Nameplate:** 0.5 × 0.16 m, `letter` 0.08, `maxScale` 1, on the office's front glass at `(cx + 1.15, 1.5, bottom + 0.03)`. `title` is `titleAbbreviation(role name)` of the office's occupant; the text in parentheses at the end of the name, else the whole name.
- **`signScale`** is `clamp((minPx · metresPerPixel) / (letter · 0.77), 1, maxScale)` with `minPx` 16 for districts and 12 for departments and rooms. 0.77 is the camera pitch foreshortening (`cos 0.7`). Nameplates are always 1.
- **`signOpacity`:**
  - district: `near` 0.25, otherwise 1;
  - department and room: `far` 0, otherwise 1;
  - nameplate: `near` 1, otherwise 0.
- **District sign positions** (`districts.ts`), as built: just in front of the middle of each district's **front edge**, so from afar each sign rises over its own district and never over a neighbour. The first try, at the corners nearest the Commons, crowded the signs together and the Commons and Business signs overlapped. The Commons has Business in front of it, so its sign stands on its right-hand side.

| id | position |
|---|---|
| commons | (20.9, 1) |
| engineering | (−42.5, 31.8) |
| product | (0, −16.7) |
| design | (29, −18.2) |
| leadership | (52, −18.2) |
| ai-data | (42.5, 8.8) |
| business | (0, 36.8) |
| people-ops | (42.5, 36.8) |

- **As built, sizes are tighter:** department signs 2.8 × 0.44 m and room signs 1.6 × 0.34 m. The Café sign hangs over the island, clear of the Files room sign. `letter` is the title's font size (the on-screen text size is `letter · scale · 0.77 / metresPerPixel`). All signs but nameplates turn to face the camera's yaw (`SignSpec.faceCamera`). Squared to +z they read as slanted banners at the whole-campus view, so this replaces the first half of deviation 2.

`SignLayer` (`scene/room/signs.ts`):
- **Atlas:** one 2048 × 1024 canvas texture (sRGB, anisotropy 4) with a slot per sign. District slots are 512 × 170, department 512 × 110, room 384 × 110 and nameplate 256 × 80, packed in rows. Each slot holds a rounded panel in `color`, the title in white `600` Inter, a second line when a department name is longer than 22 characters (split at the space nearest the middle), and the subtitle at 60% size. One extra dark pixel block (`#1f2430`) is used for the rims and cables.
- **Meshes:** one `THREE.Mesh` per kind with a shared `BufferGeometry` of quads: per sign, a back rim quad 4% larger and 0.02 m behind (dark block UVs), the face quad (slot UVs) and, if hanging, two 0.015 m cable quads rising 0.7 m from the top. Each mesh has its own `MeshBasicMaterial` (shared map, `transparent: true`, `toneMapped: false`) so opacity is per kind. That makes 4 draw calls; posts are furniture and merge with the room.
- **`setView(metresPerPixel, tier)`:** rewrites vertex positions: each sign is scaled by `signScale` about its bottom-centre (×1.06 for the hovered one). It sets each material's opacity and hides meshes at opacity 0.
- **`pick(raycaster): SignSpec | null`:** intersects the district, department and room meshes. Each sign has 2 face triangles right after its 2 rim triangles, so `sign = floor(faceIndex / 4)` within that kind's list.
- **`screenPoint(id, camera, width, height)`:** for the debug handle.

- [ ] **Step 1: Write the failing tests:**

```js
const signs = require('../src/renderer/src/features/office/campus/signs.ts');

test('signs: one per district, per department in shared districts, per Commons room, per executive', () => {
  const of = (k) => signs.SIGNS.filter((s) => s.kind === k);
  assert.equal(of('district').length, 8);
  assert.equal(of('department').length, 19);
  assert.deepEqual(of('room').map((s) => s.target).sort(), ['cafe', 'chat', 'files', 'knowledge', 'reception', 'workspaces']);
  assert.deepEqual(of('nameplate').map((s) => s.title).sort(), ['CEO', 'CFO', 'CGO', 'CIO', 'CMO', 'COO', 'CPO', 'CRO', 'CSO', 'CTO']);
  assert.equal(new Set(signs.SIGNS.map((s) => s.id)).size, signs.SIGNS.length);
});

test('district signs stand in the corridor beside their own district', () => {
  const gap = (p, b) => Math.hypot(Math.max(b.minX - p.x, 0, p.x - b.maxX), Math.max(b.minZ - p.z, 0, p.z - b.maxZ));
  for (const s of signs.SIGNS.filter((x) => x.kind === 'district')) {
    const own = districts.districtById(s.target).bounds;
    assert.ok(gap(s, own) <= 3, s.id);
    for (const d of districts.DISTRICTS) if (d.id !== s.target) assert.ok(!inside(s, d.bounds), `${s.id} inside ${d.id}`);
  }
});

test('department signs hang over their department’s back strip', () => {
  for (const s of signs.SIGNS.filter((x) => x.kind === 'department')) {
    const b = layout.DEPARTMENT_BOUNDS[s.target];
    assert.ok(s.x > b.minX && s.x < b.maxX && s.z > b.minZ && s.z < b.minZ + 2.2, s.id);
    assert.ok(s.width * s.maxScale <= b.maxX - b.minX + 1e-6, s.id);
  }
});

test('signs are true size up close and readable from afar, within their cap', () => {
  const px = (s, mpp) => (signs.signScale(s, mpp) * s.letter * 0.77) / mpp;
  for (const s of signs.SIGNS) {
    assert.equal(signs.signScale(s, 0.005), 1, s.id);
    assert.ok(signs.signScale(s, 0.2) <= s.maxScale + 1e-9, s.id);
  }
  for (const s of signs.SIGNS.filter((x) => x.kind === 'district')) assert.ok(px(s, 0.146) >= 16 - 1e-6, s.id);
});

test('sign visibility by zoom tier', () => {
  assert.equal(signs.signOpacity('district', 'far'), 1);
  assert.equal(signs.signOpacity('district', 'near'), 0.25);
  assert.equal(signs.signOpacity('department', 'far'), 0);
  assert.equal(signs.signOpacity('department', 'middle'), 1);
  assert.equal(signs.signOpacity('room', 'far'), 0);
  assert.equal(signs.signOpacity('nameplate', 'middle'), 0);
  assert.equal(signs.signOpacity('nameplate', 'near'), 1);
  assert.equal(signs.titleAbbreviation('Chief Executive Officer (CEO)'), 'CEO');
  assert.equal(signs.titleAbbreviation('Board Advisor'), 'Board Advisor');
});
```

- [ ] **Step 2: Run them and see them fail.** Run `node --test tests/office-campus.test.cjs`. Expected: FAIL, `signs.ts` not found.
- [ ] **Step 3: Implement** `campus/signs.ts`, the posts and `sign` positions, then `SignLayer`.
- [ ] **Step 4: Wire the scene and remove the HTML cards.**
  - `SceneLabels` renders tags only.
  - `OfficeCanvas` keeps `labelTier` for tags.
  - Clicking a sign calls the same functions the cards did.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(office): world signs for districts, departments, rooms and executive nameplates"`.

---

### Task 6: Model chip, composer spacing, one-line district chips

**Files:**
- Create: `src/shared/models.ts`
- Modify: `src/renderer/src/chat/ModelSelect.tsx` (`compact` prop)
- Modify: `activity/AgentComposer.tsx` (compact chip, hint text)
- Modify: `office.css` (spacing, hint wrap instead of hide)
- Create: `shell/chipFit.ts`
- Modify: `shell/DistrictChips.tsx`, `shell/shell.css`
- Test: `tests/office-chrome.test.cjs` (new; same TS hook header as `office-campus.test.cjs`)

**Interfaces:**

```ts
// src/shared/models.ts
/** A short name for a model chip: "Sonnet 4.5", "GPT-4o mini", "Gemini 2.5 Pro". At most 16 characters. */
export function shortModelName(id: string, displayName?: string): string;

// shell/chipFit.ts
/** How many chips fit on one line; when not all fit, room is kept for a "More" button. */
export function fitChips(widths: readonly number[], available: number, moreWidth: number, gap: number): number;
```

`shortModelName` rules:
1. A `displayName` of at most 16 characters is returned as is.
2. Otherwise tokenise `displayName ?? id`:
   - lowercase it and drop a path prefix (everything up to the last `/`);
   - split on `-`, `_`, space and `:`;
   - drop `claude`, `anthropic`, `openai`, `google`, `latest`, `preview`, `exp`, `experimental`, `instruct`, `chat`;
   - drop parentheses;
   - drop an 8-digit date, a `20xx` year and the two 2-digit tokens that follow it.
3. Join runs of single-digit tokens with `.` (`4`,`5` → `4.5`).
4. `gpt` joins the next token with `-` and is uppercased (`GPT-4o`). `mini` and `nano` stay lowercase. `deepseek` becomes `DeepSeek`. Tokens starting with `o` + digit stay as they are (`o3`). Everything else is title-cased.
5. Join with spaces. Longer than 16 → the first 15 characters plus `…`.

- [ ] **Step 1: Write the failing tests** (`tests/office-chrome.test.cjs`):

```js
const models = require('../src/shared/models.ts');
const chips = require('../src/renderer/src/features/office/shell/chipFit.ts');

test('short model names', () => {
  const cases = [
    ['claude-sonnet-4-5-20250929', undefined, 'Sonnet 4.5'],
    ['claude-opus-5-5', undefined, 'Opus 5.5'],
    ['claude-haiku-4-5-20251001', undefined, 'Haiku 4.5'],
    ['claude-3-5-sonnet-20241022', undefined, '3.5 Sonnet'],
    ['gpt-4o-mini', undefined, 'GPT-4o mini'],
    ['gpt-4o-2024-08-06', undefined, 'GPT-4o'],
    ['gpt-5', undefined, 'GPT-5'],
    ['o3-mini', undefined, 'o3 mini'],
    ['gemini-2.5-pro', undefined, 'Gemini 2.5 Pro'],
    ['models/gemini-2.5-flash-preview-05-20', undefined, 'Gemini 2.5 Flash'],
    ['deepseek-chat', undefined, 'DeepSeek'],
    ['meta-llama/llama-3.1-70b-instruct', undefined, 'Llama 3.1 70b'],
    ['fixture', 'Fixture', 'Fixture'],
    ['x', 'Claude Sonnet 4.5 (Thinking)', 'Sonnet 4.5 Thin…']
  ];
  for (const [id, name, expected] of cases) assert.equal(models.shortModelName(id, name), expected, id);
});

test('district chips fit on one line; the rest go to More', () => {
  assert.equal(chips.fitChips([80, 90, 70], 300, 60, 4), 3);
  assert.equal(chips.fitChips([80, 90, 70], 247, 60, 4), 2);
  assert.equal(chips.fitChips([80, 90, 70], 150, 60, 4), 1);
  assert.equal(chips.fitChips([80, 90, 70], 100, 60, 4), 0);
});
```

- [ ] **Step 2: Run them and see them fail.** Run `node --test tests/office-chrome.test.cjs`.
- [ ] **Step 3: Implement the helpers.**
  - `fitChips`:
    - if `sum(widths) + gap·(n−1) ≤ available`, return `n`;
    - otherwise return the largest `k` with `sum(first k) + gap·k + moreWidth ≤ available`.
  - `shortModelName` follows the rules above.
- [ ] **Step 4: Build the UI.**
  - **`ModelSelect`** gets `compact`. It renders a visible `<span class="model-chip-label">` with `shortModelName` of the selected model ("Choose model" when none). The native `<select>` is overlaid with `opacity: 0; position: absolute; inset: 0`, keeping its `aria-label="AI model"` and full option names. The container `title` is "Provider · Display name".
  - **`AgentComposer`:**
    - uses `<ModelSelect compact …>`;
    - hint text "Shift+Enter for a new line";
    - actions row order: attach, model chip, a spacer, hint, send.
  - **`office.css`:**
    - `.activity-composer { container-type: inline-size; }`, 12 px padding, 8 px gaps, 32 px buttons;
    - remove the rule hiding `.composer-hint`;
    - `@container (max-width: 360px) { .composer-actions-row { flex-wrap: wrap } .composer-hint { order: 5; flex-basis: 100%; text-align: right } }`.
  - **`DistrictChips`:**
    - render a hidden measuring row (`aria-hidden`, `visibility: hidden`, `position: absolute`) to read chip widths;
    - a `ResizeObserver` on the visible row computes `fitChips(…)`;
    - render the first `k` chips and a "More" button (`aria-haspopup="menu"`) whose menu lists the rest, closing on Esc and outside clicks (reuse `useEscape`);
    - `.office-district-chips { flex-wrap: nowrap; overflow: hidden; }`.
- [ ] **Step 5: Run** `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(office): short model chip, steady composer hint, one-line district chips"`.

---

### Task 7: Desktop check, screenshots, performance and spec revisions

**Files:**
- Modify: `tests/office-desktop.cjs`
- Modify: `docs/superpowers/specs/2026-09-24-office-polish-teamwork-reception-design.md` (a "Revisions during build" section)

- [ ] **Step 1: Update the desktop check.**
  - **Before enabling the debug handle:** replace the `.office-department-label, .office-zone-label` assertion with one that no `.office-district-card`, `.office-department-label` or `.office-zone-label` exists.
  - **After the reload with the debug handle:**
    - `window.__axonOffice.signs().filter(s => s.opacity > 0).length > 6` at the opening view.
    - At the whole campus, wait for `signs().filter(s => s.kind === 'district' && s.opacity === 1).length === 8`. This replaces the district-card wait.
    - **Sign click:** read `const p = window.__axonOffice.signPoint('district:engineering')`, dispatch `mousedown` then `mouseup` at `p` on the canvas, then wait for `.office-district-chips button.active` to read "Engineering".
    - **Model chip:** after selecting a coworker, `.activity-composer .model-chip-label` reads "Fixture", and `[aria-label="AI model"]` is still a `<select>`.
    - **Chips at 1100 × 740:** `.office-district-chips` is one line (`scrollHeight <= 44`), and the chips plus the "More" button add up to 8 districts.
  - **Screenshots:** at 1920 × 1080 and 1366 × 768, take the opening view, Engineering framed (`districtFrame`), a pod close-up and the whole campus. Name them `a-<width>-<view>.png`. Add one at 1366 in the dark theme: set the theme through the Settings overlay's theme control, or through `window.axon.settingsSave` with the snapshot's settings plus `theme: 'dark'`, then refresh.
  - **Performance:** log `stats()` at the whole campus. Assert draw calls `< 900` and `≤ baseline × 1.1` (the baseline is recorded in the spec's revisions from the run before Task 1). Log fps.
- [ ] **Step 2: Run everything.** `npm run typecheck`, `npm test`, `npm run build`, `npx electron tests/office-desktop.cjs`. Expected: PASS, with `CAMPUS_STATS` logged.
- [ ] **Step 3: Look at every screenshot.** Check that:
  - the Commons rooms read as bigger and furnished;
  - coffee stations are visible in the district views;
  - district signs are readable at the whole-campus view at 1366 px;
  - department signs are readable at the Engineering view, and don't overlap;
  - executive offices are furnished, with nameplates close up;
  - the chip row is one line at 1100 px;
  - the model chip shows the short name;
  - the hint shows.

  Fix what is off (sign sizes, positions) and rerun.
- [ ] **Step 4: Record the revisions.** Add "Revisions during build" to the spec: deviations 1–7 from this plan, the measured baseline and final draw calls and fps, and any tuning done in Step 3.
- [ ] **Step 5: Commit.** `git commit -m "test(office): desktop check for signs, chips and the model chip; record Part A revisions"`.
