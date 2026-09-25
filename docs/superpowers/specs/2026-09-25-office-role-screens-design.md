# Role screens — design

- **Date:** 2026-09-25
- **Branch:** `feat/office-real-models`
- **Status:** approved in chat; first of three pieces (role screens → people details → office day and social life).

## Goal

Every monitor and laptop in the office shows what its owner actually does: a designer's screen is a
design canvas, a developer's is a code editor and a terminal, a PM's is a sprint board, a recruiter's
is a candidate pipeline. You can tell who does what by glancing at their desk. When a coworker is
working on one of the user's real tasks, their screens also carry a status strip that is visible from
across the floor.

## Decisions (asked 2026-09-25)

| Question | Answer |
|---|---|
| Detail | **Recognisable apps**: each app's real layout and colours (panels, sidebars, frames, charts, cards), with text drawn as lines. At the office's closest zoom a monitor is 70–140 px wide, so real words would be unreadable and cost 4–8× the texture memory. |
| Live tasks | **Role app plus status strip**: the app keeps running (livelier while working); a thin strip along the bottom of the owner's screens shows the task: blue with a moving bar while working, amber pulse while waiting for the user, green for a while after it completes, red on error. |
| Approach | **One screen sheet drawn in code** (below), not more per-flavour textures and not downloaded screenshots. |

## Today

`scene/room/screens.ts` draws every screen as an instance of one `InstancedMesh` per `ScreenFlavor`
(`document`, `data`, `design`, `code`), with brightness per instance (`off` / `on` / `active`, from
`OfficeSimulation.screenState(deskId)`). Flavours are per district (`campus/districts.ts`) or set by
hand for the Commons desks (`campus/commons.ts`), so everyone in a district sees the same abstract bars.
`screenCanvas(flavor)` in `materials.ts` paints each 256 × 320 canvas.

## Design

### Apps

27 apps, each painted in code with Canvas 2D, in two variants (different content and layout seed)
so neighbours differ:

| App | Look |
|---|---|
| `editor` | Dark code editor: file tree, tabs, syntax-coloured indented lines, minimap, status bar |
| `terminal` | Near-black console: prompt lines, green/amber log output, a cursor |
| `browser-devtools` | A web page preview (hero, cards) over a dev-tools panel |
| `browser` | A web page being read: header, article column, images |
| `sql` | Query pane over a result grid |
| `simulator` | Editor with a phone frame beside it |
| `monitoring` | Dark dashboard: line graphs, gauges, a status row |
| `security` | Dark alerts dashboard: red/amber severity rows, a map-like panel |
| `tests` | Test runner: rows of green ticks and a few red crosses, a progress bar |
| `notebook` | Notebook cells (code + output) with a training-loss curve |
| `bi` | Light analytics dashboard: KPI cards, bars, a donut |
| `engine` | 3D game-engine viewport with a scene tree and inspector |
| `chain` | Block explorer: block cards in a row, a hash table |
| `enterprise` | Enterprise record form (CRM/ERP style): header, tabs, field grid |
| `design` | Design canvas: layers panel, grey canvas with phone/desktop frames, properties panel |
| `moodboard` | Colour palette swatches and image tiles |
| `kanban` | Sprint board: four columns of cards with coloured labels and avatars |
| `roadmap` | Gantt timeline: coloured bars across months, a today line |
| `video` | Video call grid of coloured tiles with a control bar |
| `pipeline` | CRM deal pipeline: stage columns with deal cards and amounts as bars |
| `tickets` | Support queue: rows with priority dots and status pills |
| `calendar` | Week calendar with coloured event blocks |
| `candidates` | Recruiting pipeline: candidate cards with avatars by stage |
| `spreadsheet` | Grid with a header row, numbers as lines, a small chart |
| `slides` | Slide editor: thumbnail strip and a big slide with a title bar and chart |
| `email` | Inbox list beside a reading pane |
| `document` | Document editor: headings, paragraphs, a side outline |

### Who sees what

A pure function `screenApps(agent)` returns the apps for a person's main and second screen, from
their department and, where the department is mixed, keywords in their role. The table agreed in chat:

| People | Main | Second |
|---|---|---|
| Web & Frontend | `editor` | `browser-devtools` |
| Backend & APIs | `editor` | `terminal` |
| Backend & APIs roles containing "Database" or "DBA" | `sql` | `terminal` |
| Architecture & General Engineering | `editor` | `document` (design docs and diagrams) |
| Mobile | `editor` | `simulator` |
| Cloud & Infrastructure (DevOps, SRE, cloud) | `terminal` | `monitoring` |
| Security | `security` | `terminal` |
| QA & Release | `tests` | `kanban` |
| AI, ML & Data | `notebook` | `bi` |
| Emerging Tech, roles matching game, AR, VR, XR, 3D, metaverse or graphics | `engine` | `editor` |
| Emerging Tech, roles matching blockchain, Web3, smart contract, crypto or DeFi | `chain` | `editor` |
| Emerging Tech, everyone else | `editor` | `terminal` |
| Platforms & Enterprise | `enterprise` | `editor` |
| Design (and the core Designer) | `design` | `moodboard` |
| Product Management, Project Management | `kanban` | `roadmap` |
| Engineering Management | `kanban` | `video` |
| Sales Management | `pipeline` | `email` |
| Customer Success | `tickets` | `email` |
| Marketing Management (and the Marketing Strategist) | `calendar` (content calendar) | `bi` (campaign analytics) |
| HR & People | `candidates` | `calendar` |
| Strategy & Innovation | `slides` | `spreadsheet` |
| Operations Management | `spreadsheet` | `email` |
| General Management | `slides` | `email` |
| Executive Leadership | `slides` | `video` |
| Writer, Research Analyst, Knowledge Librarian | `document` | `browser` |
| Receptionist | `calendar` | none |
| Product Coach | `kanban` | `roadmap` |
| Ops Coordinator | `spreadsheet` | `email` |
| Files Agent | `document` | `email` |

Every one of the 208 people maps to an app pair; the variant (0 or 1) comes from a hash of their id.
A desk without an owner (a spare or visitor desk) shows its district's old flavour as an app:
`code` → `editor`, `data` → `bi`, `design` → `design`, `document` → `document`.

A desk's screens, in `equipmentPlacements` order, are: laptop only → main; monitor only → main;
laptop + monitor → monitor main, laptop second; two monitors → left main, right second. A desk
with one screen shows only the main app.

### Rendering

- **Screen sheet**: one 2048 × 2240 canvas (`scene/room/screenApps.ts` paints it once, on first use).
  Each tile is 256 × 320 with a 4 px gutter: the visible screen is 160 px of it, and the extra height
  lets content scroll, wrapping within the tile (scrolling apps paint content that repeats every
  160 px, so the wrap is seamless). 8 columns × 7 rows = 56 tiles, enough for 27 apps × 2 variants.
- **One instanced mesh** for every screen in the office, replacing the per-flavour meshes. Per
  instance: which tile (an `InstancedBufferAttribute` of tile offset), brightness (the existing
  instance colour), a scroll phase and speed, and a status (0 none, 1 working, 2 waiting,
  3 completed, 4 error) with progress. The material is `MeshBasicMaterial` patched with
  `onBeforeCompile` to pick the tile, scroll it, and draw the status strip in the bottom 7% of the
  screen. One draw call for all screens (today four).
- **Motion**: content scrolls slowly (code, logs, tickets) or not at all (canvas, calendar), per app.
  While the owner works on a real task, scrolling is faster and a typing cursor blinks.
- **Status**: `OfficeScene.updateAgentStatus(id, status)` already exists; it sets the status of that
  person's desk screens. `completed` shows green for 20 s, then the strip fades out.
- `ScreenFlavor` stays for the hardware only (light casings for `design` and `moodboard` desks, dark
  keyboards for dark apps), derived from the main app.

### Performance

The sheet is about 18 MB of GPU memory (24 MB with mipmaps), replacing four small textures. Draw
calls for screens go from 4 to 1. No extra triangles. The shader adds a few instructions per screen
pixel.

## Checks

- Unit (`tests/office-screens.test.cjs`): every person in `OFFICE_AGENTS` gets a main app, and a second
  app when the table gives one; the same person always gets the same apps and variant; every app has
  two tiles, tiles never overlap and stay inside the sheet, and each of the 27 apps is used by someone; each department in the table maps as
  written (spot checks: a designer, a frontend developer, an SRE, a PM, a recruiter, a sales manager).
- Desktop (`tests/office-desktop.cjs`): screens are one draw call (`breakdown()` or a mesh count),
  and the campus stays within the existing draw-call and triangle budgets; screenshots of a pod in
  each district for review.
- Before/after screenshots shown to the user before committing.

## Out of scope

People's faces, clothes and accessories; personal desk items; the office day (standups, lunch, the
afternoon break) and visible conversations. Those are the next two pieces, each designed separately.
