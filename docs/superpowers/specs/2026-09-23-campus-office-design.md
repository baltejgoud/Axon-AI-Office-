# Campus Office — design

- **Date:** 2026-09-23
- **Status:** Approved in conversation, awaiting written-spec review
- **Builds on:** AI Office v1 (commit `c9909e5` plus the uncommitted office work on `feature/look-and-shell`)
- **Supersedes:** the shell parts of [`2026-09-21-look-and-shell-design.md`](2026-09-21-look-and-shell-design.md) §4.4–4.8 (sidebar, top bar, page layout). Its tokens, fonts and theme system (§4.1–4.3) still apply.

## 1. Goal

Axon is one screen: a large, spacious, beautiful 3D office holding **all 207 coworkers** (198 bundled roles plus Business Analyst, in 22 departments, plus 8 core agents). Every task starts by clicking a person (or finding them by specialty) and typing. Folders are handled in a Files room and handed to a person. The office should be a pleasure to look at and to use, and should stay smooth on a laptop.

## 2. What is wrong today

| # | Finding | Evidence |
|---|---|---|
| 1 | Only 16 of 207 coworkers are on the floor (8 core agents + 8 HQ specialists); the rest are hidden behind a "Headquarters" wing drop-down. | `HQ_SPECIALISTS`, `agentsForWing()` in `data/`; `OfficeScene` constructor |
| 2 | The room is 38 × 18 m and crowded; labels overlap each other and the zone cards (screenshot 2026-09-23: "Back-end", "UI/UX", "QA", "Ops" stacked). | `ROOM` in `simulation/layout.ts`; `OfficeCanvas` labels |
| 3 | Three portrait styles: photographs for the 8 core agents, SVG cartoons for specialists, low-poly figures in 3D. | `assets/agents/*.jpg/png`, `AgentPortrait.tsx`, `scene/agents/` |
| 4 | The side panel shows only the last task and last reply. No thread, no code blocks, and **no tool-approval prompts**: a tool call started from the office waits forever unless the user leaves for the Chat page. | `ActivityPanel.tsx:21-36`; approvals only rendered in `Chat.tsx` |
| 5 | There is no model picker in the office; the composer silently uses the global model or the first enabled provider. | `AgentComposer.tsx:67-70` |
| 6 | The window opens at 1380 × 900, not maximized. | `src/main/index.ts:19` |
| 7 | Leftover pages (Chat, Code, Agents, Workspaces, Knowledge, Settings) are reached through a "Back to your office" button, contrary to "only the office". | `App.tsx` |
| 8 | Each character is a separate rig of many meshes with shadows; the nav grid is built by testing every cell against every obstacle. Neither scales to 207 people on ~7,000 m². | `OfficeAgentCharacter.ts`, `NavGrid` constructor |

## 3. Scope

### In scope
- App shell: maximized start, office-only, overlays for Settings and Knowledge.
- Side panel: full conversation thread with tool approvals, model picker, Hand-to file attachments.
- Campus floor plan (~110 × 64 m): Commons + 7 districts + 22 department neighbourhoods; all 207 people seated.
- New stylized character system, deterministic appearance generator, portraits rendered from 3D.
- Level-of-detail rendering (full rigs + instanced crowd), instanced furniture, zoom-aware labels, minimap.
- Files room hub with folder cabinets and the Hand-to flow.
- Props, materials, time-of-day lighting, micro-interactions.
- Tests, desktop smoke updates, screenshot and frame-rate checks.

### Out of scope
- Multiplayer or shared offices; user-created coworkers; editing the floor plan.
- Voice, web search, notification center (other sub-projects).
- Provider, tool, MCP and approval **logic** (only their rendering moves into the side panel).
- macOS/Linux verification.

## 4. Design

### 4.1 Shell

- `createWindow` calls `maximize()` before `show()`, and stores the maximized/normal bounds in settings so an un-maximized window reopens as the user left it. `backgroundColor` follows the saved theme (as the look-and-shell spec specified).
- `App.tsx` renders only `OfficePage` plus overlays. The `Chat`, `Code`, `Agents` and `Workspaces` pages and the "Back to your office" button are removed. Their code is deleted once nothing imports it; the pieces the office reuses are extracted first (§4.12).
- **Overlays** (modal sheets over the office, focus-trapped, Esc to close):
  - **Settings**: today's `SettingsPanel`, opened from the gear button or Ctrl+,.
  - **Knowledge**: today's `Knowledge` screen, opened from the Library room's bookshelf, the Librarian's panel ("Manage library"), or the Commons chip menu.
- Shortcuts: Ctrl+K focuses "Find a person or specialty…"; Ctrl+, opens Settings; Esc closes an overlay, then clears the selection.
- `page` state collapses to `'office'` plus an `overlay: 'settings' | 'knowledge' | null` field.

### 4.2 Side panel (Activity)

Keeps its current header card (portrait, name, department, status). Below it:

1. **Conversation**: the whole thread with this coworker, newest at the bottom, using the extracted `Message` renderer (markdown, code blocks with copy, tool-call cards, thought disclosure). **Pending tool approvals render inline** with Allow / Deny, wired to `toolApprove` exactly as the Chat page does today. Streaming updates as today.
2. **Recent updates**: the existing activity feed, collapsed to the last three entries with "Show all".
3. **Composer**: as today, plus:
   - a compact **model pill** (reusing `ModelSelect`, `size="sm"`) that sets the model for a new conversation and is read-only once the conversation exists (same rule as the Chat page);
   - **file chips** for files handed over from the Files room (§4.8), removable before sending, sent as file context like today's `OfficeFiles.onInclude`.
- "New conversation" (in the header's overflow menu) starts a fresh thread with the same coworker; earlier threads stay listed in that menu, newest first.
- When no model is configured, the composer shows "Connect a model in Settings" as a button that opens the Settings overlay, instead of failing on send.

### 4.3 Campus floor plan

Units are metres; x runs along the back wall (left→right), z toward the viewer. Campus bounds `x ∈ [-55, 55]`, `z ∈ [-32, 32]`. The back and left walls are full height with windows; the front and right walls are cut low, as today, so nothing hides.

```
 z=-32 ┌──────────────┬──────────────┬─────────┬──────────┐  back wall (windows)
       │              │  Product &   │ Design  │Leadership│
       │              │  Delivery    │ Studio  │  Suite   │
       │ Engineering  │   (30)       │  (5)    │  (10)    │
 z=-12 │  9 teams     ├──────────────┼─────────┴──────────┤
       │  (76)        │   COMMONS    │    AI & Data Lab    │
       │              │ Library·Files│       (17)          │
       │              │ Planning·Café├─────────────────────┤ z=6
 z=12  │              │ Lounge       │  Business (31)      │
       │              │ Reception    ├─────────────────────┤ z=19
       │              │  (entrance)  │  People & Ops (30)  │
 z=32  └──────────────┴──────────────┴─────────────────────┘  front (low wall)
     x=-55         x=-18          x=18                  x=55
```

| District | x range | z range | Departments (people) | Look |
|---|---|---|---|---|
| Engineering | -55…-18 | -32…32 | Web & Frontend 6, Backend & APIs 8, Mobile 5, Cloud & Infrastructure 11, Security 5, Architecture & General Engineering 9, QA & Release 7, Platforms & Enterprise 11, Emerging Tech 14 | light oak floor, sit-stand desks with dual monitors, team banners |
| Product & Delivery | -18…18 | -32…-12 | Product Management 10, Project Management 10, Engineering Management 10 | carpet tiles, kanban walls, a round stand-up table per team |
| Commons | -18…18 | -12…32 | 8 core agents at their hubs | warm wood and terrazzo; see §4.4 |
| Design Studio | 18…37 | -32…-12 | Design 5 | pale concrete, big-screen desks, mood-board wall, drafting table |
| Leadership Suite | 37…55 | -32…-12 | Executive Leadership 10 | glass corner offices, walnut desks, a boardroom |
| AI & Data Lab | 18…55 | -12…6 | AI, ML & Data 17 | cool grey floor, server-rack wall with blinking LEDs, data-wall screens |
| Business | 18…55 | 6…19 | Sales 10, Marketing 10, Customer Success 5, Strategy & Innovation 6 (incl. Business Analyst) | blue-grey carpet, call booths, a sales gong, a trophy shelf |
| People & Ops | 18…55 | 19…32 | Operations Management 10, HR & People 10, General Management 10 | sage carpet, a bright wellbeing corner, a pinboard of team photos |

**Department neighbourhoods.** Each department is a rectangle inside its district: desk pods of four (existing 3.2 × 1.6 m pod) with ≥1.6 m aisles between pods and ≥2.4 m main corridors between neighbourhoods; a hanging sign in the department colour; one shared element (standing table, whiteboard or sofa) and at least two plants. A layout generator (`campus/neighbourhoods.ts`) packs pods for a given head-count into its rectangle so department sizes can change without hand-placing desks; the district rectangles and hub rooms are hand-authored.

**Department colours.** The current six-colour cycle repeats across 22 departments. It is replaced by one colour per **district** (8 colours, tuned for AA text on white and on the dark theme) with per-department tints, so neighbours are distinguishable and a district reads as one area.

**Desk assignment.** Every coworker has exactly one home desk, assigned deterministically by the layout (department → neighbourhood → pod → seat, in catalog order). `HOME_DESKS` is generated, not hand-written. Invariants (tested): 207 unique desks, every desk reachable from the Commons, no furniture overlaps, no desk inside a wall.

### 4.4 Commons

- **Reception** at the front entrance: a curved desk with the Axon mark, a floor mat, bikes and a coat rack; Ops Coordinator sits here.
- **Lounge** (Chat hub, Marketing Strategist): sofas, bean bags, a ping-pong table, a rug, floor lamps.
- **Café**: counter, espresso machine with steam, pastry case, high tables and a long communal table, pendant lights. Coffee runs go here.
- **Library** (Knowledge hub, Knowledge Librarian, Research Analyst, Writer): tall bookshelves with a rolling ladder, reading chairs, a quiet table. Clicking a bookshelf opens the Knowledge overlay.
- **Files room** (Files Agent): see §4.8.
- **Planning rooms** (Product Coach, Designer): two glass meeting rooms with screens and whiteboards; meetings happen here.

### 4.5 Characters

`scene/people/` replaces `scene/agents/` (the pose library and rig skeleton are kept and extended).

- **Proportions:** head ≈ 1/5.5 of height (today ≈ 1/7.5), rounded capsule limbs, mitten hands, soft toon-style shading (a `MeshToonMaterial` ramp or a custom lambert with a 3-step ramp) and an inverted-hull outline at 1.5 px equivalent, dropped on crowd figures.
- **Face:** eyes (with blinking every 3–6 s), brows, a small mouth; eyes and head turn toward the camera on selection and toward a conversation partner.
- **Appearance generator** (`people/appearance.ts`): a pure function `appearanceFor(id, district, department)` seeded from a hash of the id. Chooses height 1.55–1.90 m, build, one of 8 skin tones, one of 12 hairstyles (short, crop, side-part, buzz, bob, long, ponytail, bun, curly, afro, braids, bald) and hair colour, and optional glasses, beard, headphones or lanyard. Outfit comes from the **district dress code** with per-person colour variation: Engineering hoodies/tees, AI & Data vests, Design bold colours, Business shirts and blazers, Leadership suits, People & Ops cardigans, Commons smart casual. The 8 core agents get hand-tuned appearances (as today). Tested: same id → same look; no two desks in one pod share hairstyle + outfit colour.
- **Portraits:** after the scene is ready, an offscreen render target draws each person head-and-shoulders at 128 × 128 (2× for HiDPI), a few per idle frame, into a `Map<id, dataURL>` exposed through a small hook `usePortrait(id)`. Until it's ready, the portrait shows the person's initials on their colour. `AgentPortrait` and the bundled photographs are removed.

### 4.6 Rendering and performance

- **Two tiers of people.**
  - *Full:* the complete rig, with shadows, running the full behaviour simulation. Members: the selected person; anyone on a real task; anyone currently walking; the nearest people to the view centre, up to a total budget of **40**.
  - *Crowd:* one `InstancedMesh` per body part and material (≈15 draw calls for everyone), each instance posed seated or standing at its desk with a cheap vertex/instance animation (breathing, head turn, typing hands). No shadows; a soft blob shadow decal instead.
  - Promotion and demotion happen at most once per 250 ms per person, cross-faded over 200 ms, and only for people whose pose matches (seated ↔ seated), so the swap is invisible at normal zoom.
- **Simulation.** Everyone keeps logical state (at desk, idle modes). Only full-tier people run pathfinding and wandering; at most **12** people are walking at once across the campus. On-task people always walk to their desk and work visibly.
- **Furniture** is built from instanced meshes per kind (desks, chairs, monitors, plants, shelves) and merged static geometry per district for floors and walls. Target ≤ **250 draw calls** at full-campus zoom.
- **Shadows:** one directional light with a shadow camera that follows the view; a baked, subtle ambient-occlusion texture under furniture.
- **Nav grid** is built by rasterizing each inflated obstacle into the cells it covers (instead of testing every cell against every obstacle), at 0.25 m cells (440 × 256). Target: built in < 150 ms.
- **Frame budget:** 60 fps at 1920 × 1080 with the whole campus in view on integrated graphics; the render loop drops pixel ratio to 1 if frames exceed 22 ms for 2 s, and restores it when stable.
- **Reduced motion** (OS setting): no wandering, no camera glides (cuts instead), no celebration animations; idle breathing stays subtle.
- The existing **2D roster fallback** (when WebGL fails) stays, grouped by district and department.

### 4.7 Camera, labels, navigation

- Same fixed-angle orthographic camera; the zoom range spans from the whole campus in view to a close view of one pod. Pan is clamped to the campus.
- **Labels by zoom:**
  - far: 8 district cards (name, head-count);
  - middle: 22 department signs, as world-space hanging signs plus an HTML label;
  - near: name tags for people inside the view, capped at 30 and hidden when they overlap (collision pass on screen rectangles, higher priority to selected/on-task).
  The six floating zone cards are removed.
- **Top chips:** Commons · Engineering · AI & Data · Design · Product · Business · People & Ops · Leadership · Files. Clicking one glides the camera to frame that district.
- **"Go to department…"** replaces the Headquarters drop-down: a searchable menu of the 22 departments grouped by district.
- **Search** ("Find a person or specialty…") matches name, department, district and the role profile text, so "front-end", "SRE" and "business analyst" work; Enter selects the top hit and glides to them.
- **Minimap** (bottom-left of the canvas, 180 × 105): flat district shapes in their colours, a viewport rectangle, dots for on-task people; click or drag to move the camera. It can be collapsed.
- **Team strip** (bottom): shows the people of the district in view (or search results), not a fixed 16.

### 4.8 Files room hub and Hand-to

- The Files room holds a **cabinet wall**: one labelled cabinet per opened project folder (label = folder name) plus an "Open a folder" cabinet. The list of opened folders is persisted in settings (`settings.officeFolders: string[]`, max 12, most recent first) so the wall survives restarts.
- Clicking a cabinet (or the Files Agent) opens the **Files panel** in the side panel: the folder browser from `OfficeFiles`, with checkboxes for files.
- **Hand to…** opens a person picker (search + recent coworkers). Choosing someone:
  1. stores the chosen files as `pendingFiles[agentId]` in the office store;
  2. selects that person and glides the camera to them;
  3. their composer shows the files as chips; sending includes them as file context and clears `pendingFiles`.
- In the scene, the Files Agent walks to the cabinet while the Files panel is open.
- Errors (folder missing or unreadable) show inline in the panel with "Remove from wall".

### 4.9 Props, materials and light

- **Architecture:** a back wall with floor-to-ceiling window bays (bright sky gradient, soft light shafts), column grid, glass partitions, entrance with automatic doors, a mezzanine-style edge detail along the left wall.
- **Materials:** per-district floor (oak, carpet tiles, concrete, terrazzo) with subtle procedural texture; matte walls; slightly reflective glass.
- **Props,** placed by the layout (and deterministic): indoor trees and planter walls, hanging pendant lights, bookcases, wall art, a clock (real time), sticky notes on whiteboards, headphones and mugs on desks, a steaming coffee machine, a ping-pong table, bean bags, bikes, a water cooler, a sales gong, a trophy shelf, server racks with blinking LEDs, a drafting table.
- **Living details:** monitors glow when their owner types; a person who finishes a task does a small celebration; the selected person waves; hover shows a soft outline and a name tag.
- **Time-of-day light:** hemisphere + sun colours interpolate across the user's local time (bright neutral at noon, golden late afternoon, cool dusk with desk and pendant lamps on at night). A setting (Settings → Appearance → "Follow time of day", default on) turns it off, fixing midday light.
- Dark theme: the office keeps its lit interior; UI chrome follows the theme.

### 4.10 Data changes

- `officeAgents.ts`: every coworker gains `district` and `department`; `wing`, `agentsForWing`, `HQ_SPECIALISTS` are removed.
- `coworkerCatalog.ts`: gains the district map (department → district) and district colours.
- `officeZones.ts` is replaced by `campus/districts.ts` (districts, bounds, colours) and hub definitions.
- `officeStore`: removes `activeWing`/`setWing`; adds `pendingFiles`, `overlay`, `cameraFocus` (district or agent), and portrait readiness.
- `Settings`: adds `officeFolders: string[]`, `officeTimeOfDay: boolean`, `windowState` (main-owned).
- Migration: existing conversations keep their `agentId`; nothing is deleted.

### 4.11 Error handling

- WebGL failure → the 2D roster (existing), now grouped by district.
- Portrait render failure → initials fallback; never blocks the UI.
- A folder on the wall that no longer exists → inline error with "Remove from wall".
- No model configured → composer button to open Settings (§4.2).
- Frame-rate protection (§4.6).

### 4.12 Code structure

```
features/office/
  campus/            districts.ts, neighbourhoods.ts (pod packer), hubs.ts, props.ts, layout.ts (assembles FURNITURE, POIs, HOME_DESKS)
  simulation/        OfficeSimulation.ts (tiers, walker budget), navigation.ts (rasterized grid), types.ts, random.ts
  scene/
    OfficeScene.ts   orchestration only (renderer, loop, tiers, picking)
    cameraRig.ts
    room/            buildOffice.ts, furniture/ (one file per furniture family, instanced), materials.ts, lighting.ts (time of day)
    people/          appearance.ts, HumanoidRig.ts, poses.ts, FullCharacter.ts, CrowdRenderer.ts, portraits.ts
    labels/          labelLayout.ts (zoom tiers, collision)
  activity/          ActivityPanel.tsx, Conversation.tsx, AgentComposer.tsx, FilesPanel.tsx, HandToPicker.tsx
  shell/             Overlay.tsx, Minimap.tsx, DistrictChips.tsx, DepartmentMenu.tsx, TeamStrip.tsx
  OfficeCanvas.tsx   layout of the screen (today 458 lines, split into shell/ pieces)
chat/                Message.tsx, CodeBlock.tsx, ModelSelect.tsx, approvals (extracted from Chat.tsx, then Chat.tsx is deleted)
```

`furniture.ts` (812 lines) and `OfficeSimulation.ts` (979 lines) are split along these lines as they are touched; no file should exceed ~400 lines.

## 5. Testing

- **Unit (`node:test`, no DOM):**
  - campus layout: 207 unique home desks; all desks and hubs reachable from reception; no overlapping blocking furniture; nothing outside the campus or inside a wall; every department sign inside its neighbourhood;
  - appearance: deterministic per id; pod-level variety rule; every district has a dress code;
  - simulation: walker budget ≤ 12; on-task people reach their desk; full-tier budget ≤ 40; existing behaviour tests updated to the new layout;
  - nav grid build time < 150 ms (measured in the test);
  - search: "front-end" → Frontend Developer first; "business analyst" → Business Analyst first; "SRE" → Site Reliability Engineer;
  - Hand-to: `pendingFiles` set, consumed on send, cleared on removal.
- **Desktop smoke (`tests/office-desktop.cjs`):** app opens maximized on the office; no Chat/Code pages reachable; select a coworker by search; send a task (mock provider) and see it in the thread; a pending approval renders and Allow works; open the Files room, hand a file to a coworker, see the chip; Settings and Knowledge overlays open and close with Esc.
- **Visual:** screenshots at 1920 × 1080 and 1366 × 768 at three zoom levels, both themes, saved for review.
- **Performance:** a debug readout (behind `axon.officeDebug`) of fps, draw calls and tier counts; checked with the whole campus in view.

## 6. Risks

- **Scope.** This is large. The plan should deliver it in visible increments, each leaving the app working: (1) shell + side panel thread/approvals/model; (2) campus layout + desk assignment at current character fidelity; (3) LOD crowd + instanced furniture + labels/minimap; (4) new characters + portraits; (5) Files hub + Hand-to; (6) props, lighting, polish pass.
- **Performance on integrated GPUs.** Mitigated by tiers, instancing, draw-call budget and adaptive pixel ratio; measured, not assumed.
- **Uncommitted office work on the branch.** The current working tree has office changes not yet committed; they are committed as a checkpoint before implementation starts so the campus work diffs cleanly.

## 7. Revisions during build

Recorded as they were decided; each is also noted in its stage plan.

| # | Change | Why |
|---|---|---|
| R1 | Window state lives in `window-state.json` (main-owned), not in `Settings`. | Keeps settings validation and migration untouched. |
| R2 | Esc closes the top overlay only; there is no empty-selection state. | The panel always shows a coworker. |
| R3 | An "Office Library" workspace mirrors every imported document and is used by the Library residents (Knowledge Librarian, Research Analyst, Writer). | Knowledge retrieval is workspace-scoped (`service.ts`), and the Workspaces page is gone. |
| R4 | District placement: the Commons is the original 26 × 18 m room at the centre; Engineering fills the left; Product & Delivery is behind the Commons; Business is in front; Design and Leadership are at the back right; AI & Data in the middle right; People & Ops at the front right. | Reuses the tested Commons and keeps every neighbourhood ≥ 2.6 m apart. |
| R5 | Nav grid cells stay at 0.2 m (not 0.25 m); the rasterized build takes ~25 ms. | 0.25 m cells misaligned the tested Commons spots; 0.2 m is still fast. |
| R6 | Ops Coordinator sits at a new reception desk at the front of the Commons. | The spec's reception role; the old pod seat stays as a spare desk. |
| R7 | Only people within 35 m of the café use Commons amenities; everyone else takes local breaks (their department's whiteboard, a colleague's desk, their district's open area). At most 12 people are away from their desks at once. | Nobody hikes 60 m for coffee, and the walking budget bounds rendering cost. |
| R8 | Full-rig budget: 24 when close (< 30 m of floor in view), 10 in the middle range, only required people from afar; new optional rigs arrive at most 4 per 250 ms. | Measured: 60 fps at 1080p in every view on the target laptop. |
| R9 | Draw calls at whole-campus zoom are ~480 (including the shadow pass), not ≤ 250. | Frame rate holds at 60 fps; further merging would cost clarity in code for no visible gain. |
| R10 | Label tiers follow the visible floor width (far > 90 m, near < 30 m), not metres per pixel. | Keeps the opening view in the same tier on every window size. |
| R11 | World-space hanging signs are deferred to the polish stage; department names are HTML labels. | Tints on 22 small signs were not distinguishable. |
| R12 | Stages as built: 1 shell + panel; 2 campus, crowd, camera, chrome (spec increments 2–3); 3 people and portraits; 4 Files hub and Hand-to; 5 props, lighting and polish. | The crowd renderer was needed before 207 people could be shown at all. |
