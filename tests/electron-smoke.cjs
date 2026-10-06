// Runs the built application with an isolated profile and a local mock provider.
// Verifies the office-only renderer, IPC, isolation, layered overlays, and a full streaming
// round-trip including the Authorization header (asserted server-side) and usage.
const { app } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-smoke-'));
// Seed two models and a workspace whose default is not the global first model.
const now = Date.now();
fs.mkdirSync(path.join(profile, 'data/db'), { recursive: true });
fs.writeFileSync(
  path.join(profile, 'data/db/platform-v1.json'),
  JSON.stringify({
    version: 1,
    providers: [
      {
        id: 'seed',
        name: 'Seed',
        kind: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:1234/v1',
        models: [
          { id: 'first', displayName: 'First' },
          { id: 'workspace', displayName: 'Workspace default' }
        ],
        enabled: true,
        createdAt: now,
        hasApiKey: false
      }
    ],
    workspaces: [
      {
        id: 'research',
        name: 'Research test',
        systemPrompt: 'Research carefully.',
        defaultProviderId: 'seed',
        defaultModelId: 'workspace',
        enabledTools: [],
        knowledgeDocIds: [],
        roleIds: ['backend-developer'],
        fileAccess: { enabled: false, roots: [] },
        createdAt: now,
        updatedAt: now
      }
    ],
    conversations: [{ id: 'endurance-ui', title: 'Endurance history', agentId: 'chief-of-staff', providerId: 'seed', modelId: 'first', workspaceId: null, skillIds: [], roleIds: [], createdAt: now - 1000, updatedAt: now - 1000 }],
    messages: Array.from({length:5000}, (_,i) => ({ id: `history-${i}`, conversationId: 'endurance-ui', role: i % 2 ? 'assistant' : 'user', content: `Historical message ${i}`, createdAt: now - 5000 + i })),
    agents: [],
    documents: [],
    chunks: [],
    settings: {
      theme: 'dark',
      autoTitleConversations: true,
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
      streamDeltas: true,
      allowShellExecution: false,
      shellAllowlist: [],
      sendCrashDiagnostics: false,
      dataDirectoryNote: ''
    }
  })
);
app.setPath('userData', profile);
// Keep the test window restored and off-screen; the app itself opens maximized.
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
// Loopback-only mock provider. Rejects requests without the expected Bearer key.
let lastAuth = '';
/** Every request body, in order; the chat's is the one carrying a system prompt. */
const bodies = [];
const mock = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (c) => chunks.push(c));
  request.on('end', () => {
    bodies.push(Buffer.concat(chunks).toString('utf8'));
    lastAuth = String(request.headers.authorization || '');
    if (lastAuth !== 'Bearer smoke-key-123') {
      response.writeHead(401);
      response.end();
      return;
    }
    // "List the files" gets a tool call first, so the activity log has a call to show.
    const parsed = (() => {
      try {
        return JSON.parse(bodies.at(-1));
      } catch {
        return {};
      }
    })();
    const last = parsed.messages?.at(-1);
    if (last?.role === 'user' && last.content === 'List the files') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_list","type":"function","function":{"name":"list_files","arguments":"{}"}}]}}]}\n\n'
      );
      response.write('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n');
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"Hello from Axon mock"}}]}\n\n');
    response.write('data: {"choices":[{}],"usage":{"prompt_tokens":7,"completion_tokens":4}}\n\n');
    response.write('data: [DONE]\n\n');
    response.end();
  });
});
mock.listen(0, '127.0.0.1', () => {
  globalThis.__axonMockPort = mock.address().port;
});
// Loopback-only MCP server (Streamable HTTP, no sign-in) for the connector round trip.
const mcpMock = http.createServer((request, response) => {
  let body = '';
  request.on('data', (c) => (body += c));
  request.on('end', () => {
    if (request.method !== 'POST') {
      response.writeHead(200);
      response.end();
      return;
    }
    const msg = JSON.parse(body);
    if (msg.id === undefined) {
      response.writeHead(202);
      response.end();
      return;
    }
    const reply = (result) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    };
    if (msg.method === 'initialize')
      return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
    if (msg.method === 'tools/list')
      return reply({
        tools: [
          { name: 'lookup', description: 'Find a note', annotations: { readOnlyHint: true } },
          { name: 'create_note', description: 'Write a note' }
        ]
      });
    reply({ content: [{ type: 'text', text: 'ok' }] });
  });
});
mcpMock.listen(0, '127.0.0.1', () => {
  globalThis.__axonMcpPort = mcpMock.address().port;
});
const timeout = setTimeout(() => {
  console.error('SMOKE_FAIL: timed out');
  app.exit(1);
}, 45000);
app.on('web-contents-created', (_, contents) => {
  contents.on('did-fail-load', (_, code, description) => console.error('LOAD_FAIL', code, description));
  contents.on('preload-error', (_, file, error) => console.error('PRELOAD_FAIL', file, error.message));
  contents.once('did-finish-load', async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const result = await contents.executeJavaScript(`(async () => {
        if (!window.axon) throw new Error('Missing preload bridge');
        const state = await window.axon.snapshot();
        if (state.version !== 1) throw new Error('Invalid snapshot');
        if (!(state.skills.length > 800) || state.roles.length !== ${require('../src/roles/roles.json').length}) throw new Error('Catalogs missing from snapshot');
        if (typeof require !== 'undefined' || typeof process !== 'undefined') throw new Error('Node exposed in renderer');
        if (!document.querySelector('.office-viewport')) throw new Error('Office did not render');
        if (document.querySelector('.sidebar, .chat-view, .return-to-office')) throw new Error('A page other than the office is reachable');
        const id = crypto.randomUUID();
        await window.axon.providerSave({ id, name: 'Mock provider', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:${globalThis.__axonMockPort}/v1', models: [{ id: 'mock-model', displayName: 'Mock model', pricePerMillionInputTokens: 3, pricePerMillionOutputTokens: 15 }], enabled: true, createdAt: Date.now(), hasApiKey: false }, 'smoke-key-123');
        const form = { id, name: 'Mock provider', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:${globalThis.__axonMockPort}/v1', models: [{ id: 'mock-model', displayName: 'Mock model' }], enabled: true, createdAt: Date.now(), hasApiKey: true };
        const check = await window.axon.providerTest(form);
        if (!check.results[0]?.ok) throw new Error('Test connection with the saved key failed: ' + JSON.stringify(check));
        const wrong = await window.axon.providerTest(form, 'wrong-key');
        if (wrong.results[0]?.ok || !String(wrong.results[0]?.error).includes('HTTP 401')) throw new Error('Test connection missed a wrong key: ' + JSON.stringify(wrong));
        const chat = await window.axon.chatCreate(id, 'mock-model', 'research', undefined, { skillIds: ['superpowers/brainstorming'], roleIds: ['frontend-developer'] });
        await window.axon.chatSend(chat.id, 'Say hello', []);
        const after = await window.axon.snapshot();
        const assistant = after.messages.find(m => m.conversationId === chat.id && m.role === 'assistant');
        if (!assistant || assistant.content !== 'Hello from Axon mock') throw new Error('Streaming E2E failed: ' + JSON.stringify(assistant));
        if (assistant.usage?.promptTokens !== 7 || assistant.usage?.completionTokens !== 4) throw new Error('Usage not captured: ' + JSON.stringify(assistant.usage));
        // Transparency: the context meter, the usage report (a hand-computed sum) and restore points.
        const meter = await window.axon.getContextUsage(chat.id);
        if (!meter || meter.tokenBasis?.windowTokens !== 32768 || !(meter.tokenBasis.usedTokens > 0) || !(meter.outputReserve > 0) || !(meter.pct > 0 && meter.pct <= 1)) throw new Error('Context meter wrong: ' + JSON.stringify(meter));
        const report = await window.axon.usageReport();
        const expected = (7 * 3 + 4 * 15) / 1e6;
        if (report.allTime.turns !== 1 || report.allTime.promptTokens !== 7 || report.allTime.completionTokens !== 4 || Math.abs(report.allTime.cost - expected) > 1e-12) throw new Error('Usage report wrong: ' + JSON.stringify(report.allTime));
        const points = await window.axon.listBackups();
        if (points.length !== 1 || points[0].providers !== 1 || points[0].workspaces !== 1) throw new Error('Restore points wrong: ' + JSON.stringify(points));
        // Wave 2: a tool call lands in the activity log, with its decision.
        await window.axon.chatSend(chat.id, 'List the files', []);
        const activity = await window.axon.auditList({});
        if (!activity.some((e) => e.tool === 'list_files' && e.decision === 'allowed')) throw new Error('Activity log wrong: ' + JSON.stringify(activity));
        await window.axon.chatRename(chat.id, 'Smoke conversation');
        if (!(await window.axon.snapshot()).conversations.some(c => c.title === 'Smoke conversation')) throw new Error('Chat persistence failed');
        // A connector over Streamable HTTP connects, and its tools reach the window.
        await window.axon.mcpServerSave({ id: 'smoke-conn', name: 'Smoke Notes', transport: 'http', url: 'http://127.0.0.1:${globalThis.__axonMcpPort}/mcp', enabled: true, coworkers: ['chats'], args: [], env: {}, headers: {} });
        let conn;
        for (let i = 0; i < 50; i++) {
          conn = (await window.axon.snapshot()).mcpServers.find((s) => s.id === 'smoke-conn');
          if (conn?.status === 'connected') break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (conn?.status !== 'connected' || conn.tools.map((t) => t.axonName).join() !== 'mcp_smoke_notes_lookup,mcp_smoke_notes_create_note') throw new Error('Connector did not connect: ' + JSON.stringify(conn));
        let refused = false;
        try { await window.axon.connectorAdd('no-such-connector'); } catch { refused = true; }
        if (!refused) throw new Error('An unknown connector was accepted');
        window.__smoke = { chatId: chat.id, providerId: id };
        return { bridge: true, renderer: true, isolation: true, chatCRUD: true, streamingE2E: true, usageE2E: true, providerTest: true, selection: true, connector: true, transparency: true };
      })()`);
      // Settings → Connectors shows the connected one and the catalog; its picture is saved for review.
      result.connectorsPage = await contents.executeJavaScript(`(async () => {
        const wait = () => new Promise(resolve => setTimeout(resolve, 300));
        document.querySelector('button[aria-label="Office settings"]').click();
        await wait();
        document.querySelector('#settings-tab-tools').click();
        await wait();
        const row = [...document.querySelectorAll('.settings-item')].find(item => item.textContent.includes('Smoke Notes'));
        if (!row || !row.textContent.includes('Connected · 2 tools')) throw new Error('Connected connector not shown: ' + row?.textContent);
        const cards = document.querySelectorAll('.connector-card').length;
        if (cards < 35) throw new Error('Catalog shows ' + cards + ' connectors');
        return { cards };
      })()`);
      fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
      fs.writeFileSync(
        path.join(__dirname, '../test-results/connectors.png'),
        (await contents.capturePage()).toPNG()
      );
      const shot = async (name) =>
        fs.writeFileSync(
          path.join(__dirname, `../test-results/${name}.png`),
          (await contents.capturePage()).toPNG()
        );
      // Settings → Usage shows the priced model's cost; Privacy & security lists the start-up snapshot.
      result.usagePage = await contents.executeJavaScript(`(async () => {
        document.querySelector('#settings-tab-usage').click();
        await new Promise(resolve => setTimeout(resolve, 400));
        const usage = document.querySelector('.settings-content').textContent;
        if (!usage.includes('Mock model') || !/\\$0\\.000/.test(usage)) throw new Error('Usage page wrong: ' + usage);
        return true;
      })()`);
      await shot('usage');
      result.restorePoints = await contents.executeJavaScript(`(async () => {
        document.querySelector('#settings-tab-privacy').click();
        await new Promise(resolve => setTimeout(resolve, 400));
        const rows = document.querySelectorAll('.restore-point');
        if (rows.length !== 1 || !rows[0].textContent.includes('Restore…')) throw new Error('Restore points not shown: ' + document.querySelector('.settings-content').textContent);
        rows[0].scrollIntoView({ block: 'center' });
        await new Promise(resolve => setTimeout(resolve, 200));
        return true;
      })()`);
      await shot('restore-points');
      result.activityLog = await contents.executeJavaScript(`(async () => {
        document.querySelector('#settings-tab-activity').click();
        await new Promise(resolve => setTimeout(resolve, 400));
        const rows = document.querySelectorAll('.activity-log-row');
        if (!rows.length || !rows[0].textContent.includes('list files') || !rows[0].textContent.includes('Allowed')) throw new Error('Activity log not shown: ' + document.querySelector('.settings-content').textContent);
        return rows.length;
      })()`);
      await shot('activity-log');
      // Accounts: real sign-in buttons even without an app in this build; the first click sets one up.
      result.accounts = await contents.executeJavaScript(`(async () => {
        const wait = () => new Promise(resolve => setTimeout(resolve, 400));
        document.querySelector('#settings-tab-accounts').click();
        await wait();
        const button = (text) => [...document.querySelectorAll('.office-overlay button')].find(b => b.textContent.trim() === text);
        if (!button('Sign in with GitHub') || !button('Sign in with Google')) throw new Error('Sign-in buttons missing: ' + document.querySelector('.settings-content')?.textContent);
        return true;
      })()`);
      await shot('accounts');
      await contents.executeJavaScript(`(async () => {
        [...document.querySelectorAll('.office-overlay button')].find(b => b.textContent.trim() === 'Sign in with GitHub').click();
        await new Promise(resolve => setTimeout(resolve, 400));
        const title = [...document.querySelectorAll('[role=dialog] h2')].map(h => h.textContent);
        if (!title.includes('Set up GitHub sign-in')) throw new Error('GitHub setup did not open: ' + title);
      })()`);
      await shot('account-setup-github');
      await contents.executeJavaScript(`(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise(resolve => setTimeout(resolve, 300));
        [...document.querySelectorAll('.office-overlay button')].find(b => b.textContent.trim() === 'Sign in with Google').click();
        await new Promise(resolve => setTimeout(resolve, 400));
        const title = [...document.querySelectorAll('[role=dialog] h2')].map(h => h.textContent);
        if (!title.includes('Set up Google sign-in')) throw new Error('Google setup did not open: ' + title);
      })()`);
      await shot('account-setup-google');
      await contents.executeJavaScript(`(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise(resolve => setTimeout(resolve, 300));
      })()`);
      await contents.executeJavaScript(`(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise(resolve => setTimeout(resolve, 300));
        if (document.querySelector('.office-overlay')) throw new Error('Esc did not close the Settings sheet');
        await window.axon.mcpServerDelete('smoke-conn');
      })()`);
      // The context meter sits above a coworker's thread, and opens to its numbers.
      result.meter = await contents.executeJavaScript(`(async () => {
        const wait = (ms = 400) => new Promise(resolve => setTimeout(resolve, ms));
        const { providerId } = window.__smoke;
        const chat = await window.axon.chatCreate(providerId, 'mock-model', null, 'chief-of-staff', { skillIds: [], roleIds: [] }, null, "You are Axon's chief of staff.");
        await window.axon.chatSend(chat.id, 'Say hello', []);
        const find = document.querySelector('input[aria-label="Find a coworker"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(find, 'chief of staff');
        find.dispatchEvent(new Event('input', { bubbles: true }));
        await wait();
        const pick = [...document.querySelectorAll('.office-search-results button')].find(b => b.querySelector('strong')?.textContent === 'Chief of Staff');
        if (!pick) throw new Error('Chief of Staff not in the directory: ' + document.querySelector('.office-search-results')?.textContent);
        pick.click();
        await wait(1200);
        const meter = document.querySelector('.context-meter');
        if (!meter || !meter.textContent.includes(' / ')) throw new Error('Context meter not shown: ' + meter?.textContent);
        meter.querySelector('.context-meter-summary').click();
        await wait();
        if (!meter.textContent.includes('Reserved response:')) throw new Error('Meter details wrong: ' + meter.textContent);
        return meter.textContent;
      })()`);
      await shot('context-meter');
      result.virtualization = await contents.executeJavaScript(`(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        document.querySelector('[aria-label="Conversation options"]').click();
        await wait(200);
        const older = [...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('Endurance history'));
        if (!older) throw new Error('Durable older conversation is missing');
        older.click();
        await wait(1000);
        const page = await window.axon.chatHistoryPage('endurance-ui');
        if (page.total !== 5000 || page.messages.length !== 100 || page.nextBefore !== 4900) throw new Error('History page contract failed');
        const previous = await window.axon.chatHistoryPage('endurance-ui', page.nextBefore);
        if (previous.messages.length !== 100 || previous.messages[0].id !== 'history-4800') throw new Error('Earlier history page failed');
        const snapshot = await window.axon.snapshot();
        if (snapshot.messages.filter(m => m.conversationId === 'endurance-ui').length !== 100) throw new Error('Snapshot sent the full transcript');
        const loadEarlier = [...document.querySelectorAll('button')].find(b => b.textContent === 'Load earlier messages');
        if (!loadEarlier) throw new Error('Earlier history control is missing');
        loadEarlier.click();
        await wait(300);
        const rows = document.querySelectorAll('[data-item-index]').length;
        if (!(rows > 0 && rows < 100)) throw new Error('5000-message history rendered too many rows: ' + rows);
        return { stored: 5000, mountedRows: rows, pagedHistory: true, earlierPage: true };
      })()`);
      result.layeredEscape = await contents.executeJavaScript(`(async () => {
        const { chatId, providerId: id } = window.__smoke;
        // Layered Esc: a modal opened inside the Settings sheet closes first; the sheet stays open.
        const wait = () => new Promise(resolve => setTimeout(resolve, 200));
        document.querySelector('button[aria-label="Office settings"]').click();
        await wait();
        if (document.querySelector('.office-overlay h2')?.textContent !== 'Settings') throw new Error('Settings sheet did not open');
        const addProvider = [...document.querySelectorAll('.office-overlay button')].find(b => b.textContent.includes('Add provider'));
        if (!addProvider) throw new Error('Add provider button missing');
        addProvider.click();
        await wait();
        if (document.querySelectorAll('[role=dialog]').length !== 2) throw new Error('Provider modal did not open over Settings');
        // Test connection from the form itself: the tested endpoint and key are what's typed, before saving.
        const dialog = [...document.querySelectorAll('[role=dialog]')].pop();
        const type = (el, value) => {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        type(dialog.querySelector('input[type=url]'), 'http://127.0.0.1:${globalThis.__axonMockPort}/v1');
        type(dialog.querySelector('input[type=password]'), 'smoke-key-123');
        type(dialog.querySelector('input[aria-label="Add a model ID"]'), 'mock-model');
        await wait();
        [...dialog.querySelectorAll('.model-add button')].find(b => b.textContent.trim() === 'Add').click();
        await wait();
        const testButton = [...dialog.querySelectorAll('button')].find(b => b.textContent.includes('Test connection'));
        if (!testButton) throw new Error('Test connection button missing');
        testButton.click();
        let passed = null;
        for (let i = 0; i < 30 && !passed; i++) { await wait(); passed = dialog.querySelector('.test-results .is-ok .test-model'); }
        if (passed?.textContent !== 'mock-model') throw new Error('Test connection result not shown: ' + dialog.querySelector('.test-results')?.textContent);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await wait();
        if (document.querySelectorAll('[role=dialog]').length !== 1 || !document.querySelector('.office-overlay')) throw new Error('Esc did not close only the provider modal');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await wait();
        if (document.querySelector('.office-overlay')) throw new Error('Esc did not close the Settings sheet');
        await window.axon.chatDelete(chatId); await window.axon.providerDelete(id);
        return true;
      })()`);
      result.title = await contents.executeJavaScript('document.title');
      if (lastAuth !== 'Bearer smoke-key-123')
        throw new Error('API key header not received by provider: ' + lastAuth);
      const sent = bodies
        .filter((body) => body.trim())
        .map((body) => JSON.parse(body))
        .find((body) => body.messages?.some((m) => m.role === 'system'));
      if (!sent) throw new Error('The chat request never reached the provider');
      const system = sent.messages.find((m) => m.role === 'system')?.content || '';
      const r = system.indexOf('<roles>'),
        s = system.indexOf('<skills>');
      if (r < 0 || s < 0 || r > s)
        throw new Error('Roles/skills blocks missing or misordered in system prompt');
      const backendIdx = system.indexOf('## Backend Developer'),
        frontendIdx = system.indexOf('## Frontend Developer');
      if (backendIdx < 0 || frontendIdx < 0 || backendIdx > frontendIdx)
        throw new Error('Workspace roles did not precede conversation roles in system prompt');
      if (!system.includes('## Skill: brainstorming (superpowers)'))
        throw new Error('Selected skill not injected');
      console.log('SMOKE_PASS', JSON.stringify(result));
      const image = await contents.capturePage();
      fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '../test-results/desktop.png'), image.toPNG());
      clearTimeout(timeout);
      mock.close();
      mcpMock.close();
      app.quit();
    } catch (error) {
      console.error('SMOKE_FAIL', error);
      console.error(
        'SMOKE_UI',
        await contents.executeJavaScript('document.body.innerText.slice(0, 1500)').catch(() => 'unavailable')
      );
      clearTimeout(timeout);
      mock.close();
      mcpMock.close();
      app.exit(1);
    }
  });
});
require('../out/main/index.js');
app.on('will-quit', () => {
  console.log('SMOKE_PROFILE', profile);
});
