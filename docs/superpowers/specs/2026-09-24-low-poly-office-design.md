# The low-poly office — design

- **Date:** 2026-09-24
- **Status:** Section 1 (Part 1) approved in conversation; the user asked to proceed with the build. Parts 2–4 follow the answers given in conversation and are shown with screenshots as each lands.
- **Builds on:** [`2026-09-24-office-polish-teamwork-reception-design.md`](2026-09-24-office-polish-teamwork-reception-design.md) as built (up to `d072153`)
- **Supersedes in that spec:** the hanging department and room signs (§4.3 there). Departments are named by their task boards; rooms by the department menu.

## 1. Goal

The user rated the office 6.5/10: it works, but reads as flat and repetitive. This work turns it into a **polished, stylized low-poly isometric diorama** and makes it more fun to watch, in four parts built in order, each leaving the app working:

1. **The look.** Rendering (shading, light, shadows), a shared style kit, the building (plinth, walls, windows, floors) and plants.
2. **Workstations and people.** Better desks, computers and chairs; restyled characters.
3. **Café and kitchen.** A real coffee bar, a bakery counter, and an open kitchen with chefs cooking.
4. **Lounge and play.** A TV with a PS5 and coworkers playing, plus arcade, foosball and other fun props.

Done before this spec (same branch): the hanging department and room signs are removed, and the selected name tag holds the whole role inside its box.

## 2. Decisions made in conversation

| Question | Answer |
|---|---|
| Hanging signs | Remove entirely; district pylons and executive nameplates stay. |
| Art style | **Clean isometric diorama:** bevelled furniture and walls, faceted natural things (trees, plants, food, hair), soft shadows and ambient-occlusion shading, thick walls with a clean cut-away top. |
| Kitchen staff | **Ambient staff:** two chefs and a barista, not clickable, not coworkers, not counted in "208 coworkers". |
| Approach | **Code-built kit + render polish.** Models stay procedural three.js. Free third-party material (CC0 models, MIT libraries) may be used where it clearly beats code; each download is named (file, source, size) before it is fetched. |

## 3. Art direction (all parts)

- **Two families of shape.** *Made things* (furniture, counters, machines, walls) are bevelled boxes and lathed/extruded profiles with smooth shading. *Natural things* (tree crowns, plants, food, hair, rocks) are faceted: flat-shaded low-subdivision solids with a small per-facet colour variation.
- **Colour.** Warm neutrals for the building (cream walls, pale oak, soft stone), one accent family per district used on chairs, rugs, dividers and small objects. Fewer pure whites. No noisy or photographic textures: textures, where used, are soft and low-contrast.
- **Grounding.** Every object sits on the floor visibly: ambient occlusion on High, pre-drawn contact shadows on Balanced.
- **Readable from the camera.** The fixed orthographic camera (yaw 0.42, pitch 0.7) stays. Objects are sized so their silhouette reads at the "department" zoom (about 20 m across the screen).

## 4. Part 1 — The look

### 4.1 Rendering

- **Pipeline.** Render the scene into a multisampled target with a depth texture, apply `GTAOPass` (three.js built-in) using that depth (normals reconstructed from depth, so no second scene render), then `OutputPass` for tone mapping and colour space. Transparent background kept, so the page's backdrop gradient still shows around the plinth.
- **Light.** Warm key light, cool fill, a stronger sky/ground gradient, softer shadow edges. The time-of-day keys are retuned for the new materials; lamps still turn on at dusk.
- **Quality setting** in the Settings sheet: **Auto** (default), **High**, **Balanced**. High = AO on. Balanced = AO off; contact shadows (§4.2) carry the grounding. Auto starts High and steps down to Balanced when the frame rate stays under 45 fps for 4 s at a steady view, and does not step back up in the same session. The choice is a per-device preference, stored like the time-of-day switch.
- **Contact shadows.** Every piece of furniture that stands on the floor gets a soft dark ellipse or rounded rectangle decal under it (one shared radial-gradient texture, merged into the static mesh, drawn in both modes; lighter when AO is on).

### 4.2 Style kit (`scene/room/kit.ts` grows into a small module set)

- `bevelBox(size, radius, color)` over a cached `RoundedBoxGeometry` per rounded-corner ratio.
- `facet(geometry, color, variation)`: a flat-shaded, non-indexed copy with per-face vertex colours jittered ±`variation` in lightness, seeded, so crowns and food look hand-made and merge well.
- `lathe(profile, color)` for pots, cups, lamps and bottles.
- Shared palette in `materials.ts` refreshed (§3), with `accent(districtId)` returning the district's accent family (base, light, dark).
- Contact-shadow helper `shadowDecal(w, d, softness)`.

### 4.3 The building

- **Plinth.** The floor slab becomes a 0.5 m thick diorama base with a darker, slightly inset side and a thin light top edge.
- **Walls.** Solid perimeter walls thicken outward from 0.16 m to 0.3 m, and interior solid walls as far as the furniture against them allows, with a dark charcoal cut-away cap; low front walls get the same cap. The walls the navigation uses do not move. Glass walls keep their frames but gain a sill and a top rail in the district's dark neutral.
- **Windows.** Framed bays with a sill and a soft sky gradient in the panes.
- **Floors.** The busy orange plank texture is replaced by wide, low-contrast planks; each district keeps its floor kind with a calmer tone; rugs get a raised, bevelled edge.
- **Plants.** Crowns and leaves become faceted. The many small scattered floor plants give way to fewer, bigger faceted trees and planter clusters (desk plants stay). No reduction in how green the office looks from afar.

### 4.4 Budgets (checked by the desktop check)

- Whole-campus draw calls within today's **733** limit on Balanced; High adds only the fixed post-processing passes.
- 1920 × 1080 at the whole-campus view: **≥ 50 fps on Balanced** on the target laptop (Intel graphics). High is measured and reported, not gated.
- Wall thickness and the plinth do not change the walkable floor: the nav grid and every seat keep their positions (tests assert this).

## 5. Part 2 — Workstations and people

- **Desks and pods:** bevelled tops, a cable tray, a divider in the district accent, pedestals with handles.
- **Computers:** slim-bezel monitors on arms or stands (single and dual), keyboards with key rows, mouse and pad, laptops on stands; screens keep today's animated content (`DeskScreens`).
- **Desk life:** lamp, headphones, water bottle or mug, photo frame, sticky notes, small faceted plant, varied per desk by seed.
- **Chairs:** ergonomic chairs with a mesh back in the district accent, armrests and a five-star base with casters.
- **People:** same rig, poses and crowd system. Restyled meshes: a slightly larger head, faceted hair shapes (the twelve styles kept), eyes with a highlight, brows, simple mitt hands, collars, sleeves, soles. The instanced crowd figures are regenerated from the new meshes, so far and near people match. Portraits re-render from the new figures.

## 6. Part 3 — Café and kitchen

- **Coffee bar:** two espresso machines (the existing busy light and steam kept), a grinder, a cup tower, syrup bottles, a chalk menu board.
- **Bakery counter:** the pastry case filled with faceted croissants, doughnuts with icing, muffins, cupcakes, cake slices, loaves and cookies on stands and trays.
- **Open kitchen** behind the counter: a range with pans (animated flame glow and steam), an oven, a fridge, a prep counter with a chopping board and vegetables, a hood and hanging utensils.
- **Ambient staff** (`scene/staff/`): two chefs (white jacket, toque, apron) looping cooking actions (stir, toss, chop, plate) at their stations, and a barista who works the machine whenever a coworker's coffee break reaches the counter. Built on the humanoid rig, driven by a small scripted routine rather than the office simulation; not pickable, not in search, the team strip, the roster or any count.

## 7. Part 4 — Lounge and play

- **Lounge:** a wall TV on a media console with a PS5 and two controllers. The TV shows an animated game screen while someone is playing, otherwise a calm screensaver.
- **Gaming break:** a new ambient activity. One or two coworkers sit on the lounge sofa facing the TV, holding controllers, with a small thumbs-and-lean loop. It never interrupts real task work, like the existing breaks.
- **Play props:** an arcade cabinet with a glowing screen, a foosball table (a two-player standing break), the existing ping-pong tables restyled, a dartboard, a record player and a sleeping office dog on a cushion in the Commons.
- **Elsewhere:** a vending machine and a snack shelf in the wider corridors; a few more such props per district where the decor planner has room.

## 8. Testing

- Unit tests (node): the Auto quality decision; kit helpers (facet colours are seeded and stable, bevel geometry is cached); layout invariants (seats, nav grid and walkable floor unchanged by thicker walls); new activities (gaming and foosball plans, capacity, never while on a task); staff routines (never enter the navigation grid's shared walkways, never selectable).
- Desktop check: a screenshot set per part (opening, Engineering, pods, café, lounge, whole campus, at 1920 × 1080 and 1366 × 768), the quality setting switching High ↔ Balanced, the draw-call budget and the Balanced fps floor.

## 9. Out of scope

- A free camera, rotation or perspective view.
- Day/night beyond the existing time-of-day rig.
- Sound.
- Making the kitchen staff real coworkers.

## 10. Revisions during build

### Part 1

1. **`GTAOPass` workaround.** In three 0.186, passing a depth texture to the `GTAOPass` constructor throws (it reads a normal buffer it never created). The pipeline builds the pass with its own buffers and then calls `setGBuffer(depthTexture)`, which reuses the scene's depth and skips the extra normal render.
2. **Balanced draws straight to the canvas.** The first build sent Balanced through the pipeline's multisampled half-float target too; at 1080p on the target laptop that cost 8–11 fps against the previous build. Balanced now renders directly to the (antialiased) canvas like before; only High uses the pipeline.
3. **Shading settings.** Radius 0.6 m, distance exponent 1.5, thickness 0.6, fall-off 1, scale 1.7, 16 samples, at half resolution; denoise radius 10, 3 rings, 16 samples. Larger radii (0.9 m and up) left dark smudges along glass walls and the back wall.
4. **Colour in the geometry.** Rugs tinted by district and sofa fabrics would have added about 15 materials (one draw call each). They use per-vertex colour on one shared material instead (`paintedBox`), like the faceted foliage (`facet`), so the whole-campus count stays inside 733.
5. **Sofas** take a fabric per room (teal, rust, denim or olive, with cushions in the others' colours) rather than the district accent: a room's seating matches and reads as designed.
6. **Plinth** is 0.9 m deep, not 0.5 m: 0.5 m did not show from the whole-campus view. The zoom-1 fit includes its foot.
7. **Light.** Sky light ×0.72 and sun ×1.25 across the time-of-day keys, so tops and sides of objects separate; the sky light never drops below 1.3 (the existing "never dark" rule).
8. **Desktop check.** The Files room step now waits for the folder wall, which refreshes a moment after the listing (the old immediate count passed only by timing). A failed scene start is now logged to the console before the roster takes over.

### Part 2

Plan: [`2026-09-24-low-poly-parts-2-4.md`](../plans/2026-09-24-low-poly-parts-2-4.md).

1. **Static batching by finish.** Before adding anything, `batchStatic` (`scene/room/batching.ts`) replaced `mergeStatic`: every plain-coloured, opaque static material carries its colour in the geometry and merges into one mesh per finish (roughness, metalness, flat, depth pull). Whole campus: 724 → 474 draw calls with nothing else changed.
2. **Frame rate: what cost it and what fixed it.** The first Part 2 build read 47 fps at 1080p Balanced. Measured, not guessed (A/B against a baseline build, with CPU time and a GPU timer query): GPU time had *dropped*, but CPU time in `render()` had grown. Merging removed the meshes but left their ~2,700 empty groups in the scene, and three.js walks and updates every object each frame. Fixes: batching prunes groups left empty (5,748 → 908 objects at the opening view); people no longer drawn in full leave the scene instead of hiding in it; full characters use mid-poly shapes (11.7k → 4.2k triangles, far figures 3.3k → 2.7k); pedestals, pod legs and small desk things throw no shadow; chairs are lighter (about 400 triangles).
3. **Characters draw in fewer calls.** Each joint of a full character is one vertex-coloured mesh (eyes apart, to blink); selection outlines come from invisible copies of the outlined parts only. The selection ring and halo are hidden, not drawn at zero opacity.
4. **Dual monitors** replace the laptop-and-monitor setup in Engineering and AI & Data (two screens either way); Leadership keeps a laptop on a stand beside its monitor.
5. **Accent tints are mixed in display (sRGB) terms**; mixed in linear light, 45 % white already read as grey.
6. **Executive desks** lose their painted papers and brass cup: the desk-life props now sit there.
7. **Readings** (desktop check, mains power): whole campus 444 draw calls, 1.48M triangles; 1080p Balanced 55 fps (median of ten; baseline 54); 1080p High 41 fps (baseline 36).
