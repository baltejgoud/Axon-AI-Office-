# Look & Shell — design (sub-project 1 of 4)

- **Date:** 2026-09-21
- **Status:** Draft, awaiting review
- **Reference image:** [`docs/design/axon-concept-1.webp`](../../design/axon-concept-1.webp) ("Concept 1 — Minimal AI Workspace")
- **Series:** **1 Look & Shell (this spec)** → 2 Interactions (command palette, shortcut help, notification center) → 3 Web search → 4 Voice input. Each has its own spec, plan and build.

## 1. Goal

Make the running app match the reference image: light-first, on every screen, in both themes, with a shell and controls that behave the way they look. No control may pretend to work.

The right-hand panel and bottom strip of the image are treated as **spec** (palette, fonts, interaction list), not as app UI.

## 2. What is wrong today

Evidence from screenshots of the built app on 2026-09-21 (the home screen and every page, in light and dark) and from the source.

| # | Finding | Evidence |
|---|---|---|
| 1 | The app opens dark; the image is light. A light theme exists but is never shown. | `initialState()` sets `theme: 'dark'` (`repository.ts:15`); the saved profile is `dark`. |
| 2 | Double window chrome: native OS frame plus fake macOS dots drawn in the sidebar that do nothing. | `App.tsx` `.window-traffic-lights`; `main/index.ts` has no `frame`/`titleBarStyle`. |
| 3 | The window background is hardcoded dark, so it shows through during resize and first paint on a light theme. | `createWindow` sets `backgroundColor: '#0f172a'`. |
| 4 | Inter is not bundled. On this machine text falls back to Segoe UI (Inter would only render if a user happened to have it installed). | `document.fonts` is empty at runtime. |
| 5 | The logo is a different shape. The app draws a 5-node "X"; the image has one detached dot above a single thick, smoothly joined squiggle with three rounded ends. | `AxonLogo` in `ui/index.tsx`; 8× crop of the reference. |
| 6 | Dark theme defects: the "Ctrl K" chip is green-on-green; card icon tiles are white slabs. | `dark-01-home.png`. |
| 7 | The Code page embeds the full welcome hero in a half-width pane: cards wrap, the doodle overlaps the greeting. | `light-02-code.png`. |
| 8 | Facade controls: mic toasts "Voice input ready"; bell toasts "No new notifications"; Search toggles a flag nothing reads (`searchMode`) and toasts "Web search enabled"; "Alex / alex@axon.ai / Free plan" are literals; Help & Feedback calls `window.open`, which the main process denies, so it does nothing; the "Chat ⌄" pill and workspace card show chevrons but have no menus. | `Chat.tsx`, `App.tsx`, `main/index.ts:22`. |
| 9 | The drop zone ignores dropped files and opens a file dialog instead. | `Chat.tsx` `onDrop` calls `window.axon.attach()`. |
| 10 | The theme toggle writes settings without refreshing the store and reads its icon from the DOM at render time, so it is not reactive. | `Chat.tsx` "Toggle theme" handler. |
| 11 | `npm run test:desktop` fails: it expects `.welcome` (now `.welcome-workspace`) and a sidebar button named after a workspace. | `tests/electron-smoke.cjs`; run failed with "Welcome view did not render". |
| 12 | CSS hygiene: 21 hex literals and 9 px font sizes outside `tokens.css`; the project's own checklist requires 0. A second `--axon-*` palette is defined and used nowhere. | grep over `src/renderer/src/*.css`. |
| 13 | The image's own green fails WCAG AA for text: white on `#10A37F` is **3.20:1**; green text on the mint fill is **2.84:1** (need 4.5). | Computed 2026-09-21. |
| 14 | `design-system/axon/MASTER.md` is dark-first and forbids emoji and taglines, which contradicts the image. | `MASTER.md` §1, §2. |
| 15 | **The surfaces are inverted.** In the image the title strip and sidebar are the tinted "Background" (`#F6FAFD`–`#F9FAFE`) and the whole main area is white (`#FFFFFF`, an unbroken 824px run at 1×); cards are white on white, separated by a 1px border and a faint shadow. The app has a white sidebar on a gray page. | Pixel scans of the reference (Chromium canvas, 2026-09-21). |
| 16 | Smaller gaps against the image. Top-bar bell and theme buttons are bordered boxes (pictured: plain ghost icons). The theme icon shows the *target* mode (pictured: the *current* mode, a sun in light). Composer `+` is a circle and the chips are bordered pills (pictured: filled rounded rectangles). Send is a circle (pictured: rounded square). The hint sits outside the composer (pictured: inside, bottom-right). Knowledge uses the `Library` icon (pictured: open book); Workspaces uses `LayoutGrid` (pictured: a pack/bag glyph); the Agents chip uses `Bot` (pictured: sparkles). Drop-zone title reads "Drag and drop files here" (pictured: "Drag and drop here"). | Zoomed crops of the reference vs `light-01-home.png`. |

## 3. Scope

### In scope
- Theme system, tokens, bundled fonts, brand mark and app icon.
- Real window chrome, shell, sidebar, top bar, home, composer, and every existing page in both themes.
- Real drag-and-drop attachments.
- Profile settings (name, email) replacing the hardcoded identity.
- Repairing `test:desktop`, new automated checks, a screenshot-matrix script, and rewriting `MASTER.md`.

### Out of scope
- Command palette, shortcut help panel, notification center (sub-project 2).
- Web search (3) and voice input (4).
- Provider protocols, tools/MCP behavior, approvals logic (their components are only restyled to tokens).
- Installer, signing, and macOS/Linux verification. The macOS/Linux window code is written but cannot be tested on this Windows machine.

### Interim states (until sub-projects 2–4 land)
| Control | Interim behavior |
|---|---|
| Bell | Rendered, `aria-disabled="true"`, tooltip "Notifications aren't available yet". No toast. |
| Composer **Search** chip | `aria-disabled="true"`, tooltip "Web search isn't set up yet". No toast, no state flag. |
| Composer **mic** | `aria-disabled="true"`, tooltip "Voice input isn't set up yet". No toast. |
| **Ctrl+K** | Starts a new chat, so the "Ctrl K" chip on the New chat button is truthful. Sub-project 2 replaces it with the palette, opening with "New chat" pre-selected. The sidebar search stays reachable by clicking its icon. |

## 4. Design

### 4.1 Tokens and themes

`tokens.css` keeps its three layers (primitive → semantic → component); the semantic layer is re-pointed. Components reference semantic tokens only. The dead `--axon-*` block is deleted. **Light is the default.**

| Token | Light | Dark | Note |
|---|---|---|---|
| `--surface-sidebar` | `#F7F8FA` | `#0B0F17` | picture "Background"; title strip and sidebar |
| `--surface-app` | `#FFFFFF` | `#111827` | picture "Surface"; the whole main canvas and top bar |
| `--surface-panel` | `#FFFFFF` | `#151E2E` | cards, composer; separated from the canvas by border + shadow (dark lifts slightly) |
| `--surface-raised` | `#FFFFFF` | `#1A2436` | modals, menus (with shadow) |
| `--surface-hover` | `#F1F4F8` | `#1B2536` | picture "Surface Alt"; composer `+` and chips, hovers |
| `--surface-active` | `#E8EDF3` | `#223047` | pressed / selected |
| `--surface-dropzone` | `#F9FBFC` | `#0F1623` | drop-zone fill (sampled) |
| `--border-subtle` / `-default` / `-strong` | `#EEF0F4` / `#E5E7EB` / `#D0D5DD` | `#1B2433` / `#263246` / `#334259` | picture "Border" = default |
| `--text-primary` | `#111827` | `#F3F4F6` | |
| `--text-secondary` | `#667085` | `#9CA3AF` | |
| `--text-tertiary` | `#808A9E` | `#6B7686` | captions, kbd, timestamps; never body copy |
| `--accent` | `#10A37F` | `#10A37F` | picture "Accent Green": mark, icons, rails, send-button fill |
| `--accent-strong` | `#0C8567` | `#0C8567` | fills that carry text; white on it is 4.60:1 |
| `--accent-strong-hover` | `#0B7A5E` | `#0B7A5E` | white on it is 5.30:1 |
| `--accent-text` | `#0B7A5E` | `#34D399` | green text and icons on hover/active surfaces |
| `--accent-soft` | `#DDF7F0` | `rgb(16 163 127 / .16)` | picture "Accent Mint" |
| `--text-on-accent` | `#FFFFFF` | `#FFFFFF` | on `--accent-strong` |
| `--ring` | `#7C3AED` | `#A78BFA` | picture "Focus" |
| `--hue-blue` | `#2A47C9` | `#7C93F0` | Plan a project, Learn something |
| `--hue-green` | `#198C67` | `#3FBF95` | Review code |
| `--hue-purple` | `#5B3CD1` | `#A78BFA` | Create with AI |

Hue values were sampled from the reference on 2026-09-21 (stroke colors of the four starter icons: `#3140C4`, `#198C67`, `#1C4AC6`, `#3922A3`); blue and purple are nudged one step lighter because a sample is the darkest antialiased pixel. Dark-theme hues are lightened for legibility.

**Surface model (measured, not assumed).** The title strip and sidebar are `--surface-sidebar`; the main canvas and top bar are `--surface-app` (white in light). Cards and the composer are white on white, separated by a 1px `--border-subtle` (`#EEF0F4`, sampled) and a soft shadow. The drop zone is the only tinted block inside the canvas.

**Accessibility deviation (flagged for review).** The picture's exact green is used for graphics only (the mark, icons, the left rail, the send button). Anywhere text sits on green (primary buttons, the New chat label) the deeper `--accent-strong` / `--accent-text` is used, which is visibly close to but slightly darker than pictured. Reverting is a one-token change per role. Container and input borders follow the picture (≈1.3–1.6:1), so this project targets AA for text and focus rings and does **not** claim WCAG conformance.

**Dark theme** is derived from the same gray family as the picture (its `#111827` text color becomes the dark surface), not from the previous slate leftovers.

**Theme mechanics**
- New `theme.ts`: resolves `system` against `matchMedia`, sets `data-theme` on `<html>`, and exposes the resolved theme reactively. `setTheme()` goes through `perform(settingsSave)` so the store refreshes; this replaces the DOM-reading toggle (finding 10).
- Main process (`index.ts`): `createWindow` reads the saved theme and picks `backgroundColor` accordingly (no flash); sets `nativeTheme.themeSource`; and after each `settingsSave` updates `nativeTheme` and `setTitleBarOverlay` colors.
- One-time migration: see §4.11.

### 4.2 Typography

- **Inter** (variable, 400–700) and **Caveat** (500, for the doodle only) bundled locally via `@fontsource-variable/inter` and `@fontsource/caveat` (both OFL). They are renderer build-time dependencies, so they go in `devDependencies` like `lucide-react`. No runtime network access. The CSP has no `font-src`, so it falls back to `default-src 'self'`; loading is verified in test, not assumed.
- Stack: `Inter, 'SF Pro Text', -apple-system, 'Segoe UI', system-ui, sans-serif`.
- Scale unchanged (12/13/14/16/20/28/36). Weight **700** is added for the greeting only (the picture's greeting is bold); UI stays 400/500/600.

### 4.3 Brand mark, icons, app icon

- `AxonLogo` is redrawn to match the image: one detached round dot above a single thick, smoothly joined squiggle with rounded left, right and bottom ends, in the brand green (`#019C6F` sampled). Reviewed against the 8× crop of the reference.
- Icons stay Lucide at stroke 1.75. Mapping from the reference crops: New chat and Chat `MessageSquare`; Code `Code`; Knowledge `BookOpen` (today `Library`); Agents `Bot`; Workspaces `Backpack` (today `LayoutGrid`); composer chips `Globe`, `BookOpen`, `Sparkles`; theme toggle shows the **current** mode (`Sun` in light, `Moon` in dark). Starter-card icons are **unboxed** (no tile), 24px, in their hue.
- Provider marks in the model pill are **monograms** on a hued dot, not third-party logos.
- `scripts/make-icon.cjs` renders the mark to `build/icon.png` (1024²) via an offscreen Electron window; `BrowserWindow.icon` and electron-builder use it.

### 4.4 Window chrome

- Frameless: `titleBarStyle: 'hidden'`. Windows/Linux: `titleBarOverlay` (native minimize/maximize/close at top right, colors themed, `height: 32`). macOS: real traffic lights at `trafficLightPosition`.
- The fake dots are removed.
- A **32px title strip** spans the window (drag region). Interactive elements below it are `no-drag`. Layout uses `env(titlebar-area-*)` so nothing collides with the native buttons.

### 4.5 Shell layout

```
┌───────────── title strip 32px (drag) ─────────────[ – ☐ ✕ ]┐
│ Sidebar clamp(220px,19vw,264px) │ Top bar 56px              │
│  brand · New chat · nav         │───────────────────────────│
│  Recent                         │ Page content              │
│  footer                         │                           │
└─────────────────────────────────┴───────────────────────────┘
```

The picture's app window measures 1050×835 px. That is treated as 1× because its type sizes (nav labels ≈ 13px, greeting ≈ 34–36px) match this token scale. The build is verified against the picture at **1050×835**: sidebar width, card size, composer size and top-bar height within ±4px. Content column max-width 800px. Minimum window stays 980×680; below 1100px the home cards go 2-up.

`AppShell` owns the frame; the **top bar is shared by every page** (Mode pill, model menu on Chat/Code, bell, theme toggle). Conversation rename/delete appear only when a chat is open.

### 4.6 Sidebar

- **Brand row:** mark + "Axon" + Beta badge.
- **New chat:** mint fill (`--accent-soft`), `--accent-text` label, `Ctrl K` chip legible in both themes.
- **Nav:** Chat, Code, Knowledge, Agents, Workspaces; 36px rows; hover = `--surface-hover`; current page = `--surface-active` + 3px `--accent` rail with primary-colored label (on the tinted sidebar the hover fill alone would be nearly invisible).
- **Recent:** caps label + search toggle (inline field, unchanged), 32px rows with file icon, ellipsis title and `timeAgo` (`2m/1h/3h/1d/2d`), "View all" toggle (unchanged behavior).
- **Workspace switcher:** the card becomes a real menu. Items: "Personal Workspace" (no workspace), each user workspace (the built-in `code` workspace is excluded because Code has its own nav), and "Manage workspaces…". Selecting applies the workspace's default model, as `navigate()` does today. The subtitle shows the workspace's default model (or the selected model), or "No model connected"; never "Free plan".
- **User card:** shows `profile.name` / `profile.email`. If both are blank it reads "Set up your profile" and opens Settings → Profile. The avatar shows the initial, or a person icon when blank.
- **Help & Feedback:** opens `HelpDialog`: keyboard shortcuts, version (Vite-injected `__APP_VERSION__`), data-location note, and **Copy diagnostics** (version, platform, provider and model ids; no keys, no conversation text). No external link.

### 4.7 Top bar

- **Mode pill** `Chat ⌄` is a real menu (Chat, Code, Knowledge, Agents, Workspaces). When a workspace or conversation is active, breadcrumb crumbs follow: `Chat / Research / Quarterly review`.
- **Model menu** replaces the native `<select>` with the new `Menu` primitive (grouped by provider, check on current, monogram marks). The trigger is a rounded rectangle (radius 12) with a hairline border, mark, name and chevron, as pictured. Disabled once a chat exists, as today.
- **Bell and theme toggle** are plain **ghost icon buttons** (no border box), as pictured. The bell is in its interim state (§3). The toggle is reactive and shows the current mode. When a chat is open, rename and delete follow.

### 4.8 Home (welcome)

- Greeting `Good morning|afternoon|evening` by local hour (`<12`, `<18`), `, {name}` when set, plus 👋. The emoji is allowed here as content; MASTER is amended. Subtext "What would you like to work on today?".
- **Doodle:** "More possibilities with Axon" in Caveat, rotated about −6°, with a hand-drawn curved arrow SVG toward the cards; hidden below 760px of main width.
- **Four starter cards** (Plan a project, Review code, Learn something, Create with AI): unboxed 24px icon in its hue, 14/600 title, 12.5px description, arrow bottom-right that nudges 2px on hover. Click fills the composer and focuses it (existing behavior).
- **Drop zone** on `--surface-dropzone` with a dashed border, copy "Drag and drop here" / "Attach PDFs, code, images or any file to add context", and a primary "Choose files" button. **Quick chips** (Summarize a document, Analyze data, Generate code, Brainstorm ideas, More) are rounded rectangles with a hairline border, not pills.
- **Context-aware behavior** (all real, all small):
  1. No connected model → the home leads with one "Connect a provider" card instead of the starters.
  2. Active workspace has knowledge sources → starter 3 becomes "Ask your documents" (names the source count).
  3. The last-used model is remembered across launches (`localStorage`, guarded with try/catch; falls back to the first model).
  4. The workspace's default model is still applied on selection (existing).

### 4.9 Composer and drag-and-drop

- Layout as pictured: textarea, then one bar. `+` and the chips **Search · Knowledge · Agents** are **filled** `--surface-hover` rounded rectangles (radius 10, no border; counts as today). The mic is a bordered rounded square. **Send** is a solid green rounded square, not a circle. Enabled = solid; empty/disabled = tinted, visibly different. The hint "Shift + Enter for new line" sits **inside** the composer, bottom-right. Autosizing textarea, 2–8 rows. The composer is white with a 1px `--border-subtle` border and a soft shadow.
- Search and mic are in their interim state (§3).
- **Real drag-and-drop.** Today a drop opens a dialog. New flow:
  1. The renderer's drop handler passes the real `File` objects to `window.axon.attachDropped(files)`.
  2. The **preload** converts them with `webUtils.getPathForFile`, which returns `''` for forged `File` objects, and invokes the main-process handler. The renderer never receives or supplies a path string, so a compromised renderer cannot ask main to read an arbitrary file; the dialog's "explicit user selection" guarantee is preserved.
  3. Main re-validates: regular file (not a directory), at most 5 files, same 30,000-character text cap and 15 MB parse limit as `attach()`, same sender checks; then the same `parsers.extract` path.
  4. The zone highlights on `dragover` (mint tint, `--ring` outline). When a chat is open (no zone visible), the composer is the drop target with the same highlight.

### 4.10 Other pages

- **Knowledge, Agents, Workspaces, Settings:** same card, button, empty-state and page-header language as the picture. Settings gains a **Profile** tab (before Appearance); Appearance becomes a three-card theme picker (Light / Dark / System).
- **Code:** extracted from `Spaces.tsx` into `Code.tsx`; the shared top bar replaces its two ad-hoc headers. The assistant pane uses a **compact** variant of the home: a short title, three quick prompts (Review this file, Explain, Write tests) and the composer. No greeting, doodle, cards or drop zone.
- **Message view, code blocks, thought and tool-call blocks, approval card, diff viewer, modals:** restyled to tokens in both themes. Behavior is unchanged. The capture script seeds a real conversation through a mock provider so this view is actually screenshotted.
- **New `Menu` primitive** (`ui/Menu.tsx`): trigger + `role="menu"`, arrow/Home/End/typeahead, Escape, outside-click, focus return, flips upward when near the bottom. Used by the mode pill, workspace switcher and model menu.

### 4.11 Data changes

```ts
interface Settings {
  theme: 'dark' | 'light' | 'system';
  // …existing fields…
  profile: { name: string; email: string };  // new
  uiVersion: number;                          // new; owned by main, ignored from the renderer
}
```

- `initialState()`: `theme: 'light'`, `profile: { name: '', email: '' }`, `uiVersion: 2`.
- `migrate()`: `profile ??= { name: '', email: '' }`. If `(uiVersion ?? 0) < 2`: change `theme` from `'dark'` to `'light'` (`'light'` and `'system'` are left alone) and set `uiVersion = 2`. It runs once; after that the user's toggle is respected across restarts.
- `settingsSave`: trims; name ≤ 60 chars; email ≤ 120 chars and loosely valid or blank; theme validated as today; `uiVersion` is always taken from state, never from the renderer.
- New `attachDropped(paths: string[])` on `Service`, exposed to the renderer as `attachDropped(files: File[])` through the preload (see §4.9). This is a new IPC surface; it is the only one added.

### 4.12 Code structure

```
src/main/{index,repository,service}.ts   window chrome, theme→native, migration, settings validation, attachDropped
src/preload/index.ts                     attachDropped via webUtils
src/shared/{types,platform}.ts           Settings.profile/uiVersion, attachDropped
src/renderer/src/
  main.tsx                               font imports
  theme.ts                               (new)
  tokens.css                             rewritten
  styles/*.css                           layout.css split by surface: shell, sidebar, topbar, home, composer, messages, code, pages
  shell/  AppShell, TitleStrip, Sidebar, WorkspaceSwitcher, UserCard, TopBar, HelpDialog   (new)
  chat/   Home, Composer, MessageList, Message, CodeBlock, ModelMenu, starters             (extracted from Chat.tsx)
  ui/     Menu (new); AxonLogo, Modal, Button restyled
  Code.tsx                               extracted from Spaces.tsx
  App.tsx                                state wiring + AppShell only
scripts/ui-capture.cjs, scripts/make-icon.cjs
tests/tokens.test.cjs, tests/hygiene.test.cjs   (new); repository/service/electron-smoke updated
design-system/axon/MASTER.md, README.md         rewritten / updated
```

Extraction from `Chat.tsx` (970 lines) and `App.tsx` (374 lines) is **behavior-preserving** and lands before the restyle so the restyle diff stays readable.

## 5. Verification and acceptance

Automated (all must pass): `npm run typecheck`, `npm test`, `npm run build`, `npm run test:desktop`, `npx prettier --check "src/renderer/src/**/*.{ts,tsx,css}"`.

| Check | Where |
|---|---|
| Token contrast, both themes: primary and secondary text ≥ 4.5:1 on sidebar, app, panel, raised, hover and drop zone; primary text ≥ 4.5:1 on active (secondary text is never used on it, since `#667085` on `#E8EDF3` is 4.2:1); tertiary ≥ 3:1 on sidebar, app, panel and drop zone; accent text ≥ 4.5:1 on sidebar, app, panel, hover and mint; white on `--accent-strong` and hover ≥ 4.5:1; `--accent` and `--ring` ≥ 3:1 on sidebar, app and panel; danger text ≥ 4.5:1. The values in §4.1 were checked on 2026-09-21 with 0 failures; the tightest margins are secondary text on hover (4.51:1) and brand green on the light sidebar (3.01:1), so the test pins them. | `tests/tokens.test.cjs` |
| Hygiene: no hex and no `--slate-*` outside `tokens.css`; no `font-size: Npx`; nothing below 12px; no `--axon-*`. | `tests/hygiene.test.cjs` |
| Migration: dark→light once, `light`/`system` untouched, idempotent on second load; profile default; corrupt file still quarantined. | `tests/repository.test.cjs` |
| `settingsSave` validation and `uiVersion` immutability; `attachDropped` rejects directories, missing files, more than 5, over-cap text. | `tests/service.test.cjs` |
| Smoke: fresh profile is `data-theme=light`; `document.fonts.check('600 14px Inter')`; title strip present, fake dots absent; workspace switcher and model menu work; disabled controls have `aria-disabled` and raise **no** toast; a **genuine** file drop (dispatched through the Chromium debugger's `Input.dispatchDragEvent` with a real temp file) attaches it, while a forged `File` passed to `attachDropped` yields no attachment; existing streaming/usage/picker assertions still pass. | `tests/electron-smoke.cjs` |
| Screenshot matrix: 8 views (home, Code, Knowledge, Agents, Workspaces, Settings, open chat with real messages, a modal) × 2 themes × 3 sizes (1380×900, 1050×835, 980×680); no horizontal overflow; zero renderer console errors. | `npm run ui:capture` |

Fidelity review (manual, by me and then by you): the home screen at 1050×835 is compared with the reference side by side, per theme, before the work is called done.

## 6. Risks

| Risk | Mitigation |
|---|---|
| 3,100 lines of **uncommitted** work (tools, MCP, approvals) sit in the same files (`Chat.tsx`, `App.tsx`, `Settings.tsx`, …). | New branch; checkpoint commit first (with your OK); extraction is behavior-preserving and gated by the existing suite. |
| Frameless window: drag regions swallowing clicks; native buttons overlapping content at the minimum size. | Strip is a separate row; `no-drag` on controls; matrix includes 980×680. |
| Fonts blocked under `file://` + CSP. | Verified by `document.fonts.check` in smoke; fallback stack keeps the app usable. |
| `attachDropped` is new IPC and security-relevant. | Only genuine `File` objects can produce paths; main re-validates; unit-tested; no renderer-supplied paths. |
| The dark theme is a subjective redesign. | Contrast tests plus screenshots; you review both themes. |
| macOS/Linux window code unverified here. | Written to Electron's documented options; called out in README limitations. |

## 7. Delivery

- Branch `feature/look-and-shell` from `main`. Checkpoint commit of the existing working tree first, only with your explicit OK. Then small commits per step. Nothing is pushed.
- Order: (1) extraction, (2) tokens/theme/fonts/data, (3) window + shell, (4) home + composer + drag-and-drop, (5) pages, (6) tests, capture script, docs.
- **Checkpoints:** after steps 3, 4 and 5 I show you screenshots (both themes, at 1050×835 next to the reference) before continuing, so a wrong turn costs one step, not the whole build.

## 8. Decisions log

Approved on 2026-09-21: light default with a one-time flip of your saved theme; real window controls; profile name in Settings; Help as an in-app panel; monogram provider marks; branch plus checkpoint.
Added while writing this spec, for your review: **(A)** the accessible green split (§4.1); **(B)** Ctrl+K = new chat until sub-project 2 (§3); **(C)** real drag-and-drop through a new preload path (§4.9); **(D)** a custom `Menu` primitive replacing the native model `<select>` (§4.10).
Corrections from measuring the reference (they change how it looks, so they are listed here): **(E)** the surfaces are inverted relative to today, with a tinted sidebar and title strip and a white main canvas (finding 15); **(F)** the theme icon shows the current mode, the top-bar icons lose their border boxes, and the composer controls change shape (finding 16).
