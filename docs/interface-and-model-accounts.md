# Interface and model accounts

## What changed

- Settings has a searchable sidebar, keyboard tab navigation, section transitions, improved card spacing, and a dedicated **Models & API keys** section.
- Coworker cards and the conversation drawer use consistent easing and elevation. Reduced-motion preferences disable decorative transitions.
- Chat has more readable message spacing, a **Latest messages** control when scrolling through history, copy confirmation, and distinct working/thinking/writing states.
- Tool cards show understandable action labels, targets, and completion states, including tools that finish with an empty result. Work summaries count completed steps and open the actual saved output for the selected conversation.
- Agent instructions ask for concise plans, meaningful progress, actual files and verification evidence, and clear blockers. These instructions improve reporting but cannot guarantee model accuracy.
- Characters have more rounded heads and elbows, clothing details, pockets, buttons, ears, and watches. Desks have keyboard caps, mouse wheels, notebooks and pens, and detailed mugs. Body details remain baked into meshes; character geometry budget checks pass.

## Add an API key

Open **Settings → Models & API keys → Add provider**, choose the service, paste the key, then connect and save. OpenAI Responses is also available as a protocol for API-key connections. Claude has its own card in **Settings → Accounts** (see [Connect Claude](#connect-claude)); the Anthropic preset here remains for proxies and existing setups. An Anthropic key pasted here is checked with Anthropic's free model list instead of automatic test messages; **Test connection** still sends one when you ask.

Keys remain in the existing OS-protected vault in the main process. The renderer receives only whether a key is present. No keys ship with Axon.

## Connect ChatGPT

Open **Settings → Accounts → Continue with ChatGPT**. Complete OpenAI's browser consent flow and allow plan usage. After connecting, choose one of the account's available models in chat. **Refresh models** updates the catalog; **Sign out** removes local tokens and attempts remote revocation. If remote revocation fails, Axon reports that it was not confirmed.

This uses OpenAI's documented [open-source client registration](https://developers.openai.com/siwc/token-sharing-open-source), [browser sign-in](https://developers.openai.com/siwc/sign-in), and [model discovery and Responses inference](https://developers.openai.com/siwc/models-and-inference). Axon uses PKCE, state and nonce verification, signed identity-token validation, protected rotating refresh tokens, and the official API endpoint. Requests stream with `store: false`; tool rounds replay returned reasoning items as required.

There is one active ChatGPT account registration per Axon profile. Reconnection expects the same account. Eligibility, available models, quotas, workspace restrictions, and supported request options are controlled by OpenAI. This provides model access within Axon; it does not reproduce every feature of the ChatGPT website.

## Connect Claude

Open **Settings → Accounts → Claude → Connect Claude API key** and paste a key from [Claude Console → API keys](https://platform.claude.com/settings/keys). Axon checks the key with Anthropic's Models API (`GET /v1/models`), which is free: no message is sent. The card then shows:

- **Account**: the key's Console organization and workspace, from Anthropic's `anthropic-organization-id` and `anthropic-workspace-id` response headers. API keys carry no name or email.
- **Billing**: where usage is charged (below).
- **Limits**: the organization's requests, input tokens and output tokens per minute, from the `anthropic-ratelimit-*` headers of the latest Claude request.
- **Models**: the models the key can use, with the context window and output limit Anthropic publishes for each. Axon's context planner uses these limits.

Actions:

- **Replace key** checks a new key before it replaces the saved one, and says when it belongs to a different organization. API keys don't renew; an expired, disabled or deleted key fails with a message that points back to this card.
- **Refresh models** checks the saved key again, keeping prices and budgets you set and any lower context window you chose.
- **Cancel** stops a check under way.
- **Disconnect** (or removing the provider in Models & API keys) stops its conversations and deletes Axon's copy of the key. Axon cannot revoke API keys: the key works until you disable or delete it in Claude Console.
- **Prices & budgets** opens the model table for optional prices. Axon ships no prices.
- A personal or service-account key that spans several workspaces must name one. The dialog asks for the `wrkspc_…` ID and Axon sends it as `anthropic-workspace-id` on every request.

The key stays in the main-process OS vault and is sent only to `https://api.anthropic.com`. The connection cannot be pointed at another endpoint, and the renderer never receives the key.

### Billing and limits

Requests are Claude API usage, billed to the key's Console organization at API prices. They never use Claude Pro, Max or Team usage limits, and they are never charged to a Claude plan. Max 5x, Max 20x and Team plans include [monthly API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers) once a Console organization is linked in claude.ai billing settings. Keys from that organization spend those credits first, then purchased credits. Pro and Enterprise plans include no API credits. [Rate limits and the monthly spend cap](https://platform.claude.com/docs/en/api/rate-limits) follow the organization's usage tier. Axon cannot read the credit balance; Claude Console → Billing shows it.

Chat and agent errors name the Console-side cause and include Anthropic's request ID: an empty credit balance, a spend limit you set, the tier's monthly spend cap (not retried, since retrying fails until the next month), a rejected or expired key, a model the organization can't use, rate limiting, and overload.

### Why there is no Claude sign-in

Checked against Anthropic's documentation on 2026-10-08:

- Claude Code's [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) page reserves OAuth sign-in for Claude subscribers using Claude Code and Anthropic's own apps. Developers of products built on Claude, including Agent SDK products, are directed to Console API keys or a cloud provider. Third-party apps may not offer Claude.ai login, route requests through Free, Pro or Max plan credentials, or collect, store or intermediate Claude.ai credentials or session tokens.
- The [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) says the same, unless Anthropic has approved it beforehand. Anthropic publishes no OAuth client registration for this; approval would be a direct agreement, reached through [Anthropic sales](https://www.anthropic.com/contact-sales).
- The Claude API's [authentication methods](https://platform.claude.com/docs/en/manage-claude/authentication) are API keys, Workload Identity Federation (server workloads) and App Attest (iOS and macOS apps, billed to the developer's workspace). None signs a user's subscription into a desktop app.
- `ant auth login` and Claude Code's `/login` use Anthropic's own client registrations. Axon does not reuse them, import browser cookies, or invent endpoints.

The same Legal and compliance page allows end users to sign in to an **unmodified Claude Code binary** with their own plan where a product runs Claude Code under Anthropic's Commercial Terms. That would replace Axon's own agent loop and tools with Claude Code's, so it is not an equivalent of the ChatGPT connection and is not implemented here.

### Protocol details

- Streaming Messages API with tool use. Thinking blocks are replayed with their signatures, one round's tool results share a user message, and prompt caching is requested.
- Usage counts the whole prompt: `input_tokens` plus cache writes plus cache reads (earlier builds counted only `input_tokens`, which under-reported cached turns). Cache reads are also reported separately.
- A stop at a full context window counts as truncated. Anthropic's "prompt is too long" and "exceed context limit" errors start Axon's condensing retry.
- Anthropic keys added in Models & API keys also learn each model's limits from the model list.

## Validation

- TypeScript checking, production build, the full unit suite, and the desktop smoke test passed.
- Account tests cover signed identity validation, real loopback callbacks with mocked authorization, account catalog discovery, grant enforcement, concurrent refresh rotation, and local sign-out when remote revocation is unavailable.
- Responses tests cover request shape, account endpoint restrictions, model ordering, streaming failures, tool calls, usage, and encrypted reasoning replay.
- `electron tests/interface-polish.cjs` checks searchable settings, keyboard navigation, masked key inputs, dialog layering, and actual dark/light themes. Screenshots are saved under `test-results/interface-polish`.

- `tests/claude-account.test.cjs` covers the key check (model list only, paging, identity headers, refused keys with request IDs and no key in messages, multi-workspace keys, cancel), rate-limit headers, cached-token usage, credit, spend-cap and expired-key errors, context-limit errors, and the service lifecycle: vault storage, failed replacements leaving the saved key, organization changes, preserved prices, endpoint and key guards, and disconnect.
- `electron tests/claude-desktop.cjs` drives the built app: connect with a key that needs a workspace, the connected card in light and dark themes, the Models & API keys entry, and disconnect. It asserts the key is never stored in plain text and that only `GET /v1/models` reached Anthropic. Screenshots are saved under `test-results/claude-account`.

A real ChatGPT browser sign-in and live inference request have not been performed. No real Claude Console key has been checked and no Claude message has been sent: Anthropic's API was mocked in every Claude test. Tests use isolated profiles; no user account was connected and no paid request was sent.
