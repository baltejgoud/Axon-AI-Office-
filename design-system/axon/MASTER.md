# Axon — Design System (Master)

Source of truth for every renderer surface. Page-specific overrides go in `pages/<page>.md`; if a page file exists, it wins for that page only. Tokens live in `src/renderer/src/tokens.css`; components in `src/renderer/src/ui/index.tsx`.

Derived from the `ui-ux-pro-max` generator output for "AI chat desktop app, developer tool, dark mode" (style: Dark Mode / OLED, palette: slate + green, type: Inter), adapted to a desktop app rather than a landing page.

---

## 1. Principles

1. **Describe, don't sell.** Product surfaces state what a thing is and does. No eyebrows, taglines or tracked-caps slogans inside the app. The only place with personality is the empty-chat hero, and even that asks a question rather than making a promise.
2. **One scale each.** Seven type sizes, nine spacing steps, three radii, three icon sizes. If a value isn't a token, it doesn't ship.
3. **Semantic tokens only in components.** CSS and TSX reference `--surface-*`, `--text-*`, `--accent*`, `--border-*`, `--space-*`, `--radius-*`. Never `--slate-*` or a hex literal. Light theme re-points the semantic layer; components never know which theme is active.
4. **SVG icons from one family.** Lucide, stroke 1.75, sized by token, `aria-hidden` when beside text. No Unicode glyphs or emoji as icons.
5. **Every control has a visible focus ring, a hover state, and a disabled state**, and every icon-only control has an `aria-label`.

---

## 2. Tokens

### Color (semantic)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--surface-app` | slate-900 `#0F172A` | slate-50 `#F8FAFC` | Main background |
| `--surface-sidebar` | slate-950 `#0B1120` | slate-100 `#F1F5F9` | Sidebar |
| `--surface-panel` | `#1B2336` | `#FFFFFF` | Cards, composer, secondary buttons |
| `--surface-raised` | `#172032` | `#FFFFFF` | Modals |
| `--surface-hover` | slate-800 `#1E293B` | slate-200 `#E2E8F0` | Hover / active nav, badges, inline code |
| `--surface-code` | slate-950 | slate-900 | Code blocks (deliberately dark in both themes) |
| `--border-subtle` | slate-800 | slate-200 | Dividers, card edges |
| `--border-default` | slate-700 `#334155` | slate-300 `#CBD5E1` | Inputs, secondary buttons |
| `--border-strong` | slate-600 | slate-400 | Hover border |
| `--text-primary` | slate-50 | slate-900 | Body, headings |
| `--text-secondary` | slate-400 `#94A3B8` | slate-600 `#475569` | Descriptions, nav labels (≥ 4.5:1 on all surfaces) |
| `--text-tertiary` | slate-500 | slate-500 | Captions, kbd, placeholders (≥ 3:1; never for body copy) |
| `--accent` | green-500 `#22C55E` | green-700 `#15803D` | Primary button, active indicator, focus ring |
| `--text-on-accent` | slate-900 | white | Text on `--accent` (7.8:1 dark, 5.0:1 light) |
| `--accent-text` | green-400 | green-700 | Accent-coloured text/icons on surfaces |
| `--accent-soft` | green @ 12% | green @ 10% | Icon tiles, accent badges, focus halo |
| `--danger` / `--danger-text` | red-500 / red-400 | red-700 / red-700 | Destructive controls, errors |
| `--ring` | green-400 | green-600 | `:focus-visible` outline |

Contrast was checked per theme, not inferred. Slate-400 on the dark card is 6.1:1; slate-600 on slate-50 is 7.2:1.

### Typography

Font: Inter, falling back to Segoe UI / system-ui. Weights **400 / 500 / 600 only** (450 and 550 were removed — they don't exist on the fallback stack).

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 12px | Captions, badges, kbd, section labels. **Floor — nothing smaller.** |
| `--text-sm` | 13px | Buttons, nav, form labels, secondary copy, code |
| `--text-base` | 14px | Body, inputs, messages |
| `--text-md` | 16px | h3, card titles, brand |
| `--text-lg` | 20px | h2, modal titles |
| `--text-xl` | 28px | Page h1 |
| `--text-display` | 36px | Empty-chat hero only |

Line heights: `--leading-tight` 1.25 (headings), `--leading-base` 1.5 (UI), `--leading-relaxed` 1.7 (messages, paragraphs).

Section labels use `.label-caps`: 12px / 600 / uppercase / 0.06em tracking / `--text-tertiary`. That's the only tracked-caps style.

### Spacing — 4px base

`--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 · `-12` 48

Rhythm: inside a control 8–12; between controls 8; inside a card 20; between cards 16; between page sections 24; page inset `clamp(24px, 4vw, 48px)`.

### Radius

`--radius-sm` 6 (controls, kbd, avatars) · `--radius-md` 10 (cards, code blocks, icon tiles) · `--radius-lg` 16 (modal, composer) · `--radius-full` pill (badges, chips)

### Icons

Lucide, `strokeWidth 1.75`. `--icon-sm` 14 (inside sm buttons, captions) · `--icon-md` 16 (default, nav, md buttons) · `--icon-lg` 20 (icon tiles, empty states).

### Motion

`--duration-fast` 120ms (hover/colour) · `--duration-base` 200ms (overlays, fades) · `--ease-out` `cubic-bezier(.2,0,0,1)`. `prefers-reduced-motion` disables all of it. Nothing animates width/height.

### Layout

`--sidebar-width` 264 (232 under 1100px) · `--topbar-height` 56 · `--page-max-width` 1120 · `--reading-max-width` 800 (messages, composer) · `--overlay-width` 560.

---

## 3. Components

| Component | File | Variants | States | Notes |
|---|---|---|---|---|
| `Button` | `ui/index.tsx` | `primary` `secondary` (default) `ghost` `danger` × `sm` `md` × `iconOnly` `block` | hover, active, disabled, focus-visible | `iconOnly` requires `aria-label` (enforced by the type) and reuses it as `title`. One primary per view region. |
| `Icon` | `ui/index.tsx` | `sm` `md` `lg` `xl` | — | `aria-hidden` unless `label` given. |
| `Kbd` | `ui/index.tsx` | — | — | Write `Mod`; renders `⌘` on macOS, `Ctrl` elsewhere. Never hard-code a modifier. |
| `Modal` | `ui/index.tsx` | — | open (animated in) | `role=dialog`, `aria-modal`, labelled by its title, focuses first field, Escape and backdrop click close, footer = ghost Cancel + primary submit. |
| `Field` | `ui/index.tsx` | with/without `hint` | — | Label above, hint below, 13px secondary. |
| `PageHeader` | `ui/index.tsx` | with/without `actions` | — | h1 + ≤ 60ch description, actions right-aligned. Every page starts with one. |
| `EmptyState` | `ui/index.tsx` | with/without `action` | — | Icon tile + h2 + one sentence + optional primary. Dashed border. |
| `.card` / `.card-grid` | `style.css` | `card-header` `card-title` `card-footer` | — | Footer is separated by a subtle border and holds sm buttons. |
| `.badge` | `style.css` | default, `badge-accent`, `badge-outline` | — | 22px pill, 12px/500. |
| `.tab` | `style.css` | — | hover, `aria-selected` | Underline indicator, no background. |
| `.nav-item` | `layout.css` | — | hover, `aria-current=page` | Icon + label + optional kbd. 36px; history rows 32px. |
| `.input` `.select` `.textarea` | `style.css` | `select-sm` | hover, focus (ring + halo), disabled | 36px min height. Custom chevron on select. |
| `.composer` | `layout.css` | — | focus-within | Textarea + chips + bar (Attach · hint · send/stop). |
| `.message` | `layout.css` | `user` `assistant` | streaming, error | Avatar 28px; assistant avatar uses accent-soft. |
| `.suggestion` | `layout.css` | — | hover | Only on the empty chat. |
| `CatalogPicker` (`SkillPicker`, `RolePicker`) | `ui/CatalogPicker.tsx` | skills / roles | search, group tab, source filter | Built on `Modal`; rows are `<label>` with a checkbox; unsupported skills show a **Needs tools** badge. |
| `SelectionChips` | `ui/CatalogPicker.tsx` | role (accent) / skill (neutral) / locked | — | Locked = inherited from the workspace; removable chips are buttons with `aria-label`. |

---

## 4. Voice & copy

- **Register:** plain, sentence case, present tense, second person. "Import documents", not "Give your AI the whole picture."
- **Page description = one sentence that says what the page holds and what it affects.** Example: *Knowledge — "Documents your workspaces can search. Matching passages are sent to the model with your message."*
- **Buttons are verbs**, ideally one or two words: New workspace · Configure · Import · Save provider. Destructive ones are icon-only with an `aria-label` naming the target ("Remove OpenAI").
- **Confirmations state the consequence**: "Remove 'Research'? Its conversations are kept."
- **Empty states**: title says what's missing ("No providers yet"), body says how to fix it, button does it.
- **Errors** (from the main process) are already terse and specific; don't wrap them.
- **No product-name puns, no exclamation marks, no "your" as a possessive brand device** ("Your models. Your choice.").
- Keyboard hints always via `<Kbd keys="Mod K" />`.

---

## 5. Pre-delivery checklist (every renderer change)

- [ ] No hex literal or px font-size outside `tokens.css` (`grep -E '#[0-9a-f]{3,8}|font-size:\s*[0-9]+px' src/renderer/src/*.css` returns nothing).
- [ ] No Unicode glyph used as an icon; all icons via `<Icon>`.
- [ ] Nothing renders below 12px.
- [ ] Every icon-only control has `aria-label`; every modal is a `Modal`.
- [ ] Both themes checked by screenshot, not assumed (`npm run test:desktop` covers dark; toggle light in Appearance).
- [ ] `npm run typecheck && npm test && npm run build && npm run test:desktop` pass.
- [ ] `npx prettier --check "src/renderer/src/**/*.{tsx,css}"` passes.
