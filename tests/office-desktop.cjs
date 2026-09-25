// Isolated visual and interaction check. Only the provider transport is a loopback fixture.
// Notifications are logged instead of shown, and collected here.
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const notices = [];
const log = console.log;
console.log = (...args) => {
  if (String(args[0]).startsWith('NOTICE ')) notices.push(args.join(' ').slice(7));
  log(...args);
};
const { app, BrowserWindow, dialog, powerMonitor } = require('electron');
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
/** A local calendar day, 'YYYY-MM-DD', `offset` days from today. */
const localDay = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};
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
    // The receptionist records what she is asked to, with her planner tools.
    if (last?.role === 'user' && parsed.tools?.some((tool) => tool.function?.name === 'add_task')) {
      const call = {
        index: 0,
        id: 'call_planner',
        function: { name: 'add_task', arguments: JSON.stringify({ title: 'Book the venue', due: localDay(1) }) }
      };
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
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
}, 240000);
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
      // The first window of the day opens on the receptionist's briefing, with the planner folded.
      await waitFor('document.querySelector(".briefing-card")', 'morning briefing');
      assert.equal(await evaluate('document.querySelector(".activity-agent-meta h3").textContent'), 'Receptionist');
      assert.match(await evaluate('document.querySelector(".briefing-card").textContent'), /Call the bank/);
      assert.equal(await evaluate('document.querySelector(".planner-body")'), null);
      await snap('c-briefing.png');
      await evaluate('document.querySelector(".briefing-dismiss").click()');
      await waitFor('document.querySelector(".planner-body") && !document.querySelector(".briefing-card")', 'planner after the briefing');
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
      // The opening view shows the district signs; nothing hangs over departments or rooms.
      assert.equal(await evaluate("window.__axonOffice.signs().filter((s) => s.kind === 'district' && s.opacity > 0).length"), 8);
      assert.equal(await evaluate("window.__axonOffice.signs().filter((s) => s.kind !== 'district' && s.kind !== 'nameplate').length"), 0);
      const strip = () =>
        evaluate('[...document.querySelectorAll(".office-team-people button")].map(b => b.title)');
      assert.equal((await strip()).length, 9);
      // Quality: Auto starts on High (drawn sharper, finer shadows); Balanced draws at screen resolution.
      assert.deepEqual(await evaluate('window.__axonOffice.quality()'), { mode: 'auto', level: 'high' });
      await snap('look-high.png');
      await evaluate("window.__axonOffice.setQuality('balanced')");
      await pause(300);
      assert.equal((await evaluate('window.__axonOffice.quality()')).level, 'balanced');
      await snap('look-balanced.png');
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
      // Low-poly Part 2 close-ups: a desk, the core pods and people at work.
      for (const [name, x, z, span] of [
        ['p2-desk', -56.2, -21.8, 9],
        ['p2-pods', -0.6, -0.3, 10],
        ['p2-people', -42.5, -20.6, 9]
      ]) {
        await evaluate(`window.__axonOffice.focus(${x}, ${z}, ${span})`);
        await pause(1800);
        await snap(`${name}.png`);
      }
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
      // Part A's budget (within 10% of the 666 calls measured before it), read on Balanced quality.
      assert.ok(stats.calls <= 733, `draw calls ${stats.calls}`);
      // The low-poly work's triangle ceiling (1.72M before Part 2).
      assert.ok(stats.triangles <= 2.3e6, `triangles ${stats.triangles}`);
      assert.ok(tiers.full <= 40, `full rigs ${tiers.full}`);
      // Role screens: every desk screen is one draw call; the sheet is saved for review.
      const parts = await evaluate('window.__axonOffice.breakdown()');
      assert.equal(parts.screens?.meshes, 1, 'every desk screen is one draw call');
      const sheet = await evaluate('window.__axonOffice.screenSheet()');
      fs.writeFileSync(path.join(output, 'screen-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));
      // The café staff are hidden from afar; they never count as coworkers.
      assert.ok((await evaluate('window.__axonOffice.staff()')).every((s) => !s.visible), 'staff hidden from afar');
      await snap('campus-overview.png');
      // Role screens: one person per role family, close enough to see their monitors. Taken after
      // the campus budget reading, so that reading keeps its timing (walkers are always full rigs).
      for (const id of [
        'frontend-developer',
        'database-administrator',
        'site-reliability-engineer',
        'security-engineer',
        'machine-learning-engineer',
        'game-developer',
        'ui-ux-designer',
        'product-manager',
        'sales-manager',
        'talent-acquisition-manager',
        'marketing-manager',
        'chief-executive-officer'
      ]) {
        const point = await evaluate(`window.__axonOffice.deskPoint(${JSON.stringify(id)})`);
        await evaluate(`window.__axonOffice.focus(${point.x}, ${point.z}, 5)`);
        await pause(1500);
        await snap(`screens-${id}.png`);
      }
      // The status strip follows the owner's real task status, then goes back to nothing. The UI
      // developer sits in a pod's front row, so their screens face the camera.
      for (const [status, code] of [
        ['working', 1],
        ['waiting', 2],
        ['completed', 3],
        ['error', 4],
        ['idle', 0]
      ]) {
        await evaluate(`window.__axonOffice.setStatus('ui-developer', '${status}')`);
        await waitFor(`window.__axonOffice.screenStrip('ui-developer') === ${code}`, `${status} strip`);
        if (status === 'working') {
          const desk = await evaluate(`window.__axonOffice.deskPoint('ui-developer')`);
          await evaluate(`window.__axonOffice.focus(${desk.x}, ${desk.z}, 4)`);
          await pause(1500);
          await snap('screens-status-working.png');
        }
      }
      await evaluate(`document.querySelector('[aria-label="Whole campus"]').click()`);
      await waitFor(
        "window.__axonOffice.signs().filter((s) => s.kind === 'district' && s.opacity === 1).length === 8",
        'district signs again'
      );
      await pause(1500);
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
      // The café, the Lounge and a games corner come after the budget reading above: they send
      // people on breaks, and people away from their desks are drawn in full.
      // Low-poly Part 3: the café. Someone goes for coffee and the barista pulls a shot as they
      // reach the bar; the chefs cook in the open kitchen.
      await evaluate('window.__axonOffice.focus(15.2, -1.6, 10)');
      await pause(1500);
      assert.equal((await evaluate('window.__axonOffice.staff()')).length, 3);
      assert.ok((await evaluate('window.__axonOffice.staff()')).every((s) => s.visible), 'staff drawn close up');
      for (const id of ['writer', 'designer', 'research-analyst', 'product-coach'])
        if (await evaluate(`window.__axonOffice.request('${id}', 'coffee')`)) break;
      let brewed = false;
      for (let i = 0; i < 400 && !brewed; i++) {
        brewed = await evaluate("window.__axonOffice.staff().some((s) => s.id === 'barista' && s.action === 'brew')");
        if (!brewed) await pause(100);
      }
      assert.ok(brewed, 'the barista pulls a shot when someone reaches the bar');
      await pause(600);
      await snap('p3-cafe.png');
      // Staff are not coworkers: clicking the barista selects nobody.
      const selectedBefore = await evaluate('document.querySelector(".activity-agent-meta h3")?.textContent');
      const barista = await evaluate("window.__axonOffice.staffPoint('barista')");
      await evaluate(`(() => {
        const canvas = document.querySelector('.office-canvas-container canvas');
        const r = canvas.getBoundingClientRect();
        const at = { clientX: r.left + ${barista.x}, clientY: r.top + ${barista.y}, button: 0, bubbles: true };
        canvas.dispatchEvent(new MouseEvent('mousemove', at));
        canvas.dispatchEvent(new MouseEvent('mousedown', at));
        window.dispatchEvent(new MouseEvent('mouseup', at));
      })()`);
      await pause(200);
      assert.equal(await evaluate('document.querySelector(".activity-agent-meta h3")?.textContent'), selectedBefore);
      await evaluate('window.__axonOffice.focus(17.8, -1.8, 9)');
      await pause(1800);
      await snap('p3-kitchen.png');
      // Low-poly Part 4: a game on the Lounge TV, with a controller in hand.
      for (const id of ['marketing-strategist', 'writer', 'designer', 'research-analyst', 'product-coach'])
        if (await evaluate(`window.__axonOffice.request('${id}', 'gaming')`)) break;
      await evaluate('window.__axonOffice.focus(-15.5, -11.6, 10)');
      let playing = false;
      for (let i = 0; i < 500 && !playing; i++) {
        playing = (await evaluate('window.__axonOffice.lounge()')).players > 0;
        if (!playing) await pause(100);
      }
      assert.ok(playing, 'someone plays on the Lounge TV');
      await pause(1500);
      const lounge = await evaluate('window.__axonOffice.lounge()');
      assert.equal(lounge.tv, 'game');
      assert.equal(lounge.controllersOnConsole, 2 - lounge.players);
      await snap('p4-lounge.png');
      // A play break in Engineering: foosball with a teammate, or the arcade.
      let player = null;
      for (const id of ['backend-developer', 'api-developer', 'database-developer', 'frontend-developer', 'react-developer', 'web-developer'])
        if (await evaluate(`window.__axonOffice.request('${id}', 'play')`)) {
          player = id;
          break;
        }
      assert.ok(player, 'someone in Engineering takes a play break');
      let at = null;
      for (let i = 0; i < 500 && !at; i++) {
        const view = (await evaluate('window.__axonOffice.views()')).find((v) => v.id === player);
        if (view.behavior === 'foosball' || view.behavior === 'gaming') at = view.position;
        else await pause(100);
      }
      assert.ok(at, `${player} reaches the games corner`);
      await evaluate(`window.__axonOffice.focus(${at.x + 0.6}, ${at.z - 0.4}, 9)`);
      await pause(1800);
      await snap('p4-engineering-games.png');
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
      await evaluate('document.querySelectorAll(".roster-card")[2].click()');
      await pause(50);
      assert.equal(await evaluate('document.querySelector(".activity-agent-meta h3").textContent'), 'Writer');
      await evaluate(`document.querySelector('button[aria-label="Office view"]').click()`);
      await waitFor('window.__axonOffice && !document.querySelector(".office-loading")', 'return to scene');
      await pause(300);
      await evaluate(`document.querySelector('[aria-label="Reset view"]').click()`);
      await pause(600);
      await evaluate('document.querySelectorAll(".office-team-people button")[1].click()');
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
      // Keep running in the tray is on; Start with Windows waits for the installed app.
      await evaluate(`[...document.querySelectorAll('.office-overlay [role="tab"]')].find((t) => t.textContent === 'Appearance').click()`);
      await pause(80);
      const trayBox = (label) =>
        `[...document.querySelectorAll('.office-overlay label.checkbox')].find((l) => l.textContent.includes(${JSON.stringify(label)})).querySelector('input')`;
      assert.equal(await evaluate(`${trayBox('Keep running in the tray')}.checked`), true);
      assert.equal(await evaluate(`${trayBox('Start with Windows')}.disabled`), true);
      // The office quality setting reaches the scene at once.
      const qualitySelect = `[...document.querySelectorAll('.office-overlay .select')].find((s) => [...s.options].some((o) => o.value === 'balanced'))`;
      assert.equal(await evaluate(`${qualitySelect}.value`), 'auto');
      await evaluate(
        `(() => { const s = ${qualitySelect}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'high'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`
      );
      await pause(100);
      assert.deepEqual(await evaluate('window.__axonOffice.quality()'), { mode: 'high', level: 'high' });
      await evaluate(
        `(() => { const s = ${qualitySelect}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'auto'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`
      );
      await pause(100);
      assert.equal((await evaluate('window.__axonOffice.quality()')).mode, 'auto');
      await evaluate("window.__axonOffice.setQuality('balanced')");
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
      // The selected person's tag holds their whole role, however long, inside its box.
      const tagFits = `(() => {
        const tag = document.querySelector('.office-person-label.selected');
        if (!tag || tag.style.visibility === 'hidden') return false;
        const box = tag.getBoundingClientRect();
        return [...tag.querySelectorAll('strong, small')].every((text) => {
          const r = text.getBoundingClientRect();
          return r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.bottom <= box.bottom + 0.5;
        });
      })()`;
      for (const [query, role] of [
        ['distributed systems', 'Distributed Systems Engineer'],
        ['organizational development', 'Organizational Development Manager']
      ]) {
        await searchFor(query);
        await waitFor(
          `document.querySelector(".activity-agent-meta h3").textContent === ${JSON.stringify(role)}`,
          `search selects ${role}`
        );
        await waitFor(
          `document.querySelector('.office-person-label.selected strong')?.textContent === ${JSON.stringify(role)}`,
          `tag for ${role}`
        );
        await pause(1500);
        assert.ok(await evaluate(tagFits), `${role} fits its tag`);
        await snap(`tag-${role.split(' ')[0].toLowerCase()}.png`);
      }
      // Files room: open a folder, tick a file and hand it to the Frontend Developer.
      await searchFor('files agent');
      await waitFor('document.querySelector(".office-files-hub .office-file-open")', 'folder wall');
      await evaluate('document.querySelector(".office-file-open").click()');
      await waitFor('document.querySelector(".office-file-entry")', 'folder listing');
      // The wall refreshes a moment after the listing appears.
      await waitFor('document.querySelectorAll(".office-folder-cabinet:not(.add)").length === 1', 'folder on the wall');
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

      // The Today board behind the front desk lists what's next and opens the receptionist's planner.
      await evaluate('window.__axonOffice.focus(1.4, 11.8, 7)');
      await pause(1800);
      await waitFor(
        `window.__axonOffice.boards().find((b) => b.team === 'Today').cards.some((c) => c.title === 'Today — Call the bank')`,
        'the Today board'
      );
      const today = await evaluate(`window.__axonOffice.boardPoint('Today')`);
      await evaluate(`(() => {
        const canvas = document.querySelector('.office-canvas-container canvas');
        const r = canvas.getBoundingClientRect();
        const at = { clientX: r.left + ${today.x}, clientY: r.top + ${today.y}, button: 0, bubbles: true };
        canvas.dispatchEvent(new MouseEvent('mousemove', at));
        canvas.dispatchEvent(new MouseEvent('mousedown', at));
        window.dispatchEvent(new MouseEvent('mouseup', at));
      })()`);
      await waitFor(
        'document.querySelector(".activity-agent-meta h3")?.textContent === "Receptionist" && document.querySelector(".planner-body")',
        'the Today board opens the planner'
      );
      const plannerGroup = (title) =>
        `[...document.querySelectorAll('.planner-group')].find((g) => g.firstElementChild.textContent.startsWith(${JSON.stringify(title)}))?.textContent ?? ''`;
      const setValue = (selector, value, prototype = 'HTMLInputElement') =>
        evaluate(`(() => {
          const input = document.querySelector(${JSON.stringify(selector)});
          Object.getOwnPropertyDescriptor(${prototype}.prototype, 'value').set.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
      const deck = `window.axon.snapshot().then((s) => s.tasks.find((t) => t.title === 'Prep the investor deck'))`;
      // Add a to-do for today from the planner's own row.
      await setValue('.planner-add-title', 'Prep the investor deck');
      await setValue('.planner-add-date', localDay());
      await pause(60);
      await evaluate('document.querySelector(".planner-add button[type=submit]").click()');
      await waitFor(`(${plannerGroup('Today')}).includes('Prep the investor deck')`, 'a new to-do under Today');
      // Tick it: it goes to Done. Untick it: it comes back.
      const deckRow = `[...document.querySelectorAll('.planner-row')].find((r) => r.textContent.includes('Prep the investor deck'))`;
      await evaluate(`${deckRow}.querySelector('input[type=checkbox]').click()`);
      await waitFor(`${deck}.then((t) => t.status === 'done')`, 'ticked off');
      await waitFor(`!(${plannerGroup('Today')}).includes('Prep the investor deck')`, 'gone from Today');
      await evaluate(`document.querySelector('.planner-group-toggle').click()`);
      await waitFor(deckRow, 'shown under Done');
      await evaluate(`${deckRow}.querySelector('input[type=checkbox]').click()`);
      await waitFor(`${deck}.then((t) => t.status === 'open' && !t.doneAt)`, 'unticked');
      // Reschedule it to tomorrow at 10:00 with a reminder.
      await evaluate(`${deckRow}.querySelector('.planner-due').click()`);
      await waitFor('document.querySelector(".planner-due-editor")', 'date editor');
      await setValue('.planner-due-editor input[type=date]', localDay(1));
      await setValue('.planner-due-editor input[type=time]', '10:00');
      await evaluate(`document.querySelector('.planner-remind input').click()`);
      await pause(60);
      await evaluate(`document.querySelector('.planner-due-actions .primary').click()`);
      await waitFor(`${deck}.then((t) => t.due === '${localDay(1)}T10:00')`, 'rescheduled');
      const rescheduled = await evaluate(deck);
      const [y, m, d] = localDay(1).split('-').map(Number);
      assert.equal(rescheduled.remindAt, new Date(y, m - 1, d, 10, 0).getTime());
      await waitFor(`(${plannerGroup('This week')}).includes('Prep the investor deck')`, 'moved to This week');
      await waitFor(
        `window.__axonOffice.boards().find((b) => b.team === 'Today').cards.some((c) => c.title === 'Tomorrow — Prep the investor deck')`,
        'the Today board follows'
      );
      // Asked in her conversation, she records it with her tools, and her card says so.
      await evaluate(
        `(() => { const input = document.querySelector('.composer-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Remind me to book the venue tomorrow.'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(70);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor('document.querySelector(".planner-card")?.textContent.includes("Added: Book the venue")', 'planner card');
      assert.match(await evaluate('document.querySelector(".planner-card").textContent'), /due Tomorrow/);
      await waitFor(`(${plannerGroup('This week')}).includes('Book the venue')`, 'her to-do in the planner');
      assert.ok(providerRequest.messages.some((message) => message.role === 'system' && /Now: .* Today is /.test(message.content)));
      await snap('c-reception.png');
      // A reminder fires once, on time, as a notification that leads to her planner.
      await evaluate(`window.axon.taskAdd({ title: 'Stand-up', remindAt: Date.now() + 2500 })`);
      await waitFor(
        `window.axon.snapshot().then((s) => s.tasks.some((t) => t.title === 'Stand-up' && t.remindedAt))`,
        'the reminder fires'
      );
      assert.deepEqual(notices, ['Reminder — Stand-up']);
      await evaluate('window.__axonOffice.focus(1.4, 11.8, 7)');
      await pause(1500);
      await snap('c-today-board.png');
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
          await evaluate("window.__axonOffice.setQuality('balanced')");
          await pause(2000);
          // The frame rate is the median of ten readings over five seconds: one reading swings
          // with whatever else the machine is doing.
          const readings = [];
          for (let i = 0; i < 10; i++) {
            await pause(500);
            readings.push((await evaluate('window.__axonOffice.stats()')).fps);
          }
          const big = { ...(await evaluate('window.__axonOffice.stats()')), fps: [...readings].sort((a, b) => a - b)[5] };
          // Minutes in, people away from their desks are drawn in full, so the count here varies
          // with office life; the draw budget is checked at the controlled moment above.
          // The 50 fps floor is read on mains power, as agreed: on battery Windows holds the GPU
          // back, so the reading is reported but not gated.
          const onBattery = powerMonitor.isOnBatteryPower();
          console.log('CAMPUS_STATS_1080P', JSON.stringify(big), JSON.stringify(readings), JSON.stringify(await evaluate('window.__axonOffice.tiers()')), onBattery ? 'ON_BATTERY' : 'ON_MAINS');
          if (onBattery) console.log(`FPS_FLOOR_NOT_CHECKED_ON_BATTERY: ${big.fps} fps at 1080p`);
          else assert.ok(big.fps >= 50, `fps at 1080p ${big.fps}`);
          // High is measured and reported, not gated.
          await evaluate("window.__axonOffice.setQuality('high')");
          await pause(3000);
          console.log('CAMPUS_STATS_1080P_HIGH', JSON.stringify(await evaluate('window.__axonOffice.stats()')));
          await snap('a-1920-campus-high.png');
          await evaluate("window.__axonOffice.setQuality('balanced')");
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
        'OFFICE_CHECK_PASS: campus artwork, one-line district chips, world signs (visible by zoom, clickable), model chip, name tags, task boards and team list, colleagues asked and answering, the morning briefing, the receptionist’s planner (add, tick, reschedule, her tools), a reminder, the Today board, tray settings, core team strip, draw-call budget, department menu, specialty search, specialist role context, compact layout, roster, IPC streaming into the side-panel thread, model lock, fresh threads, office-only shell, Settings and Library sheets, Files room hand-to, persisted role, isolation, WebGL fallback.'
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
      // Something to brief, and a briefing not yet given today.
      tasks: [
        { id: 'seed-bank', kind: 'todo', title: 'Call the bank', status: 'open', due: localDay(), createdAt: now, updatedAt: now }
      ],
      reception: { briefedOn: localDay(-1) },
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
