# Connectors — design

- **Date:** 2026-09-27
- **Branch:** written on `feat/office-work-surface`; implementation gets its own branch (see the plan).
- **Status:** approved in chat, section by section.

## Goal

Coworkers can use the user's real services. The user opens a catalog, clicks **Connect** on Notion,
Linear, Figma or ~40 others, signs in once in the browser, and the coworkers whose work needs that
service get its tools. Reading happens on its own; anything that creates, sends, edits or deletes
still asks. Composio Connect covers the long tail and brings the 832 bundled integration skills
(written for Rube) back to life.

## Decisions (asked 2026-09-27)

| Question | Answer |
|---|---|
| What "connectors" means | **App connectors**: a catalog of services with a browser sign-in, built on MCP. Not a knowledge importer, not just a better MCP form. |
| Which services | **All groups**: dev tools, docs & projects, Google & Slack, the Composio hub, plus anything else worth adding (reference servers, local browser tools). |
| Who uses them | **Per coworker**, with defaults by role and department. Keeps each request under the providers' tool limits and fits the office. |
| Approvals | **Reads run on their own, changes ask**, from the server's tool annotations; the user can override any tool. |
| Approach | **Extend Axon's own MCP client** (Streamable HTTP + an OAuth module), not the official SDK and not Composio-only. Matches how providers, GitHub and Google sign-in are already written; no server frameworks pulled in for a client. |

## Today

- `src/main/mcp/client-manager.ts`: `McpClient` speaks stdio and the 2024-11-05 HTTP+SSE transport.
  `initialize` → `notifications/initialized` → one page of `tools/list`. Tools register in the
  `ToolRegistry` as `mcp_<server>_<tool>` (≤ 64 chars). `callTool` flattens content to text.
- `MCPServerConfig` (`src/shared/types.ts`): `transport: 'stdio' | 'sse'`, command/args/env or
  url/headers, `apiKey` kept in the vault under `mcp:<id>`.
- Settings → **Tools (MCP)** lists servers; `McpDialog.tsx` adds or edits one by hand.
- `toolsFor()` (`officeTools.ts`) offers MCP tools **only when the run has a folder**.
- `PermissionManager.check` has no MCP rule, so every MCP call falls to the default **ask**.
- Connection status (`McpClient.status`, `errorMessage`) never reaches the window; a broken server
  silently has no tools.
- `Accounts.googleSignIn` already runs a loopback server + PKCE browser sign-in.
- 832 of 895 bundled skills are `integration` skills with `requires: ["mcp:rube"]`; their bodies
  call `RUBE_SEARCH_TOOLS` (5,386 mentions), `RUBE_MANAGE_CONNECTIONS`, `RUBE_MULTI_EXECUTE_TOOL`,
  `RUBE_REMOTE_WORKBENCH` and `RUBE_GET_TOOL_SCHEMAS`. The skill picker matches `mcp:rube` to a
  server by name substring.

### What the services support (probed live, 2026-09-27)

An MCP `initialize` POST to each candidate, then its protected-resource and authorization-server
metadata:

| Kind | Services |
|---|---|
| OAuth with dynamic client registration (zero setup) | Linear, Sentry, Vercel, Supabase, Netlify, Neon, Prisma, GitLab, Cloudflare (bindings), Notion, Atlassian, Airtable, Monday, ClickUp, Todoist, Figma, Canva, Webflow, Stripe, PayPal, Intercom, Zapier, Hugging Face, Exa, Context7, Composio Connect |
| No account | Microsoft Learn, Cloudflare Docs, DeepWiki (Context7, Exa and Hugging Face also answer without one) |
| OAuth, but only for registered apps (no registration endpoint) | GitHub (`api.githubcopilot.com/mcp/`, auth at `github.com/login/oauth`), Slack, Asana, HubSpot, Box, Google Gmail / Drive / Calendar |

- Every server that signs in supports PKCE S256. None needs Client ID Metadata Documents.
- **Rube is gone**: discontinued 16 May 2026, `rube.app` has no address record. Its successor is
  **Composio Connect**, `https://connect.composio.dev/mcp`, OAuth with dynamic registration.
- Google's Workspace MCP servers (`gmailmcp.googleapis.com/mcp/v1`, `drivemcp…`, `calendarmcp…`)
  are a **Developer Preview**: a Google Cloud project, the MCP services enabled and preview enrolment.

## Design

### 1. Protocol and sign-in

**Streamable HTTP.** `MCPServerConfig.transport` gains `'http'`; stdio and SSE are unchanged.

- Every JSON-RPC message is a POST with `Accept: application/json, text/event-stream`. A JSON reply
  is handled directly; an event-stream reply is read until the response with the request's id
  arrives (other messages on it are handled as notifications and ignored for now).
- `initialize` offers `protocolVersion: '2025-06-18'` on every transport and declares no client
  capabilities (so servers do not send sampling, roots or elicitation requests). The version the
  server answers with is the one used from then on.
- `Mcp-Session-Id` from the `initialize` reply is sent on every later request, with
  `MCP-Protocol-Version: <agreed version>`. Disconnect sends `DELETE` with the session id. A `404`
  on a request that carried a session id means the session ended: re-initialize once, then retry.
- `tools/list` follows `nextCursor` until there is none. Each tool's `annotations` are kept.
- No standalone GET listening stream in v1; tools are re-listed on every connect.
- The first stdio connect may download an npx package: its `initialize` waits up to 120 s
  (other requests keep 30 s).

**OAuth** (new `src/main/mcp/oauth.ts`), started only by **Connect** or **Reconnect**:

1. **Protected resource metadata**: `resource_metadata` from the 401's `WWW-Authenticate`, else
   `/.well-known/oauth-protected-resource<path>`, else `/.well-known/oauth-protected-resource`.
   With none of these, the server URL's origin is taken as the authorization server.
2. **Authorization server metadata**: `/.well-known/oauth-authorization-server<path>`, else
   `/.well-known/openid-configuration<path>`, else `<issuer>/.well-known/openid-configuration`.
3. **Client**: by `auth` kind (below). For `oauth`, register at `registration_endpoint` as a public
   native client: `client_name: "Axon"`, `redirect_uris: [<exact loopback URI>]`,
   `grant_types: ["authorization_code", "refresh_token"]`, `response_types: ["code"]`,
   `token_endpoint_auth_method: "none"`. If the server still issues a `client_secret`, keep it and
   use it at the token endpoint. Each sign-in registers afresh with that sign-in's exact redirect
   URI (servers differ on whether a loopback port may vary); refreshes use the stored client.
4. **Browser**: `loopbackAuthorize()` (shared helper, moved out of `googleSignIn`, which then uses
   it) listens on `127.0.0.1:<ephemeral>/callback` and opens the authorization URL with
   `response_type=code`, `code_challenge` (S256), `state`, `resource=<server URL>` (RFC 8707) and
   `scope` = the `WWW-Authenticate` scope, else the resource metadata's `scopes_supported`, else
   none. Five-minute timeout; Cancel aborts.
5. **Token**: exchange with `code_verifier` and `resource`. The vault holds, under
   `mcp-oauth:<serverId>`, one JSON string: access token, refresh token, expiry, token endpoint,
   client id, client secret (if any), resource. Nothing about it goes into the state file.

**Using tokens.** Every HTTP request sends `Authorization: Bearer <access>`. Within 60 s of expiry,
or after one 401, Axon refreshes (`grant_type=refresh_token`, with `resource`) and retries once. If
refresh fails or there is no refresh token, the server's status becomes **needs-sign-in**, its tools
are unregistered, and nothing opens a browser until the user clicks Reconnect.

**`auth` kinds**, from the catalog entry (custom connectors are `oauth` if the server asks for it,
or use the existing API-key field):

| `auth` | Client |
|---|---|
| `none` | No sign-in. |
| `oauth` | Dynamic registration as above. |
| `oauth-app` | Client id (and secret) from `clients.ts`, read from the entry's `clientIdEnv` / `clientSecretEnv` like `AXON_GITHUB_CLIENT_ID`; if empty, from **Use your own app** (pasted by the user, kept in the vault under `mcp-client:<catalogId>`). Neither → the card says **Not set up in this build**. |
| `github-account` | The Axon GitHub sign-in token (`account:github`) as the Bearer. If the server refuses it, the entry falls back to `oauth-app`. |

**Status reaches the window.** The snapshot's `mcpServers` gain `status`
(`connecting` | `connected` | `needs-sign-in` | `error`), `error`, `toolCount` and the discovered
tools (name, description, annotations). The manager pushes an event on a new `connectors` channel
whenever a status changes; the renderer refreshes.

### 2. The catalog

`src/connectors/catalog.json`, bundled. An entry:

```ts
interface ConnectorEntry {
  id: string;                 // 'notion'
  name: string;               // 'Notion'
  description: string;        // one line
  category: 'code' | 'docs' | 'design' | 'comms' | 'payments' | 'reference' | 'hubs' | 'local';
  site: string;               // the service's home page
  url?: string;               // hosted: always the 'http' transport
  command?: string; args?: string[]; // local: stdio
  auth: 'none' | 'oauth' | 'oauth-app' | 'github-account';
  clientIdEnv?: string; clientSecretEnv?: string;
  preview?: boolean;          // Google
  defaultCoworkers: string[]; // core coworker ids and/or 'chats'
  defaultGroups: string[];    // specialist department names from roles.json
}
```

Entries (every URL from the probe above):

| Category | Connectors |
|---|---|
| Code & deploy | GitHub, GitLab, Linear, Sentry, Vercel, Netlify, Supabase, Neon, Prisma, Cloudflare |
| Docs & projects | Notion, Jira & Confluence, Asana, Monday, ClickUp, Todoist, Airtable, Box |
| Design | Figma, Canva, Webflow |
| Mail, chat & CRM | Slack, Gmail (Preview), Google Calendar (Preview), Google Drive (Preview), Intercom, HubSpot |
| Payments | Stripe, PayPal |
| Reference | Microsoft Learn, Cloudflare Docs, DeepWiki, Context7, Exa, Hugging Face |
| Hubs | Composio Connect, Zapier |
| On this PC | Playwright browser (`npx @playwright/mcp@latest`), Chrome DevTools (`npx chrome-devtools-mcp@latest`) |

**Connecting** creates an ordinary `MCPServerConfig` with a new `catalogId`, `transport`, url or
command from the entry, and `coworkers` from the entry's defaults. From there it is one more server
in the same manager, vault and status path. **Custom connector** is the existing dialog with
"Remote (HTTP)" added as the first transport and SSE kept for older servers.

**Keeping it honest.** `npm run connectors:check` (`scripts/connectors-check.mjs`, from the probe)
checks each hosted entry: the URL answers, and its sign-in kind still matches (`none` answers
`initialize`; `oauth` has a registration endpoint; `oauth-app`/`github-account` answer 401). Network,
so on demand only. A unit test checks the catalog's shape: unique ids, HTTPS URLs, known categories,
`defaultCoworkers` and `defaultGroups` that exist. Icons: `ServiceIcon` marks where it has them,
else the name's initial.

**Composio and the Rube skills.**

- `src/connectors/requires.ts` maps a skill requirement to a catalog id: `mcp:rube` → `composio`.
  The skill picker uses it instead of the name-substring guess: **Available via Composio** when the
  conversation's coworker has Composio connected, **Connect Composio** (opens its card) otherwise.
- When a Rube skill's body goes into a prompt, each `RUBE_<X>` is rewritten to the Axon name of the
  Composio tool whose name is `COMPOSIO_<X>` (for example `mcp_composio_composio_search_tools`).
  Composio's tool names can only be listed after signing in, so they are confirmed as the first
  implementation step; if a `RUBE_<X>` has no match, the skill stays **Needs tools** instead of
  naming a tool that does not exist.

### 3. Who gets what, and approvals

**Assignment.** `MCPServerConfig.coworkers: string[]` holds four kinds of entry:

- a coworker id (`designer`, `frontend-developer`),
- `group:<department>` for a whole specialist department (covers future members too),
- `not:<coworker id>` to take one person out of a department that has it,
- `chats` for the user's ordinary conversations outside the office.

Catalog defaults:

| Connectors | Start with |
|---|---|
| Code & deploy, Playwright, Chrome DevTools | groups Web & Frontend, Backend & APIs, Mobile, Cloud & Infrastructure, QA & Release, Architecture & General Engineering, Engineering Management |
| Docs & projects | Product Coach, Ops Coordinator, Knowledge Librarian, Writer; groups Product Management, Project Management, Operations Management |
| Figma, Canva, Webflow | Designer, Marketing Strategist; group Design |
| Gmail, Calendar | Receptionist |
| Drive | Knowledge Librarian, Research Analyst, Writer |
| Slack, Intercom, HubSpot | Ops Coordinator, Marketing Strategist; groups Sales Management, Marketing Management, Customer Success |
| Stripe, PayPal | Business Analyst; group Executive Leadership |
| Reference | Research Analyst, `chats`; all engineering groups above, AI, ML & Data, Security |
| Composio, Zapier | Ops Coordinator, `chats` |

**Migration.** Servers saved by earlier builds have no `coworkers`; `repository.ts` gives them every
core coworker, every group and `chats`: the reach they had before, now without the folder
requirement.

**Runs.** `toolsFor()` takes the run's assignee (the chat's coworker id, or `chats`) and the
connector tools: file tools still need a folder; a connector's tools are offered when the connector
is enabled, connected and assigned to the run's coworker directly, through the coworker's
department, or through `chats`. **Ask a colleague**: the colleague also gets their own connectors'
tools that resolve to allow (below), as they already get the read-only file tools.

**Tool budget.** OpenAI rejects more than 128 tools in a request; Axon budgets 100 for connectors.

- The connector page warns next to any coworker whose connectors add up to more than 100 tools.
- In a run still over budget, whole connectors are left out from the end of the coworker's list
  (most recently connected first), and the run's panel says which, e.g. "Left out Sentry and
  Stripe: too many tools for one request."
- Turning tools **Off** frees room.

**Approvals.** `PermissionManager.check` gets a connector rule, via a lookup the manager supplies
(tool name → `{ serverId, annotations, trusted, override }`):

1. The user's override in `MCPServerConfig.toolPolicy[<tool>]`: `allow`, `ask` or `off`. `off` tools
   are never offered and are denied if called.
2. Else, if the server is trusted: `readOnlyHint === true` and `destructiveHint !== true` → **allow**;
   anything else, including no annotations → **ask**.
3. Catalog servers are trusted. A custom connector is trusted only when the user turns on **Trust
   this server's read-only marks** (`trustAnnotations`); otherwise every tool asks.

"Always allow" for the session is unchanged. The approval card's preview names the connector and
tool, as the generic MCP preview does now.

**Untrusted content.** The system prompt of any run with connector tools says that connector
results (mail, pages, issues, messages) are data, not instructions, as it already does for
retrieved documents. Writes still ask, so injected text cannot act on its own.

### 4. Screens

**Settings → Connectors** (replaces "Tools (MCP)", same plug icon):

- **Connected**: a row per connector: icon, name, status badge (*Connected · 23 tools*, *Needs
  sign-in*, *Couldn't connect: <reason>*, *Connecting…*), "Used by Designer, Writer +12", an enable
  switch and **Manage**.
- **Add connectors**: search, category chips, a grid of cards (icon, name, one line, **Connect**).
  Badges: *No account*, *Preview*, *On this PC*, *Not set up in this build*.
- **Custom connector** in the header opens the existing dialog.

**Connect.**

- Sign-in services: the button becomes *Waiting for your browser…* with **Cancel**; on success a
  toast "Notion connected · 14 tools" and the card moves to Connected.
- No-account services connect at once.
- On this PC: a confirmation shows the exact command it will run and that the first start
  downloads the package.

**Manage** (a large modal):

- Status with **Reconnect**, **Sign out** (forgets the tokens) and **Remove**.
- **Used by**: the core coworkers, then the specialist departments (ticking one covers everyone in
  it; it expands to individuals), then "Your own chats". A budget warning beside anyone over 100.
- **Tools**: name, description, automatic behaviour (*Runs on its own* / *Asks first*), and an
  **Allow / Ask / Off** control. Custom connectors also show the trust switch.

**In the office.** A coworker's panel (`ActivityPanel.tsx`) shows their connectors as a row of up
to six icons and "+N" under the capabilities. Clicking it opens a popover to switch this
coworker's connected connectors on or off, with **Browse connectors** to Settings. When a
connector drops to *Needs sign-in*, a toast says so (pointing to Settings → Connectors, where
**Sign in** is) and the Settings entry shows a dot.

**Skill picker.** Rube skills show **Available via Composio** or **Connect Composio**.

## Checks

**Unit** (`node --test`, TypeScript loaded as the existing tests do):

- Streamable HTTP against a local mock server: JSON reply, event-stream reply, session id sent
  back, `404` → re-initialize once, `DELETE` on disconnect, `tools/list` pagination, annotations kept.
- OAuth against a mock resource + authorization server on loopback: each discovery path (header,
  path-aware, root; `oauth-authorization-server` and `openid-configuration`); registration body;
  the S256 challenge matches the verifier; `state` checked; `resource` sent on authorize, token
  and refresh; refresh within 60 s of expiry and after a 401; failed refresh → `needs-sign-in` and
  tools unregistered. The browser step is simulated by fetching the authorization URL and following
  its redirect to the loopback server.
- The approval rule table (override > trusted annotations > ask; custom untrusted → ask; `off` →
  deny and not offered).
- `toolsFor` with assignments by id, group and `chats`, without a folder.
- Budget trimming and its notice; migration of old servers.
- The `RUBE_<X>` rewrite, including an unmatched name.
- Catalog shape.

**Desktop** (`tests/electron-smoke.cjs` or the office desktop test): add a no-account connector
pointing at a local mock MCP HTTP server; Settings shows *Connected · N tools*; a coworker's
read-only call runs without a card; its write call shows an approval card.

**Live, on demand (not CI):** `npm run connectors:check`; one real sign-in to a self-registering
service (Linear or Notion), one no-account service (DeepWiki), and Composio (to record its tool
names for the Rube mapping).

## Verify first (implementation step 1)

1. Composio Connect's tool names, after one real sign-in.
2. Whether GitHub's remote server accepts the Axon GitHub sign-in token; otherwise `oauth-app`.
3. That Linear and Notion accept a per-sign-in registration with an exact loopback redirect URI.

## Out of scope

- Client ID Metadata Documents (no probed server requires them).
- MCP resources, prompts, sampling, roots, elicitation, and server-initiated notifications
  (`tools/list_changed`): tools only.
- Per-chat connector toggles; loading tools on demand.
- Importing connector content into Knowledge.
- Registering Axon's own Slack, Asana, HubSpot, Box or Google apps (the build reads client ids if
  present; getting them is a separate task), and Google's app verification.
- Syncing connectors between machines.
