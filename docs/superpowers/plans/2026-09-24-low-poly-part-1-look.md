# Low-poly office, Part 1 (the look) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the office the clean isometric-diorama look: ambient-occlusion shading with a quality setting, contact shadows, a shared style kit, a plinth, thicker capped walls, framed windows, calmer floors and restyled plants.

**Architecture:** A small render pipeline (`scene/render/pipeline.ts`) draws the scene into a multisampled target with a depth texture, applies three.js's `GTAOPass` at half resolution when quality is High, and finishes with `OutputPass`. A pure quality module decides Auto → Balanced. Everything else stays procedural geometry merged by `buildOffice`'s `mergeStatic`, so new detail costs triangles, not draw calls.

**Tech Stack:** three.js 0.186 (`three/examples/jsm/postprocessing`), TypeScript, React 18, Electron; node:test for unit tests; `tests/office-desktop.cjs` for the desktop check.

**Spec:** [`docs/superpowers/specs/2026-09-24-low-poly-office-design.md`](../specs/2026-09-24-low-poly-office-design.md) §3–§4.

## Global Constraints

- Whole-campus draw calls within **733** on Balanced (desktop check, 1600 × 960).
- 1920 × 1080 whole campus: **≥ 50 fps on Balanced** on the target laptop; High measured and reported, not gated.
- The nav grid, walls used by navigation, seats and furniture positions do not move.
- No new npm dependencies.
- Prettier-clean renderer code (`npm run format:check`).

---

### Task 1: Quality setting and the Auto rule

**Files:**
- Create: `src/renderer/src/features/office/scene/render/quality.ts`
- Modify: `src/renderer/src/Settings.tsx` (next to `OfficeLightingField`)
- Test: `tests/office-look.test.cjs`

**Interfaces:**
- Produces: `type QualityMode = 'auto' | 'high' | 'balanced'`, `type QualityLevel = 'high' | 'balanced'`, `qualityPreference(): QualityMode`, `setQualityPreference(mode)`, the window event `'axon-office-quality'`, and `class AutoQuality { level: QualityLevel; sample(fps: number, dt: number, steady: boolean): QualityLevel }`.

- [ ] **Step 1: Failing test.** `tests/office-look.test.cjs` (same ts-require preamble as `office-campus.test.cjs`):

```js
const quality = require('../src/renderer/src/features/office/scene/render/quality.ts');

test('Auto quality steps down after 4 s of steady slow frames, and never back up', () => {
  const auto = new quality.AutoQuality();
  for (let i = 0; i < 200; i++) auto.sample(40, 1 / 60, false);
  assert.equal(auto.level, 'high', 'a moving camera never counts');
  for (let i = 0; i < 180; i++) auto.sample(40, 1 / 60, true);
  assert.equal(auto.level, 'high', 'three seconds is not enough');
  for (let i = 0; i < 70; i++) auto.sample(40, 1 / 60, true);
  assert.equal(auto.level, 'balanced');
  for (let i = 0; i < 600; i++) auto.sample(60, 1 / 60, true);
  assert.equal(auto.level, 'balanced');
});

test('a fast frame resets the slow streak', () => {
  const auto = new quality.AutoQuality();
  for (let i = 0; i < 200; i++) auto.sample(40, 1 / 60, true);
  auto.sample(58, 1 / 60, true);
  for (let i = 0; i < 200; i++) auto.sample(40, 1 / 60, true);
  assert.equal(auto.level, 'high');
});

test('quality preference defaults to auto without storage', () => {
  assert.equal(quality.qualityPreference(), 'auto');
});
```

- [ ] **Step 2:** `node --test tests/office-look.test.cjs` → FAIL (module missing).
- [ ] **Step 3: Implement** `quality.ts`:

```ts
export type QualityMode = 'auto' | 'high' | 'balanced';
export type QualityLevel = 'high' | 'balanced';

const STORAGE_KEY = 'axon.office.quality';
const SLOW_FPS = 45;
const SLOW_SECONDS = 4;

/** The chosen quality (a per-device preference; Auto unless changed in Settings). */
export function qualityPreference(): QualityMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'high' || stored === 'balanced' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function setQualityPreference(mode: QualityMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new Event('axon-office-quality'));
  } catch {
    // Storage is unavailable: the choice lasts until the office reloads.
  }
}

/**
 * Auto quality: starts High and steps down to Balanced once the frame rate stays under 45 fps
 * for 4 s while the view is steady. It never steps back up in the same session.
 */
export class AutoQuality {
  level: QualityLevel = 'high';
  private slow = 0;

  sample(fps: number, dt: number, steady: boolean): QualityLevel {
    if (this.level === 'balanced') return this.level;
    this.slow = steady && fps < SLOW_FPS ? this.slow + dt : 0;
    if (this.slow >= SLOW_SECONDS) this.level = 'balanced';
    return this.level;
  }
}
```

- [ ] **Step 4:** Settings: an `OfficeQualityField` below `OfficeLightingField`, a `<select>` with Auto / High / Balanced (hint: "High adds soft shading where things meet. Auto switches to Balanced if the office runs slowly.") calling `setQualityPreference`.
- [ ] **Step 5:** tests pass; typecheck.

### Task 2: Render pipeline with ambient occlusion

**Files:**
- Create: `src/renderer/src/features/office/scene/render/pipeline.ts`
- Modify: `scene/OfficeScene.ts` (renderer setup, `tick`, `handleResize`, `destroy`, debug handle, `initEvents`), `scene/cameraRig.ts` (add `settled()`; include the plinth depth in the zoom-1 fit)
- Test: desktop check (Task 6)

**Interfaces:**
- Consumes: `AutoQuality`, `qualityPreference`, `'axon-office-quality'` (Task 1).
- Produces: `class RenderPipeline { constructor(renderer, scene, camera); setSize(cssWidth, cssHeight): void; ao: boolean; render(): void; dispose(): void }`; debug handle gains `quality(): { mode: QualityMode; level: QualityLevel }` and `setQuality(mode: QualityMode): void`.

- [ ] **Step 1: Implement** `pipeline.ts`:

```ts
import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Draws the office: the scene into a multisampled target, soft ambient occlusion from its depth
 * (at half resolution, normals rebuilt from depth, so no second scene render), then tone mapping
 * and colour space to the canvas. With `ao` off it is the scene and the output pass only.
 */
export class RenderPipeline {
  ao = true;
  private readonly sceneTarget: THREE.WebGLRenderTarget;
  private readonly aoTarget: THREE.WebGLRenderTarget;
  private readonly gtao: GTAOPass;
  private readonly output = new OutputPass();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.Camera
  ) {
    this.scene = scene;
    this.sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(1, 1)
    });
    this.aoTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.gtao = new GTAOPass(scene, camera, 1, 1, { depthTexture: this.sceneTarget.depthTexture });
    this.gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.2, thickness: 1.2, scale: 1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.9;
    this.output.renderToScreen = true;
    renderer.info.autoReset = false;
  }
  private readonly scene: THREE.Scene;

  setSize(width: number, height: number): void {
    const ratio = this.renderer.getPixelRatio();
    const w = Math.max(1, Math.round(width * ratio));
    const h = Math.max(1, Math.round(height * ratio));
    this.sceneTarget.setSize(w, h);
    this.aoTarget.setSize(w, h);
    this.gtao.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
  }

  render(): void {
    const renderer = this.renderer;
    renderer.info.reset();
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(this.scene, this.camera);
    let result = this.sceneTarget;
    if (this.ao) {
      this.gtao.render(renderer, this.aoTarget, this.sceneTarget);
      result = this.aoTarget;
    }
    this.output.render(renderer, null, result);
  }

  dispose(): void {
    this.sceneTarget.depthTexture?.dispose();
    this.sceneTarget.dispose();
    this.aoTarget.dispose();
    this.gtao.dispose();
    this.output.dispose();
  }
}
```

- [ ] **Step 2: Wire into `OfficeScene`.** Create the renderer with `antialias: false` (the pipeline multisamples). Build `this.pipeline` after `this.scene` and the camera exist; `handleResize` calls `this.pipeline.setSize(width, height)`; `tick` replaces `this.renderer.render(...)` with `this.pipeline.render()`. Quality: `this.mode = qualityPreference()`, `this.auto = new AutoQuality()`; each tick, once 3 s have passed since load, `const level = this.mode === 'auto' ? this.auto.sample(this.fps, dt, this.cameraRig.settled() && !document.hidden) : this.mode; this.pipeline.ao = level === 'high'`. Listen to `'axon-office-quality'` to re-read the preference (and reset `AutoQuality`). Contact shadows (Task 3) get `material.opacity` 0.35 with AO on and 0.6 off, set when the level changes. Dispose the pipeline in `destroy`.
- [ ] **Step 3: `cameraRig.settled()`** returns true when the target is within 1 cm of its destination and the zoom within 0.1 %. The zoom-1 fit adds `y = -0.5` (the plinth's foot) to its corner list.
- [ ] **Step 4:** Typecheck; run the app and compare High and Balanced by eye (`window.__axonOffice.setQuality('high' | 'balanced')`).

### Task 3: Style kit and contact shadows

**Files:**
- Modify: `scene/room/materials.ts` (`MaterialOptions.vertexColors`, palette refresh, shadow texture), `scene/room/kit.ts` (helpers), `scene/room/buildOffice.ts` (`mergeStatic` keeps `color`; decals under furniture)
- Create: `src/renderer/src/features/office/scene/room/grounding.ts` (which items get a contact shadow, and its size)
- Test: `tests/office-look.test.cjs`

**Interfaces:**
- Produces: `bevelBox(color, size, position, radius?, options?)`, `facet(geometry, color, variation, seed): THREE.BufferGeometry` (non-indexed, per-face `color` attribute), `lathe(points: [r, y][], color, segments?, options?)`, `groundShadow(item: FurnitureItem): { w: number; d: number; round: boolean } | null`, `contactShadows(items): THREE.Mesh[]`, and `contactShadowMaterial` (shared, opacity driven by the scene).

- [ ] **Step 1: Failing tests:**

```js
const grounding = require('../src/renderer/src/features/office/scene/room/grounding.ts');
test('contact shadows sit under standing furniture, not under rugs, screens or pendants', () => {
  const at = (kind, w = 1, d = 1, round = false) => grounding.groundShadow({ id: 'x', kind, x: 0, z: 0, w, d, rotation: 0, round, blocks: true });
  assert.equal(at('rug'), null);
  assert.equal(at('wall-screen'), null);
  assert.equal(at('pendant-lamp'), null);
  assert.deepEqual(at('sofa', 2, 1), { w: 2.3, d: 1.3, round: false });
  assert.deepEqual(at('cafe-table', 0.9, 0.9, true), { w: 1.2, d: 1.2, round: true });
});
```

(Facet's determinism is a three.js geometry test and runs in the renderer, not node; it is checked visually and by the desktop check's screenshot.)

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `grounding.ts`: a `NO_SHADOW` set (`rug`, `exec-rug`, `wall-screen`, `pendant-lamp`, `wall-art`, `ledge-art`, `sign-post`), otherwise footprint grown by 0.3 m (`round` passes through). `contactShadows(items)` builds one plane per item from two shared geometries (disc, rounded rectangle) and one shared `MeshBasicMaterial({ map: shadowTexture(), color: '#3b2f25', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })` at y 0.006, rotated with the item; `shadowTexture()` in `materials.ts` is a 128 px radial/rounded gradient canvas.
- [ ] **Step 4: Kit helpers** in `kit.ts`: `bevelBox` uses a cached `RoundedBoxGeometry(1,1,1,2, r)` per radius key (radius relative to the smallest side); `facet` converts to non-indexed, then writes one colour per triangle, lightness jittered by `±variation` with `seeded(seed)`; `lathe` wraps `LatheGeometry` with a shared cache keyed by points. `mat()` gains `vertexColors`; `mergeStatic` keeps `color` when the material has `vertexColors`.
- [ ] **Step 5:** tests pass; typecheck.

### Task 4: Plinth, walls, windows

**Files:**
- Modify: `scene/room/buildOffice.ts` (`floor`, `wallMesh`, `windowBays`), `scene/room/materials.ts` (palette)
- Create: `src/renderer/src/features/office/scene/room/walls.ts` (`wallSlab`)
- Test: `tests/office-look.test.cjs`

**Interfaces:**
- Produces: `wallSlab(wall: Wall, room: Bounds): { thickness: number; offset: number }` (offset along the wall's outward normal, metres).

- [ ] **Step 1: Failing test:**

```js
const walls = require('../src/renderer/src/features/office/scene/room/walls.ts');
test('perimeter walls thicken outward, keeping their inner face; inner walls stay put', () => {
  const room = { minX: -62, maxX: 62, minZ: -38, maxZ: 38 };
  const west = { id: 'w', kind: 'solid', from: { x: -62, z: -38 }, to: { x: -62, z: 38 }, height: 2.7 };
  const back = { id: 'b', kind: 'solid', from: { x: -62, z: -38 }, to: { x: 62, z: -38 }, height: 2.7 };
  const inner = { id: 'i', kind: 'solid', from: { x: -19.4, z: -15 }, to: { x: 19.4, z: -15 }, height: 2.7 };
  for (const wall of [west, back]) {
    const slab = walls.wallSlab(wall, room);
    assert.equal(slab.thickness, 0.3);
    assert.ok(Math.abs(slab.offset - 0.07) < 1e-9, 'inner face stays 0.08 m from the line');
  }
  assert.deepEqual(walls.wallSlab(inner, room), { thickness: 0.16, offset: 0 });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `wallSlab` (perimeter = both ends on the same room edge; thickness 0.3, offset `(0.3 − 0.16) / 2` outward). `wallMesh` draws solid and low walls with it: the body in the wall colour and a 0.035 m dark cap (`#3d4450`) over the full thickness; glass walls gain a sill and top rail in `#8a7a66`.
- [ ] **Step 4: Plinth.** `floor()`'s slab becomes 0.5 m deep: top at −0.004, sides `#c9bfb2` with a 0.06 m lighter lip (`#efe8dd`) round the top edge, 0.35 m beyond the room on every side.
- [ ] **Step 5: Windows.** Each bay gets a 0.06 m deep sill and head in `PALETTE.white`, mullions in `#5a6270`, and the pane a vertical sky gradient (a shared canvas texture, emissive map, so the time of day still tints it).
- [ ] **Step 6:** tests pass; typecheck; look at it in the app.

### Task 5: Floors, palette, light and plants

**Files:**
- Modify: `scene/room/materials.ts` (`woodFloorTexture`, `PALETTE`, district floor tints), `scene/room/buildOffice.ts` (`FLOORS`), `scene/room/furniture.ts` (rug with a raised edge), `scene/room/kit.ts` (`plant`, `largePlant`), `scene/room/props.ts` (`tree`, `planter`), `scene/room/lighting.ts` (keys), `campus/neighbourhoods.ts` (drop the front corner plant per department cell)
- Test: `tests/office-campus.test.cjs` (layout invariants still hold), desktop check

- [ ] **Step 1: Floors.** `woodFloorTexture`: 12 rows (wider planks), shade 0.97–1.03, grain alpha 0.05, joints alpha 0.25, base `#e6d2b0`. Walnut tint `#b89a7d`. Carpets and terrazzo keep their textures with calmer tints.
- [ ] **Step 2: Rugs.** A 0.018 m bevelled slab in the rug colour with a 0.06 m border one step darker (two meshes, both merged).
- [ ] **Step 3: Plants.** Pots via `lathe` (a rim and a foot), crowns via `facet` on `IcosahedronGeometry(0.5, 1)` with 0.08 variation, three greens; `largePlant` becomes a broad-leaf plant with faceted leaves on stems; `tree` a lathed planter, a tapered trunk and three stacked faceted crowns; `planter` bevelled with faceted shrubs and flowers.
- [ ] **Step 4: Thin out.** `neighbourhoods.ts` stops placing the small `plant-<key>-se`; the two back-corner large plants stay.
- [ ] **Step 5: Light.** Retune `lighting.ts` keys for the new materials (warmer sun, cooler fill, hemisphere ground a touch darker) and `OfficeScene` shadow radius; check midday, golden hour and evening by eye.
- [ ] **Step 6:** `npm test`; typecheck.

### Task 6: Desktop check, budgets and revisions

**Files:**
- Modify: `tests/office-desktop.cjs`, the spec (a "Revisions during build" section)

- [ ] **Step 1:** After the opening view: `setQuality('high')`, snapshot `look-high.png`; `setQuality('balanced')`, snapshot `look-balanced.png`; the draw-call budget reading runs on Balanced; the 1080p fps floor (≥ 50) is read on Balanced; High's 1080p fps is logged as `CAMPUS_STATS_1080P_HIGH`.
- [ ] **Step 2:** `npm run build && npx electron tests/office-desktop.cjs` → `OFFICE_CHECK_PASS`.
- [ ] **Step 3:** Record measured calls and fps (High and Balanced) and any deviations in the spec.
