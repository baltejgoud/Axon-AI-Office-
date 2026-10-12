# Axon interrupted UI wave — 12 October 2026

Implementation is on `feat/improvements` in `D:\Baltej IDE\.claude\worktrees\improvements`. The original `imp-asks`, `imp-files`, `imp-composer` and `imp-team` worktrees were preserved. The separate team-chat work was not integrated.

## Completed behavior

- `ask_user` pauses a chat until a choice, typed answer, skip or Stop. Team-member tasks do not receive this tool. The office, thread and notification bell distinguish questions from requests to approve work.
- Approval cards show what each tool could affect. Approve all and Reject all decide existing steps individually, exclude questions and create no task/session grants. The office overlay also supports steps pending across conversations.
- The bell lists questions, approvals, finished/failed tasks and team plans/reports. Its read state survives reloads; clicking a notice opens the associated conversation.
- Delete and move operate only on supported individual project files. They refuse traversal, .git, junction/symlink paths, folders and overwrite targets. Grants cover the exact file operation. Undo records are saved before mutation; a failed save leaves the file untouched. Undo and Undo all restore deletions and reverse moves.
- Typing `@` opens colleague search; `/` opens built-in and saved prompts. Arrow keys, Enter, Tab, Escape and pointer selection work without sending a message on selection. Completed mentions do not reopen an empty popup as you continue typing.
- Shortcuts persist in settings, with rename, edit and delete controls. Main validates 30 prompts, 40-character names, 4,000-character text and unique names. Old settings migrate to an empty list.
- Mentions add catalog-based hidden consultation instructions on send/queue. Edit-and-resend recomputes the instructions and retains attachment/file context. Display, recall and transcript rendering strip the hidden block.
- Closing offers produce up to three follow-up chips without a model call. Click sends; Shift+click prefills. Active, streaming, failed and incomplete replies show none. Code blocks and list items are ignored.
- Recovered per-coworker drafts and Up/Down recall stay outside the office store's per-keystroke updates.

## Verification

Final TypeScript and production build pass. The full unit suite passes **932/932** tests. The targeted questions/file-operations/composer suite passes **57/57**, and the composer/retry-edit suite passes **27/27**. The Electron harness passes in light and dark mode, including draft switching and restoration. No live account or paid model was used.

Commands run from this worktree:

```powershell
npm run typecheck
npm test
npm run build
node --test tests/file-ops.test.cjs tests/asks.test.cjs tests/composer-menu.test.cjs
node --test tests/composer-menu.test.cjs tests/retry-edit.test.cjs
npx electron tests/wave2-desktop.cjs
npx electron tests/wave2-desktop.cjs dark
git diff --check
```

The new desktop harness uses an isolated application profile and a loopback model. It checks keyboard menu insertion, saved shortcuts, recall, draft separation/restoration, hidden mention context, Shift+click follow-ups, the question card, the bell, answering/resuming a run and shortcut settings. Screenshots are under `test-results/wave2`, with light/dark variants. The provider checks establish request/response wiring, not live-provider adherence to consultation instructions.

Logs: `test-results-wave2-unit.log`, `test-results-wave2-build.log`, `test-results-wave2-targeted.log`, `test-results-wave2-rewrite.log`, and `test-results-wave2-desktop-{light,dark}.log`.
