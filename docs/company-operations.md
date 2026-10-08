# Company operations

Open **Company operations** from the office bar or Ask Axon command palette.

## Research, mail and CRM setup

The company panel offers three connections: Exa for public company research, Composio Connect for Gmail actions, and HubSpot for CRM contacts, companies and deals. Exa's keyless endpoint requires no sign-in and has service rate limits. Composio opens browser sign-in; afterward, select **Set up Gmail with Ops Coordinator** and send the prepared connection-only request. Complete Gmail's authorization link in your browser. A connected Composio gateway does not by itself mean Gmail is authorized. Axon's direct Google Gmail connector currently offers read/search/draft tools, without a send tool; Gmail sending uses Composio's Gmail tools when available and authorized.

Direct HubSpot setup needs an MCP Auth App created under HubSpot Development, with its client ID, secret and redirect URL configured for Axon. Use Settings → Connectors → HubSpot to supply those details and sign in. HubSpot can also be connected through Composio's app authorization flow instead of the direct server.

Successful company-panel connections grant access to the Chief of Staff, Ops Coordinator, Research Analyst, Marketing Strategist, Growth & Outreach, and Sales Management. Settings → Connectors manages access and per-tool policy. Public website research does not guarantee verified contact email addresses, and CRM access only exposes data available to the authorized account. Read-only tools may run automatically; write/send tools retain the existing approval policy. No outreach is sent during setup.

1. Save a company profile. Sanket's initial description is based on the supplied comprehensive report; its technical, compliance and commercial claims remain supplied claims.
2. Upload company documents or import a folder. Select the documents the company should use and save the profile. Document content is reference data, never authorization to act.
3. Describe a task and its deliverables, choose a model with tool support, and select **Gather team for this task**.
4. The Chief of Staff selects specialists and gathers them in an available meeting room. Review the plan and select **Start the work**.
5. Each owner works in a separate conversation with the company's workspace and knowledge. Dependencies receive their predecessors' handoffs. An evidence review checks company task deliverables before marking them done.
6. Members whose assignments are all done leave individually. Unfinished members stay, including when a task needs attention. Use **Retry** to resume unfinished assignments with missing-work feedback; completed tasks are retained. **Stop team** releases the team.
7. Read or download the detailed report. Open the saved lead conversation to give follow-up instructions or submit a new task from the company panel.

Company profiles, task conversations, meeting minutes, assignments and reports use Axon's existing local persistence. Provider/model configuration and connector access remain required. Actual sending, lead lookup and updates use available connector tools and their existing approval policy. This feature does not install connectors, contact customers, run unattended after quitting, or implement a recurring CRM pipeline. Completion review is a model judgment supported by recorded tool evidence, not independent verification of third-party claims.

Validation: `npm run typecheck`, team/office simulation unit and service tests, `npm run build`, and `npx electron tests/company-desktop.cjs` (isolated profile, mock provider). The desktop check exercises company creation, task submission, meeting plan, work start, workspace inheritance, evidence review and final report.
