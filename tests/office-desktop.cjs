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
    const parsed = JSON.parse(body);
    const system = parsed.messages?.find((message) => message.role === 'system')?.content ?? '';
    const last = parsed.messages?.[parsed.messages.length - 1];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // A colleague answering a question.
    if (system.includes('is asking you a question')) {
      response.end(
        'data: {"choices":[{"delta":{"content":"409 Conflict, with a problem+json body."}}]}\n\ndata: [DONE]\n\n'
      );
      return;
    }
    providerRequest = parsed;
    // A coworker asked to consult someone calls ask_colleague first.
    if (last?.role === 'user' && /ask a colleague/i.test(last.content)) {
      const call = {
        index: 0,
        id: 'call_colleague',
        function: {
          name: 'ask_colleague',
          arguments: JSON.stringify({ colleague: 'Backend Developer', question: 'Which status code for a conflict?' })
        }
      };
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
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
      // District chips on one line: the ones that fit plus those in the More menu make all eight.
      const chipCount = `document.querySelectorAll('.office-district-chips > button').length + Number(document.querySelector('.office-chip-more')?.dataset.hidden ?? 0)`;
      assert.equal(await evaluate(chipCount), 8);
      assert.equal(
        await evaluate('document.querySelector(".office-district-chips > button.active").textContent'),
        'Commons'
      );
      // Signs in the world replace the floating district, department and room labels.
      assert.equal(
        await evaluate('document.querySelector(".office-district-card, .office-department-label, .office-zone-label")'),
        null
      );
      // Debug handle for camera moves and performance readings.
      await evaluate("localStorage.setItem('axon.officeDebug', '1')");
      contents.reload();
      await pause(600);
      await waitFor(
        'window.__axonOffice && !document.querySelector(".office-loading")',
        'scene after reload'
      );
      await pause(800);
      // The opening view shows the Commons room signs and the district signs around them.
      assert.ok(await evaluate('window.__axonOffice.signs().filter((s) => s.opacity > 0).length > 6'));
      const strip = () =>
        evaluate('[...document.querySelectorAll(".office-team-people button")].map(b => b.title)');
      assert.equal((await strip()).length, 9);
      // Portraits are rendered from each person's 3D figure.
      await waitFor(
        'document.querySelectorAll(".office-team-people .office-portrait img").length === 9',
        'rendered portraits'
      );
      assert.match(
        await evaluate('document.querySelector(".office-team-caption strong").textContent'),
        /Commons/
      );
      for (let index = 0; index < 8; index++) {
        await evaluate(`document.querySelectorAll(".office-team-people button")[${index}].click()`);
        await pause(80);
        assert.equal(
          await evaluate(
            `document.querySelectorAll(".office-team-people button")[${index}].getAttribute("aria-pressed")`
          ),
          'true'
        );
        assert.ok(await evaluate('document.querySelector(".activity-agent-meta h3").textContent'));
      }
      // The composer's model chip shows a short name over the native select, and the hint stays.
      assert.equal(
        await evaluate('document.querySelector(".activity-composer .model-chip-label").textContent'),
        'Fixture'
      );
      assert.equal(
        await evaluate(`document.querySelector('.activity-composer [aria-label="AI model"]').tagName`),
        'SELECT'
      );
      assert.equal(
        await evaluate('getComputedStyle(document.querySelector(".composer-hint")).display'),
        'block'
      );
      // Close up, people get name tags.
      await evaluate('window.__axonOffice.focus(0.2, 0.7, 10)');
      await waitFor('document.querySelectorAll(".office-person-label").length >= 3', 'name tags close up');
      await snap('campus-pods.png');
      // Whole campus: every district sign at full strength, and performance within budget.
      await evaluate(`document.querySelector('[aria-label="Whole campus"]').click()`);
      await waitFor(
        "window.__axonOffice.signs().filter((s) => s.kind === 'district' && s.opacity === 1).length === 8",
        'district signs'
      );
      await pause(3000);
      const stats = await evaluate('window.__axonOffice.stats()');
      const tiers = await evaluate('window.__axonOffice.tiers()');
      console.log('CAMPUS_STATS', JSON.stringify(stats), JSON.stringify(tiers));
      // Part A's budget: within 10% of the 666 calls measured before it.
      assert.ok(stats.calls <= 733, `draw calls ${stats.calls}`);
      assert.ok(tiers.full <= 40, `full rigs ${tiers.full}`);
      await snap('campus-overview.png');
      // Clicking a district sign glides there, like its chip.
      const sign = await evaluate("window.__axonOffice.signPoint('district:engineering')");
      await evaluate(`(() => {
        const canvas = document.querySelector('.office-canvas-container canvas');
        const r = canvas.getBoundingClientRect();
        const at = { clientX: r.left + ${sign.x}, clientY: r.top + ${sign.y}, button: 0, bubbles: true };
        canvas.dispatchEvent(new MouseEvent('mousemove', at));
        canvas.dispatchEvent(new MouseEvent('mousedown', at));
        window.dispatchEvent(new MouseEvent('mouseup', at));
      })()`);
      await waitFor(
        'document.querySelector(".office-district-chips > button.active")?.textContent === "Engineering"',
        'sign click glides to Engineering'
      );
      const win = BrowserWindow.fromWebContents(contents);
      win.setContentSize(1100, 740);
      await pause(400);
      await snap('office-compact.png');
      // A narrow window keeps the chips on one line, with the rest in the More menu.
      assert.ok(await evaluate('document.querySelector(".office-district-chips").offsetHeight <= 44'));
      assert.equal(await evaluate(chipCount), 8);
      assert.equal(await evaluate('document.documentElement.scrollWidth > window.innerWidth'), false);
      await evaluate(`document.querySelector('button[aria-label="Team view"]').click()`);
      await waitFor('document.querySelectorAll(".roster-card").length === 208', 'roster');
      assert.equal(await evaluate('document.querySelectorAll(".roster-district").length'), 8);
      await evaluate('document.querySelectorAll(".roster-card")[1].click()');
      await pause(50);
      assert.equal(await evaluate('document.querySelector(".activity-agent-meta h3").textContent'), 'Writer');
      await evaluate(`document.querySelector('button[aria-label="Office view"]').click()`);
      await waitFor('window.__axonOffice && !document.querySelector(".office-loading")', 'return to scene');
      await pause(300);
      await evaluate(`document.querySelector('[aria-label="Reset view"]').click()`);
      await pause(600);
      await evaluate('document.querySelectorAll(".office-team-people button")[0].click()');
      await pause(50);
      assert.equal(
        await evaluate('document.querySelector(".activity-agent-meta h3").textContent'),
        'Research Analyst'
      );
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
        await evaluate(
          'document.querySelector(".office-thread .message.assistant:last-of-type").textContent'
        ),
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
        (await evaluate('window.axon.snapshot()')).conversations.filter(
          (c) => c.agentId === 'research-analyst'
        ).length,
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
      const goToDepartment = async (name) => {
        await evaluate(`document.querySelector('.office-department-trigger').click()`);
        await waitFor('document.querySelector(".office-department-popover")', 'department menu');
        await evaluate(
          `[...document.querySelectorAll('.office-department-list [role="option"]')].find(b => b.textContent.includes(${JSON.stringify(name)})).click()`
        );
        await pause(1500);
      };
      await goToDepartment('AI, ML & Data');
      assert.equal(
        await evaluate('document.querySelector(".office-team-caption strong").textContent'),
        'AI, ML & Data'
      );
      assert.equal((await strip()).length, 17);
      await snap('campus-ai-data.png');
      await goToDepartment('Backend & APIs');
      await evaluate(
        `[...document.querySelectorAll(".office-team-people button")].find(b => b.title.startsWith("Backend Developer ·")).click()`
      );
      await pause(80);
      assert.equal(
        await evaluate('document.querySelector(".activity-agent-meta h3").textContent'),
        'Backend Developer'
      );
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
      const searchFor = async (text) => {
        await evaluate(
          `(() => { const input = document.querySelector('[aria-label="Find a coworker"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
        );
        await pause(100);
        await evaluate('document.querySelector(".office-search-results > button").click()');
        await pause(100);
      };
      // Files room: open a folder, tick a file and hand it to the Frontend Developer.
      await searchFor('files agent');
      await waitFor('document.querySelector(".office-files-hub .office-file-open")', 'folder wall');
      await evaluate('document.querySelector(".office-file-open").click()');
      await waitFor('document.querySelector(".office-file-entry")', 'folder listing');
      assert.equal(await evaluate('document.querySelectorAll(".office-folder-cabinet:not(.add)").length'), 1);
      await evaluate(
        '[...document.querySelectorAll(".office-file-entry")].find(button => button.textContent.includes("notes")).click()'
      );
      await pause(70);
      await evaluate(
        '[...document.querySelectorAll(".office-file-entry")].find(button => button.textContent.includes("brief.txt")).click()'
      );
      await pause(50);
      assert.equal(
        await evaluate('document.querySelector(".office-file-entry.picked").getAttribute("aria-checked")'),
        'true'
      );
      await evaluate('document.querySelector(".office-hand-to").click()');
      await waitFor('document.querySelector(".office-hand-picker input")', 'hand-to picker');
      await evaluate(
        `(() => { const input = document.querySelector('.office-hand-picker input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'frontend'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(80);
      await evaluate('document.querySelector(".office-hand-list > button").click()');
      await waitFor(
        'document.querySelector(".activity-agent-meta h3").textContent === "Frontend Developer" && document.querySelector(".composer-attachment-tag.handed")',
        'files handed to the frontend developer'
      );
      assert.match(await evaluate('document.querySelector(".composer-handed").textContent'), /brief\.txt/);
      await snap('office-files-hand-to.png');
      await evaluate(
        `(() => { const input = document.querySelector('.composer-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Summarize this brief.'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(70);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor('document.querySelector(".status-badge.completed")', 'files task completion');
      assert.ok(
        providerRequest.messages.some(
          (message) =>
            message.role === 'user' &&
            message.content.includes('<file path="notes/brief.txt">') &&
            message.content.includes('Office file context fixture')
        )
      );
      assert.equal(await evaluate('document.querySelector(".composer-attachment-tag.handed")'), null);
      assert.match(
        await evaluate('[...document.querySelectorAll(".office-thread .message.user")].pop().textContent'),
        /Summarize this brief\./
      );
      assert.doesNotMatch(
        await evaluate('[...document.querySelectorAll(".office-thread .message.user")].pop().textContent'),
        /file path=/
      );

      await searchFor('front-end');
      assert.equal(
        await evaluate('document.querySelector(".activity-agent-meta h3").textContent'),
        'Frontend Developer'
      );
      // Coworkers ask colleagues: a card in the thread, a help record, and a card on the colleague's board.
      await evaluate(
        `(() => { const input = document.querySelector('.composer-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Please ask a colleague about status codes.'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(70);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor(
        'document.querySelector(".colleague-card")?.textContent.includes("409 Conflict")',
        'colleague card with the answer'
      );
      assert.match(await evaluate('document.querySelector(".colleague-card").textContent'), /Backend Developer/);
      await waitFor(
        `window.axon.snapshot().then((s) => s.tasks.some((t) => t.kind === 'work' && t.coworkerId === 'frontend-developer' && t.status === 'done' && s.tasks.some((h) => h.kind === 'help' && h.createdAt >= t.runStartedAt)))`,
        'the asking run finishes'
      );
      const records = (await evaluate('window.axon.snapshot()')).tasks;
      assert.ok(
        records.some(
          (t) =>
            t.kind === 'help' &&
            t.status === 'done' &&
            t.coworkerId === 'backend-developer' &&
            t.forCoworkerId === 'frontend-developer'
        ),
        'help record'
      );
      await waitFor('document.querySelector(".status-badge.completed")', 'asker shows completed');
      await waitFor(
        `window.__axonOffice.boards().find((b) => b.team === 'Backend & APIs').cards.some((c) => c.title === 'Helping Frontend')`,
        'help card on the Backend board'
      );
      // The board opens the team's task list; Esc goes back to the coworker.
      await evaluate('window.__axonOffice.focus(-42.5, -29.5, 7)');
      await pause(1800);
      await snap('b-board-closeup.png');
      const board = await evaluate(`window.__axonOffice.boardPoint('Backend & APIs')`);
      await evaluate(`(() => {
        const canvas = document.querySelector('.office-canvas-container canvas');
        const r = canvas.getBoundingClientRect();
        const at = { clientX: r.left + ${board.x}, clientY: r.top + ${board.y}, button: 0, bubbles: true };
        canvas.dispatchEvent(new MouseEvent('mousemove', at));
        canvas.dispatchEvent(new MouseEvent('mousedown', at));
        window.dispatchEvent(new MouseEvent('mouseup', at));
      })()`);
      await waitFor('document.querySelector(".team-list")', 'team list from the board');
      assert.match(await evaluate('document.querySelector(".team-list").textContent'), /Helping Frontend Developer/);
      await snap('b-team-list.png');
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
      await pause(120);
      assert.equal(await evaluate('document.querySelector(".team-list")'), null);
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
      // Screenshots for review at two window sizes: the opening view, Engineering, a pod, the
      // executive offices (nameplates) and the whole campus.
      for (const [width, height] of [
        [1920, 1080],
        [1366, 768]
      ]) {
        win.setContentSize(width, height);
        await pause(500);
        await evaluate(`document.querySelector('[aria-label="Reset view"]').click()`);
        await pause(1500);
        await snap(`a-${width}-opening.png`);
        for (const [name, x, z, span] of [
          ['engineering', -42.5, 0, 56],
          ['pods', -0.6, -0.3, 10],
          ['executive', 50, -22, 8]
        ]) {
          await evaluate(`window.__axonOffice.focus(${x}, ${z}, ${span})`);
          await pause(1800);
          await snap(`a-${width}-${name}.png`);
        }
        assert.equal(
          await evaluate("window.__axonOffice.signs().filter((s) => s.kind === 'nameplate' && s.opacity === 1).length"),
          10
        );
        await evaluate(`document.querySelector('[aria-label="Whole campus"]').click()`);
        await pause(2000);
        await snap(`a-${width}-campus.png`);
        if (width === 1920) {
          await pause(2000);
          const big = await evaluate('window.__axonOffice.stats()');
          // Minutes in, people away from their desks are drawn in full, so the count here varies
          // with office life; the draw budget is checked at the controlled moment above.
          console.log('CAMPUS_STATS_1080P', JSON.stringify(big), JSON.stringify(await evaluate('window.__axonOffice.tiers()')));
          assert.ok(big.fps >= 50, `fps at 1080p ${big.fps}`);
        }
      }
      await evaluate("document.documentElement.dataset.theme = 'dark'");
      await pause(200);
      await snap('a-1366-dark.png');
      await evaluate("document.documentElement.dataset.theme = 'light'");
      win.setContentSize(1600, 960);
      await pause(400);
      // WebGL loss should preserve access to all coworker actions.
      await evaluate(
        `document.querySelector('.office-canvas-container canvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true }))`
      );
      await waitFor('document.querySelectorAll(".roster-card").length === 208', 'context loss fallback');
      console.log(
        'OFFICE_CHECK_PASS: campus artwork, one-line district chips, world signs (visible by zoom, clickable), model chip, name tags, task boards and team list, colleagues asked and answering, core team strip, draw-call budget, department menu, specialty search, specialist role context, compact layout, roster, IPC streaming into the side-panel thread, model lock, fresh threads, office-only shell, Settings and Library sheets, Files room hand-to, persisted role, isolation, WebGL fallback.'
      );
      fs.writeFileSync(
        path.join(output, 'result.txt'),
        'PASS: 208 coworkers across 22 departments; compact layout; scene/roster switching; streamed response via actual IPC/main/provider pipeline with loopback transport; persisted role; renderer isolation; WebGL context loss fallback.'
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
