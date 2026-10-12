// Isolated profile and loopback model: exercise the real composer, questions and bell.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const repo = path.resolve(__dirname, '..');
const theme = process.argv.includes('dark') ? 'dark' : 'light';
const output = path.join(repo, 'test-results/wave2');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const requests = [];
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => body += chunk);
  request.on('end', () => {
    const payload = JSON.parse(body); requests.push(payload);
    const user = payload.messages.findLast((m) => m.role === 'user')?.content ?? '';
    const last = payload.messages.at(-1);
    const asking = typeof user === 'string' && user.includes('ask-fixture') && last?.role !== 'tool';
    const bulk = typeof user === 'string' && user.includes('bulk-fixture') && last?.role !== 'tool';
    const delta = bulk ? {tool_calls:[{index:0,id:'pref-fixture',type:'function',function:{name:'remember_preference',arguments:JSON.stringify({preference:'Use concise paragraphs.'})}}]}
      : asking ? { tool_calls: [{ index: 0, id: 'question-fixture', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Which format should I use?', options: ['Brief', 'Detailed'] }) } }] }
      : { content: 'Finished. Would you like me to draft the email?' };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
  });
});
server.listen(0, '127.0.0.1', () => {
  const now = Date.now();
  const state = { version: 1, providers: [{ id: 'fixture', name: 'Fixture', kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'fixture', displayName: 'Fixture', contextWindow: 128000 }], enabled: true, createdAt: now, hasApiKey: false }],
    workspaces: [], agents: [], documents: [], chunks: [], mcpServers: [], tasks: [], teams: [], runs: [], agentMessages: [],
    settings: { theme, autoTitleConversations: false, defaultTemperature: .7, defaultMaxTokens: 4096, streamDeltas: true, allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '', keepInTray: false, startWithWindows: false, welcomeDone: true },
    conversations: [{ id: 'wave2', title: 'Composer checks', workspaceId: null, providerId: 'fixture', modelId: 'fixture', skillIds: [], roleIds: [], agentId: 'research-analyst', createdAt: now - 10000, updatedAt: now }],
    messages: [{ id: 'u1', conversationId: 'wave2', role: 'user', content: 'Check our launch', createdAt: now - 9000 }, { id: 'a1', conversationId: 'wave2', role: 'assistant', content: 'Ready. Would you like me to draft the email? I can also compare pricing.', createdAt: now - 8000 }] };
  fs.mkdirSync(path.join(profile, 'data/db'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'data/db/platform-v1.json'), JSON.stringify(state));
  require(path.join(repo, process.env.AXON_TEST_PACKAGED==='1'?'dist/win-unpacked/resources/app.asar/out/main/index.js':'out/main/index.js'));
});
const timeout = setTimeout(() => { console.error('TIMEOUT'); app.exit(1); }, 120000);
app.on('browser-window-created', (_, win) => {
  win.show = () => { win.setPosition(-2400, 0); win.showInactive(); };
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(1536, 816);
});
app.on('web-contents-created', (_, contents) => {
  contents.once('did-finish-load', async () => {
    let failed = false;
    const evaluate = (code) => contents.executeJavaScript(code);
    const waitFor = async (code, label) => {
      for (let i = 0; i < 250; i++) { if (await evaluate(code)) return; await pause(100); }
      throw new Error('Timed out: ' + label);
    };
    const snap = async (name) => { await pause(200); fs.writeFileSync(path.join(output, `${name}-${theme}.png`), (await contents.capturePage()).toPNG()); };
    const type = (selector, value, textarea = false) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.focus(); e.setSelectionRange(e.value.length,e.value.length); e.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    const key = (name, extra = '') => evaluate(`document.querySelector('.composer-textarea').dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(name)},bubbles:true${extra}}))`);
    try {
      await waitFor(`!!document.querySelector('.office-team-people button') && !document.querySelector('.office-loading')`, 'office ready');
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key:'k',ctrlKey:true,bubbles:true }))`);
      await waitFor(`!!document.querySelector('.office-command-search input')`, 'palette');
      await type('.office-command-search input', 'Research Analyst');
      await waitFor(`[...document.querySelectorAll('#office-command-results button')].some((b) => /Research Analyst/.test(b.textContent))`, 'research search');
      await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => /Research Analyst/.test(b.textContent)).click()`);
      await waitFor(`document.querySelector('.activity-agent-meta h3')?.textContent === 'Research Analyst'`, 'chat opens');
      await waitFor(`!!document.querySelector('.coworker-actions button')`, 'coworker card');
      await evaluate(`document.querySelector('.coworker-actions button').click()`);
      await waitFor(`!!document.querySelector('.drawer-open')`, 'visible conversation drawer');
      await waitFor(`document.querySelectorAll('.follow-up-chips button').length === 2`, 'closing offers');
      await evaluate(`document.querySelector('.follow-up-chips button').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`);
      await waitFor(`document.querySelector('.composer-textarea').value === 'Yes, draft the email'`, 'shift follow-up prefills');
      assert.equal(requests.length, 0, 'Shift+click makes no model request');
      await snap('follow-ups');
      await type('.composer-textarea', '@Backend', true);
      await waitFor(`document.querySelector('.composer-menu [role=option]')?.textContent.includes('Backend Developer')`, 'mention popup');
      await snap('mention-menu');
      await key('Enter');
      await waitFor(`document.querySelector('.composer-textarea').value === '@Backend Developer ' && !document.querySelector('.composer-menu')`, 'mention inserts without sending');
      assert.equal(requests.length, 0);
      await type('.composer-textarea', '/email', true);
      await waitFor(`!!document.querySelector('.composer-menu [role=option]')`, 'slash menu');
      await snap('shortcut-menu');
      await key('Tab');
      await waitFor(`document.querySelector('.composer-textarea').value === 'Draft a short, friendly email about '`, 'Tab inserts prompt');
      await evaluate(`document.querySelector('.composer-save-shortcut').click()`);
      await type('.composer-shortcut-save input', 'weekly');
      await evaluate(`document.querySelector('.composer-shortcut-save').requestSubmit()`);
      await waitFor(`window.axon.snapshot().then((s) => s.settings.savedPrompts?.[0]?.name === 'weekly')`, 'saved shortcut');
      await type('.composer-textarea', '/week', true);
      await waitFor(`document.querySelector('.composer-menu [role=option]')?.textContent.includes('/weekly')`, 'saved prompt in menu');
      await key('Escape');
      assert.equal(await evaluate(`document.querySelector('.composer-textarea').value`), '/week', 'Escape leaves draft intact');
      await type('.composer-textarea', '', true);
      await key('ArrowUp');
      await waitFor(`document.querySelector('.composer-textarea').value === 'Check our launch'`, 'recall works');
      const openCoworker = async (name) => {
        await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key:'k',ctrlKey:true,bubbles:true }))`);
        await waitFor(`!!document.querySelector('.office-command-search input')`, 'palette');
        await type('.office-command-search input', name);
        await waitFor(`[...document.querySelectorAll('#office-command-results button')].some((b) => b.textContent.includes(${JSON.stringify(name)}))`, 'coworker result');
        await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => b.textContent.includes(${JSON.stringify(name)})).click()`);
        await waitFor(`document.querySelector('.activity-agent-meta h3')?.textContent === ${JSON.stringify(name)}`, 'coworker selected');
        if (!await evaluate(`!!document.querySelector('.drawer-open')`)) {
          await waitFor(`!!document.querySelector('.coworker-actions button')`, 'coworker card');
          await evaluate(`document.querySelector('.coworker-actions button').click()`);
        }
        await waitFor(`!!document.querySelector('.drawer-open')`, 'drawer opened');
      };
      await type('.composer-textarea', 'Research draft kept', true);
      await openCoworker('Designer');
      assert.equal(await evaluate(`document.querySelector('.composer-textarea').value`), '', 'another coworker has their own draft');
      await type('.composer-textarea', 'Designer draft kept', true);
      await openCoworker('Research Analyst');
      assert.equal(await evaluate(`document.querySelector('.composer-textarea').value`), 'Research draft kept', 'draft restored after switching coworkers');
      await type('.composer-textarea', '@Designer review this', true);
      await key('Enter');
      await waitFor(`window.axon.snapshot().then((s) => s.messages.some((m) => m.role === 'user' && m.content.includes('<mentioned-colleagues>')))`, 'mention hidden context reaches main');
      await waitFor(`!document.querySelector('.chat-run-stage') && !!document.querySelector('.follow-up-chips')`, 'reply finished');
      assert.ok(!await evaluate(`document.querySelector('.office-thread').innerText.includes('<mentioned-colleagues>')`));
      assert.ok(requests.some((r) => r.messages.some((m) => typeof m.content === 'string' && m.content.includes('Ask them with ask_colleague'))));
      await type('.composer-textarea', 'ask-fixture', true);
      await key('Enter');
      await waitFor(`!!document.querySelector('.question-card')`, 'question card');
      await snap('question');
      await evaluate(`document.querySelector('.office-bell > button').click()`);
      await waitFor(`!!document.querySelector('.office-bell-panel')`, 'bell opens');
      assert.ok(await evaluate(`document.querySelector('.office-bell-panel').innerText.includes('Which format should I use?')`));
      await snap('notification-bell');
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await evaluate(`document.querySelector('.question-option').click()`);
      await waitFor(`!document.querySelector('.question-card') && !document.querySelector('.chat-run-stage')`, 'answer resumes run');
      assert.ok(requests.some((r) => r.messages.some((m) => m.role === 'tool' && m.content === 'The user chose: Brief')));
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:',',ctrlKey:true,bubbles:true}))`);
      await waitFor(`!!document.querySelector('#settings-tab-shortcuts')`, 'settings');
      await evaluate(`document.querySelector('#settings-tab-shortcuts').click()`);
      await waitFor(`!!document.querySelector('[aria-label="Name for /weekly"]')`, 'shortcut settings');
      await snap('shortcut-settings');
      await evaluate(`document.querySelector('#settings-tab-jobs').click()`);
      await waitFor(`!!document.querySelector('.jobs-info')`, 'recurring work settings');
      await evaluate(`document.querySelector('.jobs-info button').click()`);
      await waitFor(`!!document.querySelector('.job-editor')`, 'job form');
      await type('.job-editor textarea','Draft the weekly report',true);
      await snap('recurring-job-editor');
      await evaluate(`document.querySelector('.job-editor').requestSubmit()`);
      await waitFor(`!!document.querySelector('.job-row') && !document.querySelector('.job-editor')`, 'job saved');
      await evaluate(`[...document.querySelectorAll('.job-row button')].find(b=>b.textContent==='Run now').click()`);
      await waitFor(`document.querySelector('.job-row')?.textContent.includes('completed')`, 'scheduled job completes');
      assert.ok(await evaluate(`document.querySelector('.job-row').textContent.includes('Open result')`));
      await snap('recurring-job-result');
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await evaluate(`(async()=>{const a=await window.axon.chatCreate('fixture','fixture',null,'designer',undefined,null,'You are the Designer.');const b=await window.axon.chatCreate('fixture','fixture',null,'research-analyst',undefined,null,'You are the Research Analyst.');window.bulkRuns=Promise.all([window.axon.chatSend(a.id,'bulk-fixture: remember I prefer concise paragraphs',[]),window.axon.chatSend(b.id,'bulk-fixture: remember I prefer concise paragraphs',[])]);})()`);
      await waitFor(`[...document.querySelectorAll('.approval-overlay button')].some(b=>b.textContent==='Approve all (2)')`, 'two real pending approvals');
      await snap('bulk-approvals');
      await evaluate(`[...document.querySelectorAll('.approval-overlay button')].find(b=>b.textContent==='Approve all (2)').click()`);
      await evaluate(`window.bulkRuns`);
      const approved=await evaluate(`window.axon.snapshot()`);
      assert.equal(approved.settings.coworkerPreferences.designer,'Use concise paragraphs.');
      assert.equal(approved.settings.coworkerPreferences['research-analyst'],'Use concise paragraphs.');
      console.log('WAVE 2 DESKTOP PASSED:', theme);
    } catch (error) { failed = true; console.error(error); console.error('RUNS',await evaluate(`window.axon.snapshot().then(s=>s.runs.map(r=>({agent:r.agentId,status:r.status,error:r.error})))`)); console.error('MODEL REQUESTS',requests.map(r=>({user:r.messages.findLast(m=>m.role==='user')?.content,tools:(r.tools??[]).map(t=>t.function.name)}))); await snap('failure').catch(() => {}); }
    finally { clearTimeout(timeout); server.close(); app.exit(failed ? 1 : 0); }
  });
});
