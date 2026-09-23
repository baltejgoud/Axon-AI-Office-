// Isolated visual and interaction check. Only the provider transport is a loopback fixture.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../test-results/office');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
// Keep the test window restored and off-screen; the app itself opens maximized.
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
const fixtureFolder = path.join(profile, 'office-files-fixture');
fs.mkdirSync(path.join(fixtureFolder, 'notes'), { recursive: true });
fs.writeFileSync(
  path.join(fixtureFolder, 'notes', 'brief.txt'),
  'Office file context fixture: launch a frontend prototype.'
);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixtureFolder] });
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let providerRequest;
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    providerRequest = JSON.parse(body);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('data: {"choices":[{"delta":{"content":"The office connection is working. "}}]}\n\n');
    setTimeout(() => {
      response.write(
        'data: {"choices":[{"delta":{"content":"This response travelled through Axon’s existing provider pipeline."}}]}\n\n'
      );
      response.end('data: [DONE]\n\n');
    }, 1100);
  });
});
const timeout = setTimeout(() => {
  console.error('OFFICE_CHECK_TIMEOUT');
  app.exit(1);
}, 120000);
app.on('browser-window-created', (_, win) => {
  // Capture the actual sandboxed desktop renderer without interrupting the user's current window.
  win.show = () => {
    win.setPosition(-2200, 0);
    win.showInactive();
  };
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(1600, 960);
});
app.on('web-contents-created', (_, contents) => {
  contents.once('did-finish-load', async () => {
    try {
      const evaluate = (script) => contents.executeJavaScript(script);
      const waitFor = async (script, label) => {
        for (let i = 0; i < 100; i++) {
          if (await evaluate(script)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      await waitFor(
        'document.querySelector(".office-person-label") && !document.querySelector(".office-loading")',
        'scene artwork'
      );
      await pause(500);
      const snap = async (name) =>
        fs.writeFileSync(path.join(output, name), (await contents.capturePage()).toPNG());
      await snap('office-desktop.png');
      assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
      const ids = await evaluate(
        '[...document.querySelectorAll(".office-person-label")].map(b => b.getAttribute("aria-label"))'
      );
      assert.equal(ids.length, 16);
      for (let index = 0; index < 16; index++) {
        await evaluate(`document.querySelectorAll(".office-person-label")[${index}].click()`);
        await pause(60);
        assert.equal(
          await evaluate(
            `document.querySelectorAll(".office-person-label")[${index}].getAttribute("aria-pressed")`
          ),
          'true'
        );
        assert.ok(await evaluate('document.querySelector(".activity-agent-meta h3").textContent'));
      }
      await evaluate('document.querySelectorAll(".office-person-label")[0].click()');
      const win = BrowserWindow.fromWebContents(contents);
      win.setContentSize(1100, 740);
      await pause(400);
      await snap('office-compact.png');
      assert.equal(await evaluate('document.documentElement.scrollWidth > window.innerWidth'), false);
      await evaluate(`document.querySelector('button[aria-label="Team view"]').click()`);
      await waitFor('document.querySelectorAll(".roster-card").length === 16', 'roster');
      await evaluate('document.querySelectorAll(".roster-card")[1].click()');
      await pause(50);
      assert.equal(await evaluate('document.querySelector(".activity-agent-meta h3").textContent'), 'Writer');
      await evaluate(`document.querySelector('button[aria-label="Office view"]').click()`);
      await waitFor(
        'document.querySelector(".office-person-label") && !document.querySelector(".office-loading")',
        'return to scene'
      );
      await evaluate('document.querySelectorAll(".office-person-label")[0].click()');
      await pause(50);
      await evaluate(`(() => {
        const input = document.querySelector('.composer-textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Confirm the office provider connection.');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await pause(70);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor(
        'document.querySelector(".status-badge.working") && document.querySelector(".office-thread .message.assistant")',
        'streaming response'
      );
      await waitFor('document.querySelector(".status-badge.completed")', 'completion');
      assert.match(
        await evaluate('document.querySelector(".office-thread .message.assistant:last-of-type").textContent'),
        /existing provider pipeline/
      );
      assert.ok(
        providerRequest.messages.some(
          (message) => message.role === 'system' && message.content.includes('Research Analyst')
        )
      );
      const result = await evaluate('window.axon.snapshot()');
      assert.ok(result.conversations.some((c) => c.agentId === 'research-analyst'));
      assert.match(
        await evaluate('document.querySelector(".office-thread .message.user").textContent'),
        /Confirm the office provider connection/
      );
      // The office is the only screen.
      assert.equal(await evaluate('document.querySelector(".return-to-office, .sidebar, .chat-view")'), null);
      // The model is fixed once a conversation exists.
      assert.equal(
        await evaluate(`document.querySelector('.activity-composer [aria-label="AI model"]').disabled`),
        true
      );
      // A fresh conversation empties the thread and the next task starts a second conversation.
      await evaluate(`document.querySelector('[aria-label="Conversation options"]').click()`);
      await pause(60);
      await evaluate(
        `[...document.querySelectorAll('.activity-menu [role="menuitem"]')].find(b => b.textContent.includes('New conversation')).click()`
      );
      await pause(80);
      assert.equal(await evaluate('document.querySelector(".office-thread")'), null);
      assert.equal(
        await evaluate(`document.querySelector('.activity-composer [aria-label="AI model"]').disabled`),
        false
      );
      await evaluate(`(() => {
        const input = document.querySelector('.composer-textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Second thread.');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await pause(70);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor('document.querySelector(".status-badge.completed")', 'second thread completion');
      assert.equal(
        (await evaluate('window.axon.snapshot()')).conversations.filter((c) => c.agentId === 'research-analyst')
          .length,
        2
      );
      // Settings and the library open as sheets over the office; Esc closes the top layer only.
      await evaluate(`document.querySelector('[aria-label="Office settings"]').click()`);
      await waitFor('document.querySelector(".office-overlay [role=dialog]")', 'settings overlay');
      assert.equal(await evaluate('document.querySelector(".office-overlay h2").textContent'), 'Settings');
      await pause(400);
      await snap('office-settings.png');
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await pause(80);
      assert.equal(await evaluate('document.querySelector(".office-overlay")'), null);
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }))`);
      await waitFor('document.querySelector(".office-overlay")', 'settings shortcut');
      await evaluate(`document.querySelector('.office-overlay-close').click()`);
      await pause(80);
      await evaluate(`document.querySelector('[aria-label="Open library"]').click()`);
      await waitFor('document.querySelector(".office-overlay h2")', 'library overlay');
      assert.equal(await evaluate('document.querySelector(".office-overlay h2").textContent'), 'Library');
      await pause(400);
      await snap('office-library.png');
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await pause(80);
      assert.equal(await evaluate('document.querySelector(".office-overlay")'), null);
      assert.equal(await evaluate('typeof window.require'), 'undefined');
      win.setContentSize(1600, 960);
      await pause(400);
      await snap('office-response.png');
      await evaluate("document.documentElement.dataset.theme = 'dark'");
      await pause(150);
      await snap('office-dark.png');
      await evaluate("document.documentElement.dataset.theme = 'light'");
      const changeWing = async (name) => {
        await evaluate(
          `(() => { const select = document.querySelector('[aria-label="Office department"]'); select.value = ${JSON.stringify(name)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`
        );
        await waitFor('!document.querySelector(".office-loading")', 'department render');
        await pause(250);
      };
      await changeWing('AI, ML & Data');
      assert.equal(await evaluate('document.querySelectorAll(".office-person-label").length'), 25);
      await snap('office-data-department.png');
      await changeWing('Backend & APIs');
      await evaluate(`document.querySelector('[data-anchor="agent:backend-developer"]').click()`);
      await pause(50);
      await evaluate(
        `(() => { const input = document.querySelector('.composer-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Design a typed API contract.'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(70);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor('document.querySelector(".status-badge.completed")', 'backend task completion');
      assert.ok(
        providerRequest.messages.some(
          (message) => message.role === 'system' && message.content.includes('Backend Developer')
        )
      );
      const backend = (await evaluate('window.axon.snapshot()')).conversations.find(
        (c) => c.agentId === 'backend-developer'
      );
      assert.deepEqual(backend.roleIds, ['backend-developer']);
      await evaluate(
        `(() => { const input = document.querySelector('[aria-label="Find a coworker"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'business analyst'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(100);
      await evaluate('document.querySelector(".office-search-results > button").click()');
      await waitFor(
        'document.querySelector(".activity-agent-meta h3").textContent === "Business Analyst" && !document.querySelector(".office-loading")',
        'search selects specialist'
      );
      assert.equal(
        await evaluate(`document.querySelector('[aria-label="Office department"]').value`),
        'Strategy & Innovation'
      );
      await changeWing('Headquarters');
      await evaluate(`document.querySelector('[data-anchor="agent:files-agent"]').click()`);
      await pause(80);
      assert.ok(await evaluate('document.querySelector(".office-file-open")'));
      await evaluate('document.querySelector(".office-file-open").click()');
      await waitFor('document.querySelector(".office-file-entry")', 'folder listing');
      await evaluate('document.querySelector(".office-file-entry").click()');
      await pause(70);
      await evaluate(
        '[...document.querySelectorAll(".office-file-entry")].find(button => button.textContent.includes("brief.txt")).click()'
      );
      await waitFor('document.querySelector(".office-file-preview")', 'file preview');
      await evaluate('document.querySelector(".office-file-preview button").click()');
      await pause(50);
      assert.match(
        await evaluate('document.querySelector(".activity-composer").textContent'),
        /notes\/brief.txt/
      );
      await snap('office-files-desk.png');
      await evaluate(
        `(() => { const input = document.querySelector('.composer-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Summarize this brief.'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(70);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor('document.querySelector(".status-badge.completed")', 'files task completion');
      assert.ok(
        providerRequest.messages.some(
          (message) => message.role === 'user' && message.content.includes('Office file context fixture')
        )
      );

      await evaluate(`document.querySelector('[data-anchor="agent:frontend-developer"]').click()`);
      win.setContentSize(375, 812);
      await pause(350);
      assert.equal(await evaluate('document.documentElement.scrollWidth > window.innerWidth'), false);
      await snap('office-narrow.png');
      win.setContentSize(1600, 960);
      await pause(350);
      await snap('office-specialist-closeup.png');
      await evaluate(`document.querySelector('[aria-label="Reset view"]').click()`);
      await pause(800);
      await snap('office-expanded.png');
      // WebGL loss should preserve access to all coworker actions.
      await evaluate(
        `document.querySelector('.office-canvas-container canvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true }))`
      );
      await waitFor('document.querySelectorAll(".roster-card").length === 16', 'context loss fallback');
      console.log(
        'OFFICE_CHECK_PASS: artwork, 16 selections, department navigation, catalog search, specialist role context, compact layout, roster, IPC streaming into the side-panel thread, model lock, fresh threads, office-only shell, Settings and Library sheets, persisted role, isolation, WebGL fallback.'
      );
      fs.writeFileSync(
        path.join(output, 'result.txt'),
        'PASS: 207 coworkers across 22 departments; compact layout; scene/roster switching; streamed response via actual IPC/main/provider pipeline with loopback transport; persisted role; renderer isolation; WebGL context loss fallback.'
      );
      clearTimeout(timeout);
      server.close();
      app.exit(0);
    } catch (error) {
      console.error(error);
      clearTimeout(timeout);
      server.close();
      app.exit(1);
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  const now = Date.now();
  fs.mkdirSync(path.join(profile, 'data/db'), { recursive: true });
  fs.writeFileSync(
    path.join(profile, 'data/db/platform-v1.json'),
    JSON.stringify({
      version: 1,
      providers: [
        {
          id: 'office-check',
          name: 'Office check',
          kind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          models: [{ id: 'fixture', displayName: 'Fixture' }],
          enabled: true,
          createdAt: now,
          hasApiKey: false
        }
      ],
      workspaces: [],
      conversations: [],
      messages: [],
      agents: [],
      documents: [],
      chunks: [],
      mcpServers: [],
      settings: {
        theme: 'light',
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
  require('../out/main/index.js');
});
