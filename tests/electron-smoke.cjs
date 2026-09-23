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
fs.writeFileSync(path.join(profile, 'data/db/platform-v1.json'), JSON.stringify({
  version: 1, providers: [{ id: 'seed', name: 'Seed', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1',
    models: [{ id: 'first', displayName: 'First' }, { id: 'workspace', displayName: 'Workspace default' }], enabled: true, createdAt: now, hasApiKey: false }],
  workspaces: [{ id: 'research', name: 'Research test', systemPrompt: 'Research carefully.', defaultProviderId: 'seed', defaultModelId: 'workspace', enabledTools: [], knowledgeDocIds: [], roleIds: ['backend-developer'], fileAccess: { enabled: false, roots: [] }, createdAt: now, updatedAt: now }],
  conversations: [], messages: [], agents: [], documents: [], chunks: [],
  settings: { theme: 'dark', autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true, allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '' }
}));
app.setPath('userData', profile);
// Keep the test window restored and off-screen; the app itself opens maximized.
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
// Loopback-only mock provider. Rejects requests without the expected Bearer key.
let lastAuth = '';
let lastBody = '';
const mock = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (c) => chunks.push(c));
  request.on('end', () => {
    lastBody = Buffer.concat(chunks).toString('utf8');
    lastAuth = String(request.headers.authorization || '');
    if (lastAuth !== 'Bearer smoke-key-123') { response.writeHead(401); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"Hello from Axon mock"}}]}\n\n');
    response.write('data: {"choices":[{}],"usage":{"prompt_tokens":7,"completion_tokens":4}}\n\n');
    response.write('data: [DONE]\n\n');
    response.end();
  });
});
mock.listen(0, '127.0.0.1', () => { globalThis.__axonMockPort = mock.address().port; });
const timeout = setTimeout(() => { console.error('SMOKE_FAIL: timed out'); app.exit(1); }, 30000);
app.on('web-contents-created', (_, contents) => {
  contents.on('did-fail-load', (_, code, description) => console.error('LOAD_FAIL', code, description));
  contents.on('preload-error', (_, file, error) => console.error('PRELOAD_FAIL', file, error.message));
  contents.once('did-finish-load', async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const result = await contents.executeJavaScript(`(async () => {
        if (!window.axon) throw new Error('Missing preload bridge');
        const state = await window.axon.snapshot();
        if (state.version !== 1) throw new Error('Invalid snapshot');
        if (!(state.skills.length > 800) || state.roles.length !== 198) throw new Error('Catalogs missing from snapshot');
        if (typeof require !== 'undefined' || typeof process !== 'undefined') throw new Error('Node exposed in renderer');
        if (!document.querySelector('.office-viewport')) throw new Error('Office did not render');
        if (document.querySelector('.sidebar, .chat-view, .return-to-office')) throw new Error('A page other than the office is reachable');
        const id = crypto.randomUUID();
        await window.axon.providerSave({ id, name: 'Mock provider', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:${globalThis.__axonMockPort}/v1', models: [{ id: 'mock-model', displayName: 'Mock model' }], enabled: true, createdAt: Date.now(), hasApiKey: false }, 'smoke-key-123');
        const chat = await window.axon.chatCreate(id, 'mock-model', 'research', undefined, { skillIds: ['superpowers/brainstorming'], roleIds: ['frontend-developer'] });
        await window.axon.chatSend(chat.id, 'Say hello', []);
        const after = await window.axon.snapshot();
        const assistant = after.messages.find(m => m.conversationId === chat.id && m.role === 'assistant');
        if (!assistant || assistant.content !== 'Hello from Axon mock') throw new Error('Streaming E2E failed: ' + JSON.stringify(assistant));
        if (assistant.usage?.promptTokens !== 7 || assistant.usage?.completionTokens !== 4) throw new Error('Usage not captured: ' + JSON.stringify(assistant.usage));
        await window.axon.chatRename(chat.id, 'Smoke conversation');
        if (!(await window.axon.snapshot()).conversations.some(c => c.title === 'Smoke conversation')) throw new Error('Chat persistence failed');
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
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await wait();
        if (document.querySelectorAll('[role=dialog]').length !== 1 || !document.querySelector('.office-overlay')) throw new Error('Esc did not close only the provider modal');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await wait();
        if (document.querySelector('.office-overlay')) throw new Error('Esc did not close the Settings sheet');
        await window.axon.chatDelete(chat.id); await window.axon.providerDelete(id);
        return { bridge: true, renderer: true, isolation: true, chatCRUD: true, streamingE2E: true, usageE2E: true, selection: true, layeredEscape: true, title: document.title };
      })()`);
      if (lastAuth !== 'Bearer smoke-key-123') throw new Error('API key header not received by provider: ' + lastAuth);
      const sent = JSON.parse(lastBody);
      const system = sent.messages.find((m) => m.role === 'system')?.content || '';
      const r = system.indexOf('<roles>'), s = system.indexOf('<skills>');
      if (r < 0 || s < 0 || r > s) throw new Error('Roles/skills blocks missing or misordered in system prompt');
      const backendIdx = system.indexOf('## Backend Developer'), frontendIdx = system.indexOf('## Frontend Developer');
      if (backendIdx < 0 || frontendIdx < 0 || backendIdx > frontendIdx) throw new Error('Workspace roles did not precede conversation roles in system prompt');
      if (!system.includes('## Skill: brainstorming (superpowers)')) throw new Error('Selected skill not injected');
      console.log('SMOKE_PASS', JSON.stringify(result));
      const image = await contents.capturePage();
      fs.mkdirSync(path.join(__dirname, '../test-results'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '../test-results/desktop.png'), image.toPNG());
      clearTimeout(timeout); mock.close(); app.quit();
    } catch (error) { console.error('SMOKE_FAIL', error); clearTimeout(timeout); mock.close(); app.exit(1); }
  });
});
require('../out/main/index.js');
app.on('will-quit', () => { console.log('SMOKE_PROFILE', profile); });
