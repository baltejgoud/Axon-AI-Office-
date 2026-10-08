# Office-first interface

The office remains mounted at full window size. Conversation and work surfaces float over it; resizing a work sheet never resizes the canvas.

## Contextual controls

- **Today card** reuses the planner's add, complete, rename and reschedule operations. It folds when empty, can be collapsed manually, and hides while a conversation drawer is open. Its full-planner link opens the receptionist's planner tab.
- **Ask Axon / Ctrl+K** opens a keyboard-accessible palette for people, specialties, departments and office actions. Free-form requests become a receptionist draft for the user to review and send.
- **Approval cards** summarize pending requests across conversations, including line-change counts and command previews. Review selects the requesting thread and opens the correct work step. Approve and Reject use the existing approval decision path.
- **Context chip** shows the selected conversation's project and current context usage in the drawer header. Detailed context and cost controls remain in the composer.

## Spatial behavior

HTML labels follow district signs and department boards and show catalog headcounts. They change by zoom tier and avoid floating UI. Collaboration links share one Three.js line layer and follow both moving coworkers until the consultation ends.

Coworker cards choose the nearest available position around their scene anchor, flip below near the top, and avoid navigation, planner, dock, drawer, work and approval panels. If a window has no room for a card, selection opens the conversation drawer directly.

New completion and error events produce dismissible notification cards; existing activity history is not replayed. Notifications step aside while approvals or work use their space and become available again afterward.

The work sheet's Expand control enters fullscreen review. Escape restores its previous size. Further Escape presses close the coworker card or conversation drawer, while menus, editors and dialogs handle Escape first. Shortcuts handled by the command palette cannot approve a background tool.

## Task lifecycle and saved results

Run badges share the same labels in coworker cards, conversations, work sheets and activity history: Queued, Working, Needs you, Completed, with explicit dependency waits, blockers, failures and interruptions. Actions lead to the appropriate review or conversation; they never send or resume a task automatically.

**Activity & results** in the team status card, or **Open activity history** in the command palette, opens a searchable list of persisted runs. Filters show active work, requests needing attention and completed results. Selecting a result opens its exact conversation, including its tool summaries and decisions. Results remain available after notifications are dismissed and after reopening the app. History uses existing run storage, with no additional renderer cache.

Approvals show one request at a time, with a selector when several are waiting. Notifications show one update by default and can expand as a group; the latest 20 are retained during the session. History preserves older run results. The planner folds while work or approvals need space and hides while a coworker card or history is open. Explicitly opening the planner expands it again.

Coworker cards include specialty, task or latest result, status and a relevant next action. The directory supports Up/Down and Enter; the team dock supports Left/Right and Home/End. Visible focus outlines and the existing team roster provide navigation without using the 3D scene. History and palette shortcuts cannot approve a background request.

## Verification

Build and typecheck:

```powershell
npm run typecheck
npm run build
npm test
```

Desktop checks use isolated profiles and loopback provider fixtures:

```powershell
npx electron tests/office-first.cjs
npx electron tests/office-first.cjs dark 900x700
npx electron tests/activity-panel.cjs
npx electron tests/office-split.cjs
npx electron tests/office-desktop.cjs
```

Run builds before visual tests, and run visual tests individually so asset reloads and GPU contention do not affect their results. Screenshots are saved under `test-results`.
