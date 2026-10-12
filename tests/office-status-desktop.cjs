// Agent communication and status in the real office window: someone who needs you (amber badge, raised
// hand, amber tag), a coworker who asks a colleague (walks over, bubbles, link, walks back), and a
// task that finishes (green tick, celebrating, green strip). Photographed and measured.
// Build first (npm run build), then:
//   npx electron tests/office-status-desktop.cjs [1536x816] [dark]
// Screenshots go to test-results/status. Only the provider transport is a loopback fixture.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT', error);
  process.exit(1);
});
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const repo = path.resolve(__dirname, '..');
const [width, height] = (process.argv.find((a) => /^\d+x\d+$/.test(a)) ?? '1536x816').split('x').map(Number);
const theme = process.argv.includes('dark') ? 'dark' : 'light';
const output = path.join(repo, 'test-results/status');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.on('quit', () => {
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    // Left for the next run's tidy-up.
  }
});
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const localDay = () => {
  const date = new Date();
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};

/** How long the colleague takes to answer, so there is time to watch the asker walk over. */
const ANSWER_MS = 16000;
const FRONT = 'frontend-developer';
// A colleague a few metres away in the same department, so the walk takes a few seconds.
const BACK = 'full-stack-developer';
const BACK_NAME = 'Full-Stack Developer';
const WAITING = 'research-analyst';

const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    const parsed = JSON.parse(body);
    const system = parsed.messages?.find((message) => message.role === 'system')?.content ?? '';
    const last = parsed.messages?.[parsed.messages.length - 1];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (system.includes('is asking you a question')) {
      setTimeout(
        () =>
          response.end(
            'data: {"choices":[{"delta":{"content":"409 Conflict, with a problem+json body."}}]}\n\ndata: [DONE]\n\n'
          ),
        ANSWER_MS
      );
      return;
    }
    if (last?.role === 'user' && /ask a colleague/i.test(last.content)) {
      const call = {
        index: 0,
        id: 'call_colleague',
        function: {
          name: 'ask_colleague',
          arguments: JSON.stringify({ colleague: BACK_NAME, question: 'Which status code for a conflict?' })
        }
      };
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    response.write('data: {"choices":[{"delta":{"content":"Thanks, that settles it. "}}]}\n\n');
    setTimeout(() => {
      response.write('data: {"choices":[{"delta":{"content":"The conflict code is 409."}}]}\n\n');
      response.end('data: [DONE]\n\n');
    }, 600);
  });
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  app.exit(1);
}, 420000);
app.on('browser-window-created', (_, win) => {
  win.show = () => {
    win.setPosition(-2400, 0);
    win.showInactive();
  };
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(width, height);
});

app.on('web-contents-created', (_, contents) => {
  contents.once('did-finish-load', async () => {
    const failures = [];
    const check = (ok, label) => {
      console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
      if (!ok) failures.push(label);
    };
    try {
      const evaluate = (script) => contents.executeJavaScript(script);
      const snap = async (name) => fs.writeFileSync(path.join(output, name), (await contents.capturePage()).toPNG());
      const waitFor = async (script, label, tries = 150, every = 100) => {
        for (let i = 0; i < tries; i++) {
          if (await evaluate(script)) return true;
          await pause(every);
        }
        console.log(`timed out waiting for: ${label}`);
        return false;
      };
      const handle = (expression) => evaluate(`window.__axonOffice.${expression}`);
      await waitFor('document.querySelector(".office-person-label") && !document.querySelector(".office-loading")', 'office');
      await evaluate("localStorage.setItem('axon.officeDebug', '1')");
      contents.reload();
      await pause(600);
      await waitFor('window.__axonOffice && !document.querySelector(".office-loading")', 'scene after reload');
      await pause(800);

      // ---- 1. Someone who needs you: amber badge over the head, raised hand, amber tag.
      const desk = await handle(`deskPoint('${WAITING}')`);
      await handle(`focus(${desk.x}, ${desk.z}, 12)`);
      check(
        await waitFor(
          `window.__axonOffice.markers().some(m => m.id === '${WAITING}' && m.kind === 'needs' && m.shown)`,
          'needs-you badge'
        ),
        'a stopped task shows the amber "!" badge over its owner'
      );
      check(
        await evaluate(
          `(() => { const b = document.querySelector('.office-beacon.needs'); return !!b && b.getAttribute('role') === 'img' && /needs you/.test(b.getAttribute('aria-label')); })()`
        ),
        'the badge is named for screen readers'
      );
      check(
        await waitFor(`document.querySelector('.office-person-label.is-waiting')`, 'amber tag', 40),
        'their name tag turns amber'
      );
      const tint = await evaluate(
        `(() => { const t = document.querySelector('.office-person-label.is-waiting'); if (!t) return null; const s = getComputedStyle(t); return { bg: s.backgroundColor, left: s.borderLeftColor, top: s.borderTopColor, agent: getComputedStyle(t).getPropertyValue('--agent-color').trim() }; })()`
      );
      console.log('TAG', JSON.stringify(tint));
      check(!!tint && tint.bg !== 'rgb(255, 255, 255)' && tint.left !== tint.top, 'the tag keeps its team colour on the left edge');
      await pause(900);
      await snap('status-needs.png');

      // ---- 2. Asking a colleague: the asker walks over, bubbles over both, a link, then walks back.
      await evaluate(
        `(() => { const input = document.querySelector('[aria-label="Find a coworker"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'front-end'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(150);
      await evaluate('document.querySelector(".office-search-results > button").click()');
      await pause(200);
      await waitFor(`document.querySelector('.coworker-actions button:nth-child(2)') || document.querySelector('.composer-textarea')`, 'ask box');
      if (await evaluate(`!document.querySelector('.composer-textarea')`))
        await evaluate(`document.querySelector('.coworker-actions button:nth-child(2)').click()`);
      await waitFor(`document.querySelector('.composer-textarea')`, 'composer');
      await evaluate(
        `(() => { const input = document.querySelector('.composer-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Please ask a colleague about status codes.'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(100);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      const front = await handle(`deskPoint('${FRONT}')`);
      const back = await handle(`deskPoint('${BACK}')`);
      await handle(`focus(${(front.x + back.x) / 2}, ${(front.z + back.z) / 2}, 11)`);
      check(
        await waitFor(
          `window.__axonOffice.collaborations().some(c => c.helper === '${FRONT}' && c.host === '${BACK}')`,
          'link',
          200
        ),
        'the link is drawn from the asker to the colleague they asked (not the other way round)'
      );
      const near = (a, b, d) => Math.hypot(a.x - b.x, a.z - b.z) < d;
      const arrived = await waitFor(
        `(() => { const v = window.__axonOffice.views().find(v => v.id === '${FRONT}'); return Math.hypot(v.position.x - ${back.x}, v.position.z - ${back.z}) < 2.6 && v.behavior !== 'walking'; })()`,
        'asker at the colleague’s desk',
        160
      );
      check(arrived, 'the asker walks to the colleague’s desk');
      const views = await handle('views()');
      const asker = views.find((v) => v.id === FRONT);
      const answerer = views.find((v) => v.id === BACK);
      check(near(answerer.position, back, 0.8) && answerer.sit > 0.9, 'the colleague stays seated at their own desk');
      check(!!answerer.attention, 'and turns towards the asker');
      const markers = await handle('markers()');
      const asking = markers.find((m) => m.id === FRONT);
      const answering = markers.find((m) => m.id === BACK);
      check(asking?.kind === 'asking', 'the asker is marked as asking');
      check(answering?.kind === 'answering', 'the colleague is marked as answering');
      // With their name tags on screen, the words go in the tags and no extra bubble piles up above them.
      const tagText = (id) => `document.querySelector('.office-person-label[data-anchor="agent:' + ${JSON.stringify(id)} + '"]')?.textContent ?? ''`;
      check((await evaluate(tagText(FRONT))).includes(`Asking ${BACK_NAME}…`), 'the asker’s name tag says whom they are asking');
      check((await evaluate(tagText(BACK))).includes('Answering…'), 'the colleague’s name tag says they are answering');
      check(!asking.shown && !answering.shown, 'no separate bubbles while the name tags show the words');
      await pause(700);
      await snap('status-ask.png');
      // The same moment with the coworker card out of the way, to see who stands where.
      await evaluate(`document.querySelector('.coworker-close')?.click()`);
      await pause(500);
      await snap('status-ask-clear.png');
      // The colleague answers; the asker goes back to their own desk (while their own run carries on).
      check(
        await waitFor(`window.__axonOffice.collaborations().length === 0`, 'link gone', 300),
        'the link goes when the colleague has answered'
      );

      // ---- 3. The answer is in. The asker walks back at once (their own run is finishing too), and
      // when it finishes: a green tick that follows them, a celebration at their desk, a green strip.
      const seen = new Set();
      const bubbles = new Set();
      let tick = false;
      let strip = false;
      let home = false;
      let leftTheVisit = false;
      for (let i = 0; i < 400 && !(tick && strip && home && seen.has('celebrating')); i++) {
        const state = await evaluate(
          `(() => { const v = window.__axonOffice.views().find(v => v.id === '${FRONT}'); return { markers: window.__axonOffice.markers().filter(m => m.shown).map(m => m.id + ':' + m.kind), behavior: v.behavior, x: v.position.x, z: v.position.z, sit: v.sit, strip: window.__axonOffice.screenStrip('${FRONT}') }; })()`
        );
        seen.add(state.behavior);
        for (const m of state.markers) bubbles.add(m);
        const fromHome = Math.hypot(state.x - front.x, state.z - front.z);
        if (fromHome > 1.5) leftTheVisit = true;
        if (leftTheVisit && fromHome < 0.6 && state.sit > 0.9) home = true;
        if (state.markers.includes(`${FRONT}:done`)) {
          // The tick pops in over the first third of a second: photograph it once it is up.
          if (!tick) {
            await pause(450);
            await snap('status-done.png');
          }
          tick = true;
        }
        if (state.strip === 3) strip = true;
        await pause(100);
      }
      check(home, 'the asker walks back to their desk once the answer is in');
      check(tick, `a green tick over the one who just finished (markers seen: ${[...bubbles].join(', ')})`);
      check(seen.has('celebrating'), `they celebrate at their desk (saw ${[...seen].join(', ')})`);
      check(strip, 'their desk screens show the green strip');
      check(
        await waitFor(`!window.__axonOffice.markers().some(m => m.id === '${FRONT}' && m.kind === 'done')`, 'tick over', 80),
        'the tick is only a burst'
      );
    } catch (error) {
      console.error(error);
      failures.push(String(error));
    }
    console.log(failures.length ? `FAILED ${failures.length}` : 'ALL PASSED');
    clearTimeout(timeout);
    server.close();
    app.exit(failures.length ? 1 : 0);
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
          id: 'check',
          name: 'Check',
          kind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          models: [{ id: 'fixture', displayName: 'Fixture' }],
          enabled: true,
          createdAt: now,
          hasApiKey: false
        }
      ],
      workspaces: [],
      agents: [],
      documents: [],
      chunks: [],
      mcpServers: [],
      // A task that was mid-run when the app last closed: it comes back needing a look.
      conversations: [
        {
          id: 'c-waiting',
          title: 'Market scan',
          workspaceId: null,
          providerId: 'check',
          modelId: 'fixture',
          skillIds: [],
          roleIds: [],
          agentId: WAITING,
          createdAt: now - 90000,
          updatedAt: now - 60000
        }
      ],
      messages: [
        { id: 'm1', conversationId: 'c-waiting', role: 'user', content: 'Scan the market for clinics.', createdAt: now - 80000 }
      ],
      tasks: [
        {
          id: 'w-waiting',
          kind: 'work',
          title: 'Scan the market for clinics.',
          status: 'working',
          coworkerId: WAITING,
          conversationId: 'c-waiting',
          runStartedAt: now - 80000,
          createdAt: now - 80000,
          updatedAt: now - 80000
        }
      ],
      reception: { briefedOn: localDay() },
      settings: {
        theme,
        autoTitleConversations: true,
        defaultTemperature: 0.7,
        defaultMaxTokens: 4096,
        streamDeltas: true,
        allowShellExecution: false,
        shellAllowlist: [],
        sendCrashDiagnostics: false,
        dataDirectoryNote: '',
        welcomeDone: true
      }
    })
  );
  require(path.join(repo, 'out/main/index.js'));
});
