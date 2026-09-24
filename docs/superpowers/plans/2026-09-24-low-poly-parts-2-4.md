# Low-poly office, Parts 2–4 (workstations and people, café and kitchen, lounge and play) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real workstations, district-coloured ergonomic chairs and crisper people (Part 2); a coffee bar, bakery and open kitchen with two chefs and a barista (Part 3); a TV with a PS5 and coworkers gaming, play corners with a play break, and a sleeping dog (Part 4), all within the draw-call, triangle and frame-rate budgets.

**Architecture:** Everything is procedural three.js built with the Part 1 kit. Static geometry still collapses in `mergeStatic`. Its first change is that every plain-coloured opaque material merges into one vertex-coloured material per surface (roughness, metalness, flat, depth pull), so new colours cost triangles, not draw calls. Anything that moves (screens, foosball rods, flames, the dog, staff) is either instanced or hidden at whole-campus zoom. Logic that can be tested (desk-prop placement, café and lounge layout, staff routines, the gaming and play breaks, the decor planner) lives in pure modules with node tests; the look is checked by the desktop check's screenshots.

**Tech Stack:** three.js 0.186, TypeScript, React 18, Electron; node:test (`npm test`) and the desktop check (`npm run build && npx electron tests/office-desktop.cjs`).

**Spec:** [`docs/superpowers/specs/2026-09-24-low-poly-office-design.md`](../specs/2026-09-24-low-poly-office-design.md) §3, §5–§8, plus the Parts 2–4 plan agreed in conversation (quoted in Global Constraints).

## Global Constraints

- Built in code with the Part 1 kit: rounded edges for made things (`bevelBox`, `lathe`), faceted surfaces for natural things (`facet`). No downloads; free third-party models only as a named fallback (file, source, size) and not needed by this plan.
- New colours ride in the geometry (vertex colours) so the office still draws in a few batches.
- Whole campus stays within **733** draw calls (desktop check, Balanced, 1600 × 960).
- Triangles at the whole-campus reading stay **≤ 2.3M** (1.72M before Part 2); the desktop check asserts it.
- 1920 × 1080 whole campus on Balanced: **≥ 50 fps**, read with the laptop on mains power (checked: `Win32_Battery.BatteryStatus` 2).
- The simulation never breaks: new breaks share the **12-away cap** and seat reservations; `npm test` passes after every task (no stacking, no walking through furniture, nobody stuck).
- Kitchen staff are not clickable, not searchable, not in the roster or team strip, not counted in "208 coworkers"; hidden at whole-campus zoom; still with reduced motion.
- Prettier-clean renderer code (`npm run format:check`); `npm run typecheck` clean.
- Each part ends with before/after screenshots (`test-results/lowpoly/before-partN`, `after-partN`) and one commit.

## File map

| File | Part | Responsibility |
|---|---|---|
| `scene/room/batching.ts` (new) | 2 | `mergeStatic` moved from `buildOffice.ts`; plain colours → vertex colours per surface |
| `scene/room/desks.ts` (new) | 2 | Desk tops, pods, pedestals, cable trays, dividers, computers, keyboards, desk props, `workstation()` |
| `campus/deskPlacement.ts` (new, pure) | 2 | Where equipment and props sit on a desk (seat-local rectangles) |
| `scene/room/chairs.ts` (new) | 2 | Ergonomic office chair with a district-coloured mesh back |
| `campus/districts.ts` | 2 | `districtAt(x, z)`; engineering and AI & Data equipment `dual-monitor` |
| `campus/neighbourhoods.ts` | 2 | Richer, varied `deskProps` |
| `scene/agents/HumanoidRig.ts`, `appearance.ts` | 2, 3 | Restyled people; uniforms for staff |
| `scene/people/CrowdRenderer.ts` | 2 | New fixed roles (soles), faceted hair |
| `campus/commons.ts` | 3, 4 | Café re-layout; lounge turned to the TV; gaming seats; dog bed |
| `scene/room/cafe.ts` (new) | 3 | Coffee bar, espresso machines, bakery counter |
| `scene/room/food.ts` (new) | 3 | Faceted bakery food, plates and cups |
| `scene/room/kitchen.ts` (new) | 3 | Open kitchen with flames and steam |
| `scene/staff/routines.ts` (new, pure) | 3 | Chefs' and barista's scripted loops |
| `scene/staff/StaffLayer.ts` (new) | 3 | Draws and animates the staff |
| `scene/agents/poses.ts` | 3, 4 | Staff actions; gaming and foosball poses |
| `scene/room/lounge.ts` (new) | 4 | Media console, TV, PS5, soundbar, record player, dog |
| `scene/room/tvScreen.ts` (new) | 4 | Canvas game loop and screensaver on the TV |
| `scene/room/playProps.ts` (new) | 4 | Foosball (instanced rods), arcade, dartboard, vending machine, snack shelf, TV corner |
| `campus/decor.ts` | 4 | Games, snacks and TV-corner groupings; strips packed end to end |
| `simulation/OfficeSimulation.ts`, `agentProfiles.ts`, `types.ts` | 4 | Gaming break and play break |

---

## Part 2 — Workstations and people

### Task 2.1: Batch static colours by surface (draw-call headroom)

**Files:** Create `scene/room/batching.ts`; modify `scene/room/buildOffice.ts` (remove `mergeStatic`, import `batchStatic`); test `tests/office-look.test.cjs`.

**Interfaces:** Produces `batchStatic(root: THREE.Group): void` and `surfaceKey(material: THREE.Material): string | null` (null: keep the material as is, for maps, emissive, transparent or non-standard materials).

- [ ] **Step 1: Failing test** (three runs in node):

```js
const THREE = require('three');
const batching = require('../src/renderer/src/features/office/scene/room/batching.ts');
const materials = require('../src/renderer/src/features/office/scene/room/materials.ts');

test('plain colours of one surface merge into one vertex-coloured mesh; glowing and see-through stay apart', () => {
  const root = new THREE.Group();
  const add = (color, options) => root.add(materials.box(color, [1, 1, 1], [0, 0, 0], options));
  add('#ff0000');
  add('#00ff00');
  add('#0000ff', { roughness: 0.82 });
  add('#ffffff', { emissive: '#ffcc00', emissiveIntensity: 0.6 });
  add('#d6ebf2', { transparent: true, opacity: 0.3 });
  batching.batchStatic(root);
  const meshes = root.children.filter((c) => c.isMesh);
  assert.equal(meshes.length, 3);
  const painted = meshes.find((m) => m.geometry.getAttribute('color'));
  assert.ok(painted.material.vertexColors);
  const colors = new Set();
  const attr = painted.geometry.getAttribute('color');
  for (let i = 0; i < attr.count; i++) colors.add([attr.getX(i), attr.getY(i), attr.getZ(i)].map((v) => v.toFixed(2)).join());
  assert.equal(colors.size, 3);
});
```

- [ ] **Step 2:** `npm test` → FAIL (module missing).
- [ ] **Step 3: Implement** `batching.ts`: `surfaceKey` returns `null` unless `MeshStandardMaterial`, no `map`, not transparent, emissive black; else `r|m|flat|polygonOffsetFactor`. `batchStatic` walks non-dynamic meshes; for a surface key, it clones the geometry into world space, drops `uv`, adds a `color` attribute (existing vertex colours × `material.color`, else `material.color` in linear space), adds a trivial index to non-indexed geometry, and buckets by `surface|cast|receive`; the bucket material is `mat('#ffffff', { vertexColors: true, roughness, metalness, flat, depthPull })`. Other meshes keep today's `mergeStatic` bucketing by material (non-indexed geometry gets a trivial index there too, so the `i`/`n` split disappears).
- [ ] **Step 4:** `npm test`, `npm run typecheck`, build, desktop check → record whole-campus calls before and after in the spec's revisions.

### Task 2.2: Desks (`desks.ts`)

**Files:** Create `scene/room/desks.ts`; modify `scene/room/furniture.ts` (desk, desk-pod, workstation code moves out; `furniture.ts` re-exports `workstation`), `campus/districts.ts` (`districtAt`).

**Interfaces:** Produces `districtAt(x: number, z: number, pad = 0.6): District | undefined`, `accentTones(districtColor: string): { base: string; light: string; pale: string; dark: string }`, `deskPod(item)`, `singleDesk(item)`.

- [ ] **Step 1: Failing test** (office-campus): `districtAt(-42.5, 0).id === 'engineering'`, `districtAt(22.5, 0) === undefined` (corridor), `districtAt(0, 0).id === 'commons'`.
- [ ] **Step 2:** FAIL. **Step 3:** implement `districtAt` in `districts.ts`; `rugTones` in furniture uses it.
- [ ] **Step 4: Pod:** a 3.2 × 1.6 top as `bevelBox` (radius 0.025) in pale oak with a thin darker edge band; panel legs at each end with a foot rail; a cable tray (perforated look: a shallow metal channel) under the centre line; a divider along the centre line as `paintedBox` in the district's `light` tone (0.36 m high above the desk, 0.03 thick) with a slim top rail in `dark`; pod A keeps its planter spine. Four pedestals, each a bevelled body with three drawer fronts (seams) and a bar handle per drawer. `singleDesk` (Commons 'desk'): the same top, two legs, one pedestal.
- [ ] **Step 5:** typecheck, run the app, look at a pod close up (`__axonOffice.focus(-37.6, -22.9, 9)`).

### Task 2.3: Computers

**Files:** `scene/room/desks.ts`, `campus/builder.ts` (`DeskEquipment` gains `'dual-monitor'`), `campus/districts.ts` (engineering and ai-data `equipment: 'dual-monitor'`), `campus/deskPlacement.ts` (equipment footprints); test `tests/office-campus.test.cjs`.

**Interfaces:** Produces `SCREENS_PER_SETUP: Record<DeskEquipment, number>` (laptop 1, monitor 1, laptop-monitor 2, dual-monitor 2) and `equipmentPlacements(equipment): Placement[]` where `Placement = { item: string; x: number; z: number; w: number; d: number; turn: number }` in seat-local metres (the person sits at the origin looking toward +z).

- [ ] **Step 1: Failing test:**

```js
test('only Engineering and AI & Data desks get dual screens', () => {
  for (const setup of layout.DESK_SETUPS) {
    const district = layout.poiById(setup.poiId).district;
    assert.equal(setup.equipment === 'dual-monitor', district === 'engineering' || district === 'ai-data', setup.poiId);
  }
  assert.ok(layout.DESK_SETUPS.filter((s) => s.equipment === 'dual-monitor').length >= 100);
});
```

- [ ] **Step 2:** FAIL. **Step 3:** set the equipment; add the placements.
- [ ] **Step 4: Models.** Monitor: slim bezel (dark casing 0.56 × 0.34 × 0.028 with the 0.54 × 0.31 screen inset, a 1 cm bezel and a slightly deeper chin), a back hump, a neck and an oval foot, tilted back 0.08 rad. Dual: two monitors angled ±0.28 rad, edges meeting in front of the seat. Laptop: thin base with two key-row strips and a trackpad, lid with the screen; on a stand (an aluminium riser, tilted) when there is also a monitor, on a low wedge riser otherwise. Keyboard: bevelled base with four key rows and a space bar. Mouse and pad on every desk (pad in the district `dark` tone, painted). Screens stay `display()` placeholders collected into `DeskScreens`, so extra monitors add instances, not draw calls.
- [ ] **Step 5:** tests, typecheck.

### Task 2.4: Desk life

**Files:** `campus/builder.ts` (`DeskProp` gains `'headphones' | 'bottle' | 'photo' | 'sticky-notes' | 'succulent' | 'figurine'`), `campus/neighbourhoods.ts` (`deskProps`), `campus/deskPlacement.ts` (`propPlacements`), `scene/room/desks.ts` (models); test `tests/office-campus.test.cjs`.

**Interfaces:** `propPlacements(equipment: DeskEquipment, props: DeskProp[]): Placement[]`; `POD_DESK = { minX: -0.78, maxX: 0.78, minZ: 0.4, maxZ: 1.12 }` (the half-pod in front of a seat, clear of the divider).

- [ ] **Step 1: Failing tests:**

```js
const placement = require('../src/renderer/src/features/office/campus/deskPlacement.ts');
const inside = (p, r) => p.x - p.w / 2 >= r.minX - 1e-9 && p.x + p.w / 2 <= r.maxX + 1e-9 && p.z - p.d / 2 >= r.minZ - 1e-9 && p.z + p.d / 2 <= r.maxZ + 1e-9;
const overlap = (a, b) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.z - b.z) * 2 < a.d + b.d;

test('desk life: everything stays on the desktop and nothing overlaps', () => {
  for (const setup of layout.DESK_SETUPS.filter((s) => layout.poiById(s.poiId).district && layout.poiById(s.poiId).district !== 'leadership')) {
    const all = [...placement.equipmentPlacements(setup.equipment), ...placement.propPlacements(setup.equipment, setup.props)];
    for (const p of all) assert.ok(inside(p, placement.POD_DESK), `${setup.poiId} ${p.item} off the desk`);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(all[i], all[j]), `${setup.poiId}: ${all[i].item} / ${all[j].item}`);
  }
});

test('desk life: neighbouring desks differ', () => {
  const pods = new Map();
  for (const setup of layout.DESK_SETUPS) {
    const pod = setup.poiId.replace(/-\d+$/, '') + ':' + Math.floor(Number(setup.poiId.match(/(\d+)$/)?.[1] ?? 0) / 4);
    (pods.get(pod) ?? pods.set(pod, []).get(pod)).push([...setup.props].sort().join());
  }
  for (const [pod, sets] of pods) assert.equal(new Set(sets).size, sets.length, pod);
  const all = new Set(layout.DESK_SETUPS.flatMap((s) => s.props));
  for (const prop of ['headphones', 'bottle', 'photo', 'sticky-notes', 'succulent', 'figurine']) assert.ok(all.has(prop), prop);
});
```

- [ ] **Step 2:** FAIL. **Step 3:** `deskProps(seatId, index)` picks three or four props from twelve by hash, rotated by the seat's index in its pod so pod-mates always differ; `propPlacements` fills free slots on the seat's left and right of the equipment, front to back.
- [ ] **Step 4: Models:** headphones (band + two cups), water bottle (lathe), photo frame (easel back, picture in painted tones), sticky notes (a small stack and two on the monitor bezel), succulent (faceted rosette in a small pot), figurine (faceted little character). Existing props restyled with `lathe`/`bevelBox`.
- [ ] **Step 5:** tests, typecheck.

### Task 2.5: Chairs

**Files:** Create `scene/room/chairs.ts`; `furniture.ts` routes `office-chair` there with the district accent.

- [ ] **Step 1:** `ergonomicChair(accent)`: a bevelled seat cushion in charcoal, a mesh back as `paintedBox` in the accent's `light` tone framed in charcoal, a lumbar band, armrests (post + pad), an 8-sided gas lift, a five-star base of bevelled spokes, and five low-poly casters (6-sided wheels). Colour of the back from `districtAt(item.x, item.z)`.
- [ ] **Step 2:** measure triangles per chair in node (≤ 450) and the campus total in the desktop check.

### Task 2.6: People

**Files:** `scene/agents/HumanoidRig.ts`, `scene/agents/appearance.ts`, `scene/people/CrowdRenderer.ts`, `scene/people/portraits.ts` (framing); test `tests/office-people.test.cjs`.

- [ ] **Step 1: Failing test:** a district tint: every district's `DRESS_CODES[district].colours` includes at least one colour within ΔE-ish distance (RGB distance < 90) of the district's accent family, and `generateAppearance` still passes the existing tests.
- [ ] **Step 2: Rig:** head joint scaled 1.1 (`HEAD_SCALE`); hair material flat-shaded and hair shapes on low-subdivision solids (faceted); brows a touch thicker; shoes gain a sole in a fixed `#2f2b28`; a shirt collar (two collar points, or a band for tees and hoodies) and cuffs at the wrists (shirt colour under layers, sleeve colour otherwise).
- [ ] **Step 3: Crowd:** `FIXED` learns the sole colour; the hair instanced material is flat-shaded; the baked seated pose picks up the new head size automatically.
- [ ] **Step 4: Portraits:** reframe the camera for the larger head.
- [ ] **Step 5:** tests, typecheck, look at portraits and a close-up.

### Task 2.7: Part 2 check and commit

- [ ] Desktop check: `p2-desk.png` (`focus(-37.6, -21.7, 9)`), `p2-pods.png` (core pods, span 10), `p2-people.png` (a pod with people, span 9); `assert.ok(stats.triangles <= 2.3e6)` next to the draw-call budget.
- [ ] `npm test && npm run typecheck && npm run format:check && npm run build && npx electron tests/office-desktop.cjs` → `OFFICE_CHECK_PASS`.
- [ ] Copy screenshots to `test-results/lowpoly/after-part2`; record readings and deviations in the spec's revisions; commit `feat(office): workstations and people (low-poly Part 2)`.

---

## Part 3 — Café and kitchen

### Task 3.1: Café re-layout

**Files:** `campus/commons.ts` (`buildCafe`), `campus/builder.ts` (kinds `coffee-bar`, `bakery-counter`, `open-kitchen` replace `cafe-counter` and `pastry-case`); tests `tests/office-campus.test.cjs`, `tests/office-sim.test.cjs`.

**Layout (metres):** coffee bar `(14.0, -3.875)` 4.6 × 1.2, its front edge on today's line (z −3.275) and a 0.55 m barista strip behind the counter inside its footprint, so coworkers never walk through the barista; bakery counter `(10.85, -3.6)` 1.5 × 0.65 at the bar's west end; open kitchen `(18.35, -1.75)` 2.9 × 4.4 (x 16.9–19.8, z −3.95–0.45), one blocking footprint drawn as the whole kitchen; communal table to `(18.3, 3.6)` with seats at z 2.2–5.2; `plant-cafe-2` to `(19.2, 7.0)`. The pickups (`cafe-machine`, `cafe-counter-1`, `cafe-counter-2`) keep their positions.

- [ ] **Step 1: Failing tests:**

```js
test('café: pickups still work, the Files room door stays reachable, the walkway behind the bar stays clear', () => {
  const office = new OfficeSimulation({ agentIds: [] });
  const grid = office.grid;
  for (const id of CAFE_PICKUP) assert.ok(grid.isFree(layout.poiById(id).approach), id);
  for (let x = 9.5; x <= 19.5; x += 0.25) assert.ok(grid.isFree({ x, z: -5.2 }), `walkway blocked at x ${x}`);
  for (const target of ['file-cabinet', 'printer'])
    for (const from of [...CAFE_PICKUP, 'cafe-t3-b', 'cafe-c1']) {
      const path = grid.findPath(layout.poiById(from).approach, layout.poiById(target).approach);
      assert.ok(path, `${from} -> ${target}`);
    }
  // Nobody can walk into the kitchen or behind the bar.
  for (const p of [{ x: 18.3, z: -2 }, { x: 18.3, z: -0.4 }, { x: 14, z: -4.25 }]) assert.ok(!grid.isFree(p), JSON.stringify(p));
});
```

- [ ] **Step 2:** FAIL. **Step 3:** re-lay the café; existing layout tests (no overlaps, every spot reachable) keep passing.

### Task 3.2: Coffee bar and bakery

**Files:** Create `scene/room/cafe.ts`, `scene/room/food.ts`; `furniture.ts` routes the kinds; `buildOffice.ts` handles several busy lights per item (`BuiltFurniture.machines`).

**Interfaces:** `BuiltFurniture.machines?: { light: THREE.Mesh; steam: THREE.Object3D; spots: string[] }[]` (the bar's two machines: A serves `cafe-machine` and `cafe-counter-1`, B serves `cafe-counter-2`).

- [ ] Coffee bar: bevelled counter with a wood front and a stone top; a slatted duckboard in the barista strip; under-counter fridge fronts on the barista side; two espresso machines (bevelled body, group heads with portafilters, drip tray, cups on the warmer, a gauge, busy light, steam) facing the barista; a grinder (lathe hopper with beans); a cup tower; four syrup bottles; a chalk menu board on a stand at the bar's back edge facing the café.
- [ ] Bakery counter: a glass case on a bevelled base with two trays of faceted food; on top a cake on a stand with a slice cut, a basket of loaves and baguettes, and a jar of cookies.
- [ ] `food.ts`: `croissant`, `doughnut` (icing + sprinkles), `muffin`, `cupcake`, `cake` (stand, slices), `loaf`, `baguette`, `cookie`, `plate`, `cup` — all faceted in the one facet material (one batch).
- [ ] Café tables 1, 3 and 5 get a plate with a pastry and a cup; the island gets a cake dome.

### Task 3.3: Kitchen

**Files:** Create `scene/room/kitchen.ts`; `furniture.ts` routes `open-kitchen`; `buildOffice.ts` exposes `room.kitchen`.

**Interfaces:** `BuiltFurniture.kitchen?: KitchenFx`; `interface KitchenFx { object: THREE.Object3D; setCooking(on: boolean, elapsed: number): void }`; `OfficeRoom.kitchen: KitchenFx | null`.

- [ ] Along the east side (facing west): a tall fridge, a range (four burners, oven door beneath, pans and a pot on top) under a stainless extractor hood with its chimney, an oven column. Along the west side: the prep counter with a chopping board, knife, faceted vegetables and a rail of hanging utensils above the back counter. Along the south: the pass with a heat lamp and plate stacks. A tiled floor inside the footprint (pulled forward in the depth test like rugs). Contact patches under the appliances.
- [ ] Flames (emissive, flickering) under the pan and pot and steam puffs over the pot, visible only while cooking.

### Task 3.4: Staff routines (pure)

**Files:** Create `scene/staff/routines.ts`; test `tests/office-staff.test.cjs`.

**Interfaces:**

```ts
export type StaffId = 'chef-grill' | 'chef-prep' | 'barista';
export type StaffAction = 'stir' | 'flip' | 'chop' | 'plate' | 'wipe' | 'brew' | 'idle' | 'walk';
export interface StaffState { id: StaffId; x: number; z: number; heading: number; action: StaffAction; speed: number; cooking: boolean }
export const STAFF_IDS: readonly StaffId[];
export const STAFF_ZONES: Record<StaffId, Bounds>;
export class StaffRoutines { constructor(reducedMotion = false); update(dt: number, waiting: readonly string[]): readonly StaffState[] }
```

- [ ] **Step 1: Failing tests:**

```js
test('the grill chef stirs, then flips, and the flames burn while he cooks', () => {
  const staff = new routines.StaffRoutines();
  const at = (t) => { let s; for (let i = 0; i < Math.round(t * 20); i++) s = staff.update(0.05, []); return s.find((x) => x.id === 'chef-grill'); };
  assert.equal(at(3).action, 'stir');
  assert.equal(at(4).action, 'flip'); // 7 s in total
  assert.ok(at(1).cooking);
});

test('the prep chef chops, carries to the pass and plates, then goes back', () => { /* chop at 4 s, walk at 8.5 s, plate at 11 s, back to chop by 19 s */ });

test('the barista wipes the bar until someone waits for coffee, then pulls a shot at the nearest machine', () => {
  const staff = new routines.StaffRoutines();
  for (let i = 0; i < 100; i++) staff.update(0.05, []);
  assert.equal(staff.update(0.05, []).find((s) => s.id === 'barista').action, 'wipe');
  let brewing = 0;
  for (let i = 0; i < 60; i++) if (staff.update(0.05, ['cafe-counter-2']).find((s) => s.id === 'barista').action === 'brew') brewing++;
  assert.ok(brewing > 10, 'brews within three seconds');
  for (let i = 0; i < 200; i++) staff.update(0.05, []);
  assert.equal(staff.update(0.05, []).find((s) => s.id === 'barista').action, 'wipe');
});

test('staff stay inside their zones, which coworkers cannot reach, and are not coworkers', () => {
  const office = new OfficeSimulation({ agentIds: [] });
  const staff = new routines.StaffRoutines();
  for (let i = 0; i < 6000; i++)
    for (const s of staff.update(0.05, i % 400 < 100 ? ['cafe-machine'] : []))
      assert.ok(!office.grid.isFree(s), `${s.id} at ${s.x.toFixed(2)}, ${s.z.toFixed(2)} is on walkable floor`);
  for (const id of routines.STAFF_IDS) assert.ok(!agents.OFFICE_AGENTS.some((a) => a.id === id));
  assert.equal(agents.OFFICE_AGENTS.length, 208);
});

test('with reduced motion the staff hold still', () => { /* positions and actions unchanged over 60 s */ });
```

- [ ] **Step 2:** FAIL. **Step 3:** implement as time-driven step lists per person; the barista's list is interrupted by a waiting pickup (nearest machine: A for `cafe-machine`/`cafe-counter-1`, B for `cafe-counter-2`).

### Task 3.5: Staff on screen

**Files:** Create `scene/staff/StaffLayer.ts`; modify `scene/agents/appearance.ts` (`uniform?: 'chef' | 'barista'`), `HumanoidRig.ts` (toque, cap, apron), `poses.ts` (staff actions), `OfficeScene.ts` (layer, visibility, kitchen flames, debug `staff()` and `staffPoint(id)`); desktop check.

- [ ] Chefs: white double-breasted jacket (buttons), checked trousers, a toque, a white apron. Barista: dark shirt, a brown apron, a cap. Held tools: spatula and pan (grill), knife (prep; plate while plating), cloth or cup (barista).
- [ ] Visible only while `metresPerPixel < 0.06` and the café is on screen; no hit boxes; not in labels, search or counts.
- [ ] Desktop check: café close-up `p3-cafe.png` with the Writer sent for coffee so the barista brews; a click on the barista's screen point selects nobody; `staff()` reports three.

### Task 3.6: Part 3 check and commit

- [ ] As Task 2.7 with `after-part3`; commit `feat(office): café, bakery and open kitchen with staff (low-poly Part 3)`.

---

## Part 4 — Lounge and play

### Task 4.1: Lounge turned to the TV

**Files:** `campus/commons.ts` (`buildLounge`), `campus/builder.ts` (kinds `media-console`, `dog-bed`), `simulation/types.ts` (`PoiType` gains `'game-seat'`), `scene/room/buildOffice.ts` (`wallDecor`: art beside the TV); tests.

**Layout:** media console with the TV `(-15.6, -14.55)` 1.8 × 0.45 facing +z (the camera sees the screen); main sofa to `(-15.6, -7.7)` facing the TV (rotation π), seats `lounge-sofa-1..3` at z −8.35, approached from z −8.95; side sofas 0.6 m north (z −11.0), seats 4–7 at z −11.6 and −10.4; gaming bean bags `(-16.3, -12.95)` and `(-14.9, -12.95)` with seats `game-seat-1/2` facing the TV, approached from z −12.3; dog bed `(-18.0, -13.95)` round 0.8; the old bean bags go.

- [ ] **Step 1: Failing test:** game seats exist, are seated, face the TV (`facing ≈ π`), and are reachable from reception; the console is in front of the back wall and its screen faces the viewer (rotation 0).
- [ ] **Step 2:** FAIL. **Step 3:** re-lay; all layout and simulation tests pass.

### Task 4.2: Media wall and game screen

**Files:** Create `scene/room/lounge.ts`, `scene/room/tvScreen.ts`; `furniture.ts`, `buildOffice.ts` (`room.tv`), `OfficeScene.ts` (redraw only when the TV is on screen).

**Interfaces:** `class TvScreen { material; update(elapsed: number, playing: boolean, visible: boolean): void; dispose() }`; `tvFrameDue(sinceLast: number, playing: boolean): boolean` (pure: 1/20 s while playing, 1/4 s for the screensaver).

- [ ] Console (bevelled, two doors), TV on a pedestal (slim bezel, the screen a `TvScreen` material), soundbar, PS5 (two white shells round a black core, blue light strip), two controllers on the console (hidden one by one while players hold them), a record player with a sleeve leaning beside it.
- [ ] Game: sky and hills, a road in perspective with moving stripes, two karts weaving, lap counter. Screensaver: a soft drifting gradient with a slow logo.

### Task 4.3: Gaming break

**Files:** `simulation/types.ts` (`AgentBehaviorState` `'gaming'`, `HeldItem` `'controller'`), `simulation/agentProfiles.ts` (`AmbientActivity` `'gaming'`, durations 40–90 s, weights for the core team and specialists near the Commons), `simulation/OfficeSimulation.ts`, `scene/agents/poses.ts`, `scene/agents/OfficeAgentCharacter.ts` (controller prop); tests `tests/office-sim.test.cjs`.

- [ ] **Step 1: Failing tests:** a near-Commons coworker asked to game reaches a game seat, sits, plays with a controller and a friend joins when the other seat is free and the away budget allows; a third request with both seats taken returns false; a real task mid-game sends the player to their desk; nobody games while on a task; players go back and sit at their desks afterwards; far specialists never game.
- [ ] **Step 2:** FAIL. **Step 3:** `gaming` plan: claim a free game seat, hold the controller, play, put it down, leave; invite a settled partner near the Commons for the other seat (same duration) when `awayCount() + 2 <= maxAway`. `OUTINGS` gains `gaming`.
- [ ] **Step 4: Pose:** seated low, leaning in, both hands at the chest with small thumb and wrist movement, a lean with the turns, and now and then a cheer (arms up).

### Task 4.4: Play corners and the play break

**Files:** Create `scene/room/playProps.ts`; modify `campus/builder.ts` (kinds `foosball`, `arcade`, `dartboard`, `vending-machine`, `snack-shelf`, `tv-corner`; `PoiType` `'play'`), `campus/decor.ts`, `simulation/*` (`AmbientActivity` `'play'`, `AgentBehaviorState` `'foosball'`), `buildOffice.ts` (instanced foosball rods), `poses.ts`; tests.

- [ ] **Step 1: Failing tests:** decor: every Engineering department gets a `games` corner (foosball + arcade) and at least one of `snacks`/`tv-corner`, and its largest bare stretch is under 4 m wide; every play spot is walkable and reachable (the existing sampled-route checks include them); play break: a specialist plays only at their own department's spots, foosball pulls in a teammate from the same department for the other end, arcade is solo, and both return to their desks; the 12-away cap holds with play in the mix.
- [ ] **Step 2:** FAIL. **Step 3:** decor groupings `games` (4.6 × 3.0), `snacks` (3.2 × 2.2), `tv-corner` (3.4 × 3.0); strips are packed end to end with wishes until full; Engineering's wishes first. Play spots: two foosball ends (standing, facing the table) and one arcade spot per games corner.
- [ ] **Step 4: Models:** foosball table (bevelled box on legs, green field, goals, rods as one instanced mesh across the campus that spins and slides while the table is busy), arcade cabinet (bevelled cabinet, glowing screen and marquee, joystick and buttons), dartboard on a stand (painted rings, darts), vending machine (glowing window with rows of snacks, keypad, tray), snack shelf (jars, fruit bowl, boxes), TV corner (small TV on a console, two bean bags).

### Task 4.5: Office dog

**Files:** `scene/room/lounge.ts` (`dogBed`), `furniture.ts`, `buildOffice.ts` (breathing).

- [ ] A faceted, curled-up dog (body, head on paws, ears, tail) asleep on a round cushion; the body breathes (a slow scale), still with reduced motion.

### Task 4.6: Part 4 check and commit

- [ ] Desktop check: `p4-lounge.png` (two coworkers gaming, TV showing the game), `p4-engineering-games.png`, budgets; `after-part4`; spec revisions; commit `feat(office): lounge with a TV and PS5, play corners and a dog (low-poly Part 4)`.
