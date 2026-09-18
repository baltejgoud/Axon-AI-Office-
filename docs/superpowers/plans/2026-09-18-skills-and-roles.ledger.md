# SDD ledger — plan: docs/superpowers/plans/2026-09-18-skills-and-roles.md

Spec: docs/superpowers/specs/2026-09-18-skills-and-roles-design.md (read; binding authority)
Branch: feature/skills-and-roles (from main @ 9596bf2)
Workspace: .superpowers/sdd/2026-09-18-skills-and-roles/

## Setup rulings

- Ruling: Task 0 (git init + baseline) executed by the controller, not dispatched — it is the precondition for the ledger, briefs and review packages; nothing to review. — costs nothing if wrong (the commit is inspectable).
- Ruling: work on branch `feature/skills-and-roles` in the primary checkout rather than a separate worktree — the repo was created seconds ago with no other activity to isolate from, and a second checkout would need its own `npm install` + Electron binary for the smoke test. — if wrong: the user has uncommitted work interleaved; mitigated by committing per task.
- Ruling: Task 0's `.gitignore` additions applied; `core.autocrlf=false` and a local git identity set so subagent commits work without CRLF churn.

## Pre-flight scan

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1→T2→T3 | `module.exports` of ingest-core.cjs grows each task; T3 consumes parseFrontmatter/flattenRequires/categorize/dedupe | consistent |
| T3→T4 | `buildCatalog(root, slug) → {skills, bodies}` | consistent |
| T4→T7 | catalog.json `{generatedAt, sources, skills}`; bodies.json Record | consistent |
| T5→T7/T14 | roles.json `Role[]`, 196 entries, ids kebab | consistent (196 asserted in T5, T7, T14) |
| T6→T7/T8/T9/T13 | types `Skill/Role/SkillSourceInfo/Selection`; `skillIds/roleIds` required on Conversation/Workspace/Agent; Snapshot fields; PlatformAPI | consistent; T6 step 4 fixes `initialState` + renderer literals |
| T7→T9 | `dedupe`, `rolesBlock(Role[])`, `skillsBlock({name,source,body}[])`, `skillBodies`, `roleProfiles` | consistent |
| T9→T14 | chatCreate 5th arg selection; block markers `## Skill: brainstorming (superpowers)`, `## Frontend Developer` | consistent |
| T10→T11/T12 | `SkillPicker/RolePicker({selected,onApply,onClose})`, `SelectionChips({selection,inherited?,onRemove?})` | consistent |
| T11 | `pendingSelection` added to UIState in same task | consistent |
| T12→T10 | Modal Escape stack change in ui/index.tsx; CatalogPicker uses Modal | compatible |
| T2 self | categorize tests vs KEYWORDS (path excluded from haystack) | consistent, traced each case |
| T3 self | fixture: alpha→review (review precedes engineering), dedupe keeps `skills/alpha`, beta→integration | consistent |
| T7 self | `rolesBlock` array contains a `''` element → produces a 4-newline gap; tests pass either way | cosmetic — see ruling |
| T6–T8 vs Global Constraints | "typecheck must pass at end of every task touching src/" vs T6 step 4 "leave service errors for Task 9" | conflict — see ruling |
| T8 self | test relies on `fs/os/path/Repository` imports | verified present in tests/repository.test.cjs:3-16 |
| T11/T12 self | lucide `Puzzle`, `Bot`, `Lock` | verified exported by lucide-react 1.47 |

- Ruling: Tasks 6, 7, 8 may leave `npm run typecheck` red **only** in `src/main/service.ts` (unimplemented `chatSelectionSet` / snapshot shape); Task 9 must return it to green and run the full gate. The spec's data model is one unit and splitting it across tasks is the plan's choice; merging four tasks into one dispatch would lose per-task review. — if wrong: a mid-plan checkout doesn't typecheck for three commits.
- Ruling: in Task 7 `rolesBlock`, drop the `''` element from the joined array (the `.replace('<roles>\n\n', '<roles>\n')` stays). Test expectations unchanged. — cosmetic.

## Task log
- Ruling: Tasks 1–3 batched into one implementer dispatch (same two files, sequential TDD steps, complete code in plan); reviewed as one unit. — if wrong: one larger review surface.
- Tasks 1–3: minor (deferred): no test for CRLF frontmatter, `|` block scalar, or same-rank dedupe tie-break (ingest-core.cjs:29,92); keyword regex anchors only the left word boundary (`debt`→"debtor") — plan-mandated; hasScripts computed before dedupe (negligible).
- Tasks 1–3: complete (commits 9596bf2..4018f7d, review clean)
- Task 4: review → 2 Important valid (test-driven-development→content; no try/finally temp-dir cleanup, plan-mandated). Ruling: fix both — `'test-driven'` added to workflow keywords is within step 5's mandate; cleanup on failure is cheap and correct. Ruling: reviewer's finding 3 ("fabricated ambiguity note") dismissed — the note was in the controller's dispatch prompt, which the reviewer could not see. — costs nothing if wrong.
- Task 4: minor (deferred): `generatedAt` makes catalog.json non-reproducible byte-for-byte (plan-mandated field).
- Task 4: fix round 1/5 (2 addressed, 0 open — test-driven→workflow; try/finally cleanup; commits d11b7c8..926a0d9)
- Task 4: complete (commits 4018f7d..926a0d9, review clean after 1 fix round)
- Task 5: Ruling: role count is 198, not 196 — the controller miscounted (the plan's own list has 98 dev + 100 management; the two duplicates were dropped from the dev side). The user's list is authoritative: restore `client-success-manager` and `account-success-manager`; change the 196 assertions in tests/roles.test.cjs, the spec §7, and the plan's Task 7 and Task 14 to 198. — if wrong: two extra roles nobody asked for (cost ≈ 0).
- Task 5: minor (deferred): client-success-manager ≈ customer-success-manager (thin daylight); account-success-manager overlaps account-manager artefacts; SRE example is 76 words (brief's own example).
- Task 5: complete (commits 926a0d9..0d0f5c1, review clean; count corrected to 198 per ruling)
- Ruling: Tasks 6–8 batched into one dispatch (types/platform contract, main-process catalogs + prompt assembly, repository migration); distinct files, complete code in plan; reviewed as one unit. Task 9 separate.
- Tasks 6–8: Ruling: spec §6 said "bodies and profiles are never sent to the renderer" but §10 requires the role picker to show the first line of each profile. Amended §6: skill bodies never cross IPC; role profiles do (≈140 KB, our own text). — if wrong: 140 KB extra per snapshot.
- Tasks 6–8: minor (deferred): implementer's Edit tool flipped four files to CRLF (fixed in a28e4a5); consider a `.gitattributes` (`* text=auto eol=lf`) in the final wave.
- Tasks 6–8: complete (commits 0d0f5c1..09a94b4, review clean)
- Task 9: (re-dispatched after a rate-limit abort; no partial work had landed)
- Task 9: minor (deferred): 50-item cap checked before dedupe (plan-mandated).
- Task 9: complete (commits 5805c1e..0e3ac78, review clean; full gate green)
- Task 10: minor (deferred): `sourceOf` splits the id instead of using `Skill.source`; `Item.size` unused; `kb()` floors at 1k; no virtualisation (plan-accepted).
- Task 10: complete (commits 0e3ac78..041b4fa, review clean)
- Ruling: Tasks 11–13 batched into one dispatch (composer, workspace/agent modals, Settings tab — all renderer wiring of the same pickers; 11 and 12 share state and the Modal Escape stack); reviewed as one unit with a manual screenshot check by the controller. — if wrong: one larger review surface.
- Tasks 11–13: review → 1 Important plan-mandated (Modal escape stack keyed on unstable `onClose`; parent re-render while a picker is open reorders the stack). Ruling: fix now — hold `onClose` in a ref and register one stable entry per mount; the plan's effect dependency was the defect. — if wrong: nothing (strictly more robust).
- Tasks 11–13: minor (deferred): Settings `maxWidth: 720` px literal (brief-mandated, matches sibling panel); controller screenshots: default checkbox styling in picker rows looks small; `.project-root` prose renders in mono (pre-existing).
- Tasks 11–13: fix round 1/5 (1 addressed, 0 open — stable Modal escape registration; commits e608a1c..6555a9e)
- Tasks 11–13: complete (commits 041b4fa..6555a9e, review clean after 1 fix round; controller screenshot check passed: picker, chips, inherited locks, nested Escape, Settings tab)
- Task 14: complete (commits 6555a9e..5c417f7, review clean; full gate green)
## All tasks complete → final whole-branch review
- Final review (opus): 1 Critical (nested Modal forms swallow submit → workspace/agent pickers can't Apply), 3 Important (awesome-claude-skills license placeholder; no Service-level selection/composition test; agentImport drops exported selections), 9 Minor.
- Ruling: Important 2 (licensing of awesome-claude-skills, 864 skills with no LICENSE at the recorded commit) is a product/legal decision, not a code fix — surface to the user; the README's "do not distribute" gate stands meanwhile. — if wrong: nothing changes until the user decides.
- Ruling: one fix wave covers Critical 1 (portal + stopPropagation + useId + smoke step), Important 3 (smoke: workspace role inherited + Service unit test), Important 4 (agentImport keeps selections, unknown ids dropped), Minors 5, 6, 8 (updatedAt; Settings copy; memoised items + drop Item.size) and the deferred `.gitattributes`. Remaining minors stay deferred.
- Final fix wave: 7/7 addressed (commits 5c417f7..5d78f3a), scoped re-review clean; controller re-verified nested Apply by screenshot (1 dialog left, new chip present).
- Final gate at 5d78f3a (controller-run): typecheck clean · 34/34 tests · build · SMOKE_PASS (selection + nestedPicker) · format:check clean · working tree clean · 26 commits on feature/skills-and-roles.
- Parked for the user (not code): awesome-claude-skills (864 skills) has no LICENSE at the recorded commit — decide before lifting the README's "do not distribute" gate.
## DONE — plan complete
