# Axon — PM working notes

## What Axon is
Electron desktop app, local-first, v0.2.0. One screen: a 3D isometric office holding 207 "coworkers"
(198 bundled job roles + core team). You click a person, give them a task, they work in your files.
Beyond the office: 39 MCP connectors, Knowledge/Library (pdf/docx/xlsx parsing + lexical retrieval),
Planner/tasks, Skills catalog + ingest, MCP, audit log, git tools, reminders, tray.

## Evidence base I actually have (v0.2.0, branch feat/transparency)
Verified in code:
- `src/main/audit/log.ts` — AuditLog, append-only `audit.jsonl`, 20k entries kept, 25k compact.
  Records tool, actor, decision (allowed/denied/skipped), result ok|error, detail.
  Records: file tools, git, shell, notes, schedules, controlchip sub-agents, **connector tool calls via
  the generic execute path** (service.ts:1239-1249).
- `src/main/infra/vault.ts` — OS-protected credentials.
- `README.md:73` — "**Do not publicly distribute this build yet.**" test-signed only, no security
  review, parsers process-isolated but not OS-sandboxed, no encryption at rest.
- `sendCrashDiagnostics` exists in `Settings.tsx` and `repository.ts`.
- Zero analytics vendors (no posthog/mixpanel/segment/amplitude) anywhere in the repo.
- `README.md:78` — "Nothing runs on a schedule: agents only work when you ask."
- Renderer is fully sandboxed: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.

## The central problem
**Zero user research, zero customer data, zero instrumentation, zero distribution.** No users ⇒ no
adoption data ⇒ no evidence any shipped surface earns its place. As PM I cannot distinguish
"connects to Notion" vs "connects to Salesforce" as a bet vs. solved problem.

## My position (v0.2.0)
- The engineering is well above what the product practice can support. Eng is shipping on a
  transparency branch, shipping release gates honestly in the README, release blockers written down.
- Engineering quality ≠ product validation. Eng quality does not license a roadmap.
- Success has been declared at shipping, not at adoption. Success is currently "it exists and it
  works on my machine" — that is a QA bar, not a product bar.
- The 3D office is the differentiation bet. Unvalidated. No evidence users prefer it to a list.
  A toggle to a 2D list is the cheapest test of that bet and the single highest-value experiment.
- The 198-role catalog and 39 connectors are demo-shaped scope decisions. Impressive in a screenshot,
  no evidence any of them get used.
- Roadmap item 1 (code signing + sandbox + security review) is the only item that unblocks every
  possible customer at once. Feature work should not outrun it.
- **2026-02-19: added the fourth unvalidated-surface objection.** Voice control would be the *fourth*
  or fifth demo-shaped surface on top of an app with zero users. I did not block it (user is the
  decision maker) but I recorded that "it's a compelling demo" is currently its only argument.

## Voice control — the engagement so far
Brief written to `docs/voice-control-brief.md`. User asked to "gather a team" to build voice control
for the selected coworker (speak → transcript → prompt to selected agent).

Verified in code myself:
- Mic is **hard-denied**: `src/main/index.ts:88-91`, blanket `Set(['clipboard-sanitized-write'])` feeding
  both `setPermissionRequestHandler` and `setPermissionCheckHandler`. `getUserMedia` can never succeed.
- **Any STT model is excluded by design**: `modelChoice.ts:41-42` `NOT_CHAT` regex matches
  `whisper|audio|speech|transcri|asr|paraformer|sambert|cosyvoice|realtime|…`, and `chooseModels()`
  filters every model a key offers through it. A key that can transcribe still gets chat models.
- **Zero audio infrastructure exists** — `getUserMedia` has no call sites anywhere.
- Mic button is a designed placeholder (`aria-label="Voice input"`, toasts only), scoped out of the
  shell work as a later sub-project.
- Audit log has no field for where an instruction came from, and stores no prompt text.

Security Engineer (verified against code — did NOT re-read the files, so her/his claims below are
reported as given, not re-verified by me):
- Replace the static Set with a **predicate**: `media`/`audioCapture` only when (a) persisted voice
  setting on, (b) single-use short-TTL capture token from a deliberate action, (c) `requestingOrigin`
  matches our app URL, (d) contents is main frame. Both handlers share it. Unconditional check-handler
  = process-lifetime pre-grant, no revocation.
- **The core finding: audio is an unauthenticated input channel.** Not a hallucination problem — an
  *authentication* problem. Anyone in the room / a video call / a speaker can produce an instruction
  indistinguishable from the user. A typed instruction is executable because the person at the
  keyboard typed it. So for voice-originated runs: approvals never satisfiable by voice; `sessionGrants`
  start empty and are not inherited from typed sessions (gate at `permissions.ts:74`); `run_command`,
  `start_process`, `git push`, connector sends, MCP writes, `~/.ssh`/`.aws`/`.env` pinned to `ask` with
  no session-grant path; **typed** confirmation before the first privileged call.
- `origin: 'voice'` alone insufficient — must propagate to sub-agents too (`service.ts:1274`), plus
  `turnId`/`messageId`, ASR model, `noSpeechProb`/confidence, typed-confirmation flag. The log stores
  no prompt text so the turn id is the only join back to what was actually heard.
- On blockers: **additive, does not move them.** Makes "no encryption at rest" cover transcripts, and
  "parsers process-isolated but not OS-sandboxed" now has a speech process attached. Recommends the
  security review first, mic path in scope.

Unanswered (3-questions-per-task limit hit; do not fabricate their input):
- NLP Engineer: STT path (cloud-via-user-key vs bundled local vs OS-native) + the `modelChoice.ts`
  change + renderer vs main capture + streaming vs push-to-talk. Returned a tool-trace, no answer.
- Software Architect: placement (renderer/main/parse-worker precedent), renderer vs main capture,
  OS-dictation-as-first-version honesty, task sizing.
- Designer: recording-state affordance, push-to-talk vs hands-free, transcript confirmation surface.

## Disagreements I am recording rather than resolving silently
- CS Manager: push instrument-first (opt-in local telemetry + export). My position: if active users
  < ~20, aggregate telemetry has no statistical floor and interviews beat it outright. Below that
  threshold, interviews first.
- CS Manager vs. me: instrumentation gap. Connectors/git/shell are instrumented via audit log;
  Knowledge/Planner/Skills are UI-only and produce **zero audit entries**. So "no data on Knowledge"
  is not evidence of disuse — it is evidence I cannot see. Absence of signal must not silently
  become low priority. This is the exact failure mode I'm trying to avoid, except it would run
  against my own bias, favouring whatever was already shipped.
- Designer: did not return a usable answer (call aborted mid-tool-call). 3D bet unopposed but
  unvalidated. toggle-to-list experiment remains my recommendation.
- Security Engineer vs. me: pushed back that voice is "just another input method". I hold that
  unauthenticated-input status is a distinct trust tier from typed text and justifies its own gate.
  Recorded, not resolved.
- Security Engineer vs. me: recommended review-first. I accept this. Note the tension with my own
  "feature work should not outrun it" line — that line was about *shipping* order, and the review
  is already the blocker, so it is consistent. The mic path needs to be **in scope** for the review.
