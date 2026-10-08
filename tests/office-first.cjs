// Build first, then npx electron tests/office-first.cjs [dark] [900x700].
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app } = require('electron');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../test-results/office-first');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
const project = path.join(profile, 'project');
fs.mkdirSync(path.join(project, 'notes'), { recursive: true });
const theme = process.argv.includes('dark') ? 'dark' : 'light';
const [width, height] = (process.argv.find((a) => /^\d+x\d+$/.test(a)) ?? '1600x960').split('x').map(Number);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sequence = 0;
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    const parsed = JSON.parse(body);
    const last = parsed.messages?.at(-1);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (last?.role === 'user' && String(last.content).includes('approval fixture')) {
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `approval-${++sequence}`, function: { name: 'write_file', arguments: JSON.stringify({ path: 'notes/change.ts', content: 'export const ready = true;\n' }) } }] } }] })}\n\ndata: [DONE]\n\n`
      );
    } else response.end('data: {"choices":[{"delta":{"content":"Done."}}]}\n\ndata: [DONE]\n\n');
  });
});
const timeout = setTimeout(() => {
  console.error('TIMEOUT office-first');
  app.exit(1);
}, 180000);
app.on('browser-window-created', (_, win) => {
  win.webContents.on('render-process-gone', (_, details) =>
    console.error('Renderer exited:', details.reason)
  );
  win.show = () => {
    win.setPosition(-2400, 0);
    win.showInactive();
  };
  win.setContentSize(width, height);
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    try {
      const run = (script) =>
        win.webContents.executeJavaScript(script).catch((error) => {
          throw new Error(`${error.message}\nIn: ${script}`);
        });
      const wait = async (script, label) => {
        for (let i = 0; i < 180; i++) {
          if (await run(script)) return;
          await pause(100);
        }
        console.error(
          'Wait diagnostics:',
          await run(
            `JSON.stringify({ready:document.readyState, text:document.body.innerText.slice(0,800), loading:!!document.querySelector('.office-loading'), roster:!!document.querySelector('.office-roster-fallback'), canvas:!!document.querySelector('canvas'), debug:!!window.__axonOffice})`
          )
        );
        throw new Error('Timed out: ' + label);
      };
      const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
      const set = (selector, value, prototype = 'HTMLInputElement') =>
        run(
          `(() => { const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${prototype}.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`
        );
      const snap = async (name) => {
        await pause(250);
        fs.writeFileSync(
          path.join(output, `${name}-${width}x${height}-${theme}.png`),
          (await win.webContents.capturePage()).toPNG()
        );
      };
      await wait(
        `document.querySelector('.office-team-people button') && !document.querySelector('.office-loading')`,
        'office'
      );
      await run(`localStorage.setItem('axon.officeDebug','1')`);
      // Recreate only the scene to enable diagnostics, keeping loaded assets cached.
      await run(
        `[...document.querySelectorAll('.office-apps-menu button')].find(b=>b.textContent.trim()==='Team view').click()`
      );
      await wait(`!!document.querySelector('.office-roster-fallback')`, 'team view');
      await run(
        `[...document.querySelectorAll('.office-apps-menu button')].find(b=>b.textContent.trim()==='Office view').click()`
      );
      await wait(`!!window.__axonOffice && !document.querySelector('.office-loading')`, 'debug scene');
      assert.ok(await run(`document.querySelector('.conversation-drawer').inert`), 'drawer starts inert');
      assert.ok(
        await run(
          `(() => { const a=document.querySelector('.office-viewport').getBoundingClientRect(),b=document.querySelector('.office-container').getBoundingClientRect(); return Math.abs(a.width-b.width)<2 && Math.abs(a.height-b.height)<2; })()`
        ),
        'full canvas'
      );
      await run(`window.__testOfficeCanvas = document.querySelector('.office-canvas-container canvas')`);
      await set('[aria-label="Find a coworker"]', 'developer');
      await pause(100);
      const firstMatch = await run(
        `document.querySelector('[aria-label="Find a coworker"]').getAttribute('aria-activedescendant')`
      );
      await run(
        `document.querySelector('[aria-label="Find a coworker"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))`
      );
      await pause(100);
      assert.notEqual(
        await run(
          `document.querySelector('[aria-label="Find a coworker"]').getAttribute('aria-activedescendant')`
        ),
        firstMatch,
        'directory arrow navigation'
      );
      await run(
        `document.querySelector('[aria-label="Find a coworker"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`
      );
      await run(
        `(() => {const buttons=document.querySelectorAll('.office-team-people button'); buttons[0].focus(); buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));})()`
      );
      assert.ok(
        await run(`document.activeElement===document.querySelectorAll('.office-team-people button')[1]`),
        'dock arrow navigation'
      );
      await click('.office-history-link');
      await wait(`!!document.querySelector('.global-work-panel input')`, 'activity history');
      assert.ok(
        await run(`document.activeElement===document.querySelector('.global-work-panel input')`),
        'history focuses search'
      );
      assert.ok(
        await run(
          `[...document.querySelectorAll('.history-run')].find(b=>b.textContent.includes('Removed conversation fixture'))?.disabled`
        ),
        'deleted conversation cannot open a different thread'
      );
      await set('.global-work-panel input', 'archived');
      await wait(`document.querySelectorAll('.history-run').length===1`, 'history search');
      assert.ok(
        await run(
          `document.querySelector('.history-run .lifecycle-badge').textContent.includes('Completed')`
        ),
        'saved completed state'
      );
      await snap('history');
      await run(
        `window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`
      );
      await wait(`!document.querySelector('.global-work-panel')`, 'history Escape');
      assert.ok(
        await run(`document.querySelector('.conversation-drawer').inert`),
        'history Escape only closes history'
      );
      await snap('office');
      await run(`window.__axonOffice.help('backend-developer','frontend-developer')`);
      assert.ok(
        await run(
          `window.__axonOffice.collaborations().some(p=>p.helper==='backend-developer' && p.host==='frontend-developer')`
        ),
        'collaboration link appears'
      );
      await run(
        `(() => { const a=window.__axonOffice.deskPoint('frontend-developer'), b=window.__axonOffice.deskPoint('backend-developer'); window.__axonOffice.focus((a.x+b.x)/2,(a.z+b.z)/2,35); })()`
      );
      await pause(700);
      await snap('collaboration');
      await run(`window.__axonOffice.endHelp('backend-developer')`);
      assert.equal(
        await run(`window.__axonOffice.collaborations().length`),
        0,
        'finished consultation removes link'
      );
      assert.ok(
        await run(`!!document.querySelector('.office-planner-card .planner-body')`),
        'today tasks expand planner'
      );
      await set('.office-planner-card .planner-add-title', 'Floating planner test');
      await pause(100);
      await click('.office-planner-card .planner-add button[type=submit]');
      await wait(
        `window.axon.snapshot().then(s => s.tasks.some(t => t.title==='Floating planner test' && t.due))`,
        'planner add'
      );
      await run(
        `[...document.querySelectorAll('.office-planner-card .planner-row')].find(r=>r.textContent.includes('Floating planner test')).querySelector('input[type=checkbox]').click()`
      );
      await wait(
        `window.axon.snapshot().then(s => s.tasks.find(t => t.title==='Floating planner test')?.status==='done')`,
        'planner tick'
      );
      await click('.office-planner-card [aria-label="Collapse planner"]');
      assert.ok(
        await run(`document.querySelector('.office-planner-card').classList.contains('collapsed')`),
        'planner collapses'
      );
      await run(`window.dispatchEvent(new KeyboardEvent('keydown',{ key:'k',ctrlKey:true,bubbles:true }))`);
      await wait(`!!document.querySelector('.office-command-palette')`, 'command shortcut');
      await set('.office-command-search input', 'Backend & APIs');
      await pause(100);
      await run(
        `[...document.querySelectorAll('#office-command-results button')].find(b=>b.querySelector('.command-kind').textContent==='Department').click()`
      );
      await wait(
        `document.querySelector('.office-team-caption strong')?.textContent==='Backend & APIs'`,
        'department command'
      );
      await wait(`!!document.querySelector('.office-place-label.department')`, 'HTML department labels');
      await click('.ask-axon');
      await set('.office-command-search input', 'Frontend Developer');
      await pause(100);
      await run(
        `[...document.querySelectorAll('#office-command-results button')].find(b=>b.querySelector('.command-kind').textContent==='Person').click()`
      );
      await wait(
        `!!document.querySelector('.coworker-popover') || document.querySelector('.conversation-drawer').classList.contains('is-open')`,
        'person selection'
      );
      if (await run(`!!document.querySelector('.coworker-popover')`)) {
        await pause(600);
        assert.ok(
          await run(
            `(() => { const card=document.querySelector('.coworker-popover').getBoundingClientRect(); return [...document.querySelectorAll('[data-office-obstacle]')].filter(e=>getComputedStyle(e).display!=='none' && getComputedStyle(e).visibility!=='hidden').every(e=>{ const r=e.getBoundingClientRect(); return card.right<=r.left || card.left>=r.right || card.bottom<=r.top || card.top>=r.bottom; }); })()`
          ),
          'card avoids overlays'
        );
        await snap('coworker');
        await click('.coworker-actions button');
      }
      await wait(`!document.querySelector('.conversation-drawer').inert`, 'drawer');
      assert.ok(await run(`!document.querySelector('.office-planner-card')`), 'planner hides behind drawer');
      await wait(`!!document.querySelector('.drawer-context-chip')`, 'context chip');
      await set('.composer-textarea', 'Keep this draft', 'HTMLTextAreaElement');
      await pause(100);
      await click('.drawer-close');
      await pause(300);
      await click('.office-team-people button[aria-pressed="true"]');
      await run(`document.querySelector('.coworker-actions button')?.click()`);
      await pause(300);
      assert.equal(
        await run(`document.querySelector('.composer-textarea').value`),
        'Keep this draft',
        'draft survives close'
      );
      await click('[aria-label="Work surface"]');
      await wait(`document.querySelector('.office-workspace').classList.contains('has-work')`, 'work sheet');
      await click('[aria-label="Fullscreen work"]');
      await pause(300);
      assert.ok(
        await run(
          `document.querySelector('.office-workspace').classList.contains('work-fullscreen') && document.querySelector('.work-surface-slot').getBoundingClientRect().height > document.querySelector('.office-workspace').clientHeight-40`
        ),
        'fullscreen sheet'
      );
      await snap('fullscreen');
      await run(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
      await pause(100);
      assert.ok(
        await run(`!document.querySelector('.office-workspace').classList.contains('work-fullscreen')`),
        'Escape restores work sheet'
      );
      await click('[aria-label="Close the work surface"]');
      await set('.composer-textarea', 'approval fixture reject', 'HTMLTextAreaElement');
      await pause(100);
      await click('.composer-btn-send');
      await wait(`!!document.querySelector('.office-approval-card')`, 'global approval');
      assert.ok(await run(`!!document.querySelector('.approval-change-stats')`), 'approval stats');
      await snap('approval');
      await click('.ask-axon');
      await set('.office-command-search input', 'View whole campus');
      await pause(100);
      await run(
        `(() => { const option=document.querySelector('#office-command-results button'); option.focus(); option.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true})); })()`
      );
      await pause(100);
      assert.ok(
        await run(`!!document.querySelector('.office-approval-card')`),
        'palette shortcuts do not approve a background tool'
      );
      await run(
        `[...document.querySelectorAll('.office-approval-actions button')].find(b=>b.textContent==='Review diff').click()`
      );
      await wait(
        `document.querySelector('.office-workspace').classList.contains('has-work') && !!document.querySelector('.work-diff-add')`,
        'review diff'
      );
      assert.ok(
        await run(`document.querySelector('.conversation-drawer').inert`),
        'review exposes work sheet'
      );
      await run(
        `[...document.querySelectorAll('.office-approval-actions button')].find(b=>b.textContent==='Reject').click()`
      );
      await wait(`!document.querySelector('.office-approval-card')`, 'reject');
      assert.equal(fs.existsSync(path.join(project, 'notes/change.ts')), false, 'rejection writes no file');
      await wait(`document.querySelector('.status-badge.completed')`, 'rejected run ends');
      await click('[aria-label="Close the work surface"]');
      await wait(`!!document.querySelector('.office-notice.completed')`, 'completion notification');
      await run(`document.querySelector('.office-notice button:last-child').click()`);
      await wait(`!document.querySelector('.conversation-drawer').inert`, 'notification opens thread');
      await set('.composer-textarea', 'approval fixture approve', 'HTMLTextAreaElement');
      await pause(100);
      await click('.composer-btn-send');
      await wait(`!!document.querySelector('.office-approval-card')`, 'second global approval');
      await run(
        `[...document.querySelectorAll('.office-approval-actions button')].find(b=>b.textContent==='Approve').click()`
      );
      await wait(
        `document.querySelector('.work-now-text')?.textContent.startsWith('Saved change.ts') && !!document.querySelector('.status-badge.completed')`,
        'approved write'
      );
      assert.equal(
        fs.readFileSync(path.join(project, 'notes/change.ts'), 'utf8'),
        'export const ready = true;\n'
      );
      await wait(`!!document.querySelector('.status-badge.completed')`, 'approved run ends');
      await click('[aria-label="Close the work surface"]');
      await click('.drawer-close');
      await run(`void window.axon.chatSend('c-dev','approval fixture queue one',[])`);
      await wait(`!!document.querySelector('.office-approval-card')`, 'first queued approval');
      await run(`void window.axon.chatSend('c-back','approval fixture queue two',[])`);
      await wait(
        `!!document.querySelector('.approval-queue select') && document.querySelector('.approval-queue select').options.length===2`,
        'grouped approval queue'
      );
      assert.equal(
        await run(`document.querySelectorAll('.office-approval-card').length`),
        1,
        'only one approval card shown'
      );
      await click('.office-history-link');
      await run(
        `(() => {const button=document.querySelector('.history-filters button'); button.focus(); button.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));})()`
      );
      await pause(100);
      assert.equal(
        await run(`document.querySelector('.approval-queue select').options.length`),
        2,
        'history shortcuts never approve a background tool'
      );
      await click('[aria-label="Close activity history"]');
      await run(
        `(() => {const select=document.querySelector('.approval-queue select'); select.value=select.options[1].value; select.dispatchEvent(new Event('change',{bubbles:true}));})()`
      );
      await wait(
        `document.querySelector('.office-approval-card header').textContent.includes('Backend Developer')`,
        'choose exact approval'
      );
      await run(
        `[...document.querySelectorAll('.office-approval-actions button')].find(b=>b.textContent==='Reject').click()`
      );
      await wait(
        `!document.querySelector('.approval-queue') && !!document.querySelector('.office-approval-card')`,
        'remaining approval stays available'
      );
      await run(
        `[...document.querySelectorAll('.office-approval-actions button')].find(b=>b.textContent==='Reject').click()`
      );
      await wait(`!document.querySelector('.office-approval-card')`, 'queue resolved');
      await wait(
        `window.axon.snapshot().then(s=>!s.runs.some(r=>['c-dev','c-back'].includes(r.conversationId) && ['working','starting','waiting_for_approval'].includes(r.status)))`,
        'queued runs finish'
      );
      await run(
        `if(document.querySelector('.office-workspace').classList.contains('has-work')) document.querySelector('[aria-label="Close the work surface"]').click()`
      );
      await wait(`!!document.querySelector('.notice-group')`, 'grouped notifications');
      assert.equal(
        await run(`document.querySelectorAll('.office-notice').length`),
        1,
        'one notification by default'
      );
      await click('.notice-group');
      await wait(`document.querySelectorAll('.office-notice').length>1`, 'expand updates');
      await click('.notice-history');
      await wait(`!!document.querySelector('.global-work-panel')`, 'notification opens saved history');
      await set('.global-work-panel input', 'archived');
      await wait(`document.querySelectorAll('.history-run').length===1`, 'saved archived result remains');
      await click('.history-run');
      await wait(
        `document.querySelector('.conversation-drawer').textContent.includes('Archived result remains available.')`,
        'history opens exact archived conversation'
      );
      assert.ok(
        await run(`!document.querySelector('.global-work-panel')`),
        'history closes after result selection'
      );
      await click('.ask-axon');
      await set('.office-command-search input', 'Open planner');
      await pause(100);
      await run(
        `[...document.querySelectorAll('#office-command-results button')].find(b=>b.querySelector('.command-kind').textContent==='Action').click()`
      );
      await wait(
        `document.querySelector('.conversation-drawer').inert && !!document.querySelector('.office-planner-card .planner-body')`,
        'planner command opens the contextual card from a thread'
      );
      await click('.ask-axon');
      await set('.office-command-search input', 'Organize the quarterly offsite');
      await pause(100);
      await run(
        `[...document.querySelectorAll('#office-command-results button')].find(b=>b.querySelector('.command-kind').textContent==='Ask').click()`
      );
      await wait(
        `document.querySelector('.composer-textarea').value==='Organize the quarterly offsite'`,
        'ask prepares draft'
      );
      assert.equal(
        await run(`document.querySelector('.activity-agent-meta h3').textContent`),
        'Receptionist'
      );
      assert.ok(
        await run(`document.querySelector('.office-canvas-container canvas')===window.__testOfficeCanvas`),
        'canvas never remounts for overlays and work'
      );
      assert.equal(
        await run(`document.documentElement.scrollWidth>window.innerWidth`),
        false,
        'no horizontal overflow'
      );
      win.webContents.reload();
      await pause(500);
      await wait(
        `!!document.querySelector('.office-team-people button') && !document.querySelector('.office-loading')`,
        'reopened office'
      );
      await click('.office-history-link');
      await set('.global-work-panel input', 'frontend');
      await run(
        `[...document.querySelectorAll('.history-filters button')].find(b=>b.textContent==='Completed').click()`
      );
      await wait(
        `document.querySelectorAll('.history-run').length>=4`,
        'new completed runs persist across reload'
      );
      const savedCount = await run(
        `window.axon.snapshot().then(s=>s.runs.filter(r=>r.agentId==='frontend-developer' && r.status==='completed').length)`
      );
      assert.equal(
        await run(`document.querySelectorAll('.history-run').length`),
        savedCount,
        'history matches saved run records'
      );
      assert.ok(
        await run(`!document.querySelector('.office-notice')`),
        'reopen does not replay completion notifications'
      );
      await snap('saved-results');
      console.log(
        'PASS office-first: planner, commands, labels, drafts, fullscreen, lifecycle, saved history, grouped approvals/notifications and Ask Axon'
      );
      clearTimeout(timeout);
      server.close();
      app.exit(0);
    } catch (error) {
      console.error(error);
      await win.webContents
        .capturePage()
        .then((image) =>
          fs.writeFileSync(path.join(output, `failure-${width}x${height}-${theme}.png`), image.toPNG())
        )
        .catch(() => {});
      clearTimeout(timeout);
      server.close();
      app.exit(1);
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  const now = Date.now(),
    d = new Date();
  const day = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-');
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
      projectRoot: project,
      runs: [
        {
          runId: 'deleted-run',
          agentId: 'ops-coordinator',
          conversationId: 'c-deleted',
          status: 'completed',
          summary: 'Removed conversation fixture',
          startedAt: now - 100000,
          updatedAt: now - 95000,
          completedAt: now - 95000,
          dependencies: [],
          children: [],
          artifactRefs: []
        },
        {
          runId: 'archived-run',
          agentId: 'frontend-developer',
          conversationId: 'c-history',
          status: 'completed',
          summary: 'Archived redesign result',
          startedAt: now - 90000,
          updatedAt: now - 80000,
          completedAt: now - 80000,
          dependencies: [],
          children: [],
          artifactRefs: []
        }
      ],
      tasks: [
        {
          id: 'today',
          kind: 'todo',
          title: 'Review the redesign',
          due: day,
          status: 'open',
          createdAt: now,
          updatedAt: now
        }
      ],
      conversations: [
        {
          id: 'c-history',
          title: 'Archived redesign',
          workspaceId: null,
          providerId: 'check',
          modelId: 'fixture',
          skillIds: [],
          roleIds: [],
          agentId: 'frontend-developer',
          projectRoot: project,
          createdAt: now - 90000,
          updatedAt: now - 80000
        },
        {
          id: 'c-back',
          title: 'Backend queue fixture',
          workspaceId: null,
          providerId: 'check',
          modelId: 'fixture',
          skillIds: [],
          roleIds: [],
          agentId: 'backend-developer',
          projectRoot: project,
          createdAt: now - 60000,
          updatedAt: now - 60000
        },
        {
          id: 'c-dev',
          title: 'Review fixture',
          workspaceId: null,
          providerId: 'check',
          modelId: 'fixture',
          skillIds: [],
          roleIds: [],
          agentId: 'frontend-developer',
          projectRoot: project,
          createdAt: now - 20000,
          updatedAt: now - 10000
        }
      ],
      messages: [
        {
          id: 'archived-message',
          conversationId: 'c-history',
          role: 'assistant',
          content: 'Archived result remains available.',
          createdAt: now - 80000
        },
        {
          id: 'u',
          conversationId: 'c-dev',
          role: 'user',
          content: 'Read the fixture',
          createdAt: now - 20000
        },
        {
          id: 'a',
          conversationId: 'c-dev',
          role: 'assistant',
          content: 'Ready.',
          createdAt: now - 10000,
          toolCalls: [
            {
              id: 'read',
              name: 'read_file',
              arguments: JSON.stringify({ path: 'notes/readme.ts' }),
              result: '1: export const ready = false;'
            }
          ]
        }
      ],
      reception: { briefedOn: day },
      settings: {
        theme,
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
