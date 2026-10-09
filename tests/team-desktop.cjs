// Desktop check: a team meeting in the real office window. The Chief of Staff gathers three people,
// they walk to Room 1 (a six-seater fits four), the plan card waits for Start, each task runs with its
// owner working from the room, the report comes, and then everyone walks back to their desk.
// Run after a build: npx electron-vite build && npx electron tests/team-desktop.cjs
// A loopback model answers as the lead, the attendees, the planner and the owners; attendees hold
// their answers until the team is seated, so the room can be seen full, and the first task waits until
// its owner has been seen working at the table.
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../test-results/team');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const theme = process.argv.includes('dark') ? 'dark' : 'light';
const localDay = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};

const PLAN = {
  summary: 'The API first, then the form on it, then tests over both.',
  assignments: [
    { id: 't1', owner: 'Backend Developer', title: 'Reset API', brief: 'Add POST /reset and the token store.', files: ['src/api/reset.ts'] },
    { id: 't2', owner: 'Frontend Developer', title: 'Reset form', brief: 'Build the reset form on the new API.', depends_on: ['t1'], files: ['src/ui/ResetForm.tsx'] },
    { id: 't3', owner: 'QA Engineer', title: 'Reset tests', brief: 'Cover the API and the form.', depends_on: ['t1'], files: ['tests/reset.test.ts'] }
  ]
};
/** Attendees wait here until the test lets the meeting go on. */
let releaseMeeting;
const meetingHeld = new Promise((resolve) => (releaseMeeting = resolve));
/** Owners' tasks wait here until the test has seen them at work in the room. */
let releaseWork;
const workHeld = new Promise((resolve) => (releaseWork = resolve));
const sse = (response, ...events) => {
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end('data: [DONE]\n\n');
};
const text = (content) => ({ choices: [{ delta: { content } }] });
const call = (id, name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });

const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', async () => {
    const parsed = JSON.parse(body);
    const system = parsed.messages?.find((m) => m.role === 'system')?.content ?? '';
    const last = parsed.messages?.[parsed.messages.length - 1];
    const tools = (parsed.tools ?? []).map((t) => t.function?.name);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (tools.includes('propose_plan')) return sse(response, call('plan1', 'propose_plan', PLAN));
    if (system.includes('has called a team meeting')) {
      await meetingHeld;
      return sse(response, text('From my side: I would own my part and need the API contract early.'));
    }
    if (system.includes('Your team has finished'))
      return sse(response, text('The reset flow is in: the API, the form on it, and tests over both. Check the email copy.'));
    if (last?.role === 'user' && typeof last.content === 'string' && last.content.startsWith('Team goal:')) {
      await workHeld;
      await pause(1200);
      const id = last.content.match(/Your task \((t\d)\)/)[1];
      return sse(response, text(`Done with ${id}. Hand-off: it is in place and tested.`));
    }
    if (tools.includes('call_team_meeting') && last?.role === 'user' && /password reset/i.test(last.content))
      return sse(response, call('meet1', 'call_team_meeting', {
        goal: 'Add a password reset flow: API, form and tests.',
        attendees: ['Backend Developer', 'Frontend Developer', 'QA Engineer']
      }));
    sse(response, text('I have gathered Backend, Frontend and QA in Room 1 to plan it.'));
  });
});

const timeout = setTimeout(() => {
  console.error('TEAM_CHECK_TIMEOUT');
  app.exit(1);
}, 240000);
app.on('browser-window-created', (_, win) => {
  win.show = () => {
    win.setPosition(-2200, 0);
    win.showInactive();
  };
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(1536, 816);
});
app.on('web-contents-created', (_, contents) => {
  contents.once('did-finish-load', async () => {
    try {
      const evaluate = (script) => contents.executeJavaScript(script);
      const waitFor = async (script, label, tries = 150) => {
        for (let i = 0; i < tries; i++) {
          if (await evaluate(script)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      const snap = async (name) => fs.writeFileSync(path.join(output, theme === 'dark' ? name.replace('.png', '-dark.png') : name), (await contents.capturePage()).toPNG());
      await waitFor('document.querySelector(".office-person-label") && !document.querySelector(".office-loading")', 'the office');
      await evaluate("localStorage.setItem('axon.officeDebug', '1')");
      contents.reload();
      await pause(600);
      await waitFor('window.__axonOffice && !document.querySelector(".office-loading")', 'the office after reload');
      await pause(500);
      await evaluate(
        `(() => { const input = document.querySelector('[aria-label="Find a coworker"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'chief of staff'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(150);
      await evaluate('document.querySelector(".office-search-results > button").click()');
      await waitFor('document.querySelector(".activity-agent-meta h3")?.textContent === "Chief of Staff"', 'Chief of Staff');
      await evaluate(
        `(() => { const input = document.querySelector('.composer-textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Add a password reset flow'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(80);
      await evaluate('document.querySelector(".composer-btn-send").click()');

      // 0. Another team already waits on its plan in Room 3: seated there, with its tasks on the side-wall board.
      const marketing = ['ops-coordinator', 'content-creator', 'copywriter'];
      const inRoom3 = `(() => { const views = window.__axonOffice.views(); return ${JSON.stringify(marketing)}.every((id) => { const v = views.find((x) => x.id === id); return v && v.sit === 1 && String(v.poiId).startsWith('room-3-'); }); })()`;
      await waitFor(inRoom3, 'the marketing team seated in Room 3', 1200);
      const room3Board = `window.__axonOffice.boards().find((b) => b.team === 'Room 3')`;
      assert.deepEqual(await evaluate(`${room3Board}.cards.map((c) => c.title)`), ['Draft posts', 'Polish copy']);
      await evaluate('window.__axonOffice.focus(-13.2, 6.5, 11)');
      await pause(1500);
      await snap('0-room-3.png');

      // 1. The meeting: the card shows who is coming and where (Room 3 is taken), and they walk to Room 1.
      await waitFor('document.querySelector(".team-card.is-meeting")', 'the team card');
      assert.match(await evaluate('document.querySelector(".team-card header").textContent'), /Team meeting · Room 1/);
      const people = ['chief-of-staff', 'backend-developer', 'frontend-developer', 'qa-engineer'];
      const where = () => evaluate(`window.__axonOffice.views().filter((v) => ${JSON.stringify(people)}.includes(v.id)).map((v) => ({ id: v.id, poi: v.poiId, sit: v.sit, behavior: v.behavior, onTask: v.onTask }))`);
      const seated = `(() => { const views = window.__axonOffice.views(); return ${JSON.stringify(people)}.every((id) => { const v = views.find((x) => x.id === id); return v && v.sit === 1 && String(v.poiId).startsWith('room-1-'); }); })()`;
      try {
        await waitFor(seated, 'the team seated in Room 1', 1200);
      } catch (error) {
        console.error('WHERE', JSON.stringify(await where()));
        throw error;
      }
      const head = await evaluate(`window.__axonOffice.views().find((v) => v.id === 'chief-of-staff').poiId`);
      assert.equal(head, 'room-1-n2', 'the lead takes the first chair');
      const roomBoard = `window.__axonOffice.boards().find((b) => b.team === 'Planning')`;
      assert.equal(await evaluate(`${roomBoard}.title`), 'Room 1', "Room 1's board shows the team");
      assert.equal(await evaluate(`${roomBoard}.cards[0].title`), 'Add a password reset flow: API, form and tests.');
      await evaluate('window.__axonOffice.focus(-4.7, -10.5, 13)');
      await pause(1500);
      await snap('1-room.png');

      // 2. Everyone speaks; the plan waits for Start.
      releaseMeeting();
      await waitFor('document.querySelector(".team-card.is-planned")', 'the plan', 300);
      assert.equal(await evaluate('document.querySelectorAll(".team-task").length'), 3);
      assert.match(await evaluate('document.querySelector(".team-card").textContent'), /Plan ready for you/);
      await pause(400);
      await snap('2-plan.png');
      await evaluate(`[...document.querySelectorAll('.global-work .office-history-link')].find((b) => b.textContent.trim() === 'Multi Agents').click()`);
      await waitFor(`document.querySelector('.multi-agents .multi-task-graph .colleague-summary')`, 'Multi Agents from the office rail');
      await waitFor(`document.querySelector('.conversation-drawer.is-open') && !document.querySelector('.conversation-drawer').inert`, 'Multi Agents drawer is visible');
      await pause(450);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.multi-agents .multi-task-graph .colleague-summary-body > strong')].slice(0, 3).map((e) => e.textContent)`), ['Backend Developer', 'Frontend Developer', 'QA Engineer'], 'shared colleague cards for all planned tasks, before the lead run');
      await snap('2b-multi-agents.png');
      await evaluate(`document.querySelector('#activity-tab-chat').click()`);
      await waitFor(`document.querySelector('.activity-tabpanel-chat:not([hidden]) .team-card.is-planned')`, 'return to the plan');

      // While the plan waits, the team stays in the room.
      assert.ok(await evaluate(seated), 'the team waits for the plan in Room 1');

      // 3. Start: the API first, worked on at the table; then the form and the tests together, then the report.
      await evaluate('document.querySelector(".team-card .team-button.primary").click()');
      const backendAtWork = `(() => { const v = window.__axonOffice.views().find((x) => x.id === 'backend-developer'); return v.onTask && v.sit === 1 && String(v.poiId).startsWith('room-1-'); })()`;
      try {
        await waitFor(backendAtWork, 'the Backend Developer working in Room 1', 300);
      } catch (error) {
        console.error('WHERE', JSON.stringify(await where()));
        throw error;
      }
      await waitFor(`${roomBoard}.cards.some((c) => c.title === 'Reset API' && c.status === 'working')`, 'the board showing the API task at work');
      await pause(3000);
      assert.ok(await evaluate(backendAtWork), 'still at the table, not off to their desk');
      assert.ok(await evaluate(seated), 'the whole team stays in the room while it works');
      await snap('3-working.png');
      releaseWork();
      await waitFor('document.querySelector(".team-card.is-done")', 'the team to finish', 600);
      const snapshot = await evaluate('window.axon.snapshot()');
      const team = snapshot.teams.find((t) => t.leadId === 'chief-of-staff');
      assert.equal(team.room, 'room-1');
      assert.equal(team.status, 'done');
      assert.deepEqual(team.plan.assignments.map((a) => a.status), ['done', 'done', 'done']);
      assert.match(team.report, /reset flow is in/);
      for (const a of team.plan.assignments) {
        const brief = snapshot.messages.find((m) => m.conversationId === a.conversationId && m.role === 'user');
        assert.equal(brief.from, 'Chief of Staff', `${a.id} brief is from the lead`);
      }
      const formBrief = snapshot.messages.find((m) => m.conversationId === team.plan.assignments[1].conversationId && m.role === 'user');
      assert.match(formBrief.content, /Done with t1/, 'the form got the API hand-off');
      // Done: everyone walks back to their desk, and Room 1's board is Planning's again.
      const leftRoom = `(() => { const views = window.__axonOffice.views(); return ${JSON.stringify(people)}.every((id) => { const v = views.find((x) => x.id === id); return v && !String(v.poiId).startsWith('room-1-'); }); })()`;
      try {
        await waitFor(leftRoom, 'the team out of Room 1, on the way back to their desks', 1200);
      } catch (error) {
        console.error('WHERE', JSON.stringify(await where()));
        throw error;
      }
      assert.equal(await evaluate(`${roomBoard}.title`), 'Planning');
      await evaluate('document.querySelector(".team-card").scrollIntoView({ block: "end" })');
      await pause(400);
      await snap('4-done.png');

      // 4. Open an owner's chat from the card: their thread opens on the brief from the lead.
      await evaluate('document.querySelectorAll(".team-card .team-open")[1].click()');
      await waitFor('document.querySelector(".activity-agent-meta h3")?.textContent === "Frontend Developer"', "the owner's chat");
      await waitFor('[...document.querySelectorAll(".message.user strong")].some((s) => s.textContent === "Chief of Staff")', 'the brief from the lead');
      await pause(400);
      await snap('5-owner.png');
      console.log('TEAM_CHECK_PASS', output);
      clearTimeout(timeout);
      server.close();
      app.quit();
    } catch (error) {
      console.error('TEAM_CHECK_FAIL', error);
      try {
        fs.writeFileSync(path.join(output, 'failure.png'), (await contents.capturePage()).toPNG());
      } catch {}
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
          id: 'mock', name: 'Mock', kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          models: [{ id: 'mock-model', displayName: 'Mock model' }], enabled: true, createdAt: now, hasApiKey: false
        }
      ],
      workspaces: [], conversations: [], messages: [], agents: [], documents: [], chunks: [], mcpServers: [], tasks: [],
      // A marketing team whose plan waits for the user, in Room 3.
      teams: [
        {
          id: 'posts', leadId: 'ops-coordinator', conversationId: 'conv-posts', goal: 'Launch-week posts for LinkedIn and X',
          attendees: ['content-creator', 'copywriter'], providerId: 'mock', modelId: 'mock-model', room: 'room-3', status: 'planned',
          minutes: [],
          plan: {
            summary: 'Draft the posts, then polish the copy.',
            assignments: [
              { id: 't1', ownerId: 'content-creator', title: 'Draft posts', brief: 'One per platform.', dependsOn: [], files: [], status: 'waiting' },
              { id: 't2', ownerId: 'copywriter', title: 'Polish copy', brief: 'Tighten the hooks.', dependsOn: ['t1'], files: [], status: 'waiting' }
            ]
          },
          createdAt: now, updatedAt: now
        }
      ],
      reception: { briefedOn: localDay() },
      settings: {
        theme, autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true,
        allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: ''
      }
    })
  );
  require('../out/main/index.js');
});
