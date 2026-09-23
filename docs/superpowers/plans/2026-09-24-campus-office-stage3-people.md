# Campus Office — Stage 3: People and portraits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every one of the 207 coworkers looks like a distinct person dressed for their district, blinks and glances, and has a portrait rendered from their own 3D figure. The portraits replace the mixed photographs and cartoons everywhere.

**Architecture:** A pure appearance generator (`scene/agents/appearance.ts`) turns an id, district and department into a deterministic look. A catalog pass re-rolls looks so that no two people in the same pod share hairstyle and top colour. The rig draws the new tops, hairstyles and accessories, and exposes the eye meshes for blinking. The crowd renderer bakes one body template per top shape plus hair, beard, glasses and headphone templates. A portrait studio (`scene/people/portraits.ts`) renders head-and-shoulders images in idle time into a cache, and `usePortrait(id)` feeds `AgentPortrait`.

**Tech Stack:** three r186, React 18 (`useSyncExternalStore`), `node:test`.

**Spec:** [docs/superpowers/specs/2026-09-23-campus-office-design.md](../specs/2026-09-23-campus-office-design.md) §4.5 (and R12).

## Global Constraints
- Same id → same look, on every launch (spec §4.5).
- No two desks in one pod share hairstyle + top colour (spec §4.5).
- Dress code per district (spec §4.5); the 8 core agents keep hand-tuned looks.
- The portrait shows initials/drawn fallback until the render is ready and never blocks the UI (spec §4.11).
- Performance stays at the Stage 2 level: 60 fps, whole-campus draw calls < 900 (desktop check).

## Tasks

### Task 1: Appearance generator with tests
- `Appearance` gains `top: 'tee' | 'shirt' | 'polo' | 'hoodie' | 'blazer' | 'cardigan' | 'suit' | 'vest'`, `beard: string | null` (colour), `headphones: boolean`. `HairStyle` gains `crop`, `side-part`, `buzz`, `long`, `afro`, `braids`, `bald`. `jacket` stays the outer-layer colour (set for blazer, cardigan, suit and vest).
- `generateAppearance(id, district, accent, variant = 0)` is a pure function of its inputs, seeded from `hashString(\`${id}:${variant}\`)`. It sets height 1.55–1.90, build 0.9–1.1, one of 8 skin tones, one of 9 hair colours, a style (bald/buzz/crop weighted lower), glasses 25%, beard 20% (never with `long`, `bun` or `braids`), headphones 25% in Engineering and 8% elsewhere, and the district's dress code (tops and palettes below). Trousers and shoes come from the district palette.
- `APPEARANCE_OF: ReadonlyMap<string, Appearance>` is built once from `OFFICE_AGENTS` in catalog order. Core agents use `APPEARANCES`; each department is walked in chunks of four (one pod), and a person's variant is re-rolled until their `hairStyle + shirt/jacket colour` differs from everyone earlier in the chunk.
- `appearanceFor(id, accent?)` returns `APPEARANCE_OF.get(id)`, or a generated look for unknown ids.
- Dress codes: Engineering `hoodie, tee, tee, polo, shirt, hoodie` in navy, charcoal, heather, forest, maroon, mustard, teal and off-white, with jeans, black or khaki; AI & Data `vest, shirt, tee, hoodie` in slate, teal, indigo, white and graphite; Design `tee, cardigan, shirt, tee` in coral, mustard, lilac, emerald, black and sky; Product `shirt, cardigan, polo, blazer` in light blue, white, sage, navy and sand; Business `shirt, blazer, polo, blazer` in white, pale blue, navy, charcoal and burgundy; People & Ops `cardigan, shirt, polo, cardigan` in cream, blush, sage, lavender and teal; Leadership `suit, suit, blazer` in charcoal, navy and black over white or pale-blue shirts, with the tie in the district colour.
- Tests (`tests/office-people.test.cjs`): deterministic; all 207 have a look; pod variety holds for every department; every specialist's top belongs to their district's dress code; Leadership wears suits or blazers; at least 8 distinct hairstyles and 6 skin tones across the catalog.

### Task 2: Rig: tops, hairstyles, beard, headphones, blinking
- Arms: upper arm uses the shirt for `tee` and `vest`, otherwise the outer layer; forearm uses skin for `tee`, the shirt for `vest`, otherwise the outer layer.
- Hoodie: a hood at the back of the neck and two drawstrings. Suit: a tie in the accent colour. Polo: a collar. Beard: a jaw/chin shape in the beard colour. Headphones: a band (half torus) and two cups in `#1f2430`.
- New hairstyles as simple primitives (cap sizes, a long back fall, an afro sphere, two braids, a side swoop); `bald` draws no cap.
- `HumanoidRig.eyes: THREE.Mesh[]` holds the eye and eye-white meshes after consolidation. `OfficeAgentCharacter.update` hides them for 0.12 s every 3–6 s (seeded per person); reduced motion keeps them open.
- Verify in the desktop screenshots at pod distance.

### Task 3: Crowd templates for the new looks
- Body templates by top shape: `tee`, `shirt`/`polo` (shared), `hoodie`, `jacket` (blazer and cardigan), `suit` and `vest`. Hair templates for every style except bald. Beard, glasses and headphones get a template each, with sentinel roles (`beard` `#080808`, headphones fixed `#1f2430`).
- Tie colour uses the badge role (accent).
- Check: the whole-campus draw calls in the desktop check stay < 900.

### Task 4: Portraits rendered from 3D
- `scene/people/portraits.ts`: a lazily created studio (its own 192 × 192 `WebGLRenderer` with `preserveDrawingBuffer`, a perspective camera at head height, a key, fill and rim light, and a transparent background). `requestPortrait(id)` queues work. A scheduler renders up to 3 portraits per idle slice (`requestIdleCallback`, with `setTimeout` as fallback), stores `canvas.toDataURL('image/png')` in a cache and notifies subscribers. `usePortrait(id)` uses `useSyncExternalStore`. Failures (no WebGL) mark the studio unavailable, and the drawn fallback stays.
- `AgentPortrait` shows the rendered image when ready, else the existing SVG drawing (updated for tops, beard and headphones). `data/avatars.ts` is deleted; the photo assets stay on disk but are no longer imported.
- The portrait background is a soft tint of the person's district colour.
- Tests: the queue/cache logic is split into a pure `PortraitQueue` class (enqueue dedupe, priority for visible people, `take(n)`), unit-tested without WebGL.
- Desktop check: after 3 s, `.office-team-people .office-portrait img` shows rendered images for the Commons team.

### Task 5: Verify and commit
- `npm run typecheck`, `npm test`, `npm run build`, both desktop checks, and a look at the screenshots (pod close-up, team strip, side panel).
