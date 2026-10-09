# Axon UI completion — 9 October 2026

Work stayed in `D:\Baltej IDE\.claude\worktrees\ui-improvements` on `feat/ui-improvements`. The existing changes were checkpointed first as `c2d1216` (`feat(ui): stopped-early runs, reading view, dockable panel, model picker, map and settings fixes`). The completion commit is `feat(ui): finish office markers, reply navigation and results shelf`.

## Item 18: district markers

`scene/people/CrowdRenderer.ts` owns one instanced mesh of 12-segment floor rings, coloured from each `OFFICE_AGENTS` entry's district. `scene/OfficeScene.ts` updates walking and seated full-character markers in the same pass as character movement. Returning to the crowd restores the desk position. Rings cast and receive no shadows, and their depth offset keeps them visible above rugs. `scene/agents/OfficeAgentCharacter.ts` reduces the existing selection ring to 12 segments.

There are 213 markers, at 24 triangles each: **5,112 added triangles**, one draw call, about **0.21%** of the initial overview. The selection-ring change also removes 88 triangles per visible selected/hovered selection ring. `tests/office-people.test.cjs` checks district colour, geometry cost, no shadows, and position/visibility across both rendering tiers.

The initial live overview recorded **2,461,664 triangles**, 11 full characters and 202 crowd characters. The final overview recorded **2,405,772 triangles**, 6 full characters and 207 crowd characters. These live totals vary with simulation state and are not evidence of a geometry reduction. The nominal 2.3M overview ceiling was already exceeded; the existing harness checks a 10% margin (2.53M).

Windows reported `PowerLineStatus = Offline` before and after these runs. The final battery readings were **52 FPS** for the initial overview and **38 FPS** at 1920×1080 (2,526,936 triangles, 15 full characters and 198 crowd characters). **Mains-power FPS remains unverified**; these battery readings are not used as a performance comparison. Re-run `npx electron tests/office-desktop.cjs` on mains power for the requested FPS check.

Screenshots: `test-results/office/a-1920-engineering.png`, `test-results/office/a-1920-campus.png`; seated markers are also visible in `test-results/office-first/result-shelf-1536x816-light.png`.

## Item 2: long-thread navigation

`activity/ActivityPanel.tsx` makes the chat's actual Virtuoso scroll parent focusable after clicking thread text. Page Up/Down, Home/End, Space and Shift+Space scroll that viewport. Interactive controls keep their own keys. `shell/shell.css` reserves focus outlines for keyboard use.

`activity/Conversation.tsx` reuses `sections()` for a compact Reply sections navigator next to Latest messages. A heading selection first mounts the correct virtualized reply, then aligns its heading in the scroll viewport. `chat/MessageView.tsx` supplies message identifiers and the same heading IDs as the reading view.

`tests/reading-desktop.cjs` targets the visible scroll viewport rather than an offscreen message. Each of three wheel ticks moved **120 px**, with an assertion of at least 80 px per tick. The harness also checks keyboard movement and heading navigation.

Screenshots in light and dark: `test-results/reading/12-reply-navigator-1536x816-<theme>.png`, `2-long-reply-top-1536x816-<theme>.png`, `3-reading-view-1536x816-<theme>.png`.

## Item 17: labels around faces

`scene/OfficeScene.ts` treats nearby projected head locations as obstacles, tries additional vertical placements, and hides ordinary tags that cannot fit. The selected tag stays visible. `shell/SceneLabels.tsx` keeps the selected tag mounted during camera travel, fixing the race behind the flaky specialist-tag wait. `tests/office-desktop.cjs` now waits for the exact role and fitting tag together.

Screenshots: `test-results/office/tag-distributed.png`, `tag-organizational.png`, `b-team-list.png`.

## Section F / I: colleagues and results

`shell/GlobalWork.tsx` exposes Multi Agents in the office rail while any run or team is active, including when the rail is folded. It opens the corresponding work without moving the camera.

`ColleagueSummary.tsx` supplies portrait, role, lifecycle status, model chip and last-reply preview. `OfficeDirectory.tsx`, `OfficeCanvas.tsx` and `activity/MultiAgents.tsx` reuse it in search, map popovers and task graphs.

Activity & results now loads the final assistant reply within each finished run's timestamps from the complete paginated history. It provides Open conversation, Read result, Copy and Save as file through `window.axon.documentSave`. Removed conversations stay unavailable. No connector handoff was added.

`tests/office-first.cjs` checks an archived result's preview, exact reader content, full Copy payload and the actual saved Markdown file. The OS clipboard boundary is shimmed because the test window stays offscreen; native interactive clipboard access remains outside this automated check. `tests/team-desktop.cjs` checks the office-rail entry and the three planned tasks' shared cards.

Screenshots: `test-results/office-first/result-shelf-1536x816-<theme>.png`, `test-results/team/2b-multi-agents.png` and `2b-multi-agents-dark.png`.

## Item 30 and remaining desktop checks

`tests/reading-desktop.cjs` uses a loopback provider to create a real pending file-write approval. It checks the in-thread card and task grant action, Ctrl+Enter outside fields, no approval while typing, and the resulting file on disk.

Screenshot review found that the shared diff viewer inherited `contain: strict` from the work surface and collapsed inside the approval card. `layout.css` retains layout/paint/style containment there while allowing row content to determine height. The harness asserts the proposed file content is visible, not just that a card exists.

`tests/service.test.cjs` confirms a second write in the same run needs no further approval after Allow for this task, and a new run asks again before writing.

`tests/office-desktop.cjs` checks the board hover label, unchanged camera target after a board click, and no horizontal overflow in Team tasks. Its main window defaults to 1536×816; existing responsive and 1080p probes remain. `tests/team-desktop.cjs` supports dark-theme fixtures and preserves separate screenshots.

Approval screenshots: `test-results/reading/11-in-thread-approval-1536x816-<theme>.png`. Team tasks: `test-results/office/b-team-list.png`. Work-surface screenshots: `test-results/office-split/`.

## Validation commands

```powershell
npx tsc --noEmit -p .
npm test
npx electron-vite build
npx electron tests/reading-desktop.cjs 1536x816
npx electron tests/reading-desktop.cjs 1536x816 dark
npx electron tests/activity-panel.cjs 1536x816
npx electron tests/activity-panel.cjs 1536x816 dark
npx electron tests/office-first.cjs 1536x816
npx electron tests/office-first.cjs 1536x816 dark
npx electron tests/office-split.cjs 1536x816
npx electron tests/office-split.cjs 1536x816 dark
npx electron tests/office-desktop.cjs
npx electron tests/team-desktop.cjs
npx electron tests/team-desktop.cjs dark
git diff --check
```

TypeScript and the production build pass. The unit suite has **685 passing tests** (683 existing plus the service grant test and marker handoff test). Reading, activity panel, results shelf, work surface and team desktop checks pass in both themes. The full office harness passes, including its dark-theme probes, responsive sizes, specialist tags and team-board checks. Desktop logs are in `test-results-*.log` in this worktree, and screenshots are under `test-results/`. No `npm run dev` session was launched, and no dependencies or assets were added. The work-surface harness starts and stops its own loopback fixture server.

## Item 26: live ChatGPT-plan check for the user

The checkpoint's `main/providers.ts` change retains streamed Responses items when a completed event carries an empty output array. `tests/responses.test.cjs` covers streamed tool calls in that case, both with and without a text preamble. No sign-in or stored credential was used for verification here.

To check the live account yourself:

1. Open a small project containing a `README.md`. If no ChatGPT-plan account is configured, leave this check pending until you choose to configure one.
2. Open Research Analyst, start a fresh conversation, and select **GPT-6.1-Sol** from the ChatGPT-plan account.
3. Send: **“Use the project file tools to list the files, read README.md, and summarize the project in three bullets. Name the file you inspected. Do not answer from memory.”**
4. Expect visible file-tool calls followed by a substantive final answer referring to README.md. There should be no “Provider returned no response” / unsupported-parameters error and no false Completed state with only a preamble.

The live account check and mains-power FPS comparison are the two remaining external checks.
