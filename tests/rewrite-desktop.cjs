// Retry and Edit in the real window: Retry under the last finished reply (asking first when that reply
// changed files), Edit on your own messages (Esc cancels, Ctrl+Enter sends), and the thread, the saved
// conversation and what the model was sent all agreeing afterwards. Photographed and measured.
// Build first (npm run build), then:
//   npx electron tests/rewrite-desktop.cjs [1536x816] [dark]
// Screenshots go to test-results/rewrite. Only the provider transport is a loopback fixture.
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
const output = path.join(repo, 'test-results/rewrite');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
const project = path.join(profile, 'project');
fs.mkdirSync(project);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
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

/** What the model was sent each time, and how many answers it has given. */
const sent = [];
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    // The background memory check also asks the model; only the coworker's own turns are counted.
    if (!body.includes('Classify conversation facts')) {
      try {
        sent.push(JSON.parse(body));
      } catch {
        sent.push(null);
      }
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `Fresh answer number ${sent.length}.` } }] })}\n\n`);
    setTimeout(() => response.end('data: [DONE]\n\n'), 600);
  });
});

server.listen(0, '127.0.0.1', () => {
  const now = Date.now();
  const real = fs.realpathSync(project);
  fs.writeFileSync(path.join(project, 'a.txt'), 'second version\n');
  const checkpoints = path.join(profile, 'checkpoints');
  fs.mkdirSync(checkpoints, { recursive: true });
  fs.writeFileSync(
    path.join(checkpoints, `${crypto.createHash('sha1').update('w1').digest('hex')}.json`),
    JSON.stringify({ toolCallId: 'w1', conversationId: 'c-work', root: real, path: 'a.txt', existed: true, before: 'original\n', afterHash: sha256('second version\n'), savedAt: now - 50000 })
  );
  const write = {
    id: 'w1',
    name: 'write_file',
    arguments: JSON.stringify({ path: 'a.txt', content: 'second version\n' }),
    result: 'Saved a.txt',
    change: { added: 1, removed: 1, created: false, undo: 'kept' }
  };
  const chat = (id, title, agentId, extra = {}) => ({ id, title, workspaceId: null, providerId: 'check', modelId: 'fixture', skillIds: [], roleIds: [], agentId, createdAt: now - 100000, updatedAt: now - 30000, ...extra });
  const attachment = '\n\n<attachment name="brief.txt" attachmentId="att-1">\nThe brief says: keep it short.\n[Full document ingested.]\n</attachment>';
  const state = {
    version: 1,
    providers: [
      {
        id: 'check',
        name: 'Check',
        kind: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        models: [{ id: 'fixture', displayName: 'Fixture', contextWindow: 128000 }],
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
    teams: [],
    conversations: [
      chat('c-work', 'Restyle the landing page', 'frontend-developer', { projectRoot: real, attachmentRefs: [{ id: 'att-1', name: 'brief.txt' }] }),
      chat('c-team', 'A teammate task', 'research-analyst')
    ],
    messages: [
      { id: 'w-ask', conversationId: 'c-work', role: 'user', content: `Restyle the landing page header.${attachment}`, createdAt: now - 62000 },
      { id: 'w-done', conversationId: 'c-work', role: 'assistant', content: 'Done: the header is restyled.', createdAt: now - 55000, providerId: 'check', modelId: 'fixture' },
      { id: 'w-ask2', conversationId: 'c-work', role: 'user', content: 'Now shorten the hero text.', createdAt: now - 40000 },
      { id: 'w-step', conversationId: 'c-work', role: 'assistant', content: '', createdAt: now - 38000, providerId: 'check', modelId: 'fixture', toolCalls: [write] },
      { id: 'w-done2', conversationId: 'c-work', role: 'assistant', content: 'Shortened the hero text to one line.', createdAt: now - 35000, providerId: 'check', modelId: 'fixture' },
      { id: 't-brief', conversationId: 'c-team', role: 'user', content: 'Your task from the lead.', from: 'Chief of Staff', createdAt: now - 90000 },
      { id: 't-done', conversationId: 'c-team', role: 'assistant', content: 'Finished the research.', createdAt: now - 80000, providerId: 'check', modelId: 'fixture' }
    ],
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
  };
  state.teams.push({
    id: 'team-1', leadId: 'chief-of-staff', conversationId: 'c-none', goal: 'g', attendees: [], providerId: 'check', modelId: 'fixture', status: 'done', minutes: [], createdAt: now, updatedAt: now,
    plan: { assignments: [{ id: 'a1', ownerId: 'research-analyst', title: 't', brief: 'b', dependsOn: [], files: [], status: 'done', conversationId: 'c-team' }] }
  });
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
  contents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.log('renderer:', message.slice(0, 300));
  });
  contents.on('render-process-gone', (_event, details) => console.log('renderer gone:', details.reason));
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
        await pause(250);
        const image = await contents.capturePage();
        fs.writeFileSync(path.join(output, `${name}-${width}x${height}-${theme}.png`), image.toPNG());
      };
      const check = (ok, problem) => {
        if (!ok) problems.push(problem);
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${problem}`);
      };
      const type = (selector, value) =>
        evaluate(
          `(() => { const i = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`
        );
      const typeInto = (selector, value) =>
        evaluate(
          `(() => { const i = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`
        );
      const key = (target, init) =>
        evaluate(`document.querySelector(${JSON.stringify(target)}).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`);
      const saved = (id) => evaluate(`window.axon.chatHistoryPage(${JSON.stringify(id)}).then((p) => p.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, streaming: !!m.streaming, toolCalls: (m.toolCalls || []).length })))`);
      const open = async (query, who) => {
        await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
        await waitFor(`!!document.querySelector('.office-command-search input')`, 'palette');
        await type('.office-command-search input', query);
        await waitFor(`[...document.querySelectorAll('#office-command-results .command-kind')].some((k) => k.textContent === 'Conversation')`, 'a conversation result');
        await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => b.querySelector('.command-kind').textContent === 'Conversation').click()`);
        await waitFor(`document.querySelector('.activity-agent-meta h3')?.textContent === ${JSON.stringify(who)}`, who);
      };
      await waitFor('document.querySelector(".office-team-people button") && !document.querySelector(".office-loading")', 'office', 300);
      await pause(800);

      // ---------------------------------------------------------------- the teammate's task: nothing to rewrite
      await open('teammate', 'Research Analyst');
      await waitFor(`!!document.querySelector('[data-message-id="t-done"]')`, 'the task thread');
      await pause(400);
      check((await evaluate(`document.querySelectorAll('.thread-retry, [data-action="edit"], [data-action="retry"]').length`)) === 0, "a team member's task has no Retry and no Edit");
      await snap('team-task-no-buttons');

      // ---------------------------------------------------------------- the work conversation
      await open('restyle', 'Frontend Developer');
      await evaluate(`window.axon.projectChoose()`);
      await waitFor(`!!document.querySelector('[data-message-id="w-done2"]')`, 'the work thread');
      await pause(500);
      check((await evaluate(`document.querySelectorAll('.thread-retry [data-action="retry"]').length`)) === 1, 'one Retry, under the last reply');
      check(await evaluate(`(() => { const r = document.querySelector('.thread-retry'); const m = document.querySelector('[data-message-id="w-done2"] .message-body'); return r.getBoundingClientRect().top >= m.getBoundingClientRect().bottom - 2; })()`), 'it sits below that reply');
      check((await evaluate(`document.querySelector('[data-action="retry"]').title`)) === 'Ask again for a new answer', 'its tooltip says what it does');
      check((await evaluate(`document.querySelectorAll('[data-message-id="w-ask"] [data-action="edit"], [data-message-id="w-ask2"] [data-action="edit"]').length`)) === 2, 'Edit on both of your messages');
      check((await evaluate(`document.querySelectorAll('[data-message-id="w-done"] [data-action="edit"], [data-message-id="w-done2"] [data-action="edit"]').length`)) === 0, 'and on none of the replies');
      await evaluate(`document.querySelector('[data-message-id="w-ask"] [data-action="edit"]').focus()`);
      await snap('1-edit-on-focus');

      // The last reply changed a file, so Retry asks first (its Undo buttons go with the reply).
      await evaluate(`document.querySelector('[data-action="retry"]').click()`);
      await waitFor(`!!document.querySelector('.thread-retry-note')`, 'Retry asks first');
      const ask = await evaluate(`({ note: document.querySelector('.thread-retry-note').textContent, buttons: [...document.querySelectorAll('.thread-retry button')].map((b) => b.textContent).join('|'), focus: document.activeElement?.textContent })`);
      console.log('retry asks:', JSON.stringify(ask));
      check(/Files they changed stay changed/.test(ask.note) && /Undo/.test(ask.note), 'it says files stay changed, and to use Undo first');
      check(ask.buttons === 'Ask again|Cancel' && ask.focus === 'Cancel', 'Ask again or Cancel, with the keyboard on Cancel');
      await snap('1b-retry-asks');
      await key('.thread-retry', { key: 'Escape' });
      await waitFor(`!document.querySelector('.thread-retry-note')`, 'Esc cancels');
      check((await evaluate(`document.activeElement?.getAttribute('data-action')`)) === 'retry', 'Esc puts you back on Retry');
      check((await saved('c-work')).length === 5, 'nothing was removed');
      await evaluate(`document.querySelector('.activity-tabpanel-chat').scrollTop = 0`);
      await waitFor(`!!document.querySelector('[data-message-id="w-ask"] [data-action="edit"]')`, 'the first message is on screen');

      // Edit the first message: the box, the note about the file the later reply changed.
      const before = await evaluate(`Math.round(document.querySelector('[data-message-id="w-ask"] .message-body').getBoundingClientRect().width)`);
      await evaluate(`document.querySelector('[data-message-id="w-ask"] [data-action="edit"]').click()`);
      await waitFor(`!!document.querySelector('[data-message-id="w-ask"] .message-edit-field')`, 'the edit box');
      const field = await evaluate(`(() => { const f = document.querySelector('.message-edit-field'); return { value: f.value, focused: document.activeElement === f, width: Math.round(f.closest('.message-body').getBoundingClientRect().width) }; })()`);
      console.log('edit box:', JSON.stringify(field), 'bubble was', before);
      check(field.value === 'Restyle the landing page header.', 'the box holds your words, without the attachment block');
      check(field.focused, 'and has the keyboard');
      check(Math.abs(field.width - before) <= 2 || field.width >= 260, 'it is the width of the message (or the least a box needs)');
      const note = await evaluate(`document.querySelector('.message-edit-note')?.textContent`);
      check(note === 'Replies after this message will be replaced. Files your coworkers changed stay changed — use Undo to roll them back.', 'the note says replies are replaced and files stay changed');
      check((await evaluate(`document.querySelector('.message-edit-field').getAttribute('aria-describedby') === document.querySelector('.message-edit-note').id`)), 'the note is read with the box');
      check((await evaluate(`[...document.querySelectorAll('.message-edit-actions button')].map((b) => b.textContent).join('|')`)) === 'Save and send|Cancel', 'Save and send, Cancel');
      await snap('2-editing');

      // Esc cancels, and puts you back on Edit.
      await key('.message-edit-field', { key: 'Escape' });
      await waitFor(`!document.querySelector('.message-edit-field')`, 'the box closes on Esc');
      check((await evaluate(`document.activeElement?.getAttribute('data-action')`)) === 'edit', 'Esc puts you back on Edit');
      const untouched = await saved('c-work');
      check(untouched.map((m) => m.id).join() === 'w-ask,w-done,w-ask2,w-step,w-done2', 'cancelling changed nothing');

      // Edit the first message and send it with Ctrl+Enter.
      await evaluate(`document.querySelector('[data-message-id="w-ask"] [data-action="edit"]').click()`);
      await waitFor(`!!document.querySelector('.message-edit-field')`, 'the edit box again');
      await typeInto('.message-edit-field', 'Restyle the landing page header, calmer colours.');
      await key('.message-edit-field', { key: 'Enter', ctrlKey: true });
      await waitFor(`!document.querySelector('[data-message-id="w-ask2"]') && !document.querySelector('[data-message-id="w-done2"]')`, 'the later messages are gone from the thread', 100);
      check(true, 'the later messages left the thread');
      await snap('3-edit-running');
      await waitFor(`[...document.querySelectorAll('.message.assistant')].some((m) => /Fresh answer number 1/.test(m.textContent)) && !document.querySelector('.message.streaming')`, 'the new answer', 100);
      const afterEdit = await saved('c-work');
      console.log('after edit:', JSON.stringify(afterEdit.map((m) => [m.role, m.content.slice(0, 60)])));
      check(afterEdit.length === 2 && afterEdit[0].role === 'user' && afterEdit[1].role === 'assistant', 'the saved conversation is the edited message and its new answer');
      check(afterEdit[0].content.startsWith('Restyle the landing page header, calmer colours.') && afterEdit[0].content.includes('<attachment name="brief.txt" attachmentId="att-1">'), 'the edited message keeps its attachment');
      check(afterEdit[0].id !== 'w-ask', 'it is a new message');
      const snapshot = await evaluate(`window.axon.snapshot().then((s) => s.conversations.find((c) => c.id === 'c-work').attachmentRefs)`);
      check(JSON.stringify(snapshot) === JSON.stringify([{ id: 'att-1', name: 'brief.txt' }]), 'its attachment can still be read');
      check(fs.readFileSync(path.join(project, 'a.txt'), 'utf8') === 'second version\n', 'the file the cut-away reply changed stays changed');
      const request = sent.at(-1);
      const userTurns = request.messages.filter((m) => m.role === 'user');
      check(userTurns.length === 1 && /calmer colours/.test(JSON.stringify(userTurns[0].content)), 'the model was sent the edited message once');
      check(!JSON.stringify(request.messages).includes('Shortened the hero'), 'and none of the replies that were replaced');
      check((await evaluate(`document.querySelectorAll('[data-message-id="w-ask"], [data-message-id="w-step"], [data-message-id="w-done"]').length`)) === 0, 'the old messages are not on screen');
      await snap('4-after-edit');

      // Retry: the last message stays, a fresh answer replaces the reply.
      await waitFor(`!!document.querySelector('[data-action="retry"]')`, 'Retry is back when the run is over');
      const lastUser = afterEdit[0].id;
      await evaluate(`document.querySelector('[data-action="retry"]').click()`);
      await waitFor(`[...document.querySelectorAll('.message.assistant')].some((m) => /Fresh answer number 2/.test(m.textContent)) && !document.querySelector('.message.streaming') && !!document.querySelector('[data-action="retry"]')`, 'the retried answer', 100);
      const afterRetry = await saved('c-work');
      console.log('after retry:', JSON.stringify(afterRetry.map((m) => [m.role, m.content.slice(0, 40)])));
      check(afterRetry.length === 2 && afterRetry[0].id === lastUser, 'retry keeps your message (the same one)');
      check(/Fresh answer number 2/.test(afterRetry[1].content) && !/number 1/.test(afterRetry[1].content), 'and replaces the reply');
      check(sent.at(-1).messages.filter((m) => m.role === 'user').length === 1, 'the model was sent your message once, not twice');
      check((await evaluate(`document.querySelectorAll('.message.user').length`)) === 1 && (await evaluate(`document.querySelectorAll('.message.assistant').length`)) === 1, 'the thread shows one message of yours and one reply');
      await snap('5-after-retry');
      check((await evaluate(`window.axon.snapshot().then((s) => s.tasks.find((t) => t.conversationId === 'c-work')?.status)`)) === 'done', 'the task is done again');

      // Reload the window: the saved conversation is what is shown.
      await evaluate(`location.reload()`);
      await pause(2500);
    } catch (error) {
      failed = true;
      console.error('FAILED', error);
      try {
        console.log('saved:', JSON.stringify(await contents.executeJavaScript(`window.axon.chatHistoryPage('c-work').then((p) => p.messages.map((m) => [m.role, m.content.slice(0, 50), !!m.streaming, m.error]))`)));
        console.log('thread:', JSON.stringify(await contents.executeJavaScript(`[...document.querySelectorAll('.office-thread .message, .office-thread .thread-retry')].map((e) => e.className + ': ' + e.textContent.slice(0, 60))`)));
        console.log('error banner:', JSON.stringify(await contents.executeJavaScript(`document.querySelector('.banner-error')?.textContent ?? null`)));
        const image = await contents.capturePage();
        fs.writeFileSync(path.join(output, 'failure.png'), image.toPNG());
      } catch (inner) {
        console.log('no diagnostics:', String(inner));
      }
    }
    console.log(problems.length || failed ? `${problems.length} problem(s)` : 'all checks passed');
    clearTimeout(timeout);
    server.close();
    app.exit(problems.length || failed ? 1 : 0);
  });
});
