# Campus Office — Stage 2: The campus floor with all 207 coworkers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 38 × 18 m room and its department switcher with one ~112 × 66 m campus. It has a Commons and seven districts, all 207 coworkers seated at their own desks, and it stays smooth on a laptop.

**Architecture:** The layout becomes generated data. A small builder collects walls, furniture, points of interest and desk setups. The existing hand-authored room is reused unchanged as the **Commons** at the centre (its simulation behaviour is already tested). A **neighbourhood packer** lays out each department's pods inside its district, and **Leadership** gets private glass offices. The nav grid rasterizes obstacles, so it builds fast at campus size. The simulation caps how many people are away from their desks at once and keeps outings local. Rendering uses two tiers: up to 40 **full** rigs (selected, on-task, walking, nearest to the view), with everyone else drawn by a **crowd renderer**. The crowd renderer takes seated rig geometry baked once per role (skin, shirt, hair style, …) and draws it as instanced meshes with per-person colours. Desk screens are instanced too. The camera frames the whole campus and zooms to a pod. The UI gets district chips, a department menu, zoom-tiered labels, a district team strip and a minimap.

**Tech Stack:** three r186 (InstancedMesh, BufferGeometryUtils), React 18, Zustand, `node:test` with the TS transpile hook.

**Spec:** [docs/superpowers/specs/2026-09-23-campus-office-design.md](../specs/2026-09-23-campus-office-design.md) §4.3, §4.4 (Commons as it exists today), §4.6, §4.7 and §4.10 (Stage 2 covers increments 2 and 3 of §6: campus layout plus LOD crowd, labels and minimap, because 207 full rigs would not run).

## Global Constraints

- 207 coworkers, each with exactly one home desk; 22 departments; 8 districts (spec §4.3).
- Main corridors between neighbourhoods ≥ 2.4 m; aisles between pods ≥ 1.6 m (spec §4.3).
- Full-tier people ≤ 40; people away from their desk at once ≤ 12 (spec §4.6).
- Nav grid at 0.25 m cells, built in < 150 ms on this machine (spec §4.6; measured in test with a generous CI bound of 600 ms, logged).
- Reduced motion: no wandering, camera cuts instead of glides (spec §4.6).
- The 2D roster fallback stays, grouped by district (spec §4.6).
- Tests: `TEMP`/`TMP` on `D:\axon-tmp`; every task ends with `npm run typecheck` and `npm test` green.

## Deliberate deviations from the spec (recorded; the spec is revised at the end of this stage)

1. **District placement.** The Commons is the existing 26 × 18 m room, unchanged, at the centre (x −13…13, z −9…9), plus a reception strip in front of it. District rectangles are therefore: Engineering x −54…−19 (full depth); Product & Delivery x −16…16, z −31…−12.5 (behind the Commons); Business x −16…16, z 14.5…31 (in front of the Commons); Design Studio x 19…32 and Leadership x 35…54 (back right); AI & Data Lab x 19…54, z −11…8; People & Ops x 19…54, z 11…31. This keeps every neighbourhood ≥ 2.6 m apart and reuses the tested Commons.
2. **Department colours.** Colours are one per district (8), with departments told apart by their signs, rather than per-department tints. Tints on 22 small signs were indistinguishable in mock-ups.
3. **World-space hanging signs** (spec §4.7) are deferred to Stage 6 polish. Department names show as zoom-tiered HTML labels in this stage.

## File map

| File | Responsibility |
|---|---|
| `features/office/campus/districts.ts` (new) | district ids, names, colours, bounds, grid, dress/screen flavour; department → district |
| `features/office/campus/builder.ts` (new) | `LayoutBuilder`: `item`, `rug`, `plant`, `seat`, `spot`, `deskSeat`, `visit`, `wall`, desk setups, department anchors |
| `features/office/campus/commons.ts` (new) | the existing room, moved verbatim from `layout.ts` into builder calls |
| `features/office/campus/neighbourhoods.ts` (new) | pod packer per department and Leadership offices |
| `features/office/simulation/layout.ts` | assembles the campus; keeps its public exports; adds `DISTRICT_ANCHORS`, `DEPARTMENT_ANCHORS` |
| `features/office/simulation/navigation.ts` | rasterized obstacle build; `reachableFrom()` flood fill |
| `features/office/simulation/OfficeSimulation.ts` | away budget, district-local outings |
| `features/office/data/officeAgents.ts`, `data/coworkerCatalog.ts` | `district`, `department` on every coworker; drop wings |
| `features/office/data/officeZones.ts` | **deleted** (replaced by districts) |
| `features/office/scene/room/buildOffice.ts` | campus floor zones, perimeter windows, instanced screens |
| `features/office/scene/room/screens.ts` (new) | instanced desk screens with per-desk brightness |
| `features/office/scene/people/CrowdRenderer.ts` (new) | baked seated templates + instanced crowd + crowd picking |
| `features/office/scene/people/tiers.ts` (new) | pure: who is full-tier this frame |
| `features/office/scene/OfficeScene.ts` | tier manager, campus lights/shadow follow, label tiers, minimap data |
| `features/office/scene/cameraRig.ts` | symmetric frustum, campus clamp, zoom range, `zoomLevel()`, `viewBounds()` |
| `features/office/shell/DistrictChips.tsx`, `DepartmentMenu.tsx`, `Minimap.tsx`, `TeamStrip.tsx` (new) | office chrome |
| `features/office/OfficeCanvas.tsx`, `OfficeDirectory.tsx`, `store/officeStore.ts` | use the above; search by specialty |
| `tests/office-campus.test.cjs` (new) | layout, districts, nav, tiers |
| `tests/office-sim.test.cjs` | updated to the campus |
| `tests/office-desktop.cjs` | campus flow |

---

### Task 1: Districts and the coworker data model

**Files:** create `campus/districts.ts`; modify `data/officeAgents.ts`, `data/coworkerCatalog.ts`; test `tests/office-campus.test.cjs`.

**Interfaces (produces):**
```ts
export type DistrictId = 'commons' | 'engineering' | 'product' | 'design' | 'leadership' | 'ai-data' | 'business' | 'people-ops';
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export type ScreenFlavor = 'code' | 'data' | 'design' | 'document'; // re-exported from scene/room/materials type
export interface District {
  id: DistrictId; name: string; short: string; color: string;
  bounds: Bounds; grid: [cols: number, rows: number];
  departments: string[];          // catalog group names, in layout order
  flavor: ScreenFlavor; equipment: 'laptop' | 'laptop-monitor' | 'monitor';
  floor: 'oak' | 'carpet-blue' | 'carpet-sage' | 'concrete' | 'terrazzo' | 'walnut' | 'carpet-grey';
}
export const DISTRICTS: readonly District[];
export function districtOf(department: string): DistrictId;   // throws for unknown groups
export function districtById(id: DistrictId): District;
```
`OfficeAgent` gains `district: DistrictId` and `department: string` (core agents: `'commons'` and a readable hub name). `wing`, `agentsForWing` and `HQ_SPECIALISTS` are removed. `specialistColor(group)` returns the district colour. Specialist `role` keeps the group name.

District table (colours are AA on white for text use in labels; values tuned in Step 3):

| id | name | short | color | grid | departments |
|---|---|---|---|---|---|
| commons | Commons | Commons | `#b7791f` | 1×1 | — |
| engineering | Engineering | Engineering | `#2f5bd3` | 3×3 | Web & Frontend, Backend & APIs, Mobile, Cloud & Infrastructure, Security, Architecture & General Engineering, QA & Release, Platforms & Enterprise, Emerging Tech |
| product | Product & Delivery | Product | `#7c3aed` | 3×1 | Product Management, Project Management, Engineering Management |
| design | Design Studio | Design | `#c0267a` | 1×1 | Design |
| leadership | Leadership Suite | Leadership | `#0f5e57` | 5×2 offices | Executive Leadership |
| ai-data | AI & Data Lab | AI & Data | `#0e7490` | 1×1 | AI, ML & Data |
| business | Business | Business | `#b4461b` | 4×1 | Sales Management, Marketing Management, Customer Success, Strategy & Innovation |
| people-ops | People & Ops | People & Ops | `#3f7a3a` | 3×1 | Operations Management, HR & People, General Management |

- [ ] **Step 1: Failing tests** (`tests/office-campus.test.cjs`, same TS hook header as `office-panel.test.cjs`):
```js
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
  const lum = (hex) => { const c = [1,3,5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  for (const d of districts.DISTRICTS) assert.ok(1.05 / (lum(d.color) + 0.05) >= 4.5, `${d.id} ${d.color}`);
});
test('district rectangles do not overlap and keep a 2.4 m corridor', () => {
  const list = districts.DISTRICTS;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i].bounds, b = list[j].bounds;
    const gapX = Math.max(b.minX - a.maxX, a.minX - b.maxX);
    const gapZ = Math.max(b.minZ - a.maxZ, a.minZ - b.maxZ);
    assert.ok(Math.max(gapX, gapZ) >= 2.4, `${list[i].id} / ${list[j].id}`);
  }
});
```
- [ ] **Step 2:** Run it and confirm the tests fail (`Cannot find module …/campus/districts.ts`).
- [ ] **Step 3: Implement `districts.ts`** with the table above, the bounds from deviation 1 (Commons bounds x −14…14, z −10…12), `flavor`/`equipment`/`floor` per district (Engineering code/laptop-monitor/oak; Product document/laptop/carpet-blue; Design design/monitor/concrete; Leadership document/laptop-monitor/walnut; AI data/laptop-monitor/carpet-grey; Business data/laptop/carpet-blue; People document/laptop/carpet-sage; Commons document/laptop/terrazzo). If a colour fails the contrast test, darken it until it passes.
- [ ] **Step 4: Data model.** In `officeAgents.ts`, give the 8 core agents `district: 'commons'` and departments: Research Analyst and Writer → `'Library'`, Knowledge Librarian → `'Library'`, Designer and Product Coach → `'Planning'`, Files Agent → `'Files room'`, Marketing Strategist → `'Lounge'`, Ops Coordinator → `'Reception'`. Specialists get `district: districtOf(role.group)`, `department: role.group`, `accentColor: districtById(...).color`. Delete `agentsForWing`/`HQ_SPECIALISTS`/`wing`. In `officeStore.ts`, remove `activeWing`/`setWing` and replace them with `focusDistrict: DistrictId | null` and `setFocusDistrict(id)`. Fix compile errors in `OfficeCanvas`, `OfficeDirectory` and `OfficeScene` minimally: `OfficeScene` constructs every agent (the crowd arrives in Task 6, so temporarily only the 8 core plus the first 32 specialists are rendered) and the directory drops the wing picker. Tasks 5–8 finish the UI.
- [ ] **Step 5:** Run the tests; `npm run typecheck`; `npm test`. Commit `feat(office): districts and coworker data model`.

---

### Task 2: Campus layout (builder, Commons, neighbourhoods, Leadership)

**Files:** create `campus/builder.ts`, `campus/commons.ts`, `campus/neighbourhoods.ts`; modify `simulation/layout.ts`, `simulation/types.ts`; test `tests/office-campus.test.cjs`.

**Interfaces:**
```ts
// types.ts
export interface PointOfInterest { /* existing fields */ district?: DistrictId; department?: string }
// builder.ts
export class LayoutBuilder {
  readonly walls: Wall[]; readonly furniture: FurnitureItem[]; readonly pois: PointOfInterest[];
  readonly setups: DeskSetup[]; readonly visits: [deskId: string, x: number, z: number][];
  readonly departments: { name: string; district: DistrictId; bounds: Bounds; anchor: Vec2; desks: string[] }[];
  wall(id, kind, x1, z1, x2, z2): void;
  item(id, kind, x, z, w, d, options?): FurnitureItem;   // same semantics as today's `item`
  rug(id, x, z, w, d): void; plant(id, x, z, large?): void;
  seat(...same as today...): void; spot(...same..., extra?: { district?, department? }): void;
  deskSeat(id, zoneId, x, z, facing, chair?, extra?: { district?, department? }): void;
  setup(poiId, equipment, props, flavor?): void;
}
// neighbourhoods.ts
export function podGrid(count: number, w: number, d: number): { cols: number; rows: number };   // pure, tested
export function buildDistricts(b: LayoutBuilder, members: Record<string, string[]>): Record<string, string>; // department -> ids; returns agentId -> deskId
// layout.ts keeps: ROOM, WALL_THICKNESS, WALLS, FURNITURE, POINTS_OF_INTEREST, poiById, HOME_DESKS, DESK_SETUPS, DeskSetup, DeskEquipment, DeskProp, ZONE_ANCHORS, FurnitureKind, FurnitureItem, Wall, WallKind
// layout.ts adds:  DISTRICT_ANCHORS: Record<DistrictId, Vec2>; DEPARTMENT_ANCHORS: Record<string, Vec2>; DEPARTMENT_BOUNDS: Record<string, Bounds>; SCREEN_FLAVORS: Record<string, ScreenFlavor>
// layout.ts removes: SPECIALIST_DESKS
```
`ROOM` becomes `{ minX: -56, maxX: 56, minZ: -33, maxZ: 33 }`. The perimeter walls are: back solid (z −33), left solid (x −56), right low (x 56), front low (z 33). The Commons keeps its interior glass rooms. Its back wall is a solid `commons-back` from x −13.4 to 13.4 at z −9 (the lounge, meeting, library and files rooms lean on it, and it only hides the corridor behind). A glass `commons-files-e` runs from (13, −9) to (13, −1.6) to close the files room, and the old left, right and front walls are removed. Reception is a `reception-desk` item (new kind, 2.4 × 0.8, blocks) at (−9.5, 11.2) with a standing visit spot; Ops Coordinator's home desk stays `desk-ops`.

**Pod packer** (per department cell of size w × d, `n` people):
- Pods hold 4 (the existing `desk-pod`, 3.2 × 1.6, seats at x ±0.8, z ±1.15). Pod pitch is 4.8 m in x and 5.2 m in z, which leaves ≥ 1.6 m aisles.
- `P = ceil(n / 4)`; `maxCols = max(1, floor(w / 4.8))`; `cols = clamp(ceil(sqrt(P * w / d)), 1, min(P, maxCols))`; `rows = ceil(P / cols)`.
- Each cell reserves a 2.2 m back strip for its whiteboard (free-standing, facing +z, with a `whiteboard` spot 0.9 m in front, tagged with district and department) and the department anchor (the label point). Pods are centred in the rest.
- Plants: large ones at the two back corners, a small one at the front-right corner. One rug under the pod block.
- Seats are filled in catalog order, pod by pod (north seats first). Every seat gets a desk setup: the district's equipment, props picked by a hash of the seat id from `mug, notebook, plant, pen-cup, books, lamp, folder, tablet` (2–3 props), and the district's screen flavour. Each seat also gets a visit spot at its approach point.
- Empty seats keep a chair and a setup (screen off), so pods look complete.

**Leadership offices:** a 5 × 2 grid of 3.8 × 7 m cells, rows at z −31…−24 and −21…−14. Glass partitions separate cells, and each cell has a glass front wall with a 1.2 m door gap in the middle. The executive desk (`desk`, 1.7 × 0.8) is 2.9 m from the cell back, with the seat behind it facing +z, plus an armchair guest spot, a rug and a large plant. The department anchor is at the district centre.

- [ ] **Step 1: Failing tests** (append to `office-campus.test.cjs`):
```js
const layout = require('../src/renderer/src/features/office/simulation/layout.ts');
const hood = require('../src/renderer/src/features/office/campus/neighbourhoods.ts');
const inside = (p, b) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ;

test('podGrid fits every department in its cell', () => {
  assert.deepEqual(hood.podGrid(14, 9.9, 18.9), { cols: 2, rows: 2 });
  assert.deepEqual(hood.podGrid(10, 8.9, 18.5), { cols: 1, rows: 3 });
  assert.deepEqual(hood.podGrid(17, 35, 19), { cols: 4, rows: 2 });
});
test('every coworker has a unique home desk with a workstation', () => {
  const ids = agents.OFFICE_AGENTS.map((a) => a.id);
  const desks = ids.map((id) => layout.HOME_DESKS[id]);
  assert.ok(desks.every(Boolean));
  assert.equal(new Set(desks).size, 207);
  for (const desk of desks) assert.ok(layout.DESK_SETUPS.some((s) => s.poiId === desk), desk);
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
  const rects = layout.FURNITURE.filter((f) => f.blocks && !/-seat$/.test(f.id)).map((f) => {
    const turned = Math.abs(Math.sin(f.rotation)) > 0.5;
    const hw = (turned ? f.d : f.w) / 2, hd = (turned ? f.w : f.d) / 2;
    return { id: f.id, minX: f.x - hw, maxX: f.x + hw, minZ: f.z - hd, maxZ: f.z + hd };
  });
  for (const r of rects) assert.ok(r.minX > layout.ROOM.minX && r.maxX < layout.ROOM.maxX && r.minZ > layout.ROOM.minZ && r.maxZ < layout.ROOM.maxZ, r.id);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const overlap = a.minX < b.maxX - 0.01 && b.minX < a.maxX - 0.01 && a.minZ < b.maxZ - 0.01 && b.minZ < a.maxZ - 0.01;
    assert.ok(!overlap, `${a.id} overlaps ${b.id}`);
  }
});
test('every department has an anchor inside its district', () => {
  for (const d of districts.DISTRICTS) for (const dep of d.departments)
    assert.ok(inside(layout.DEPARTMENT_ANCHORS[dep], d.bounds), dep);
});
test('spot ids are unique', () => {
  const ids = layout.POINTS_OF_INTEREST.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
```
(The overlap test excludes chair footprints, which legitimately tuck under desks, and uses a sweep so it stays fast. Sort `rects` by `minX` and break the inner loop when `b.minX >= a.maxX`.)
- [ ] **Step 2:** Run it and confirm the tests fail.
- [ ] **Step 3:** `builder.ts`: move `item`, `rug`, `plant`, `seat`, `spot`, `deskSeat`, `SEAT_FOOTPRINT` and the `VISIT_SPOTS` logic out of `layout.ts` into the class, unchanged in behaviour.
- [ ] **Step 4:** `commons.ts`: `buildCommons(b)` replays today's `FIXED_FURNITURE`, the core desks, meeting/collab/lounge/café seats, standing spots, core visit spots and core desk setups, with **the same ids and coordinates**. It drops the old specialist studios and adds the reception desk and its visit spot.
- [ ] **Step 5:** `neighbourhoods.ts`: `podGrid`, then `buildDistricts(b, members)` that splits each district by its `grid` with 2.6 m gaps and packs pods (or offices for Leadership) as specified.
- [ ] **Step 6:** `layout.ts`: create the builder, add the perimeter and Commons walls, call `buildCommons`, compute `members` from `OFFICE_AGENTS` (non-commons, grouped by department in catalog order), call `buildDistricts`, and export everything. `HOME_DESKS` = the 8 core desks + the generated map. `ZONE_ANCHORS` stays (Commons rooms). Add `DISTRICT_ANCHORS` (the centre of each district's bounds; the Commons anchor is (0, 0)).
- [ ] **Step 7:** Run the tests, typecheck, and commit `feat(office): campus layout with commons, neighbourhoods and leadership offices`.

---

### Task 3: Nav grid at campus scale

**Files:** modify `simulation/navigation.ts`; test `tests/office-campus.test.cjs`, `tests/office-sim.test.cjs`.

**Interfaces:** `NavGrid` constructor unchanged (default `cellSize` becomes 0.25); new `reachableFrom(p: Vec2): Uint8Array` (a flood fill over unblocked cells) and `isReachable(mask, p): boolean`.

- [ ] **Step 1: Failing tests**
```js
const nav = require('../src/renderer/src/features/office/simulation/navigation.ts');
test('nav grid builds quickly at campus size', () => {
  const t = performance.now();
  const grid = new nav.NavGrid(nav.obstaclesFrom(layout.WALLS, layout.FURNITURE));
  const ms = performance.now() - t;
  console.log(`nav grid ${grid.cols}x${grid.rows} in ${ms.toFixed(0)} ms`);
  assert.ok(ms < 600, `${ms} ms`);
});
test('every spot is walkable and reachable from reception', () => {
  const grid = new nav.NavGrid(nav.obstaclesFrom(layout.WALLS, layout.FURNITURE));
  const mask = grid.reachableFrom(layout.poiById('visit-reception').approach);
  for (const poi of layout.POINTS_OF_INTEREST) {
    assert.ok(grid.isFree(poi.approach), `${poi.id} approach inside furniture`);
    assert.ok(grid.isReachable(mask, poi.approach), `${poi.id} unreachable`);
  }
});
```
- [ ] **Step 2:** Run them and confirm they fail. The build takes seconds today, and `reachableFrom` doesn't exist yet.
- [ ] **Step 3: Implement the rasterized build.** Initialize `nearest` per cell to the distance to the room edge. For each obstacle, take its bounding box inflated by `comfortRadius`, convert it to a cell range, and for those cells only compute the distance and take the minimum. Then threshold into `blocked`/`comfortBlocked` as before. Add `reachableFrom` (BFS over 8-neighbours with the same corner rule as `search`) and `isReachable`.
- [ ] **Step 4:** Run the tests. In `office-sim.test.cjs`, replace the all-pairs route test ("every spot is on walkable floor and reachable…") with: the Commons desks keep the all-pairs check against the **Commons** spots only (the spots inside Commons bounds), plus 40 random desk→spot routes across the campus checked for clear legs. Replace the first two tests (which used `SPECIALIST_DESKS`) with: for each department, all its members plus the core 8 run 60 s with tasks on; every member's screen goes `active`; there are no seat conflicts.
- [ ] **Step 5:** `npm test` green. Commit `perf(office): rasterized nav grid and reachability for the campus`.

---

### Task 4: Simulation at campus scale

**Files:** modify `simulation/OfficeSimulation.ts`; test `tests/office-sim.test.cjs`.

**Interfaces:** `SimulationOptions.maxAway?: number` (default 12). `OfficeSimulation.awayCount(): number`. The behaviour contract: `choosePlan` returns a desk plan when `awayCount() >= maxAway` (tasks are never limited); `visit` hosts come from the visitor's own department (the Commons core agents visit other core agents); `whiteboard` and `idle` spots come from the visitor's district (Commons spots for the core agents); café, lounge, bookshelf and printer stay Commons-wide, but only for the core agents and for specialists within 25 m of the café or library, so nobody hikes the full campus for a coffee.

- [ ] **Step 1: Failing tests**
```js
test('207 people: at most twelve away from their desks, and a step stays cheap', () => {
  const ids = agents.OFFICE_AGENTS.map((a) => a.id);
  const office = new OfficeSimulation({ agentIds: ids, seed: 5 });
  for (const id of ids) office.setTaskStatus(id, 'idle');
  let worst = 0;
  run(office, 15 * 60, 1 / 10, (o) => { assert.ok(o.awayCount() <= 12, `${o.awayCount()} away`); });
  for (let i = 0; i < 200; i++) { const t = performance.now(); office.step(1 / 60); worst = Math.max(worst, performance.now() - t); }
  assert.ok(worst < 8, `worst step ${worst.toFixed(2)} ms`);
});
test('specialists only visit people in their own department', () => {
  // run 20 minutes; whenever a view has poiId visit-*, its host desk's department equals the visitor's
});
```
Write the second test out fully: for each view whose `poiId` starts with `visit-`, look up `poiById(poiId).hostDeskId`, then that desk's `department`, and compare it with `OFFICE_AGENTS.find(a => a.id === view.id).department`, skipping the core agents.
- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3: Implement.** Keep a counter of agents whose plan kind is an ambient outing and who are not at home. Pass district and department into `AgentState` via a `profile` fallback built from `OFFICE_AGENTS`, keeping `AGENT_PROFILES` for the core 8. Specialists get weights `{ desk: 70, coffee: 6, whiteboard: 8, visit: 8, idle: 4, lounge: 4 }` with the 25 m rule applied at choose time. Filter the spot lists by district and department.
- [ ] **Step 4:** All simulation tests pass (the existing core-agent behaviour tests are unchanged). Commit `feat(office): campus-scale simulation with an away budget and local outings`.

---

### Task 5: Campus room rendering (floors, walls, windows, instanced screens, light)

**Files:** modify `scene/room/buildOffice.ts`, `scene/room/furniture.ts` (a `reception-desk` builder; `workstation` returns screen slots instead of meshes), `scene/room/materials.ts` (floor textures per district kind); create `scene/room/screens.ts`; modify `scene/OfficeScene.ts` (lights).

**Interfaces:**
```ts
// screens.ts
export interface ScreenSlot { deskId: string; flavor: ScreenFlavor; size: 'laptop' | 'monitor'; matrix: THREE.Matrix4 }
export class DeskScreens { constructor(slots: ScreenSlot[]); readonly object: THREE.Group; update(dt: number, elapsed: number, state: (deskId: string) => ScreenState): void; dispose(): void }
```
One `InstancedMesh` per (flavor × size) with a `MeshBasicMaterial({ map: screenTexture(flavor), toneMapped: false })`. The per-instance colour is `off #1d2530` → `on #9aa3ad` → `active #ffffff`, eased per desk. Active screens also pulse slightly (±6%). That makes 8 draw calls for all screens.

- **Floors:** one textured plane per district (oak = the existing wood texture; carpet = a new procedural fine noise texture tinted per kind; concrete; terrazzo with flecks; walnut = darker wood). Corridors are light oak. Planes sit at y = 0.001 over one base slab.
- **Perimeter walls** as today. The back wall (z −33) and the left wall (x −56) get **window bays**: a 3.6 m window every 6 m (skipping 1 m near corners), built with the existing window code as a loop.
- **Commons back wall** keeps the art, clock and slats (re-anchored to z −9 + t).
- **Light:** the hemisphere light stays. The sun's shadow camera follows the camera target each frame (snapped to 1 m to avoid shimmer), with a half-extent from `cameraRig.viewRadius()` clamped to 14…60 m. Map size stays 2048.
- `mergeStatic` stays; screens are no longer dynamic meshes.

- [ ] Steps: implement; `npm run build`; take desktop screenshots with Task 6 (people come next); commit `feat(office): campus floors, window bays, instanced desk screens and following light`.

---

### Task 6: Two-tier people (full rigs + instanced crowd)

**Files:** create `scene/people/tiers.ts`, `scene/people/CrowdRenderer.ts`; modify `scene/agents/HumanoidRig.ts` (tag each mesh with `userData.role`), `scene/OfficeScene.ts`; test `tests/office-campus.test.cjs` (tiers).

**Interfaces:**
```ts
// tiers.ts (pure)
export interface TierInput { id: string; x: number; z: number; mustBeFull: boolean; canBeCrowd: boolean }
export function chooseFullTier(people: TierInput[], centre: { x: number; z: number }, budget: number, previous: ReadonlySet<string>, hysteresis = 1.5): Set<string>;
// CrowdRenderer
export class CrowdRenderer {
  constructor(people: { id: string; look: Appearance; seat: { x: number; z: number; facing: number; height: number } }[]);
  readonly object: THREE.Group;
  setVisible(id: string, visible: boolean): void;   // hide while the person is full-tier
  update(elapsed: number, reducedMotion: boolean): void; // breathing / small sway via instance matrices, every other frame
  pick(raycaster: THREE.Raycaster): string | null;  // instanced invisible hit boxes
  dispose(): void;
}
```
`chooseFullTier` rules: everyone with `mustBeFull` (selected, on task, walking or away from their desk, i.e. `!canBeCrowd`) is always in the set. The rest of the budget goes to the nearest `canBeCrowd` people by distance to `centre`. People already in `previous` get their distance divided by `hysteresis` so the set doesn't flicker. `canBeCrowd` is true only when the person is seated at their home desk (`view.poiId === home && view.sit > 0.95`) and not selected or on a task.

**Baking:** build one template rig per jacket variant (jacket / none) with sentinel colours per role (skin, shirt, outer, trousers, shoes, badge, eyes, eye-white, mouth, brows→hair), apply `computePose({ behavior: 'typing', sit: 1, seatHeight: 0.48, scale: 1, … time: 0 })`, `updateMatrixWorld`, and merge the geometries per role in world space. Hair: one template per hairstyle, head-only. Glasses: one template. Each role becomes an `InstancedMesh` with `MeshStandardMaterial({ roughness: 0.85 })` and `instanceColor` from the person's appearance (fixed roles such as eyes and mouth use their fixed colours). Instance matrix: translate to the seat, rotate to the facing, uniform scale `s = height / 1.68`, with a y offset `0.48 * (1 - s)` so the hips stay on the seat. Crowd figures don't cast shadows. Each gets a blob shadow disc (instanced, `MeshBasicMaterial`, black, 18% opacity).

**OfficeScene:** create full `OfficeAgentCharacter`s **lazily** when someone first enters the full tier (keep a pool, and dispose of rigs that stay out of the tier for 30 s). Every 250 ms, recompute the tier from the simulation views and the camera target. When a person moves to the crowd, hide the rig and show their instance; when they move to full, the reverse. Hit-testing checks full hit boxes first, then `crowd.pick`. `setLabels` handles labels for people without a rig by using their seat position (height 1.55 m).

- [ ] **Step 1: Failing tiers tests**
```js
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
```
- [ ] **Step 2:** Confirm they fail, implement `tiers.ts`, confirm they pass.
- [ ] **Step 3:** Tag the rig meshes with roles, then write `CrowdRenderer`.
- [ ] **Step 4:** Tier manager and lazy rigs in `OfficeScene`, with `__axonOffice` gaining `tiers(): { full: number; crowd: number }` and `stats(): { fps: number; calls: number }` (from `renderer.info.render.calls` and a rolling frame time).
- [ ] **Step 5:** Build and visually verify with the desktop test screenshot at full-campus zoom and at a pod close-up: the crowd matches the full figures, and swapping between them isn't noticeable. Commit `feat(office): two-tier people with an instanced seated crowd`.

---

### Task 7: Camera for the campus

**Files:** modify `scene/cameraRig.ts`.

**Interfaces:** `zoomLevel(): number` (world metres per screen pixel), `viewBounds(): Bounds` (the floor area visible, as an axis-aligned rectangle), `viewRadius(): number`, `focus(point: Vec2, span: number)` (frames `span` metres of floor across the shorter screen side), `overview()` (whole campus), `target(): Vec2`.

- The frustum is symmetric around the target (no `centreX`/`centreY` offset). The target starts at the campus centre, with zoom 1 = the whole campus fitting the view.
- `MAX_ZOOM` fits about 9 m across the shorter side; `MIN_ZOOM` = 1 (whole campus). The near/far planes are `DISTANCE ± 90`.
- Clamp: the target stays inside the campus bounds shrunk by half the visible extent, or at the centre when the view is larger than the campus.
- The office opens on the Commons at a 44 m span, with a smooth glide (a cut under reduced motion).
- [ ] Steps: implement; manual check in the desktop run (pan, zoom, focus on a district); commit `feat(office): campus camera framing, zoom range and clamping`.

---

### Task 8: Office chrome — district chips, department menu, search, labels by zoom, team strip, minimap

**Files:** create `shell/DistrictChips.tsx`, `shell/DepartmentMenu.tsx`, `shell/TeamStrip.tsx`, `shell/Minimap.tsx`, `shell/search.ts` (pure); modify `OfficeCanvas.tsx` (split into these), `OfficeDirectory.tsx`, `OfficeScene.ts` (label tiers, `onViewChange` callback with `{ bounds, target, zoom }` throttled to 150 ms), `office.css`; delete `data/officeZones.ts`; test `tests/office-campus.test.cjs` (search).

**Interfaces:**
```ts
// search.ts
export function searchCoworkers(query: string, agents: readonly OfficeAgent[], limit = 8): OfficeAgent[];
// Scores: exact name match 100, name prefix 80, a name word starting with the query 60, department or district 40, capabilities/description/systemPrompt 20.
// Normalises "front-end" ≈ "frontend" ≈ "front end"; synonyms: sre→site reliability, ba→business analyst, ux→ui/ux, pm→product manager, qa→quality.
```
- **Labels by zoom** (from `zoomLevel()` in metres per pixel): far (> 0.09 m/px) shows 8 district cards (name, head count, colour dot) at the district anchors; middle (0.035–0.09) shows 22 department labels at the department anchors plus the Commons room names; near (< 0.035) shows name tags for people inside `viewBounds()`, at most 30, chosen by distance to the centre, with the selected and on-task people always shown. The collision pass stays. Label DOM elements are created only for the current tier (React renders the tier's list from `onViewChange`).
- **DistrictChips:** replaces the zone tabs, with 8 chips (Commons, Engineering, AI & Data, Design, Product, Business, People & Ops, Leadership). Clicking one calls `scene.focus(DISTRICT_ANCHORS[id], span)`, where the span fits the district bounds. The chip for the district containing the view centre is `aria-pressed`.
- **DepartmentMenu:** replaces the wing `<select>` with a button "Go to department…" that opens a searchable listbox grouped by district. Choosing a department focuses `DEPARTMENT_ANCHORS[name]` at a 16 m span and sets the team strip to that department.
- **Search:** uses `searchCoworkers`. Enter selects the top result: `selectAgent` + `scene.setSelectedAgent(id, true)` (focus at an 8 m span).
- **TeamStrip:** shows people in the focused department, else the district at the view centre (the Commons shows the core 8). Caption: "Engineering · 76 people". It scrolls horizontally.
- **Minimap:** a 180 × 105 SVG of district rectangles in their colours at 25% opacity with outlines, the viewport rectangle from `viewBounds()`, and dots for on-task people. Click or drag sets the camera target. It can collapse to a button (the state is kept in `localStorage` via try/catch).
- **Roster fallback:** grouped by district headings with the department under each name.

- [ ] **Step 1: Failing search tests**
```js
const search = require('../src/renderer/src/features/office/shell/search.ts');
const top = (q) => search.searchCoworkers(q, agents.OFFICE_AGENTS)[0]?.name;
test('search finds people by specialty', () => {
  assert.equal(top('front-end'), 'Frontend Developer');
  assert.equal(top('frontend'), 'Frontend Developer');
  assert.equal(top('business analyst'), 'Business Analyst');
  assert.equal(top('sre'), 'Site Reliability Engineer (SRE)');
  assert.equal(top('files'), 'Files Agent');
  assert.deepEqual(search.searchCoworkers('', agents.OFFICE_AGENTS), []);
});
```
- [ ] **Step 2:** Confirm they fail, implement `search.ts`, confirm they pass.
- [ ] **Step 3:** Build the components and the label tiers; delete `officeZones.ts`; style everything in `office.css` with the office variables.
- [ ] **Step 4:** Build and check visually. Commit `feat(office): district chips, department menu, specialty search, zoom-tier labels, team strip and minimap`.

---

### Task 9: Desktop checks, performance readout and screenshots

**Files:** modify `tests/office-desktop.cjs`.

- Replace the "16 selections" block: assert the far-tier district cards (8) at open; zoom to the Commons and click 8 core name tags.
- Replace `changeWing(...)`: use "Go to department…" → "Backend & APIs", assert the team strip caption contains "Backend & APIs", click Backend Developer in the strip, send a task, and assert the role context as before.
- Search "business analyst" + Enter → the panel shows Business Analyst.
- Performance: after the scene settles with the whole campus in view, read `window.__axonOffice.stats()` for 3 s. Assert `calls < 400` and log fps. Set `localStorage['axon.officeDebug'] = '1'` before load via `webContents.executeJavaScript` + reload.
- Tiers: assert `tiers().full <= 40 + onTask`.
- Screenshots: `campus-overview.png` (whole campus), `campus-engineering.png` (Engineering focus), `campus-pod.png` (pod close-up), `campus-dark.png`, `campus-compact.png` (1100 × 740).
- The roster fallback shows 207 cards grouped by district.
- [ ] Run it, look at every screenshot, fix what looks wrong, and commit `test(office): campus desktop checks, performance readout and screenshots`.

## Self-review

- Spec §4.3: districts (T1), neighbourhoods, corridors, desk assignment and invariants (T2); §4.4 Commons reused (T2), with its reception.
- Spec §4.6: tiers and crowd (T6), away budget ≤ 12 (T4), instanced screens and draw-call budget (T5, T9), shadows following the view (T5), nav raster (T3), reduced motion (T4, T7), roster fallback (T8).
- Spec §4.7: camera (T7), zoom-tier labels, chips, department menu, search, minimap, team strip (T8). The world-space signs are deviation 3.
- Spec §4.10: data changes (T1); `officeZones.ts` deleted (T8).
- Names used consistently: `DistrictId`, `DISTRICTS`, `districtOf`, `districtById`, `LayoutBuilder`, `podGrid`, `buildDistricts`, `DISTRICT_ANCHORS`, `DEPARTMENT_ANCHORS`, `DEPARTMENT_BOUNDS`, `reachableFrom`, `isReachable`, `maxAway`, `awayCount`, `DeskScreens`, `ScreenSlot`, `chooseFullTier`, `CrowdRenderer`, `zoomLevel`, `viewBounds`, `viewRadius`, `focus(point, span)`, `searchCoworkers`, `focusDistrict`/`setFocusDistrict`.
