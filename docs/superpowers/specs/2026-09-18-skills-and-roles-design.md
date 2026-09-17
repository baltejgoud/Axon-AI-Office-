# Skills & Roles — Design

**Date:** 2026-09-18
**Status:** Approved for planning
**Scope:** Bundled skill catalog, bundled role catalog, selection UI, prompt injection.

## 1. Goal

Let a user choose, per conversation / workspace / agent profile, (a) one or more **skills** — instruction sets taken from public Agent-Skills repositories — and (b) one or more **development or management roles** — authored personas. Both are bundled with Axon; nothing is fetched at runtime. Selections are folded into the system prompt of every message sent from that context.

Axon executes no tools. A skill or role is therefore only ever text in the system prompt.

## 2. Non-goals

- Runtime download, cloning or syncing of repositories.
- Running any script, MCP server or file referenced by a skill.
- Bundling `references/*.md`, `scripts/`, data CSVs or any file other than `SKILL.md`.
- User-created skills or roles inside the app (roles are editable only in the committed JSON).
- Automatic skill/role suggestion based on the message.

## 3. Sources (initial)

| Slug | Repository | License |
|---|---|---|
| `ui-ux-pro-max` | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT |
| `design-md` | https://github.com/google-labs-code/design.md | Apache-2.0 |
| `ponytail` | https://github.com/DietrichGebert/ponytail | MIT |
| `superpowers` | https://github.com/obra/superpowers | MIT |
| `awesome-claude-skills` | https://github.com/ComposioHQ/awesome-claude-skills | per-repo; recorded at ingest |

The list lives in `skills.sources.json` at the repo root. Adding a source is a one-object append followed by `npm run skills:ingest`.

## 4. Ingest (build-time only)

`scripts/skills/ingest.cjs` (pure helpers in `scripts/skills/ingest-core.cjs`), run by `npm run skills:ingest` on a developer machine. It may use `git` because it never ships; the app never shells out.

For each source:

1. Shallow-clone into a temp directory.
2. Find every `SKILL.md`, excluding `node_modules`.
3. Parse YAML-ish frontmatter: `name`, `description` (plain or `>` block scalar), optional `category`, optional `requires` (map; values may be lists).
4. **Dedupe by skill `name` within a source.** When the same name appears at several paths (e.g. `.claude/skills/x`, `cli/assets/skills/x`), keep the first match in this preference order: `skills/`, `.claude/skills/`, any other path. Record the kept `path`.
5. `hasScripts` = the skill directory contains `scripts/` or any `*.py|*.sh|*.cjs|*.js|*.ts` file.
6. `requires` = flattened `requires` frontmatter as `"<key>:<value>"` strings, e.g. `mcp:rube`.
7. `supported` = `requires.length === 0 && !hasScripts`.
8. `category` per §5.
9. `id` = `${slug}/${name}`. Ingest fails if two skills in one source resolve to the same id after dedupe.
10. Body = the markdown after the frontmatter, trimmed. Bodies over 64 000 characters fail ingest (none of the current 907 do).

Outputs, all committed:

- `src/skills/catalog.json` — `Skill[]` (see §6). Sorted by `source`, then `name`.
- `src/skills/bodies.json` — `Record<skillId, string>`.
- `src/skills/LICENSES.md` — for each source: URL, license name, and the verbatim LICENSE file text if present.

Ingest is deterministic for a given set of commits; the script prints the commit SHA it read from each source, and those SHAs are written into `catalog.json` under a top-level `sources` array so the catalog records its own provenance.

## 5. Categorization

Applied at ingest, in order; first rule that matches wins.

1. Frontmatter `category`, lower-cased, if it is one of `design | engineering | workflow | review | content | integration | other`.
2. `requires` contains any `mcp:*`, **or** the path contains `composio-skills/` → `integration`.
3. Keyword match against `name + " " + description` (lower-cased, word-boundary match; the path is deliberately excluded because `skills/` and `.agents/skills/` would match every skill):
   - `review`: review, audit, over-engineer, debt, critique, lint
   - `workflow`: brainstorm, plan, tdd, debug, worktree, branch, subagent, agents, executing, finishing, dispatch
   - `design`: design, ui, ux, brand, logo, banner, slide, color, typography, figma, canvas, artifact
   - `content`: write, writing, changelog, comms, research, blog, seo, copy, content, document, invoice
   - `engineering`: code, typescript, api, service, cli, sdk, test, contract, ink, migration
4. Otherwise `other`.

Rule order matters: "review" beats "workflow" so `requesting-code-review` lands in Review, not Workflow.

## 6. Data model

### Bundled (read-only at runtime)

```ts
type SkillCategory = 'design' | 'engineering' | 'workflow' | 'review' | 'content' | 'integration' | 'other';

interface Skill {
  id: string;            // "superpowers/brainstorming"
  source: string;        // slug
  path: string;          // directory within the repo
  name: string;
  description: string;
  category: SkillCategory;
  requires: string[];    // e.g. ["mcp:rube"]
  hasScripts: boolean;
  supported: boolean;
  bytes: number;         // body length
}

interface SkillSourceInfo { slug: string; url: string; license: string; commit: string; skillCount: number }

interface Role {
  id: string;            // "frontend-developer"
  name: string;          // "Frontend Developer"
  group: string;         // see §7
  profile: string;       // authored, 80–120 words
}
```

`src/main/skills.ts` imports `catalog.json` and `bodies.json` and exposes:

```ts
catalog(): { skills: Skill[]; sources: SkillSourceInfo[] }
skillBodies(ids: string[]): { id: string; name: string; source: string; body: string }[]  // unknown ids skipped
```

`src/main/roles.ts` imports `roles.json` and exposes `roles(): Role[]` and `roleProfiles(ids)`.

### Persisted state (`platform-v1.json`)

`Conversation`, `Workspace`, and `Agent` each gain `skillIds: string[]` and `roleIds: string[]`. Schema version stays 1. `Repository.migrate()` sets both to `[]` where absent, so existing files load unchanged. `validate()` requires both to be arrays of strings when present.

### Renderer snapshot

`Snapshot` gains `skills: Skill[]`, `skillSources: SkillSourceInfo[]`, `roles: Role[]`. Skill bodies (3.3 MB) are never sent to the renderer. Role profiles are included in `roles` — they are small (~140 KB total) and the picker shows the first line of each. The catalog is ~300 KB; it rides along with the existing snapshot rather than adding an IPC method, since `snapshot()` is already called on every refresh and the catalog is static.

## 7. Roles catalog

`src/roles/roles.json`, hand-authored, 198 roles after removing the two duplicates (Technical Product Manager, Engineering Manager) from the supplied list.

Groups — development: Web & Frontend · Backend & APIs · Mobile · Cloud & Infrastructure · Security · AI, ML & Data · Architecture & General Engineering · Design · QA & Release · Platforms & Enterprise · Emerging Tech. Management: Executive Leadership · General Management · Product Management · Project Management · Engineering Management · Operations Management · Sales Management · Marketing Management · HR & People · Customer Success · Strategy & Innovation.

Every `profile` has four labelled parts, in this order, so profiles combine predictably:

```
Owns: …
Optimises for: …
Pushes back on: …
Communicates: …
```

Ids are kebab-case of the name with parenthetical abbreviations dropped (`site-reliability-engineer`, not `sre`).

## 8. Prompt assembly

In `Service.chatSend`, after computing `workspace` and `history`:

```
effectiveRoles  = dedupe([...workspace.roleIds,  ...chat.roleIds])
effectiveSkills = dedupe([...workspace.skillIds, ...chat.skillIds])
```

In `chatCreate`, the new conversation's `skillIds`/`roleIds` are `dedupe([...agent.skillIds, ...selection.skillIds])` (agent first, then whatever the composer passed; either may be empty). Agent selections are therefore copied at creation, alongside the agent's system message, so `chatSend` has a single place to read.

System prompt order:

1. Workspace system prompt (or default)
2. Workspace instructions
3. **Roles block** (if any)
4. **Skills block** (if any)
5. System messages from history (agent prompt)
6. Retrieved knowledge (unchanged)

Roles block:

```
<roles>
You are working as: {names, comma-separated}.
Apply every role below. Where they disagree, say so and give each perspective rather than silently picking one.

## {Role name}
{profile}
</roles>
```

Skills block:

```
<skills>
The user selected these skills. Follow their instructions. Scripts, tool servers, and files they reference are not available here — do the equivalent manually or say what you can't do.

## Skill: {name} ({source})
{body}
</skills>
```

**Budget:** if the skills block exceeds 80 000 characters, `chatSend` throws `Selected skills exceed the budget (N of 80,000 characters). Remove a skill.` before anything is persisted. Roles are small and have no separate cap. Both blocks count toward the existing 240 000-character context check.

Unknown ids (e.g. a skill removed by a later ingest) are silently skipped at assembly time and shown as "unavailable" chips in the UI.

## 9. IPC

New / changed methods on `PlatformAPI`:

```ts
chatCreate(providerId, modelId, workspaceId, agentId?, selection?: { skillIds: string[]; roleIds: string[] })
chatSelectionSet(conversationId: string, selection: { skillIds: string[]; roleIds: string[] }): Promise<void>
```

`workspaceSave` and `agentSave` accept the new arrays on their existing objects. Validation on all three: arrays of ≤ 50 strings, each ≤ 200 chars, ids must exist in the respective catalog (unknown ids rejected on save, only tolerated on load).

## 10. UI

### Pickers

`SkillPicker` and `RolePicker` are two instances of one `CatalogPicker` component (`src/renderer/src/ui/CatalogPicker.tsx`) parameterised by items, groups and selection. Built on the existing `Modal`.

- Search input (name + description, case-insensitive substring).
- Group tabs: for skills, category tabs **All · Design · Engineering · Workflow · Review · Content · Integration · Other** plus a source `<select>`; for roles, the group list. Integration is listed last.
- Rows: checkbox, name, one-line description (roles: first line of `Owns:`), right-aligned meta. Skills show `bytes` as "12k" and a **Needs tools** badge when `!supported`. Rows for unsupported skills remain selectable.
- Footer: "N selected · Mk chars" (skills) or "N selected" (roles); Cancel / Apply.
- Lists are virtualised only if needed; 900 rows of plain buttons is acceptable in Chromium and avoids a dependency. Revisit if scrolling is visibly slow.

### Composer

Two ghost buttons beside **Attach**: **Roles** and **Skills**, each with a count badge when non-empty. Active items render as chips in a row above the composer bar: role chips use `badge-accent`, skill chips use the default badge. Chips inherited from the workspace show a lock icon and can't be removed from the composer; conversation-level chips have an ×. For a not-yet-created conversation, the selection is held in renderer state and passed to `chatCreate`; afterwards changes go through `chatSelectionSet`.

### Workspace and agent modals

A **Roles** field and a **Skills** field, each a secondary button reading "3 selected" that opens the corresponding picker; chips beneath.

### Code page

No new UI. The Code page already uses `Chat` with the `code` workspace, so the composer buttons appear there and the `code` workspace's own `skillIds`/`roleIds` (set via Workspaces → Configure on the built-in card) are inherited.

### Settings

New tab **Skills & roles**: table of sources (slug, URL, license, commit, count), total role count and group count, and a pointer to `src/skills/LICENSES.md` for the full license texts. Read-only.

## 11. Errors

- Save with unknown id → "Unknown skill/role: {id}". (Renderer only offers catalog ids, so this guards IPC misuse.)
- Budget exceeded → message in §8; the chat's pending message is not created.
- Catalog JSON failing to import is a build failure, not a runtime state.

## 12. Tests

`tests/skills.test.cjs`

- Frontmatter parser: plain `description`, `>` block scalar, `requires` map with list values, missing optional fields.
- Categorizer: one fixture per rule, plus the ordering case (`requesting-code-review` → review).
- Dedupe preference order.
- Ingest against a fixture directory under `tests/fixtures/skills-repo/` (no git, no network): produces expected `catalog.json` entries, fails on duplicate ids, fails on oversize body.
- Prompt assembly: roles before skills; workspace before conversation; dedupe; unknown ids skipped; budget error at 80 001 chars.

`tests/roles.test.cjs`

- `roles.json`: unique ids, every profile contains the four labels in order, no empty group, every id is kebab-case.

`tests/electron-smoke.cjs` (extend)

- Mock provider records request body. Seed a conversation with `skillIds: ['superpowers/brainstorming']` and `roleIds: ['frontend-developer']`; assert the system message contains `<roles>` before `<skills>` and `## Skill: brainstorming`.
- Assert `snapshot().skills.length > 0` and `snapshot().roles.length > 0`.

## 13. Open decisions (resolved)

- Skill id scheme `source/name` — approved.
- SKILL.md-only bundling — approved.
- Authored per-role profiles — approved.
- Integration category shown last — design decision, not raised; change if unwanted.
