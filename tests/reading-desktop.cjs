// Reading a long answer in the coworker's panel, photographed and measured: a 1,800-word plan with
// headings, a table, numbered steps and {merge_fields}, a long message of yours, a reply that stopped
// early, how far one wheel tick moves, and the reading view.
// Build first (npm run build), then: npx electron tests/reading-desktop.cjs [1536x816] [dark]
// Screenshots go to test-results/reading. Only the provider transport is a loopback fixture.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT', error);
  process.exit(1);
});
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const repo = path.resolve(__dirname, '..');
const [width, height] = (process.argv.find((a) => /^\d+x\d+$/.test(a)) ?? '1536x816').split('x').map(Number);
const theme = process.argv.includes('dark') ? 'dark' : 'light';
const output = path.join(repo, 'test-results/reading');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
const project = path.join(profile, 'approval-project');
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

/** A plan as long as the one in the marketing run: sections, a table, steps, and an email with merge fields. */
const VERTICALS = ['Clinics', 'Coaching institutes', 'Real-estate brokers', 'D2C food brands'];
const plan = [
  '# Go-to-market plan for SANKET',
  'This plan covers who we sell to first, what we say, and the outreach that books the first 20 calls. Each section ends with what you need to approve.',
  '## Ideal customer profile per vertical',
  ...VERTICALS.flatMap((v, i) => [
    `### ${i + 1}. ${v}`,
    `${v} with 5 to 50 staff, run by the owner, who already spend on ads but answer enquiries by hand. They lose leads after 6 pm and on weekends, and nobody follows up after the first reply. The buyer is the owner; the user is the front desk.`,
    `- **Trigger:** a new branch, a hiring post for a receptionist, or reviews that mention slow replies.\n- **Budget:** ₹8,000 to ₹25,000 a month on tools.\n- **Proof they need:** one case study in the same city, and a 14-day trial with their own numbers.`
  ]),
  '## Channels and volumes',
  '| Channel | Weekly volume | Owner | Expected replies |\n| --- | --- | --- | --- |\n| Cold email | 250 | SDR | 6 to 9 |\n| LinkedIn connection + note | 120 | SDR | 10 to 14 |\n| Instagram DMs (clinics) | 60 | Social media manager | 4 to 6 |\n| Partner referrals | 10 | Founder | 3 to 5 |',
  '## Email sequence',
  'Four touches over 12 days. Every line in braces is a merge field and must stay exactly as written.',
  ...[1, 2, 3, 4].flatMap((n) => [
    `### Email ${n} (day ${[0, 3, 7, 12][n - 1]})`,
    `Subject: ${['A quick question about your evening enquiries', 'What {company} loses after 6 pm', 'How a clinic in {city} answered every lead', 'Closing the loop'][n - 1]}\n\nHi {first_name},\n\n{observation}\n\n${'We help teams like yours reply to every enquiry within a minute, day or night, and hand the warm ones to your front desk with the context already written up. '.repeat(2)}\n\nWould a 15-minute call next week be useful?\n\n{sender_name}`
  ]),
  '## Week-by-week rollout',
  ...Array.from({ length: 6 }, (_, w) =>
    `${w + 1}. **Week ${w + 1}:** ${['Build the lead list for clinics and coaching institutes (400 leads), verify emails, and write the first observations.', 'Send email 1 and the LinkedIn notes; log every reply in the CRM the same day.', 'Run follow-ups, book the first calls, and collect objections word for word.', 'Rewrite the weakest email from the objections; start real-estate brokers.', 'Add Instagram DMs for clinics; ask the first three customers for a referral.', 'Review: replies, calls booked, cost per call; decide which vertical gets double volume.'][w]}`
  ),
  '## Risks and what we do about them',
  ...['Deliverability drops if we send 250 a week from one new domain. Warm two domains for 14 days first and cap each inbox at 40 a day.', 'Observations written in bulk read as generic. The SDR writes each one from the lead’s own site or reviews, never from a template.', 'Owners in clinics are hard to reach by email. Instagram DMs and a call to the front desk carry that vertical.'].map((r) => `- ${r}`),
  '## What you need to approve',
  '1. The four verticals and their order.\n2. The email sequence wording, including the subject lines.\n3. Sending from two new domains, with a 14-day warm-up.\n4. A budget of ₹30,000 for the lead list and tools in month one.'
].join('\n\n');
const longAsk =
  'We are SANKET, a small team that answers enquiries for local businesses with AI. I want a go-to-market plan for the next six weeks. ' +
  'Cover the ideal customer profile per vertical (clinics, coaching institutes, real-estate brokers, D2C food brands), the channels and weekly volumes, ' +
  'a four-email cold sequence with merge fields ({first_name}, {company}, {city}, {observation}, {sender_name}) kept exactly as written, ' +
  'a week-by-week rollout, the main risks, and a short list of what I need to approve. Keep it practical: numbers, owners and dates, not theory. ' +
  'Assume one SDR, one social media manager and me as the founder. Our budget for month one is around ₹30,000.';

const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const last = JSON.parse(body).messages?.at(-1);
    if (last?.role === 'user' && /approval fixture/.test(last.content)) {
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'approval-write', function: { name: 'write_file', arguments: JSON.stringify({ path: 'approved.md', content: '# Approved\n\nThe fixture write was approved.' }) } }] } }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    response.end('data: {"choices":[{"delta":{"content":"Done."}}]}\n\ndata: [DONE]\n\n');
  });
});

server.listen(0, '127.0.0.1', () => {
  const now = Date.now();
  const say = (id, role, content, ago, extra = {}) => ({
    id,
    conversationId: 'c-plan',
    role,
    content,
    createdAt: now - ago,
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
          models: [
            { id: 'fixture', displayName: 'Fixture', contextWindow: 128000 },
            { id: 'deepseek-flash', displayName: 'DeepSeek Flash', contextWindow: 64000, supportsTools: false },
            { id: 'kimi-k2', displayName: 'Kimi K2', contextWindow: 256000, supportsVision: true }
          ],
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
        {
          id: 'c-plan',
          title: 'Go-to-market plan',
          workspaceId: null,
          providerId: 'check',
          modelId: 'fixture',
          skillIds: [],
          roleIds: [],
          agentId: 'research-analyst',
          createdAt: now - 90000,
          updatedAt: now - 1000
        }
      ],
      messages: [
        say('m1', 'user', longAsk, 90000),
        say('m2', 'assistant', plan, 80000),
        say('m3', 'user', 'Now turn the risks into a checklist for the SDR.', 20000),
        say('m4', 'assistant', "I'll outline the checklist and check the guidance.", 10000, {
          incomplete: 'preamble',
          notice: 'This reply only says what it will do; the work itself did not happen.'
        })
      ],
      settings: {
        theme,
        autoTitleConversations: true,
        defaultTemperature: 0.7,
        defaultMaxTokens: 4096,
        streamDeltas: true,
        allowShellExecution: true,
        shellAllowlist: [],
        sendCrashDiagnostics: false,
        dataDirectoryNote: '',
        modelProfiles: { fast: { providerId: 'check', modelId: 'deepseek-flash' }, deep: { providerId: 'check', modelId: 'kimi-k2' } }
      }
    })
  );
  require(path.join(repo, 'out/main/index.js'));
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  app.exit(1);
}, 150000);
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
    const problems = [];
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
      await waitFor(
        'document.querySelector(".office-person-label") && !document.querySelector(".office-loading")',
        'scene'
      );
      await pause(800);
      await evaluate(
        `(() => { const i = document.querySelector('.office-directory input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Research Analyst'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(250);
      await evaluate(
        `[...document.querySelectorAll('.office-search-results button')].find((b) => b.querySelector('strong')?.textContent === 'Research Analyst').click()`
      );
      await waitFor(`document.querySelector('.activity-agent-meta h3')?.textContent === 'Research Analyst'`, 'panel');
      await evaluate(`document.querySelector('.coworker-actions button')?.click()`);
      await waitFor(`document.querySelector('.office-thread .message')`, 'thread');
      await pause(900);
      await snap('1-thread-end');

      // The badge for a reply that stopped early, and its Continue.
      const badge = await evaluate(`document.querySelector('.activity-agent-meta .status-badge')?.textContent`);
      console.log('badge:', badge);
      if (!/stopped early/i.test(badge ?? '')) problems.push(`hero badge says "${badge}", not "Stopped early"`);
      if (!(await evaluate(`[...document.querySelectorAll('.message-notice.stopped-early button')].some((b) => b.textContent === 'Continue')`)))
        problems.push('no Continue on the reply that stopped early');

      // Scroll areas inside the panel that can actually scroll.
      const scrollers = await evaluate(`(() => [...document.querySelectorAll('.office-activity-panel *')]
        .filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2)
        .map((e) => (e.className && typeof e.className === 'string' ? e.className.split(' ')[0] : e.tagName) + ' ' + e.clientHeight + '/' + e.scrollHeight))()`);
      console.log('scrollers:', JSON.stringify(scrollers));
      if (scrollers.length > 1) problems.push(`${scrollers.length} nested scroll areas: ${scrollers.join(', ')}`);

      // How far one wheel tick moves the long reply.
      // Start away from either edge and target the visible scroll viewport, not an offscreen reply.
      await evaluate(`document.querySelector('.activity-tabpanel-chat').scrollTop = 900`);
      await pause(700);
      const point = await evaluate(`(() => { const r = document.querySelector('.activity-tabpanel-chat').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      const scrolled = () => evaluate(`document.querySelector('.activity-tabpanel-chat').scrollTop`);
      contents.sendInputEvent({ type: 'mouseMove', ...point });
      const before = await scrolled();
      const tickDistances = [];
      for (let i = 0; i < 3; i++) {
        const tickStart = await scrolled();
        contents.sendInputEvent({ type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY: 120, wheelTicksY: -1, canScroll: true });
        await pause(250);
        tickDistances.push(tickStart - await scrolled());
      }
      await pause(400);
      const after = await scrolled();
      console.log('three wheel ticks up moved', before - after, 'px');
      console.log('per tick:', tickDistances);
      if (tickDistances.some((px) => px < 80)) problems.push(`wheel ticks moved only ${tickDistances.join(', ')}px`);

      contents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      contents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
      await pause(100);
      if (!(await evaluate(`document.activeElement === document.querySelector('.activity-tabpanel-chat')`))) problems.push('clicking the thread did not focus its scroll area');
      if (await evaluate(`document.querySelector('.activity-tabpanel-chat').matches(':focus-visible')`)) problems.push('mouse focus shows a keyboard focus ring');
      const key = (keyCode) => {
        contents.sendInputEvent({ type: 'keyDown', keyCode });
        contents.sendInputEvent({ type: 'keyUp', keyCode });
      };
      key('Home');
      await pause(200);
      if (await scrolled() > 2) problems.push('Home did not reach the start');
      key('PageDown');
      await pause(200);
      if (await scrolled() < 80) problems.push('Page Down did not move the thread');
      const beforeSpace = await scrolled();
      key('Space');
      await pause(200);
      if (await scrolled() - beforeSpace < 80) problems.push('Space did not move the thread');
      key('End');
      await pause(200);
      const remaining = await evaluate(`(() => { const s = document.querySelector('.activity-tabpanel-chat'); return s.scrollHeight - s.clientHeight - s.scrollTop; })()`);
      if (remaining > 2) problems.push('End did not reach the latest reply');

      await evaluate(`document.querySelector('.thread-scrub summary').click()`);
      await waitFor(`document.querySelector('.thread-scrub[open] nav')?.getBoundingClientRect().height > 0`, 'reply navigator opens');
      await pause(150);
      await snap('12-reply-navigator');
      await evaluate(`[...document.querySelectorAll('.thread-scrub nav button')].find((b) => b.textContent === 'Email sequence').click()`);
      await pause(600);
      const headingVisible = await evaluate(`(() => { const s = document.querySelector('.activity-tabpanel-chat').getBoundingClientRect(); const h = document.querySelector('[data-message-id="m2"] #rv-email-sequence')?.getBoundingClientRect(); return h && h.top >= s.top && h.bottom <= s.bottom; })()`);
      if (!headingVisible) problems.push('reply navigator did not reach Email sequence');
      await evaluate(`document.querySelector('.thread-scrub').open = false`);

      // Placeholders keep their braces.
      const braces = await evaluate(`document.querySelector('.office-thread').innerText.includes('{observation}')`);
      if (!braces) problems.push('{observation} is not shown as written');

      // The jump pill must not cover the last lines.
      await evaluate(`(() => { const s = [...document.querySelectorAll('.office-activity-panel *')].find((e) => e.scrollHeight > e.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)); if (s) s.scrollTop = 0; })()`);
      await pause(700);
      await snap('2-long-reply-top');
      const jump = await evaluate(`(() => { const j = document.querySelector('.chat-jump'); if (!j) return null; const r = j.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })()`);
      console.log('jump pill:', JSON.stringify(jump));

      // Headings are bigger than body text.
      const sizes = await evaluate(`(() => { const c = document.querySelector('.office-thread .message.assistant .message-content'); const px = (s) => c.querySelector(s) && parseFloat(getComputedStyle(c.querySelector(s)).fontSize); return { h1: px('h1'), h2: px('h2'), h3: px('h3'), p: px('p') }; })()`);
      console.log('type sizes:', JSON.stringify(sizes));
      if (!(sizes.h2 > sizes.p && sizes.h1 > sizes.h2)) problems.push(`headings are not bigger than body text: ${JSON.stringify(sizes)}`);

      // The reading view, when there is one.
      const reader = await evaluate(`(() => { const b = document.querySelector('[data-action="read"]'); b?.click(); return !!b; })()`);
      if (reader) {
        await waitFor(`document.querySelector('.reading-view')`, 'reading view');
        await pause(500);
        await snap('3-reading-view');
      } else problems.push('no reading view for a long reply');

      // Copy all / export for the whole thread, in the conversation menu.
      if (reader) {
        // A real key press: Esc closes the reading view and nothing under it.
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await waitFor(`!document.querySelector('.reading-view')`, 'reading view closes on Esc');
        await pause(300);
        if (!(await evaluate(`!!document.querySelector('.conversation-drawer.is-open')`)))
          problems.push('Esc on the reading view also closed the conversation');
      }
      await evaluate(`document.querySelector('.activity-menu-trigger')?.click()`);
      await pause(200);
      await snap('4-conversation-menu');
      if (!(await evaluate(`!!document.querySelector('[data-action="copy-thread"]') && !!document.querySelector('[data-action="save-thread"]')`)))
        problems.push('no Copy all / Save for the thread');
      await evaluate(`document.querySelector('.activity-menu-trigger')?.click()`);

      // The model picker: type and press Enter at once; a model is picked, Settings never opens.
      await evaluate(`document.querySelector('.activity-composer .model-picker-trigger').click()`);
      await waitFor(`document.querySelector('.model-picker-pop input')`, 'model list');
      await pause(200);
      await snap('5-model-picker');
      await evaluate(
        `(() => { const i = document.querySelector('.model-picker-pop input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'kimi'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      contents.sendInputEvent({ type: 'char', keyCode: '\r' });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      await pause(600);
      const picked = await evaluate(`document.querySelector('.activity-composer .model-picker-label')?.textContent`);
      console.log('picked:', picked);
      if (!/kimi/i.test(picked ?? '')) problems.push(`Enter after typing picked "${picked}", not Kimi`);
      if (await evaluate(`!!document.querySelector('.settings-nav, .settings-panel, [aria-label="Settings"]')`))
        problems.push('Enter in the model search opened Settings');

      // A real request from the service, shown in the thread rather than only on the work surface.
      await evaluate('window.axon.projectChoose()');
      await evaluate(`(() => { void window.axon.chatSend('c-plan', 'Run the approval fixture', []); })()`);
      await waitFor(`document.querySelector('.pending-approvals .approval-card')`, 'in-thread approval');
      await evaluate(`document.querySelector('.work-close')?.click()`);
      await evaluate(`document.querySelector('.activity-tabpanel-chat').scrollTop = document.querySelector('.activity-tabpanel-chat').scrollHeight`);
      await pause(400);
      await snap('11-in-thread-approval');
      const preview = await evaluate(`(() => { const p = document.querySelector('.pending-approvals .approval-preview-diff'); return { height: p?.getBoundingClientRect().height ?? 0, text: p?.textContent ?? '' }; })()`);
      if (preview.height < 50 || !preview.text.includes('The fixture write was approved.')) problems.push('the in-thread approval hides its proposed file content');
      if (!(await evaluate(`document.querySelector('.pending-approvals').innerText.includes('Allow for this task')`))) problems.push('approval has no task grant');
      await evaluate(`document.querySelector('.activity-composer textarea').focus()`);
      const approveKey = () => {
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['control'] });
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['control'] });
      };
      approveKey();
      await pause(300);
      if (!(await evaluate(`!!document.querySelector('.pending-approvals .approval-card')`))) problems.push('Ctrl+Enter approved while typing');
      await evaluate(`document.querySelector('.activity-tabpanel-chat').focus()`);
      approveKey();
      await waitFor(`!document.querySelector('.pending-approvals .approval-card')`, 'Ctrl+Enter approves from the thread');
      await waitFor(`window.axon.snapshot().then((s) => !s.runs.some((r) => r.conversationId === 'c-plan' && ['working', 'starting', 'waiting_for_approval'].includes(r.status)))`, 'approved run finishes');
      if (!fs.existsSync(path.join(project, 'approved.md'))) problems.push('approved write did not reach disk');

      // Another coworker's new conversation: the model carried over is marked as inherited.
      await evaluate(
        `(() => { const i = document.querySelector('.office-directory input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'Designer'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(250);
      await evaluate(
        `[...document.querySelectorAll('.office-search-results button')].find((b) => b.querySelector('strong')?.textContent === 'Designer').click()`
      );
      await waitFor(`document.querySelector('.activity-agent-meta h3')?.textContent === 'Designer'`, 'designer');
      await evaluate(`document.querySelector('.coworker-actions button')?.click()`);
      await pause(700);
      const note = await evaluate(`document.querySelector('.activity-composer .model-picker-note')?.textContent`);
      console.log('designer model note:', note);
      if (note !== 'inherited') problems.push('the carried-over model is not marked as inherited');
      await snap('6-inherited-model');

      // The panel docks left and widens from its ⋯ menu; the office makes room on the other side.
      const menuAction = async (action) => {
        await evaluate(`document.querySelector('.activity-menu-trigger')?.click()`);
        await pause(150);
        await evaluate(`document.querySelector('[data-action="${action}"]')?.click()`);
        await pause(600);
      };
      await menuAction('dock');
      const docked = await evaluate(`(() => { const d = document.querySelector('.conversation-drawer').getBoundingClientRect(); const n = document.querySelector('.office-navigation').getBoundingClientRect(); return { drawerLeft: Math.round(d.left), drawerRight: Math.round(d.right), railLeft: Math.round(n.left) }; })()`);
      console.log('docked left:', JSON.stringify(docked));
      if (docked.drawerLeft > 40 || docked.railLeft < docked.drawerRight) problems.push(`left dock overlaps: ${JSON.stringify(docked)}`);
      await snap('7-docked-left');
      await menuAction('width');
      const wide = await evaluate(`Math.round(document.querySelector('.conversation-drawer').getBoundingClientRect().width)`);
      console.log('wide panel:', wide);
      if (wide < 700) problems.push(`wide panel is only ${wide}px`);
      await snap('8-wide-panel');
      await menuAction('width');
      await menuAction('dock');

      // Close up: the breadcrumb says where you are.
      for (let i = 0; i < 6; i++) {
        await evaluate(`document.querySelector('[aria-label="Zoom in"]')?.click()`);
        await pause(250);
      }
      await pause(900);
      const crumb = await evaluate(`document.querySelector('.office-breadcrumb')?.innerText ?? null`);
      console.log('breadcrumb:', JSON.stringify(crumb));
      if (!crumb) problems.push('no breadcrumb close up');
      await snap('9-breadcrumb');

      // Settings → Appearance: the words under each setting match its choice.
      await evaluate(`document.querySelector('[aria-label="Office settings"]').click()`);
      await waitFor(`[...document.querySelectorAll('.settings-nav-item')].some((b) => b.textContent.includes('Appearance'))`, 'settings');
      await evaluate(`[...document.querySelectorAll('.settings-nav-item')].find((b) => b.textContent.includes('Appearance')).click()`);
      await pause(400);
      await snap('10-appearance');
      const hint = await evaluate(`document.querySelector('.settings-page')?.innerText.includes('Always light') || document.querySelector('.settings-page')?.innerText.includes('Always dark')`);
      if (!hint) problems.push('the Theme hint does not describe the chosen theme');

      const spill = await evaluate(
        `(() => { const p = document.querySelector('.office-activity-panel'); return p.scrollWidth - p.clientWidth; })()`
      );
      if (spill > 0) problems.push('the panel scrolls sideways by ' + spill + 'px');
      console.log(problems.length ? 'PROBLEMS:\n- ' + problems.join('\n- ') : 'No problems found.');
      console.log('Screenshots in', output);
    } catch (error) {
      failed = true;
      console.error(error);
    }
    clearTimeout(timeout);
    app.exit(failed || problems.length ? 1 : 0);
  });
});
