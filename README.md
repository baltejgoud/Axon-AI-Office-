# Axon — AI Studio

A working local-first Electron AI desktop **beta** using TypeScript, React, Zustand and electron-vite. This release is validated end-to-end against a local mock provider (streaming, usage capture, API-key handling) — it contains **no** paid-API key and **no** official Union Alpha endpoint.

## Run

```powershell
Set-Location 'D:\Baltej IDE'
npm install
npm run dev
```

For the built application, run `npm run build` followed by `npm start`.

Add a provider in Settings, enter its API base URL and exact model IDs, and optionally save an API key. Keys use Electron safeStorage (Windows DPAPI / system keyring); insecure fallback is refused. No API key or official Union Alpha endpoint is included. Use endpoint/model details from your service. Local OpenAI-compatible servers can use HTTP on loopback without a key.

## Implemented

- Sandboxed desktop renderer and explicit preload methods.
- Persistent conversations, title/content search, rename/delete, streamed Markdown and highlighted code, copy, cancellation, document attachments.
- OpenAI-compatible, Anthropic Messages, and Gemini streaming protocols. Provider enable/disable, endpoint, API key and model management.
- Workspaces with system prompt, instructions, default model and selected knowledge sources.
- Manual assistant profiles with JSON import/export, model and workspace selection. Profiles are data, not executable plugins.
- PDF/DOCX/text/Markdown/Excel/CSV and individual code-file ingestion; chunking and BM25 search. Workspace retrieval includes source-labelled passages.
- Project folder selection, bounded file listing/content search, text editor, file creation/updates with native confirmation. Explicit opt-in sharing of the current editor buffer.
- Dark/light/system themes, keyboard shortcuts and local data/security information.
- Bundled skills (from public Agent-Skills repositories, see `skills.sources.json`) and 198 authored roles, selectable per conversation, workspace, or agent profile and injected into the system prompt. Regenerate skills with `npm run skills:ingest`. Scripts and tool servers referenced by a skill do not run.

## Validation

```powershell
npm run typecheck
npm test        # 31 tests: core + repository hardening
npm run build
npm run test:desktop
npm run package:dir
```

Unit tests use Node's test runner and the installed TypeScript compiler. Protocol tests use mocked transport, not paid services. The desktop E2E test starts the built app with an isolated temporary profile and a loopback mock provider: it verifies rendering, IPC, renderer isolation, workspace-default-model selection, a full streaming round-trip (assistant text delivered through IPC and persisted), per-protocol usage capture, and asserts server-side that the saved API key arrives as `Bearer …`. It saves a screenshot at `D:\Baltej IDE\test-results\desktop.png` and prints its temporary profile path. `npm run package:dir` produces `dist\win-unpacked\Axon.exe` (verified exit 0; test-signed only).

## Architecture

- `D:\Baltej IDE\src\main\index.ts`: lifecycle, window isolation and IPC sender checks.
- `D:\Baltej IDE\src\main\service.ts`: application operations and request lifecycle.
- `D:\Baltej IDE\src\main\providers.ts`: endpoint policy, SSE parser, three protocol adapters, retry/backoff and usage capture.
- `D:\Baltej IDE\src\main\repository.ts`: validated schema-v1 state, corruption quarantine, migration seam, rolling backups.
- `D:\Baltej IDE\src\main\parse-pool.ts` and `src\main\workers\parse-worker.ts`: document parsing isolated in utilityProcess workers (30s timeout, crash respawn).
- `D:\Baltej IDE\src\main\infra\vault.ts`: OS-protected credentials, never returned to renderer.
- `D:\Baltej IDE\src\main\knowledge.ts`: extraction, chunking and lexical retrieval.
- `D:\Baltej IDE\src\main\project.ts`: selected-root file boundary, exclusions and junction checks.
- `D:\Baltej IDE\src\shared\platform.ts`: active typed API. Earlier `ipc.ts` is a design contract, not the active bridge.
- `D:\Baltej IDE\src\preload\index.ts`: explicit IPC facade.
- `D:\Baltej IDE\src\renderer\src`: React views and Zustand state. No Node or provider HTTP access.
- `D:\Baltej IDE\src\renderer\src\tokens.css` and `src\renderer\src\ui\index.tsx`: design tokens (primitive > semantic > component) and the shared Button/Icon/Kbd/Modal/Field/PageHeader/EmptyState primitives. The spec is `design-system\axon\MASTER.md`.
- `D:\Baltej IDE\src\main\skills.ts`, `src\main\roles.ts`, `src\main\prompt.ts`: bundled catalogs and system-prompt block assembly (80k-character skill budget).

One versioned JSON document is persisted with serialized replacement writes, serving reads from RAM, with corruption quarantine and rolling pre-write backups. This is bounded local storage, not a scalable database. Production needs transactional SQLite with migrations and indexed/paged queries. Parsing already runs in isolated utilityProcess workers, and the renderer consumes streaming events incrementally rather than via snapshot refreshes.

## Release blockers and limitations

**Do not publicly distribute this build yet.** The dependency audit now reports **0 vulnerabilities** (19 → 0 after Electron 44, electron-vite 5/Vite 7, electron-builder 26 upgrades, replacing `xlsx` with `exceljs`, and an npm override for its transitive `uuid`). Remaining gates: the executable is test-signed (no real code-signing certificate), document parsers are process-isolated but not OS-resource-sandboxed, and no security review has been performed.

- Conversation/document text is not encrypted on disk. Use full-disk encryption.
- Selected content goes to your chosen provider; its privacy and billing policies apply.
- No terminal execution, autonomous tools, unattended writes, schedules, multi-agent orchestration, vector search, OCR, image understanding, repository-wide knowledge import or executable plugins.
- Code is a manual review/copy/save workflow, not autonomous project editing. Automatic workspace file/tool permissions are disabled.
- File checks block ordinary traversal and symlink/junction escapes but not a malicious local process racing file replacement. Keep projects under your control.
- Basic text streaming with usage capture and temperature; not every provider reasoning/tool/vision parameter.
- Context uses a character cap rather than exact provider token accounting.
- No live call to a paid provider, signed installer, cross-platform packaging, accessibility audit or large-codebase performance benchmark has been verified. `npm run package:dir` was verified with exit 0; installers, code signing and update delivery remain unimplemented.

## Production roadmap

1. Real code signing/notarization, an OS-level resource sandbox for parsers, and a security review.
2. SQLite transactions/migrations, backups, pagination, background indexing and model context budgets.
3. Provider capability negotiation, live integration tests, usage/cost reporting and retry policies.
4. Reviewable diff proposals and capability-scoped tools, with explicit user approvals.
5. Versioned plugin manifests, durable agent run history and permission revocation.
6. Accessible dialogs/focus management, broader UI tests, code signing and signed updates.
