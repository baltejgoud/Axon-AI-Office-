# Voice control — staffing brief and decision memo

**Status:** needs your decision before anyone writes code
**Requested by:** PM (voice control for the selected coworker)
**Consulted:** Security Engineer (verified against code). NLP Engineer and Software Architect were
called but returned no usable answer — their sections below are open, not filled in.

---

## 1. The ask

Speak → transcript → the selected coworker acts on it. The mic button already exists in the composer
and currently does nothing but toast "Voice input ready".

## 2. What I verified in the code myself

| # | Finding | Where |
|---|---|---|
| 1 | Mic is **hard-denied**. A blanket `Set` allowlist containing only `clipboard-sanitized-write` feeds both `setPermissionRequestHandler` and `setPermissionCheckHandler`. `getUserMedia` can never succeed. | `src/main/index.ts:88-91` |
| 2 | **Any STT model is excluded by design.** `NOT_CHAT` regex matches `whisper|audio|speech|transcri|asr|paraformer|sambert|cosyvoice|realtime|…`, and `chooseModels()` filters every model a key offers through it. A key that *can* transcribe still gets assigned chat models, and the speech capability is invisible. | `src/renderer/src/settings/modelChoice.ts:41-42` |
| 3 | **Zero audio infrastructure exists.** `getUserMedia` has no call sites anywhere in the repo. Nothing to reuse. | repo-wide search |
| 4 | Mic button is designed as a placeholder (`aria-label="Voice input"`, toasts only) and was scoped out of the shell work as a later sub-project. | `docs/superpowers/specs/2026-09-21-look-and-shell-design.md:6,57` |
| 5 | The audit log records tool / actor / decision / result / detail. It has **no field for where the instruction came from**, and deliberately stores no prompt text. | `src/main/audit/log.ts` |

## 3. Security Engineer's assessment (verified, not opinion)

**3.1 The minimum defensible change to the allowlist.** Not "add `media` to the Set". Replace the
static Set with a **predicate** returning true for `media`/`audioCapture` only when all of:
- an explicit persisted voice setting is on;
- a single-use, short-TTL capture token exists, minted by a deliberate in-app action;
- `requestingOrigin` matches our own app URL;
- `contents` is the main window's main frame.

Both handlers must share the predicate. If `setPermissionCheckHandler` returns true unconditionally it
pre-grants for the whole process lifetime — no prompt, no revocation. Plus a visible recording
indicator and a hard stop on blur / quit / settings-toggle. If STT is cloud-based that is a **data
egress** decision needing its own opt-in.

**3.2 Audio is an unauthenticated input channel.** This is the real finding, and it is sharper than
accuracy. A typed instruction is executable because the person at the keyboard typed it. A spoken
one is not — anyone in the room, a video call, or a speaker can produce an instruction that is
indistinguishable from the user. Whisper hallucination is a quality problem; this is an
authentication problem. Consequences for a voice-originated run:
- approvals are never satisfiable by voice (no "yes", no "always allow" from audio);
- `sessionGrants` start empty and are **not** inherited from prior typed sessions (the gate at
  `permissions.ts:74`);
- `run_command`, `start_process`, `git push`, connector sends, MCP writes, `~/.ssh` / `.aws` / `.env`
  pinned to `ask`, with no session-grant path;
- transcript echoed back for **typed** confirmation before the first privileged call.

VAD, greedy decoding, dropping low-confidence segments are hygiene, not the control.

**3.3 `origin: 'voice'` alone is not enough.** Origin must propagate to every derived audit entry
**including sub-agents** — the label dying at first delegation is exactly where privilege grows
(`service.ts:1274`). Minimum fields: `origin` on every entry; `turnId`/`messageId` to join back to
the stored transcript; ASR model; `noSpeechProb`/confidence; whether typed confirmation followed.
Without the turn id you cannot answer "what was actually heard" afterwards. Without confidence you
cannot distinguish a hallucinated instruction from a real one — the first question an incident
review asks.

**3.4 On the existing blockers: additive, and it does not move them.** Voice adds a consent surface,
an unauthenticated input channel into a privileged executor, and possibly a new egress. It also
makes two current blockers worse — "no encryption at rest" now covers transcripts and voice
provenance, and "parsers process-isolated but not OS-sandboxed" now has a speech process attached.
**Recommendation: do the security review first, with the mic path in scope.** The code work can be
prepared in parallel, but the *ship* decision should not precede the review.

## 4. Team needed

| Role | Why | Status |
|---|---|---|
| **Security Engineer** | Consent model, untrusted-input tier, audit provenance | ✅ consulted, findings above |
| **NLP Engineer** | STT approach: cloud-via-user-key vs bundled local model vs OS-native; the `modelChoice.ts` change | ⬜ asked, no answer returned |
| **Software Architect** | Placement (renderer / main / parse-worker precedent), streaming vs push-to-talk, task sizing | ⬜ asked, no answer returned |
| **Designer** | Recording-state affordance, push-to-talk vs hands-free, transcript confirmation surface | ⬜ not yet engaged |
| **Product Manager** (me) | Scope, sequencing against the security-review blocker | ✅ this memo |

I have three questions per task against the team, so the NLP and architecture views are the next
round. I am not going to guess at their fields.

## 5. Decisions only you can make

1. **Does this ship before the security review?** My recommendation: no. It can be *built* in
   parallel and be ready to go the moment the review lands, but the mic path widens the threat model
   the review is meant to cover, and shipping it first means shipping an unreviewed consent surface
   and an unauthenticated input channel into a privileged executor.
2. **Where does the audio go?** Cloud STT (sends audio off-device — a direct contradiction of
   "local-first" as currently marketed), bundled local model (install size, download, CPU), or OS
   dictation. This is a positioning decision, not just an engineering one, and it should not be made
   inside a code review.
3. **Is this scoped at all this cycle?** I want to say the uncomfortable thing: v0.2.0 has zero
   users, zero distribution, and no evidence any shipped surface earns its place. Voice would be the
   fifth unvalidated surface. I am not blocking it — you are the decision maker — but "it is a
   compelling demo" is currently the only argument in its favour, and I have no evidence that is the
   right bet. Your call.
4. **Who is the target user?** Typing a task to a coworker is not slow. Voice wins when the user is
   hands-busy or driving the 3D view, or when the task is long prose. I do not know which of these is
   real, and that changes the design substantially.

## 6. Smallest genuinely testable slice

Assuming you clear decision 1:

**Slice A — provenance only, no mic.** Add `origin` to the audit log and thread it through the
existing typed path (`'typed'`), including sub-agents. No user-facing change, no permission change,
no new dependency. It is the part of this feature that is unambiguously good, it directly closes part
of the instrumentation gap I have on record, and it means when voice does land, the audit trail is
already shaped for it. It can be built now and needs no decision from you.

**Slice B — OS dictation, honestly labelled.** Make the composer reliably focusable so Win+H /
macOS dictation types into it. Costs almost nothing. It is not a cop-out if we call it what it is —
it is a deliberate thin first slice. It is a cop-out if we ship it and claim voice control.

**Slice C — real mic capture.** Requires decisions 1 and 2 plus the NLP and architecture answers.
This is the one that needs the Security Engineer's predicate, the confirmation-before-privilege
behaviour, and ASR confidence in the audit trail.

## 7. Open, unanswered

- Which STT path, and what does it do to the `modelChoice.ts` exclusion without regressing the
  existing auto-selection tests? (NLP Engineer — pending)
- Renderer vs main-process capture, and streaming vs push-to-talk cost. (Software Architect — pending)
- What the recording and confirmation surfaces should look like. (Designer — not engaged)
