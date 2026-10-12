// Dashboards in the real window: a coworker's model calls show_dashboard, the card appears in the
// conversation, Open shows it in the Dashboards sheet, the line chart reads every series under the
// pointer, charts turn into tables, a table copies as CSV, the sheet filters by who, Go to
// conversation, Delete, and the empty sheet. Photographed and measured.
// Build first (npx electron-vite build), then:
//   npx electron tests/dashboards-desktop.cjs [1536x816] [dark]
// Screenshots go to test-results/dashboards. Only the provider transport is a loopback fixture.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT', error);
  process.exit(1);
});
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app, BrowserWindow, clipboard, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const repo = path.resolve(__dirname, '..');
const [width, height] = (process.argv.find((a) => /^\d+x\d+$/.test(a)) ?? '1536x816').split('x').map(Number);
const theme = process.argv.includes('dark') ? 'dark' : 'light';
const output = path.join(repo, 'test-results/dashboards');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
/** The native confirmations (Delete): what they asked, answered "go ahead". */
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

/** What the Growth Marketing Manager's model hands over: eight weeks of lead generation. */
const LEADS = {
  title: 'Lead generation, last 8 weeks',
  summary: 'Qualified leads are up 18% on the previous 8 weeks. LinkedIn brings the most; email converts best.',
  widgets: [
    { type: 'stat', label: 'Qualified leads', value: '1,284', change: '+18% vs previous 8 weeks' },
    { type: 'stat', label: 'Cost per lead', value: '42.5', unit: '$', change: '-6% vs previous 8 weeks' },
    { type: 'stat', label: 'Demo bookings', value: 228, change: '+11% vs previous 8 weeks' },
    { type: 'stat', label: 'Best channel', value: 'LinkedIn', note: '38% of qualified leads' },
    {
      type: 'bar',
      title: 'Qualified leads by channel',
      unit: 'leads',
      data: [
        { label: 'LinkedIn', value: 488 },
        { label: 'Email', value: 301 },
        { label: 'Webinars', value: 214 },
        { label: 'Organic search', value: 173 },
        { label: 'Referrals', value: 108 }
      ]
    },
    {
      type: 'line',
      title: 'Leads each week',
      x: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
      series: [
        { name: 'Qualified leads', values: [128, 141, 137, 152, 163, 171, 188, 204] },
        { name: 'Demo bookings', values: [21, 24, 22, 27, 30, 31, 35, 38] }
      ]
    },
    {
      type: 'table',
      title: 'Top accounts this period',
      columns: ['Company', 'Industry', 'Employees', 'Stage', 'Owner'],
      rows: [
        ['Northwind Pharma', 'Pharmaceuticals', 4200, 'Demo booked', 'A. Rao'],
        ['Fabrikam Apparel', 'Apparel and fashion', 1300, 'Proposal', 'J. Chen'],
        ['Contoso Agritech', 'Agriculture', 860, 'Qualified', 'A. Rao'],
        ['Tailspin Electronics', 'Electronics', 2900, 'Demo booked', 'M. Silva'],
        ['Adventure Works', 'Hardware', 640, 'Qualified', 'J. Chen'],
        ['Litware Foods', 'Agriculture', 410, 'Qualified', 'M. Silva'],
        ['Proseware Labs', 'Pharmaceuticals', 1750, 'Proposal', 'A. Rao'],
        ['Wide World Textiles', 'Apparel and fashion', 980, 'Demo booked', 'J. Chen'],
        ['Coho Components', 'Electronics', 520, 'Qualified', 'M. Silva'],
        ['Lucerne Supply', 'Hardware', 300, 'Qualified', 'A. Rao'],
        ['Margie Mills, Inc', 'Apparel and fashion', 2200, 'Proposal', 'J. Chen'],
        ['Trey Seeds', 'Agriculture', 150, 'Qualified', 'M. Silva']
      ]
    },
    {
      type: 'list',
      title: 'What we found',
      items: [
        { text: 'LinkedIn leads close 1.4x faster', detail: 'Median 19 days from first touch to demo, against 27 for other channels.', url: 'https://example.com/linkedin' },
        { text: 'Webinar sign-ups dropped in W3', detail: 'The session clashed with a trade fair; attendance recovered the week after.' },
        { text: 'Email open rates are steady at 31%', url: 'https://example.com/email' },
        { text: 'Two pharma accounts asked for compliance documents', detail: 'Northwind and Proseware: send the security pack before the demo.' }
      ]
    },
    { type: 'text', title: 'Next steps', body: '1. **Move budget to LinkedIn**: it brings the most leads and the fastest deals.\n2. Book a second webinar slot away from trade fairs.\n3. Prepare the compliance pack for pharma prospects.' }
  ],
  sources: [{ title: 'HubSpot export, 10 Oct 2026' }, { title: 'Campaign report', url: 'https://example.com/campaigns' }]
};

/** The loopback model: a coworker's first step shows the dashboard; after the tool answers, a reply. */
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      // Not a chat request.
    }
    const answered = (parsed.messages ?? []).some((m) => m.role === 'tool');
    const offered = (parsed.tools ?? []).some((t) => t.function?.name === 'show_dashboard');
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (offered && !answered) {
      const call = { index: 0, id: 'call_dash', type: 'function', function: { name: 'show_dashboard', arguments: JSON.stringify(LEADS) } };
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
    } else {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Here is the dashboard: leads are up 18%, and LinkedIn leads the way.' } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    }
    response.end('data: [DONE]\n\n');
  });
});

server.listen(0, '127.0.0.1', () => {
  const now = Date.now();
  const conversation = (id, title, agentId, at) => ({
    id, title, workspaceId: null, providerId: 'check', modelId: 'fixture', skillIds: [], roleIds: [], ...(agentId ? { agentId } : {}), createdAt: at, updatedAt: at
  });
  const state = {
    version: 1,
    providers: [
      {
        id: 'check', name: 'Check', kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        models: [{ id: 'fixture', displayName: 'Fixture', contextWindow: 128000 }], enabled: true, createdAt: now, hasApiKey: false
      }
    ],
    workspaces: [], agents: [], documents: [], chunks: [], mcpServers: [], tasks: [],
    conversations: [
      conversation('c-leads', 'Lead numbers', 'growth-marketing-manager', now - 120000),
      conversation('c-research', 'Clinic market sizing', 'research-analyst', now - 7200000),
      conversation('c-mine', 'My own notes', undefined, now - 86400000)
    ],
    messages: [
      { id: 'm1', conversationId: 'c-leads', role: 'user', content: 'How did lead generation go?', createdAt: now - 120000 },
      { id: 'm2', conversationId: 'c-leads', role: 'assistant', content: 'I pulled the HubSpot export. Want it as a dashboard?', createdAt: now - 110000, providerId: 'check', modelId: 'fixture' },
      { id: 'm3', conversationId: 'c-research', role: 'user', content: 'Size the clinic market.', createdAt: now - 7200000 }
    ],
    dashboards: [
      {
        id: 'd-research', title: 'Clinic market by region', summary: 'The south is the largest market; the north is growing fastest.',
        widgets: [
          { type: 'stat', label: 'Clinics', value: 18400 },
          { type: 'stat', label: 'Yearly growth', value: 4.2, unit: '%' },
          { type: 'bar', title: 'Change in clinic count, last year', data: [{ label: 'North', value: 9.1 }, { label: 'South', value: 3.4 }, { label: 'East', value: -2.2 }, { label: 'West', value: 1.5 }], unit: '%' }
        ],
        sources: [{ title: 'National clinic register 2026', url: 'https://example.com/register' }],
        agentId: 'research-analyst', conversationId: 'c-research', toolCallIds: ['old1'], createdAt: now - 7000000, updatedAt: now - 7000000
      },
      {
        id: 'd-mine', title: 'Reading list', widgets: [{ type: 'list', title: 'To read', items: ['Pricing pages of three rivals', 'The clinic association report'] }],
        sources: [], conversationId: 'c-mine', toolCallIds: ['old2'], createdAt: now - 86000000, updatedAt: now - 86000000
      }
    ],
    settings: {
      theme, autoTitleConversations: false, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true,
      allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '', welcomeDone: true
    }
  };
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
        await pause(250);
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
      const click = (selector, text) =>
        evaluate(
          `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${text ? `e.textContent.trim() === ${JSON.stringify(text)}` : 'true'}); if (!b) return false; b.click(); return true; })()`
        );
      /** Nothing in these boxes is wider than its box (no sideways scroll, no clipped values). */
      const overflowing = (selector) =>
        evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className + ': ' + e.textContent.slice(0, 40))`);
      await waitFor('document.querySelector(".office-team-people button") && !document.querySelector(".office-loading")', 'office', 300);
      await pause(800);

      // ---------------------------------------------------------------- the coworker shows a dashboard
      check(/Dashboards \(2\)/.test(await evaluate(`document.querySelector('.global-work')?.innerText ?? ''`)), 'the rail offers Dashboards, with the two already there');
      await ctrlK();
      await waitFor(`!!document.querySelector('.office-command-search input')`, 'palette');
      await type('.office-command-search input', 'Lead numbers');
      await waitFor(`[...document.querySelectorAll('#office-command-results .command-kind')].some((k) => k.textContent === 'Conversation')`, 'the conversation in search');
      await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => b.querySelector('.command-kind').textContent === 'Conversation').click()`);
      await waitFor(`document.querySelector('.activity-agent-meta h3')?.textContent === 'Growth Marketing Manager'`, 'the conversation opens');
      await evaluate(`window.axon.chatSend('c-leads', 'Yes, put it in a dashboard.', [])`);
      await waitFor(`!!document.querySelector('.dash-card')`, 'the card in the conversation', 200);
      await waitFor(`/leads are up 18%/.test(document.querySelector('.activity-tabpanel-chat')?.innerText ?? '')`, 'the reply after it', 200);
      await evaluate(`document.querySelector('.dash-card').scrollIntoView({ block: 'center' })`);
      const card = await evaluate(`(() => { const c = document.querySelector('.dash-card'); return { title: c.querySelector('.dash-card-title strong').textContent, tiles: c.querySelectorAll('.dash-stat').length, values: [...c.querySelectorAll('.dash-stat-value')].map((v) => v.textContent), more: c.querySelector('.dash-card-more')?.textContent }; })()`);
      console.log('card:', JSON.stringify(card));
      check(card.title === LEADS.title, 'the card shows the title');
      check(card.tiles === 4 && card.values.join('|') === '1,284|$42.5|228|LinkedIn', 'the card shows the four number tiles, formatted');
      check(card.more === 'Also: 2 charts · 1 table · 1 list · 1 note', 'the card says what else is on it');
      check(!(await evaluate(`[...document.querySelectorAll('.work-summary')].some((w) => /show_dashboard|dashboard/i.test(w.textContent))`)), 'the call is not listed as work');
      check((await overflowing('.dash-card .dash-stat-value, .dash-card')).length === 0, 'nothing in the card overflows');
      await snap('1-card');
      check(/Dashboards \(3\)/.test(await evaluate(`document.querySelector('.global-work')?.innerText ?? ''`)), 'the rail count goes up');

      // ---------------------------------------------------------------- the sheet
      await click('.dash-card .dash-small-button', 'Open');
      await waitFor(`!!document.querySelector('.dash-sheet .dash-head h2')`, 'the sheet');
      check((await evaluate(`document.querySelector('.dash-sheet .dash-head h2').textContent`)) === LEADS.title, 'Open shows that dashboard');
      check((await evaluate(`document.querySelector('.dash-sheet-item[aria-current="true"] strong').textContent`)) === LEADS.title, 'and marks it in the list');
      const listed = await evaluate(`[...document.querySelectorAll('.dash-sheet-item strong')].map((s) => s.textContent)`);
      check(listed.length === 3 && listed[0] === LEADS.title, 'every dashboard listed, newest first');
      check((await overflowing('.dash-sheet-view, .dash-stat-value, .dash-widget, .dash-bar-label')).length === 0, 'nothing in the sheet overflows sideways');
      const panel = await evaluate(`(() => { const r = document.querySelector('.office-overlay-panel').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()`);
      console.log('sheet size:', panel.join('x'));
      await snap('2-sheet');
      await evaluate(`document.querySelector('.dash-plot').scrollIntoView({ block: 'center' })`);
      await pause(300);
      const plot = await evaluate(`(() => { const r = document.querySelector('.dash-plot svg').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
      // Point at the fifth week.
      const left = await evaluate(`Number(document.querySelector('.dash-plot svg .dash-gridline, .dash-plot svg .dash-axis').getAttribute('x1'))`);
      const right = await evaluate(`Number(document.querySelector('.dash-plot svg .dash-gridline, .dash-plot svg .dash-axis').getAttribute('x2'))`);
      const pointX = Math.round(plot.x + left + ((right - left) * 4) / 7);
      contents.sendInputEvent({ type: 'mouseMove', x: pointX, y: Math.round(plot.y + plot.h / 2) });
      await waitFor(`!!document.querySelector('.dash-tooltip')`, 'the tooltip');
      const tip = await evaluate(`document.querySelector('.dash-tooltip').innerText`);
      console.log('tooltip:', JSON.stringify(tip));
      check(/W5/.test(tip) && /163/.test(tip) && /Qualified leads/.test(tip) && /30/.test(tip) && /Demo bookings/.test(tip), 'pointing at week 5 reads both lines there');
      check(await evaluate(`(() => { const t = document.querySelector('.dash-tooltip').getBoundingClientRect(); const v = document.querySelector('.dash-sheet-view').getBoundingClientRect(); return t.left >= v.left && t.right <= v.right; })()`), 'the tooltip stays inside the sheet');
      await snap('3-line-tooltip');
      contents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });

      // A chart read as a table.
      await evaluate(`[...document.querySelectorAll('.dash-widget')].find((w) => /Qualified leads by channel/.test(w.textContent)).querySelector('.dash-small-button').click()`);
      const rows = await evaluate(`[...document.querySelectorAll('.dash-widget')].find((w) => /Qualified leads by channel/.test(w.textContent)).querySelectorAll('tbody tr').length`);
      check(rows === 5, 'the bar chart turns into a table of its five bars');

      // Copy as CSV: the clipboard takes writes from a focused window, so focus it and click like a person.
      BrowserWindow.fromWebContents(contents).focus();
      contents.focus();
      await waitFor(`document.hasFocus()`, 'the window has focus', 50);
      await evaluate(`[...document.querySelectorAll('.dash-widget')].find((w) => /Top accounts/.test(w.textContent)).scrollIntoView({ block: 'center' })`);
      await pause(200);
      const copyAt = await evaluate(`(() => { const r = [...document.querySelectorAll('.dash-widget')].find((w) => /Top accounts/.test(w.textContent)).querySelector('.dash-small-button').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      contents.sendInputEvent({ type: 'mouseDown', x: copyAt.x, y: copyAt.y, button: 'left', clickCount: 1 });
      contents.sendInputEvent({ type: 'mouseUp', x: copyAt.x, y: copyAt.y, button: 'left', clickCount: 1 });
      await waitFor(`[...document.querySelectorAll('.toast')].some((t) => /Table copied as CSV/.test(t.textContent))`, 'copied', 40);
      const csv = await Promise.resolve(clipboard.readText());
      console.log('clipboard:', typeof csv, JSON.stringify(String(csv).slice(0, 80)));
      check(csv.startsWith('Company,Industry,Employees,Stage,Owner\r\nNorthwind Pharma,Pharmaceuticals,4200,') && csv.includes('"Margie Mills, Inc"'), 'Copy as CSV puts the table on the clipboard, quoted');
      await evaluate(`[...document.querySelectorAll('.dash-widget')].find((w) => /Top accounts/.test(w.textContent)).scrollIntoView({ block: 'center' })`);
      await snap('4-table-and-list');

      // Negative bars in another coworker's dashboard; the filter by who.
      await evaluate(`[...document.querySelectorAll('.dash-sheet-item')].find((b) => /Clinic market/.test(b.textContent)).click()`);
      await waitFor(`document.querySelector('.dash-sheet .dash-head h2')?.textContent === 'Clinic market by region'`, 'the other dashboard');
      check((await evaluate(`document.querySelectorAll('.dash-bar.negative').length`)) === 1, 'a negative value grows the other way from zero');
      await snap('5-negative-bars');
      const who = await evaluate(`[...document.querySelectorAll('.dash-sheet-filter option')].map((o) => o.textContent)`);
      console.log('who:', JSON.stringify(who));
      check(who.join('|') === 'Everyone|Growth Marketing Manager|Research Analyst|You', 'the filter names everyone who made one');
      await evaluate(`(() => { const s = document.querySelector('.dash-sheet-filter select'); s.value = 'you'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await pause(200);
      check((await evaluate(`[...document.querySelectorAll('.dash-sheet-item strong')].map((s) => s.textContent).join('|')`)) === 'Reading list', 'filtering to You shows your own');
      check(!(await evaluate(`[...document.querySelectorAll('.dash-actions button')].some((b) => /Go to conversation/.test(b.textContent))`)), 'your own chat has no coworker to go to');
      await evaluate(`(() => { const s = document.querySelector('.dash-sheet-filter select'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

      // Delete.
      await evaluate(`[...document.querySelectorAll('.dash-sheet-item')].find((b) => /Reading list/.test(b.textContent)).click()`);
      await click('.dash-actions button', 'Delete');
      await waitFor(`document.querySelectorAll('.dash-sheet-item').length === 2`, 'deleted');
      check(asked.length === 1 && /Delete the dashboard "Reading list"\?/.test(asked[0].message), 'Delete asks first');

      // Go to conversation.
      await evaluate(`[...document.querySelectorAll('.dash-sheet-item')].find((b) => /Clinic market/.test(b.textContent)).click()`);
      await click('.dash-actions button', 'Go to conversation');
      await waitFor(`!document.querySelector('.dash-sheet') && document.querySelector('.activity-agent-meta h3')?.textContent === 'Research Analyst'`, 'the research conversation');
      check(true, 'Go to conversation closes the sheet and opens it');

      // Ctrl+K, and the empty sheet.
      await ctrlK();
      await type('.office-command-search input', 'dashboards');
      await pause(300);
      await evaluate(`[...document.querySelectorAll('#office-command-results button')].find((b) => /Open dashboards/.test(b.textContent)).click()`);
      await waitFor(`!!document.querySelector('.dash-sheet')`, 'Ctrl+K opens the sheet');
      check(true, 'Ctrl+K "Open dashboards" opens the sheet');
      for (const id of await evaluate(`window.axon.snapshot().then((s) => s.dashboards.map((d) => d.id))`))
        await evaluate(`window.axon.dashboardDelete(${JSON.stringify(id)})`);
      await waitFor(`/No dashboards yet/.test(document.querySelector('.office-overlay-panel')?.innerText ?? '')`, 'the empty sheet');
      check(true, 'with none left, the sheet says how to get one');
      await snap('6-empty');
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
      console.log(failed || problems.length ? 'DASHBOARD CHECKS FAILED' : 'DASHBOARD CHECKS PASSED');
      server.close();
      app.exit(failed || problems.length ? 1 : 0);
    }
  });
});
