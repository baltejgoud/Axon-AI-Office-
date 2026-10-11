// The friendlier-Axon checks in the real window: approvals that wait, the welcome guide, Ctrl+K finding
// past conversations, Undo all, each task's cost and the spending limit, the scrub bar, team-coloured
// rings with search highlighting, and deleting a conversation. Photographed and measured.
// Build first (npm run build), then:
//   npx electron tests/friendly-desktop.cjs [1536x816] [dark]        (seeded office)
//   npx electron tests/friendly-desktop.cjs fresh [1536x816] [dark]  (a first start: the welcome guide)
// Screenshots go to test-results/friendly. Only the provider transport is a loopback fixture.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT', error);
  process.exit(1);
});
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '..');
const [width, height] = (process.argv.find((a) => /^\d+x\d+$/.test(a)) ?? '1536x816').split('x').map(Number);
const theme = process.argv.includes('dark') ? 'dark' : 'light';
const fresh = process.argv.includes('fresh');
const output = path.join(repo, 'test-results/friendly');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
const project = path.join(profile, 'project');
fs.mkdirSync(project);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
/** The native confirmations (Undo all): what they asked, answered "go ahead". */
const asked = [];
dialog.showMessageBox = async (options) => {
  asked.push(options);
  return { response: 1 };
};
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
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const server = http.createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: {"choices":[{"delta":{"content":"Done."}}]}\n\ndata: [DONE]\n\n');
  });
});

/** A long research thread (for the scrub bar), with one message search should find. */
function researchThread(now) {
  const messages = [];
  for (let i = 0; i < 14; i++) {
    messages.push({
      id: `r${i}u`,
      conversationId: 'c-research',
      role: 'user',
      content: i === 3 ? 'Which zebra launch dates work for the clinics vertical?' : `Question ${i + 1}: what should we check next about the market?`,
      createdAt: now - 400000 + i * 20000
    });
    messages.push({
      id: `r${i}a`,
      conversationId: 'c-research',
      role: 'assistant',
      content: Array.from(
        { length: 6 },
        (_, p) => `Paragraph ${p + 1} of answer ${i + 1}. The market for local services is moving to messaging, and owners answer enquiries by hand after hours, so follow-ups slip. ${'More detail on pricing, channels and timing. '.repeat(4)}`
      ).join('\n\n'),
      createdAt: now - 400000 + i * 20000 + 9000,
      providerId: 'check',
      modelId: 'fixture',
      usage: { promptTokens: 4200, completionTokens: 900 }
    });
  }
  return messages;
}

server.listen(0, '127.0.0.1', () => {
  const now = Date.now();
  const real = fs.realpathSync(project);
  const settings = {
    theme,
    autoTitleConversations: true,
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    streamDeltas: true,
    allowShellExecution: false,
    shellAllowlist: [],
    sendCrashDiagnostics: false,
    dataDirectoryNote: ''
  };
  let state;
  if (fresh) state = { version: 1, providers: [], workspaces: [], agents: [], documents: [], chunks: [], mcpServers: [], tasks: [], conversations: [], messages: [], settings };
  else {
    // The work a coworker did: a.txt changed twice, b.txt made. Its checkpoints can undo both.
    fs.writeFileSync(path.join(project, 'a.txt'), 'second version\n');
    fs.writeFileSync(path.join(project, 'b.txt'), 'made by the task\n');
    const checkpoints = path.join(profile, 'checkpoints');
    fs.mkdirSync(checkpoints, { recursive: true });
    const keep = (toolCallId, file, existed, before, after, savedAt) =>
      fs.writeFileSync(
        path.join(checkpoints, `${crypto.createHash('sha1').update(toolCallId).digest('hex')}.json`),
        JSON.stringify({ toolCallId, conversationId: 'c-work', root: real, path: file, existed, ...(existed ? { before } : {}), afterHash: sha256(after), savedAt })
      );
    keep('w1', 'a.txt', true, 'original\n', 'first version\n', now - 60000);
    keep('w2', 'b.txt', false, undefined, 'made by the task\n', now - 59000);
    keep('w3', 'a.txt', true, 'first version\n', 'second version\n', now - 50000);
    const save = (id, file, content, created) => ({
      id,
      name: 'write_file',
      arguments: JSON.stringify({ path: file, content }),
      result: `Saved ${file}`,
      change: { added: 1, removed: created ? 0 : 1, created, undo: 'kept' }
    });
    state = {
      version: 1,
      providers: [
        {
          id: 'check',
          name: 'Check',
          kind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          models: [{ id: 'fixture', displayName: 'Fixture', contextWindow: 128000, pricePerMillionInputTokens: 3, pricePerMillionOutputTokens: 15 }],
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
      tasks: [],
      conversations: [
        { id: 'c-research', title: 'Clinic market research', workspaceId: null, providerId: 'check', modelId: 'fixture', skillIds: [], roleIds: [], agentId: 'research-analyst', createdAt: now - 400000, updatedAt: now - 30000 },
        { id: 'c-work', title: 'Restyle the landing page', workspaceId: null, providerId: 'check', modelId: 'fixture', skillIds: [], roleIds: [], agentId: 'frontend-developer', projectRoot: real, createdAt: now - 70000, updatedAt: now - 40000 },
        { id: 'c-old', title: 'Old notes to remove', workspaceId: null, providerId: 'check', modelId: 'fixture', skillIds: [], roleIds: [], agentId: 'frontend-developer', createdAt: now - 900000, updatedAt: now - 800000 }
      ],
      messages: [
        ...researchThread(now),
        { id: 'w-ask', conversationId: 'c-work', role: 'user', content: 'Restyle the landing page header.', createdAt: now - 62000 },
        { id: 'w-step1', conversationId: 'c-work', role: 'assistant', content: '', createdAt: now - 61000, providerId: 'check', modelId: 'fixture', usage: { promptTokens: 12000, completionTokens: 800 }, toolCalls: [save('w1', 'a.txt', 'first version\n', false), save('w2', 'b.txt', 'made by the task\n', true)] },
        { id: 'w-step2', conversationId: 'c-work', role: 'assistant', content: '', createdAt: now - 51000, providerId: 'check', modelId: 'fixture', usage: { promptTokens: 14000, completionTokens: 600 }, toolCalls: [save('w3', 'a.txt', 'second version\n', false)] },
        { id: 'w-done', conversationId: 'c-work', role: 'assistant', content: 'Done: the header is restyled and b.txt holds the new copy.', createdAt: now - 45000, providerId: 'check', modelId: 'fixture', usage: { promptTokens: 15000, completionTokens: 300 } },
        { id: 'o1', conversationId: 'c-old', role: 'user', content: 'Some old notes.', createdAt: now - 800000 }
      ],
      settings: { ...settings, welcomeDone: true }
    };
  }
  fs.mkdirSync(path.join(profile, 'data/db'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'data/db/platform-v1.json'), JSON.stringify(state));
  require(path.join(repo, 'out/main/index.js'));
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  app.exit(1);
}, 180000);
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
    const problems = [];
    let failed = false;
    try {
      const evaluate = (script) => contents.executeJavaScript(script);
      const waitFor = async (script, label, tries = 150) => {
        for (let i = 0; i < tries; i++) {
          if (await evaluate(script)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      const snap = async (name) => {
        await pause(200);
        const image = await contents.capturePage();
        fs.writeFileSync(path.join(output, `${name}-${width}x${height}-${theme}.png`), image.toPNG());
      };
      const type = (selector, value) =>
        evaluate(
          `(() => { const i = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`
        );
      const check = (ok, problem) => {
        if (!ok) problems.push(problem);
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${problem}`);
      };
      const ctrlK = () => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
      await waitFor('document.querySelector(".office-team-people button") && !document.querySelector(".office-loading")', 'office', 300);
      await pause(800);

      if (fresh) {
        // ---------------------------------------------------------------- 2. the welcome guide
        await waitFor(`!!document.querySelector('.welcome-guide')`, 'the welcome guide opens by itself');
        await snap('welcome-1-first-start');
        const steps = await evaluate(`[...document.querySelectorAll('.welcome-step > div > strong')].map((s) => s.textContent)`);
        console.log('steps:', JSON.stringify(steps));
        check(steps.length === 3, 'the guide has three steps');
        check(await evaluate(`[...document.querySelectorAll('.welcome-task')].every((b) => b.disabled)`), 'first tasks wait for a model');
        await evaluate(`[...document.querySelectorAll('.welcome-step button')].find((b) => /Choose folder/.test(b.textContent)).click()`);
        await waitFor(`document.querySelectorAll('.welcome-step.done').length === 1`, 'the folder step ticks off');
        await snap('welcome-2-folder-chosen');
        await evaluate(`[...document.querySelectorAll('.welcome-foot button')].find((b) => /Skip/.test(b.textContent)).click()`);
        await waitFor(`!document.querySelector('.welcome-guide')`, 'the guide closes');
        await waitFor(`window.axon.snapshot().then((s) => s.settings.welcomeDone === true)`, 'closing it is remembered');
        check(true, 'closing the guide is remembered (welcomeDone)');
        await ctrlK();
        await type('.office-command-search input', 'welcome');
        await pause(300);
        await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => /welcome guide/i.test(b.textContent)).click()`);
        await waitFor(`!!document.querySelector('.welcome-guide')`, 'Ctrl+K brings the guide back');
        check(true, 'Ctrl+K "Show the welcome guide" opens it again');
        return;
      }

      // ---------------------------------------------------------------- 3. Ctrl+K finds past conversations
      check(!(await evaluate(`!!document.querySelector('.welcome-guide')`)), 'no welcome guide for someone already set up');
      await ctrlK();
      await waitFor(`!!document.querySelector('.office-command-search input')`, 'palette');
      await type('.office-command-search input', 'zebra launch');
      await waitFor(`[...document.querySelectorAll('#office-command-results .command-kind')].some((k) => k.textContent === 'Conversation')`, 'a conversation result');
      await snap('search-1-palette');
      const result = await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => b.querySelector('.command-kind').textContent === 'Conversation').innerText`);
      console.log('result:', JSON.stringify(result));
      check(/Clinic market research/.test(result) && /Research Analyst/.test(result) && /zebra launch/i.test(result), 'the result names the conversation, who, and the line that matched');
      await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => b.querySelector('.command-kind').textContent === 'Conversation').click()`);
      await waitFor(`document.querySelector('.activity-agent-meta h3')?.textContent === 'Research Analyst'`, 'the conversation opens');
      await waitFor(`!!document.querySelector('[data-message-id="r3u"].message-revealed')`, 'the matched message is shown and marked');
      const inView = await evaluate(`(() => { const s = document.querySelector('.activity-tabpanel-chat').getBoundingClientRect(); const m = document.querySelector('[data-message-id="r3u"]').getBoundingClientRect(); return m.top >= s.top - 1 && m.bottom <= s.bottom + 1; })()`);
      check(inView, 'the matched message is scrolled into view');
      await snap('search-2-revealed');

      // ---------------------------------------------------------------- 6. the scrub bar
      await waitFor(`!!document.querySelector('.thread-rail')`, 'the scrub bar on a long thread');
      const marks = await evaluate(`document.querySelectorAll('.thread-rail-mark').length`);
      check(marks === 14, `one mark per message of yours (${marks})`);
      check(await evaluate(`document.querySelector('.activity-tabpanel-chat').classList.contains('has-thread-rail')`), 'the panel scrollbar steps aside for it');
      const rail = await evaluate(`(() => { const r = document.querySelector('.thread-rail').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), top: r.top, height: r.height }; })()`);
      const scrollTop = () => evaluate(`document.querySelector('.activity-tabpanel-chat').scrollTop`);
      const at = (fraction) => Math.round(rail.top + rail.height * fraction);
      contents.sendInputEvent({ type: 'mouseMove', x: rail.x, y: at(0.05) });
      contents.sendInputEvent({ type: 'mouseDown', x: rail.x, y: at(0.05), button: 'left', clickCount: 1 });
      await pause(250);
      const nearTop = await scrollTop();
      for (const f of [0.2, 0.4, 0.6]) {
        contents.sendInputEvent({ type: 'mouseMove', x: rail.x, y: at(f), button: 'left' });
        await pause(120);
      }
      await pause(250);
      const label = await evaluate(`document.querySelector('.thread-rail-label')?.textContent`);
      await snap('rail-1-dragging');
      const middle = await scrollTop();
      contents.sendInputEvent({ type: 'mouseUp', x: rail.x, y: at(0.6), button: 'left', clickCount: 1 });
      console.log('rail drag: scrollTop', nearTop, '->', middle, 'label', JSON.stringify(label));
      check(middle > nearTop + 500, 'dragging the scrub bar moves through the thread');
      check(/^(You|Research Analyst) · /.test(label ?? ''), 'the label says whose message is there');

      // ---------------------------------------------------------------- 5. what a task cost
      const costs = await evaluate(`[...document.querySelectorAll('.run-cost')].map((p) => p.textContent)`);
      console.log('research costs:', JSON.stringify(costs.slice(0, 2)));
      check(costs.length > 0 && costs.every((c) => /^This task: \$\d/.test(c)), 'each finished task says what it cost');

      // ---------------------------------------------------------------- 4. Undo all
      await ctrlK();
      await type('.office-command-search input', 'restyle');
      await waitFor(`[...document.querySelectorAll('#office-command-results .command-kind')].some((k) => k.textContent === 'Conversation')`, 'the work conversation');
      await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => b.querySelector('.command-kind').textContent === 'Conversation').click()`);
      await waitFor(`document.querySelector('.activity-agent-meta h3')?.textContent === 'Frontend Developer'`, 'frontend developer');
      await evaluate(`window.axon.projectChoose()`);
      await waitFor(`!!document.querySelector('.work-summary-undo')`, 'Undo all');
      const workCost = await evaluate(`document.querySelector('.run-cost')?.textContent`);
      console.log('work cost:', workCost);
      check(/^This task: \$0\.\d+ · 42\.7K tokens$/.test(workCost ?? ''), `the task's cost adds up its steps (${workCost})`);
      check((await evaluate(`document.querySelector('.work-summary-undo').textContent`)) === 'Undo all', 'two files: "Undo all"');
      await snap('undo-1-before');
      await evaluate(`document.querySelector('.work-summary-undo').click()`);
      await waitFor(`!document.querySelector('.work-summary-undo')`, 'undone', 100);
      check(fs.readFileSync(path.join(project, 'a.txt'), 'utf8') === 'original\n', 'a.txt is back to before the task');
      check(!fs.existsSync(path.join(project, 'b.txt')), 'b.txt, made by the task, is gone');
      check(asked.length === 1 && /Undo all of Frontend Developer/.test(asked[0].message), 'one confirmation for the whole task');
      await snap('undo-2-after');

      // ---------------------------------------------------------------- 7. delete a conversation
      await evaluate(`document.querySelector('.activity-menu-trigger').click()`);
      await waitFor(`!!document.querySelector('.activity-menu')`, 'menu');
      await evaluate(`document.querySelector('.activity-menu-row:last-child')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
      await snap('delete-1-menu');
      const items = await evaluate(`[...document.querySelectorAll('.activity-menu [role=menuitem]')].map((b) => b.textContent)`);
      check(items.includes('Delete this conversation…'), 'the menu has "Delete this conversation…"');
      check((await evaluate(`document.querySelectorAll('.activity-menu-delete').length`)) === 2, 'each earlier conversation has its own Delete');
      await evaluate(`[...document.querySelectorAll('.activity-menu-delete')].find((b) => /Old notes/.test(b.getAttribute('aria-label'))).click()`);
      await waitFor(`!!document.querySelector('.confirm-dialog')`, 'confirm dialog');
      await snap('delete-2-confirm');
      check(/Delete this conversation\?/.test(await evaluate(`document.querySelector('.confirm-dialog h2').textContent`)), 'Axon asks in its own dialog');
      await evaluate(`document.querySelector('.confirm-dialog .btn-danger, .confirm-dialog [class*=danger]').click()`);
      await waitFor(`window.axon.snapshot().then((s) => !s.conversations.some((c) => c.id === 'c-old'))`, 'deleted');
      check(true, 'the old conversation is deleted');
      await waitFor(`[...document.querySelectorAll('.toast')].some((t) => /Conversation deleted/.test(t.textContent))`, 'toast', 30);
      check(true, 'a toast says so');

      // ---------------------------------------------------------------- 6. team rings and search highlight
      await evaluate(`document.querySelector('.office-drawer-close, .conversation-drawer [aria-label="Close"]')?.click()`);
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await pause(400);
      await type('.office-directory input', 'developer');
      await pause(600);
      const found = await evaluate(`document.querySelectorAll('.office-person-label.found').length`);
      console.log('found tags:', found);
      check(found >= 5, 'people "Find a person" found get name tags at this zoom');
      await snap('rings-1-search-highlight');
      await type('.office-directory input', '');
      await pause(400);
      check((await evaluate(`document.querySelectorAll('.office-person-label.found').length`)) === 0, 'clearing the search clears the highlight');
      await snap('rings-2-team-colours');
      // A whole district: each team's rings in its own colour, the same as its label.
      for (let i = 0; i < 5; i++) {
        await evaluate(`document.querySelector('[aria-label="Zoom out"]').click()`);
        await pause(250);
      }
      await pause(1500);
      const labelColours = await evaluate(`[...document.querySelectorAll('.office-place-label.department')].map((l) => l.style.getPropertyValue('--place-color'))`);
      console.log('department label colours:', JSON.stringify(labelColours));
      check(new Set(labelColours).size === labelColours.length && labelColours.length > 3, 'each department label in view has its own colour');
      await snap('rings-3-district');

      // ---------------------------------------------------------------- 5. the spending limit setting
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }))`);
      await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Usage')`, 'settings');
      await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Usage').click()`);
      await waitFor(`!!document.querySelector('[aria-label="Pause a task at a spending limit"]')`, 'the spending limit row');
      await evaluate(`document.querySelector('[aria-label="Pause a task at a spending limit"]').click()`);
      await waitFor(`!!document.querySelector('#task-spend-limit')`, 'the limit field');
      await waitFor(`window.axon.snapshot().then((s) => s.settings.taskSpendLimit === 1)`, 'saved at $1');
      check(true, 'turning the limit on saves $1 a task');
      await snap('limit-1-settings');
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await waitFor(`![...document.querySelectorAll('h2, h3')].some((h) => h.textContent === 'Usage')`, 'settings closes');

      // ---------------------------------------------------------------- 2. a first task from the guide
      await ctrlK();
      await type('.office-command-search input', 'welcome');
      await pause(300);
      await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => /welcome guide/i.test(b.textContent)).click()`);
      await waitFor(`!!document.querySelector('.welcome-guide')`, 'the guide from Ctrl+K');
      check(await evaluate(`document.querySelector('.welcome-step').classList.contains('done')`), 'with a model connected, step 1 is ticked');
      await evaluate(`[...document.querySelectorAll('.welcome-task')].find((b) => /Research a question/.test(b.textContent)).click()`);
      await waitFor(`!document.querySelector('.welcome-guide') && document.querySelector('.activity-agent-meta h3')?.textContent === 'Research Analyst'`, 'the first task opens the research analyst');
      await waitFor(`/Compare three popular project management tools/.test(document.querySelector('.office-activity-panel textarea')?.value ?? '')`, 'the task is in the message box');
      check(true, 'a first task goes into their message box, ready to send');
      check(await evaluate(`!!document.querySelector('.activity-empty')`), 'in a new conversation');
      await snap('welcome-3-first-task');
    } catch (error) {
      failed = true;
      console.error(error);
      try {
        fs.writeFileSync(path.join(output, `failure-${width}x${height}-${theme}.png`), (await contents.capturePage()).toPNG());
      } catch {
        // No picture, the error says enough.
      }
    } finally {
      clearTimeout(timeout);
      if (problems.length) console.error('PROBLEMS:\n- ' + problems.join('\n- '));
      console.log(failed || problems.length ? 'FRIENDLY CHECKS FAILED' : 'FRIENDLY CHECKS PASSED');
      server.close();
      app.exit(failed || problems.length ? 1 : 0);
    }
  });
});
