// Desktop check: Stop and messages sent while a coworker works, in the real office window.
// Run after a build: npx electron-vite build && npx electron tests/composer-stop.cjs
// A loopback model holds its first answer open until stopped, so the run is still going when we act.
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../test-results/composer');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const localDay = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};

/** The last user message of every request the model got. */
const asked = [];
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    const parsed = JSON.parse(body);
    const last = parsed.messages?.[parsed.messages.length - 1];
    asked.push(typeof last?.content === 'string' ? last.content : '');
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (last?.content === 'Long job') {
      // Starts answering, then keeps going until the run is stopped.
      response.write('data: {"choices":[{"delta":{"content":"Working on the long job…"}}]}\n\n');
      // The response closes when Axon aborts the request (a request's own close fires once its body is read).
      response.on('close', () => response.end());
      return;
    }
    response.end('data: {"choices":[{"delta":{"content":"Switched to the new request."}}]}\n\ndata: [DONE]\n\n');
  });
});
const timeout = setTimeout(() => {
  console.error('COMPOSER_CHECK_TIMEOUT');
  app.exit(1);
}, 120000);
app.on('browser-window-created', (_, win) => {
  win.show = () => {
    win.setPosition(-2200, 0);
    win.showInactive();
  };
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(1536, 816);
});
app.on('web-contents-created', (_, contents) => {
  contents.once('did-finish-load', async () => {
    try {
      const evaluate = (script) => contents.executeJavaScript(script);
      const waitFor = async (script, label) => {
        for (let i = 0; i < 150; i++) {
          if (await evaluate(script)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      const snap = async (name) => fs.writeFileSync(path.join(output, name), (await contents.capturePage()).toPNG());
      const type = (text) =>
        evaluate(
          `(() => { const input = document.querySelector('.composer-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
        );
      await waitFor('document.querySelector(".office-person-label") && !document.querySelector(".office-loading")', 'the office');
      await pause(500);
      await evaluate(
        `(() => { const input = document.querySelector('[aria-label="Find a coworker"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'backend developer'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(150);
      await evaluate('document.querySelector(".office-search-results > button").click()');
      await waitFor('document.querySelector(".activity-agent-meta h3")?.textContent === "Backend Developer"', 'Backend Developer');

      // 1. A task goes out: Stop appears, and the box stays open for more.
      await type('Long job');
      await pause(80);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor('document.querySelector(".composer-btn-stop")', 'the Stop button');
      for (let i = 0; i < 50 && !asked.length; i++) await pause(100);
      assert.deepEqual(asked, ['Long job'], 'the model is answering the first task');
      assert.equal(await evaluate('document.querySelector(".composer-textarea").disabled'), false, 'the box stays usable while they work');
      await snap('1-running.png');

      // 2. A message sent meanwhile waits for their next step, shown above the box.
      await type('Do this instead');
      await pause(80);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor('document.querySelector(".composer-queued-item")', 'the waiting message');
      assert.match(await evaluate('document.querySelector(".composer-queued").textContent'), /Do this instead/);
      assert.equal(await evaluate('document.querySelector(".composer-textarea").value'), '', 'the box is cleared once it is queued');
      await snap('2-queued.png');

      // 3. Stop: the long job ends, the waiting message goes next, and its answer arrives.
      await evaluate('document.querySelector(".composer-btn-stop").click()');
      await waitFor('!document.querySelector(".composer-queued-item") && !document.querySelector(".composer-btn-stop")', 'the run after Stop to finish');
      const snapshot = await evaluate('window.axon.snapshot()');
      const chat = snapshot.conversations.find((c) => c.agentId === 'backend-developer');
      const thread = snapshot.messages
        .filter((m) => m.conversationId === chat.id && m.role !== 'system')
        .map((m) => [m.role, m.content, m.error ?? null]);
      assert.deepEqual(thread, [
        ['user', 'Long job', null],
        ['assistant', 'Working on the long job…', 'Generation stopped.'],
        ['user', 'Do this instead', null],
        ['assistant', 'Switched to the new request.', null]
      ]);
      assert.deepEqual(asked, ['Long job', 'Do this instead']);
      await pause(300);
      await snap('3-after-stop.png');

      // 4. Esc in an empty box stops a run too.
      await type('Long job');
      await pause(80);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor('document.querySelector(".composer-btn-stop")', 'the second run');
      await evaluate(
        `document.querySelector('.composer-textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
      );
      await waitFor('!document.querySelector(".composer-btn-stop")', 'Esc to stop the run');
      console.log('COMPOSER_CHECK_PASS', output);
      clearTimeout(timeout);
      server.close();
      app.quit();
    } catch (error) {
      console.error('COMPOSER_CHECK_FAIL', error);
      try {
        fs.writeFileSync(path.join(output, 'failure.png'), (await contents.capturePage()).toPNG());
      } catch {}
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
          id: 'mock', name: 'Mock', kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          models: [{ id: 'mock-model', displayName: 'Mock model' }], enabled: true, createdAt: now, hasApiKey: false
        }
      ],
      workspaces: [], conversations: [], messages: [], agents: [], documents: [], chunks: [], mcpServers: [], tasks: [],
      reception: { briefedOn: localDay() },
      settings: {
        theme: 'light', autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true,
        allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: ''
      }
    })
  );
  require('../out/main/index.js');
});
