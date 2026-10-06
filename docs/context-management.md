# Context management implementation

The provider gateway compiles a working request on every call, including tool continuations, worker consultations and team planning. Durable chat messages are not deleted by compilation.

## Components

- `src/main/context.ts`: model-aware admission, output/safety reserves, priority sections, recent turns, typed checkpoints, canonical fact provenance and correction overlays, completed tool-round compaction, bounded payload representations, conversation search, tool discovery and inspector redaction.
- `src/main/context-artifacts.ts`: full tool/attachment payloads outside the hot conversation JSON, plus prompt-free per-call telemetry.
- `src/main/code-context.ts`: lazy TypeScript/JavaScript AST indexing, exact symbol line ranges, imports and content-hash invalidation.
- `src/main/service.ts`: shared provider admission and one overflow retry, scoped retrieval, durable memory, correction and artifact IPC, per-agent measurements and structured team reports.
- Context meter: compiled section estimates, output reserve, safety margin, locally archived work, editable memory and development inspector. Model changes refresh the preview.
- Chat and Multi Agents lists use existing Virtuoso virtualization. Closed tool details and thinking blocks now defer their bodies until opened.

Required system instructions, project directives, the active user instruction and the latest provider replay/tool interaction survive reduction. Reloadable project/document sections yield before recent dialogue. Earlier complete tool rounds within one autonomous task are removed as whole units; exact saved results remain retrievable.

## Model settings

Provider model listings contribute numeric context/output metadata when supplied. A tighter manual limit takes precedence. Settings expose context window, maximum output, response reserve, safety margin and recent-turn count. A model without context metadata currently uses a conservative **32,768-token fallback**; configure the real limit for such endpoints. The default recent-turn count is eight, independent of large model capacity.

Input plus reserved output plus safety margin must fit. A single oversize required input is refused with recovery guidance rather than silently shortened. Overflow retries use the original request, not a previous condensed prompt, and retry only before any streamed output.

## Memory and retrieval

Canonical facts are exact source excerpts with message provenance. Explicit labeled goals, decisions, completed work, open work, blockers, file/artifact references, commands, tests, external facts and handoffs have typed categories. Attachment text is excluded from user-constraint extraction. User edits apply persistent overlays to the original facts; repeated compilation does not paraphrase earlier summaries.

Tools include `search_conversation_history`, `retrieve_conversation_turns`, `read_attachment`, `read_tool_output`, `file_context`, `get_symbol`, and capability-based `discover_tools` when the catalog exceeds twenty definitions. Retrieval is scoped to the owning conversation. Artifact IDs are hashed into safe local paths. Large JSON results retain a valid bounded representation; plain logs preserve error excerpts and a reference to complete output. Attachments are ingested once and stored as references, with bounded initial excerpts.

Workers receive their assignment, dependency handoffs and lead constraints. Completion reports contain summary, decisions, actual changed paths, recorded tests, blockers and conversation references; leads aggregate reports instead of worker transcripts.

## Practical limits and remaining validation

Admission uses cached local `js-tiktoken` BPE tokenizers for recognized model IDs, with explicit model settings for `o200k_base`, `cl100k_base`, `p50k_base`, `r50k_base`, or conservative bytes. Unknown provider models retain the UTF-8 byte upper estimate; their tokenizer is not guessed from an unrelated model family. Literal special-token strings are ordinary user text. Provider-reported input, output and cache counters remain separate, and the safety margin covers provider request framing. These remain compiled request estimates rather than exact provider wire counts.

Semantic checkpoints now run independently after conversation task boundaries. A coalescing background scheduler resumes pending work after restart and shares the provider concurrency gate with lower queue priority. Only new or changed source messages are classified, in bounded batches. Classifications must use exact excerpts from identified user/assistant messages; fabricated excerpts, tool data, and attachment instructions are rejected. All missed user paragraphs are retained conservatively as constraints, and explicit-pattern extraction also remains available offline. A source fingerprint rejects stale results and schedules a fresh checkpoint. Saved memory is revalidated against current source text during compilation, with persistent correction overlays applied afterward. Shutdown cancels queued and in-flight checkpoint requests.

This validation guarantees source provenance and conservative user-text coverage, not perfect semantic interpretation of arbitrary assistant prose. An unavailable classifier falls back to exact source retention. Many unique pinned requirements can still exceed a small model's capacity; admission refuses that request rather than dropping requirements.

The development inspector is a redacted compilation preview of saved state; unsent composer text is not included. Secret-pattern redaction is defense in depth, and provider credentials are never part of the preview or telemetry. Diagnostic records contain IDs and numeric costs, not prompts.

Full payload artifacts reside under the app data directory in `context-artifacts`. Transcript pages reside under the repository data directory in `message-pages`. Preserve both directories when transferring profiles: platform JSON restore points reference immutable pages and do not package page/artifact contents. Old pages are retained so historical backups remain restorable. No artifact/page retention deletion policy was added.

Historical storage now commits a page manifest in the platform JSON and stores immutable, checksum-verified message pages separately. Existing JSON transcripts migrate on their next save. Startup loads metadata without hydrating page contents; the history API reads only overlapping pages, using a conversation-scoped ordinal cursor and a maximum page size of 200. Snapshots send the latest 100 messages per conversation. Chat exposes earlier-page loading, and complete cost totals come from the main process rather than the loaded UI slice. Foreground workflows hydrate their own conversation, while untouched conversations remain on disk. Cold conversation caches are bounded after save; active streaming turns retain their mutable references. Explicit global reporting/compatibility access can still hydrate all messages.

These changes implement tokenizer selection, independent validated checkpoint jobs, and persistent history pagination. Multi-week live-provider endurance remains an external validation task; automated fixtures do not establish it.

## Verification

Automated coverage includes 500-turn endurance at 32K and 128K, 128K to 32K switching, 100 signed tool rounds in one task, exact latest input, output/safety reserves, section sums, large terminal/directory/MCP/code results, multiple attachments, durable artifact restart, scoped search, fact provenance/corrections, hash invalidation, schema selection, redacted inspector and single-retry overflow recovery. The desktop smoke fixture includes 5,000 saved messages and asserts fewer than 100 mounted virtual rows.

Validated on October 4, 2026: `npm run typecheck`, `npm run build`, all 631 tests in `npm test`, and `npm run test:desktop` pass. The isolated desktop fixture checks 100-message history pages, earlier-page loading, and fewer than 100 mounted rows for 5,000 stored messages and displayed the compiled token breakdown and output reserve. These checks establish the implemented behavior; they do not establish multi-week live-provider endurance or perfect semantic interpretation of arbitrary prose.

Additional architecture regression coverage: local BPE parity for Unicode/code/special-token text; explicit tokenizer setting round trips; semantic source validation and unlabeled user-text retention; stale checkpoint rejection; scheduler coalescing and foreground priority; persisted page restart, bounded reads, corruption detection, and immutable historical manifests.
