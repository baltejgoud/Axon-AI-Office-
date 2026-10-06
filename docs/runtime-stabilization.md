# Axon runtime stabilization implementation

This pass implements an authoritative execution layer and connects the desktop UI to it. It is substantial working code, but **the entire requested definition of done is not yet satisfied**. The limitations below are part of the delivery, not claims of implemented features.

## 1. Root causes

- Execution ownership was fragmented between conversation controllers, team tasks, consultations, approvals, and shell processes. Stop could launch a queued message immediately afterward.
- Commands used a separate subprocess/log architecture while the interface looked like a terminal. Windows shell assumptions were inconsistent.
- Renderer working indicators could outlive execution. Team seating omitted a lead coordinating a meeting.
- Tool payloads and chat histories were rendered directly; there was no unified operational view.
- Project changes could change the tools' target while an earlier operation waited for approval.
- Voice capture used larger chunks and offered no retry of already captured audio.

## 2–3. Architecture and major source files

- `src/main/runtime/supervisor.ts`: persisted runs, parent/children, state transitions, cancellation, restart recovery, and coworker execution lanes.
- `src/main/runtime/messages.ts`: typed colleague requests, responses and handoffs with unresolved duplicate detection.
- `src/main/runtime/providers.ts`: per-provider concurrency queues, abortable waits, model failure cache, readable errors.
- `src/main/runtime/terminal.ts`: one PTY service for commands, background processes and interactive human shells.
- `src/main/service.ts`: connects these components to chat, teams, consultations, approvals, project closing, streams, and tool execution.
- `src/main/team/runner.ts`, `plan.ts`, `tools.ts`: configurable team concurrency and explicit model profiles, retained dependency scheduler, late-cancellation safeguards.
- `src/main/tools/registry.ts`, `processes.ts`: agent commands and background jobs use the shared terminal service.
- `src/shared/runtime.ts`, `runtimePresentation.ts`, `platform.ts`, `types.ts`: shared records, readable presentation and IPC contracts.
- `src/main/repository.ts`, `src/main/index.ts`, `src/preload/index.ts`: additive persistence and restricted IPC exposure.
- `MultiAgents.tsx`, `LiveTerminal.tsx`, `GlobalWork.tsx` under `src/renderer/src/features/office/`: operational view, real terminal and global navigation.
- `OfficePage.tsx`, `OfficeCanvas.tsx`, `ActivityPanel.tsx`, `Conversation.tsx`, `officeStore.ts`: execution-backed office state and virtualized chat.
- `src/renderer/src/chat/useDictation.ts`, `DictationButton.tsx`, `AgentComposer.tsx`: recording feedback, resource release, cancellation and captured-audio retry.
- `src/renderer/src/Settings.tsx`, `src/renderer/src/ui/ApprovalCard.tsx`: concurrency/profile controls and collapsed large approval commands.
- `package.json`, lockfile: node-pty, xterm and virtualization dependencies; native PTY unpacking for packaging.

Pre-existing provider credit-retry and ModelPicker work was preserved. Local collaboration/hardening branches were inspected; the current team implementation was extended rather than replaced wholesale.

## 4. Data compatibility

Repository state remains backward compatible with platform version 1. Additive `runtimeVersion: 1`, `runs` and `agentMessages` fields default to empty arrays for old files. New settings are optional and default conservatively. Existing conversations, providers, audit records and trusted folders remain intact. Previously active runs become interrupted at startup. Terminal output is bounded, in-memory session history rather than a new persistent database.

## 5–6. Updates and Multi Agents

The Updates tab becomes Multi Agents. It exposes team goal, lead, actual status, task progress, active/waiting/attention counts, Stop and eligible Resume actions. Task cards show owner, dependencies, current action, result, planned files and conversation navigation. Communication shows human-readable sender → recipient requests and responses. Timeline translates audit entries into readable sentences, retains expandable technical detail, and integrates earlier session updates.

The task graph is currently a dependency-card view. A global work indicator opens the relevant coworker and Multi Agents view. Office status derives from live runs, including meeting participants. Long conversations and the audit timeline use virtualization.

## 7. Terminal execution

Both agent commands and background processes use node-pty. Human shells persist; agent commands get individually owned PTY sessions with structured results. Windows prefers pwsh, then Windows PowerShell, then cmd. Unix uses the configured shell with platform fallback. Agent context includes platform, architecture, shell, project root, launch cwd and PATH executable availability.

xterm displays ANSI output with interactive stdin, resize, Ctrl+C, kill, copy, clear, search and session selection. A new user terminal can be opened after exit. Output streams in bounded batches without full platform-state refresh. Command results contain exit code, signal, duration, cwd, shell and session ID. PTYs merge stdout/stderr; the result's stderr field is empty rather than pretending the streams are distinguishable.

Agent launch cwd is canonicalized and checked against project boundaries, including junctions. Existing approval, audit and file safeguards remain. An approved run captures its project so a later global project switch cannot redirect its writes. This is launch-directory enforcement, not an OS sandbox for arbitrary approved shell code.

## 8. Cancellation

Runs own linked controllers and children. Cancellation traverses descendants even if a parent already finished. It aborts provider streams and queued waits, withdraws pending approvals, cancels messages, terminates owned terminals/background processes and prevents late completion from overwriting canceled state. Stop discards queued chat messages. Conversation/project close offers Stop work & close as the default, background work, and Cancel. Background conversation records are retained so work remains inspectable. Shutdown stops terminal sessions; persisted unfinished work is interrupted on restart.

## 9. Agent communication

Existing read-only consultations and team handoffs now create persisted structured bus records, including sender, recipient, run, purpose, content, response relationship and status. Replies resolve requests. Duplicate unresolved consultations and self requests are rejected. Existing no-nested consultation/subagent restrictions prevent recursive delegation. Team scheduling continues to enforce assignment dependencies and passes concise predecessor results.

## 10. Providers

Requests queue behind a configurable per-provider limit, default two. Coworker lanes serialize the same agent across conversations. Team concurrency is configurable. Cancellation releases queued work. Invalid model responses cache model unavailability until provider configuration changes. Explicit fast/standard/deep/coding profiles can select worker models; no silent fallback is introduced.

402 errors produce a credit-recovery explanation. Optional auto-fit reduces the token limit once when the provider reports an affordable amount, only before any output has streamed. It does not retry indefinitely or replay partial output. Existing bounded in-flight provider credit retry remains preserved.

## 11. Voice

Recording phase appears before microphone initialization. Capture uses mono 24 kbps audio and 100 ms chunks, with a two-minute bound. Cancel tears down recording or transcription and ignores late results. Failures release resources. Captured audio can be retried without recording again. Existing keyboard controls and insertion selection are retained. Debug timings cover capture initialization, encoding and provider latency. These changes improve feedback and payload size; no real-provider latency benchmark is claimed.

## 12–13. Validation

Added `tests/runtime.test.cjs`, `runtime-service.test.cjs`, `voice-runtime.test.cjs`, and `runtime-desktop.cjs`. They cover parent cancellation, restart, lane serialization, approval withdrawal, project/conversation closing, project-switch isolation, provider queues/errors, message delivery/handoff/duplicates, Windows PTY execution/cancellation/boundaries, voice lifecycle/insertion/retry, readable timeline and desktop terminal rendering.

Existing tests were updated where their old expectations contradicted the new Stop behavior or actual native shell. Desktop smoke selectors and role counts were corrected for the current application. Team desktop validation caught and fixed missing lead seating.

Verification logs are in `test-results/stabilization-*.log`. Final verification: 601/601 unit tests pass, typecheck passes, production build passes, runtime desktop smoke passes, general desktop smoke passes, and team desktop passes. The tests use controlled model responses and do not establish success of the full authentication repair scenario against a live paid provider.

## 14. Remaining limitations

- Windows node-pty's console-list helper can emit `AttachConsole failed` during cleanup after an exited shell. PTY tests terminate and desktop session state reaches ended; this native diagnostic is unresolved.
- Agent commands do not share persistent shell environment across calls. Displayed cwd is launch cwd and does not track a human's subsequent `cd`. Explicit shell/interactive command selection and a dedicated Restart button remain incomplete.
- Communication is an event list, without clickable graph edges or 3D connection overlays. Office poses are driven by active runs but do not provide every requested distinct animation.
- No automatic stalled-run detector, generalized arbitrary-depth delegation/cycle engine, or full artifact ownership/test-count aggregation exists. Assignment dependencies are enforced by the team scheduler; supervisor dependency records are not fully populated from all team tasks.
- No full-machine agent permission tier or additional-folder terminal expansion was added. Existing trusted-folder behavior is retained. Arbitrary approved shell code requires human judgment as before.
- No capability-aware remote model preflight or user-selected fallback workflow beyond profiles and provider/model switching was added.
- Voice remains request-based transcription, without streaming interim text or VAD.
- Timeline retains a bounded recent audit window. Complete audit history remains in the existing audit system. Run/message persistence is not yet aggressively compacted.
- Completion uses existing team reports and task results, without a complete structured changed-files/tests/security/QA summary dashboard.
- Packaging metadata is configured, but an installed distributable and macOS/Linux PTY operation have not been verified.

## 15. UI evidence

Desktop captures: `test-results/multi-agents.png`, `runtime-timeline.png`, `live-terminal.png`. Existing team captures under `test-results/team/` show room occupancy, plan, completion and owner navigation. Screenshots reflect the controlled test scenario and the final office-theme styling.

