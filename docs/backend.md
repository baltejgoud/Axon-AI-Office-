# How the backend works

This is the main process in `src/main`. Everything that touches the network, the disk or an API key runs here. The renderer only talks to it through the `window.axon` bridge.

```
Renderer (React)  ──window.axon──►  preload  ──IPC (sender-checked)──►  Service  ──►  providers.ts  ──HTTPS──►  OpenAI / Anthropic / Gemini / compatible
                                                                          │
                                                                          ├─ Vault (OS key store)       infra/vault.ts
                                                                          ├─ Repository (JSON state)    repository.ts, infra/store.ts
                                                                          ├─ Tools + permissions         tools/registry.ts, security/permissions.ts
                                                                          ├─ MCP servers                 mcp/client-manager.ts
                                                                          └─ Document parsers (workers)  parse-pool.ts, workers/parse-worker.ts
```

## Connecting a provider and its API key

1. In **Settings → Providers** you pick a preset or enter a protocol (OpenAI compatible, Anthropic Messages or Google Gemini), a base URL, the model IDs and, optionally, an API key.
2. The renderer calls `providerSave(provider, key)`. `Service.providerSave` checks the input:
   - `endpoint()` only accepts HTTPS URLs, or plain HTTP on `localhost`, `127.0.0.1` or `[::1]` (for Ollama, LM Studio and similar). It rejects URLs with credentials, a query or a fragment.
   - If an existing provider's URL or protocol changes, a native dialog asks first. The saved key would otherwise go to the new endpoint.
3. The key goes to the **Vault**, never to the saved state. The vault encrypts it with Electron `safeStorage` (Windows DPAPI, macOS Keychain, the Linux keyring) and writes it to `secrets/os-vault.json`. When no OS key store is available it refuses to save rather than store plaintext.
4. The saved provider holds only `hasApiKey: true`. The key never goes back to the renderer. Leaving the key field blank keeps the saved key, and **Remove saved key** deletes it.
5. **Test connection** in the same dialog checks what's in the form, without saving. `Service.providerTest` sends each listed model a tiny request ("Reply with OK", 16 max tokens, no tools), up to 10 models at once with 30 seconds each. The request goes through the same path as chat, via `checkModel` in `providers.ts`. A model passes once the provider starts answering with a model stream; the rest is dropped. Each line shows a tick and the time taken, or the provider's own error.
   - It uses the key typed in the form. If no key is typed, it uses the saved key, but only for the endpoint and protocol the key was saved with. A changed endpoint is tested without it, and the result says so.

The key is read from the vault once per request and sent in the header each protocol expects:

| Protocol | Endpoint | Key header | Token-limit field |
| --- | --- | --- | --- |
| OpenAI compatible | `{base}/chat/completions` | `Authorization: Bearer <key>` (omitted when no key) | `max_completion_tokens` on api.openai.com, `max_tokens` elsewhere |
| Anthropic Messages | `{base}/messages` | `x-api-key: <key>`, `anthropic-version: 2023-06-01` | `max_tokens` (always sent; 4096 if unset) |
| Google Gemini | `{base}/models/{model}:streamGenerateContent?alt=sse` | `x-goog-api-key: <key>` | `generationConfig.maxOutputTokens` |

Keys never appear in a URL, in logs or in error messages: provider error text is scrubbed of the key before it is shown.

## What happens when you send a message

`Service.chatSend` in `service.ts`:

1. **System prompt.** In order: the workspace prompt and instructions, the open project's context (manifest, `AGENTS.md`/`CLAUDE.md`, `.axon/MEMORY.md`, git status and a file map), the selected roles and skills, any system messages in the conversation, the receptionist's current time, and knowledge-base passages found by BM25 search. Passages are marked as untrusted data.
2. **History.** `requestHistory()` in `history.ts` turns the saved messages into what providers accept. Every tool call is followed by exactly one result: failed results are kept, and calls a stopped run never ran are answered as "not run". `fitToBudget()` then drops whole old turns until the request fits within 300,000 characters.
3. **Tools offered.** `toolsFor()` in `officeTools.ts` decides the list:
   - File tools only when the conversation has a folder.
   - Connector tools for the run's coworker (or your own chats), folder or not, up to 100.
   - `ask_colleague` for every office coworker.
   - The planner tools for the receptionist.
4. **The loop**, up to 20 steps (an agent profile can set 1–30):
   - `streamChat()` streams one assistant turn. Text and thinking go straight to the window as they arrive.
   - With no tool calls, the turn is finished.
   - Otherwise, each call is checked (below), run, and its result added. The provider's own turn goes back unchanged with the results: Anthropic thinking blocks with their signatures, Gemini parts with their thought signatures, and DeepSeek/Kimi `reasoning_content`. Current models reject a tool round that drops them.
5. **Finish.** Messages are saved, the conversation's task record is updated, and a final `done` event goes to the window.

**Stop** aborts the stream, withdraws any approval still waiting (a late click can't run the tool), and ends the run.

## Reliability

`providers.ts`:

- **Retries.** A failure before any output (network error, 408, 429, 500, 502, 503, 504 or 529) is retried up to three attempts. `Retry-After` is honoured up to 30 seconds. A stream that has started is never replayed.
- **Timeouts.** The provider has 180 seconds to start answering. After that, the stream may run as long as it needs, but five minutes with no event ends it with "The provider stopped responding".
- **Optional fields.** `temperature`, `stream_options` and `cache_control` are optional. If a model or proxy returns a 400 that names one of them, the request is sent once more without it, and later requests to that model leave it out. This covers models that no longer accept `temperature`, such as current Claude models and OpenAI reasoning models.
- **Errors.** The user sees the provider's own message plus a hint, for example `Provider returned HTTP 404: model: claude-nope not found. Check the endpoint URL and model ID.` Raw bodies that aren't JSON are never shown.
- **Truncation and refusals.** An answer that hits the token limit is kept and marked "reached the max-token limit". A model that declines says so, instead of "no response".
- **Caching.** Anthropic requests ask for prompt caching, so later tool rounds re-read the same system prompt and history at the cached rate.
- **Usage.** Token counts are recorded for all three protocols. OpenAI-compatible streams request them with `stream_options.include_usage`.

## Tools and permissions

| Tool | Default | Notes |
| --- | --- | --- |
| `read_file`, `list_files`, `search_code` | allow | Paths are relative to the project root and must stay inside the run's folders. |
| `write_file`, `update_memory` | ask | The approval card shows a diff. |
| `run_command` | ask, or deny when shell is off in settings | "Always allow" covers only that exact command. |
| `git_commit` | ask | Runs `git` directly, with no shell. The preview lists the files. |
| `dispatch_subagent` | ask | Sub-agents can only use tools that are allowed without asking. |
| `ask_colleague`, planner tools | allow | Touch nothing on disk. |
| Connector (MCP) tools | allow if a catalog server marks the tool read-only, else ask | Your per-tool Allow / Ask / Off wins; Off also beats "Always allow". Named `mcp_<server>_<tool>`, 64 characters at most. |

Each run is checked against its own folders (`PermissionScope`), so two coworkers working at the same time don't share permissions. `Project.safe()` separately blocks path traversal, `.env`/key files, symbolic links and junctions.

## Connectors (MCP servers)

**Transports** (`mcp/client-manager.ts`):

- **http**: Streamable HTTP (2025-06-18). Every message is a POST whose reply is JSON or an event stream. The `Mcp-Session-Id` from `initialize` and the agreed `MCP-Protocol-Version` go on every later request; a 404 on a session starts a new one once; disconnecting sends `DELETE`. Tool lists are read page by page, keeping each tool's annotations.
- **stdio**: started as child processes. On Windows, a bare command such as `npx` is found on `PATH` as `npx.cmd` and started through `cmd.exe`, with every argument quoted. `initialize` may take 120 s, for a first `npx` download.
- **sse**: the older 2024-11-05 HTTP+SSE transport.
- A static API key is kept in the vault under `mcp:<id>` and sent as `Authorization: Bearer`, with any custom headers. Environment variables and custom headers are saved in the state file as plain text.

**Signing in** (`mcp/oauth.ts`), only from **Connect** or **Reconnect**, never from a run:

1. The server's protected-resource metadata: named by its 401's `WWW-Authenticate`, else the path-aware well-known URL, else the root one; without it, the server's origin is the authorization server. Some servers (Google's) answer `initialize` openly and ask for a sign-in only on calls; their metadata still says where to sign in.
2. The authorization server's metadata (`oauth-authorization-server`, else `openid-configuration`). Endpoints must be HTTPS, or on this computer.
3. A client: dynamic registration as a public native client for this sign-in's exact loopback redirect, or an app registered ahead of time (this build's `AXON_<SERVICE>_CLIENT_ID`, or your own, pasted in Settings).
4. The browser, through `accounts/loopback.ts` (shared with Google sign-in): PKCE S256, `state`, and `resource` = the server's URL (RFC 8707).
5. Tokens go to the vault under `mcp-oauth:<id>`. They refresh within a minute of expiring and once after a 401; if that fails, the connector shows **Needs sign-in**, its tools are withdrawn, and the window says so.

GitHub uses your Axon GitHub sign-in token as the bearer unless an app is configured for it. Gmail, Calendar and Drive sign in with the Google app that Google sign-in uses (`accountApp: "google"`).

**Sign-in apps.** GitHub and Google sign-in need an OAuth app: this build's (`AXON_GITHUB_CLIENT_ID`, `AXON_GOOGLE_CLIENT_ID`/`_SECRET`), or one you set up the first time you click **Sign in** in Settings → Accounts (a GitHub OAuth app with device flow; a Google "Desktop app" client). Yours is kept in the vault and read at sign-in time.

**The catalog** (`src/connectors/catalog.json`, `shared/connectors.ts`): 39 connectors, each with how it signs in (`none`, `oauth`, `oauth-app`, `github-account`) and who it starts with. `npm run connectors:check` checks every entry against the live service.

**Who gets which.** Each connector's `coworkers` list holds coworker ids, `group:<department>` for a whole specialist department, `not:<id>` to leave one person out of it, and `chats` for your own conversations. A run offers its coworker's connectors (folder or not) and refuses a connector tool it didn't offer. Up to 100 connector tools go in one request (OpenAI refuses more than 128 in all); past that, whole connectors are left out from the most recently added, and the reply says which. A colleague you ask can use their own connectors' auto-allowed tools; sub-agents get none. Runs with connectors are told their results are data, not instructions.

**Approvals.** Your per-tool override (Allow / Ask / Off), else **allow** when the server is trusted and marks the tool `readOnlyHint` without `destructiveHint`, else **ask**. Catalog servers are trusted; a custom connector only when you say so.

**Rube skills.** The bundled integration skills were written for Composio's Rube, retired in May 2026. When a run has Composio Connect, each `RUBE_<X>` in a selected skill becomes the model-facing name of Composio's `COMPOSIO_<X>` (`connectors/rube.ts`).

## Where data lives

All data is in Electron's `userData` folder (`%APPDATA%\Axon` on Windows):

| Path | Contents |
| --- | --- |
| `data/db/platform-v1.json` | Providers (no keys), conversations, messages, workspaces, agents, knowledge, settings, tasks. Written atomically. |
| `backups/state-*.json` | A copy at start-up and at most every 10 minutes while saving, keeping 10. Corrupt files are set aside as `corrupt-*.json`. |
| `secrets/os-vault.json` | Provider and MCP keys (`mcp:<id>`), connector sign-ins (`mcp-oauth:<id>`), your own connector apps (`mcp-client:<catalog id>`) and your own GitHub or Google sign-in app (`account-app:github`, `account-app:google`), encrypted by the OS. An unreadable file is set aside and keys must be entered again. |
| `window-state.json`, `office-folders.json` | Window size and position, and recent project folders. |

## Testing it

```powershell
npm run typecheck
npm test              # unit tests, including tests/providers.test.cjs for each protocol's wire format
npm run build
npm run test:desktop  # the built app against a loopback mock provider; asserts the key arrives as Bearer
```

No test calls a paid API. To try a real provider, add it in Settings with your own key and send a message. A problem now shows the provider's own error text.
