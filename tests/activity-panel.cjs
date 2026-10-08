// The coworker's side panel, photographed: the receptionist's chat and planner, a coworker with a
// thread and one without, and the Files room, with how much of the panel the conversation gets.
// Build first (npm run build), then: npx electron tests/activity-panel.cjs [1536x816] [dark]
// Screenshots go to test-results/activity-panel. Only the provider transport is a loopback fixture.
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
const output = path.join(repo, 'test-results/activity-panel');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
// The app still holds files in the profile until it has quit.
app.on('quit', () => {
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    // Left for the next run's tidy-up.
  }
});
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const localDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};

const server = http.createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: {"choices":[{"delta":{"content":"Done."}}]}\n\ndata: [DONE]\n\n');
  });
});

server.listen(0, '127.0.0.1', () => {
  const now = Date.now();
  const conv = (id, agentId, title, at) => ({
    id,
    title,
    workspaceId: null,
    providerId: 'check',
    modelId: 'fixture',
    skillIds: [],
    roleIds: [],
    agentId,
    createdAt: at,
    updatedAt: at
  });
  const say = (id, conversationId, role, content, ago) => ({
    id,
    conversationId,
    role,
    content,
    createdAt: now - ago
  });
  const todo = (id, title, due, extra = {}) => ({
    id,
    kind: 'todo',
    title,
    status: 'open',
    due,
    createdAt: now,
    updatedAt: now,
    ...extra
  });
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
      tasks: [
        todo('t1', 'Call the bank', localDay()),
        todo('t2', 'Send the investor update', `${localDay()}T17:00`),
        todo('t3', 'Book the venue', localDay(2)),
        todo('t4', 'Renew the domain', localDay(-3), { status: 'done', doneAt: now - 3600e3 })
      ],
      conversations: [
        conv('c-rec', 'receptionist', 'My day', now - 60000),
        conv('c-dev', 'frontend-developer', 'Task filters', now - 30000)
      ],
      messages: [
        say('r1', 'c-rec', 'user', 'What is on my calendar today?', 70000),
        say(
          'r2',
          'c-rec',
          'assistant',
          'You have two things today: call the bank, and send the investor update by 17:00. Booking the venue is due in two days.',
          68000
        ),
        say('r3', 'c-rec', 'user', 'Remind me about the investor update an hour before.', 66000),
        say(
          'r4',
          'c-rec',
          'assistant',
          'Done. I will remind you at 16:00. Anything else you would like me to plan?',
          64000
        ),
        say(
          'd1',
          'c-dev',
          'user',
          'Add filters to the task list: status, priority, and sort by due date.',
          40000
        ),
        say(
          'd2',
          'c-dev',
          'assistant',
          'Filters and due-date sorting are in. I added a `useFilteredTasks` hook, a filter bar above the list, and four tests. Everything passes.',
          30000
        )
      ],
      reception: { briefedOn: localDay() },
      settings: {
        theme,
        autoTitleConversations: true,
        defaultTemperature: 0.7,
        defaultMaxTokens: 4096,
        streamDeltas: true,
        allowShellExecution: true,
        shellAllowlist: [],
        sendCrashDiagnostics: false,
        dataDirectoryNote: ''
      }
    })
  );
  require(path.join(repo, 'out/main/index.js'));
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  app.exit(1);
}, 120000);
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
    let failed = false;
    try {
      const evaluate = (script) => contents.executeJavaScript(script);
      const waitFor = async (script, label) => {
        for (let i = 0; i < 150; i++) {
          if (await evaluate(script)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      const snap = async (name) => {
        const image = await contents.capturePage();
        fs.writeFileSync(path.join(output, `${name}-${width}x${height}-${theme}.png`), image.toPNG());
      };
      /** Each part of the panel's height, as a share of the whole. */
      const shares = () =>
        evaluate(`(() => {
          const panel = document.querySelector('.office-activity-panel').getBoundingClientRect();
          const parts = [...document.querySelector('.office-activity-panel').children]
            .filter((e) => !e.hidden && getComputedStyle(e).display !== 'none')
            .map((e) => [e.className.split(' ')[0] || e.tagName, Math.round((e.getBoundingClientRect().height / panel.height) * 100) + '%']);
          return { panel: [Math.round(panel.width), Math.round(panel.height)], parts };
        })()`);
      const choose = async (name) => {
        await evaluate(
          `(() => { const i = document.querySelector('.office-directory input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(name)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`
        );
        await pause(250);
        await evaluate(
          `[...document.querySelectorAll('.office-search-results button')].find((b) => b.querySelector('strong')?.textContent === ${JSON.stringify(name)}).click()`
        );
        await waitFor(
          `document.querySelector('.activity-agent-meta h3')?.textContent === ${JSON.stringify(name)}`,
          name
        );
        await evaluate(`document.querySelector('.coworker-actions button')?.click()`);
        await pause(600);
      };
      const clickTab = async (label) => {
        const found = await evaluate(
          `(() => { const t = [...document.querySelectorAll('.activity-tabs [role=tab]')].find((b) => b.textContent.startsWith(${JSON.stringify(label)})); t?.click(); return !!t; })()`
        );
        await pause(300);
        return found;
      };
      await waitFor(
        'document.querySelector(".office-person-label") && !document.querySelector(".office-loading")',
        'scene'
      );
      await pause(800);

      await choose('Receptionist');
      console.log('receptionist', JSON.stringify(await shares()));
      await snap('1-receptionist-chat');
      if (await clickTab('Planner')) await snap('2-receptionist-planner');
      // Sending from the planner goes back to the chat, where the answer arrives.
      await evaluate(
        `(() => { const t = document.querySelector('.composer-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Thanks'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(80);
      await evaluate('document.querySelector(".composer-btn-send").click()');
      await waitFor(
        'document.querySelector(".activity-tabs [aria-selected=true]")?.textContent === "Chat"',
        'back to the chat'
      );
      await waitFor('document.querySelector(".status-badge.completed")', 'reply');
      await choose('Frontend Developer');
      console.log('frontend', JSON.stringify(await shares()));
      await snap('3-frontend');
      // Who they are, from the portrait; the context chip's numbers, above the message box.
      await evaluate('document.querySelector(".activity-portrait-button").click()');
      await waitFor('document.querySelector(".activity-profile")', 'profile');
      await pause(200);
      await snap('3b-profile');
      await evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
      );
      await waitFor('!document.querySelector(".activity-profile")', 'profile closes on Esc');
      await evaluate('document.querySelector(".context-meter-summary").click()');
      await waitFor('document.querySelector(".context-meter-details")', 'context details');
      await pause(200);
      await snap('3c-context');
      await evaluate(
        'document.querySelector(".composer-textarea").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))'
      );
      await waitFor(
        '!document.querySelector(".context-meter-details")',
        'context details close on a click outside'
      );
      await choose('Designer');
      await snap('4-empty');
      await choose('Files Agent');
      await snap('5-files');
      // The panel never scrolls sideways.
      const spill = await evaluate(
        `(() => { const p = document.querySelector('.office-activity-panel'); return p.scrollWidth - p.clientWidth; })()`
      );
      if (spill > 0) throw new Error('The panel scrolls sideways by ' + spill + 'px');
      console.log('Screenshots in', output);
    } catch (error) {
      failed = true;
      console.error(error);
    }
    clearTimeout(timeout);
    app.exit(failed ? 1 : 0);
  });
});
