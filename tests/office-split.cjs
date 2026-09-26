// The office and the work surface below it: when the surface opens, the 60/40 split and dragging
// its divider, the side panel's summary of each run and its rows opening the surface, changes and
// approvals on the surface, a command's output as it runs, and frame rate while dragging.
// Build first (npm run build), then: npx electron tests/office-split.cjs [1600x960] [dark]
// Screenshots go to test-results/office-split. Only the provider transport is a loopback fixture.
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
const output = path.join(repo, 'test-results/office-split');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const [width, height] = (process.argv.find((a) => /^\d+x\d+$/.test(a)) ?? '1600x960').split('x').map(Number);
const theme = process.argv.includes('dark') ? 'dark' : 'light';
const localDay = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};

// A project folder for the live run, chosen through the (stubbed) folder dialog.
const project = path.join(profile, 'axon-platform');
fs.mkdirSync(path.join(project, 'notes'), { recursive: true });
fs.writeFileSync(path.join(project, 'notes', 'todo.md'), '# Todo\n\n- Filters\n- Sorting\n- Tests\n');
const projectRoot = fs.realpathSync(project);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });

// The live run: write a file, then run a command that prints a line every 300 ms, then reply.
const SLOW = "let i=0;const t=setInterval(()=>{console.log('line '+i);if(++i===6)clearInterval(t)},300)";
const toolCall = (id, name, args) =>
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\ndata: [DONE]\n\n`;
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (c) => (body += c));
  request.on('end', () => {
    const parsed = JSON.parse(body);
    const last = parsed.messages?.[parsed.messages.length - 1];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (last?.role === 'user' && /notes file/i.test(last.content)) {
      response.end(toolCall('call_write', 'write_file', { path: 'notes/todo.md', content: '# Todo\n\n- Filters\n- Sorting by due date\n- Tests\n- Docs\n' }));
      return;
    }
    if (last?.role === 'tool' && last.tool_call_id === 'call_write') {
      response.end(toolCall('call_run', 'run_command', { command: `node -e "${SLOW}"` }));
      return;
    }
    response.end('data: {"choices":[{"delta":{"content":"All done."}}]}\n\ndata: [DONE]\n\n');
  });
});

const TASK_FILTERS = `import { useMemo, useState } from 'react';
import type { Task, TaskPriority, TaskStatus } from '../types/task';

export interface TaskFilterState {
  status: TaskStatus | 'all';
  priority: TaskPriority | 'all';
  sort: 'due-asc' | 'due-desc';
}

export const DEFAULT_FILTERS: TaskFilterState = { status: 'all', priority: 'all', sort: 'due-asc' };

/** Status, priority and due-date sorting for the dashboard's task list. */
export function TaskFilters({ value, onChange }: { value: TaskFilterState; onChange: (next: TaskFilterState) => void }) {
  return (
    <div className="task-filters" role="group" aria-label="Filter tasks">
      <select value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value as TaskFilterState['status'] })}>
        <option value="all">All statuses</option>
        <option value="todo">To do</option>
        <option value="done">Done</option>
      </select>
      <button onClick={() => onChange({ ...value, sort: value.sort === 'due-asc' ? 'due-desc' : 'due-asc' })}>
        Due date {value.sort === 'due-asc' ? '↑' : '↓'}
      </button>
    </div>
  );
}
`;
const TASK_LIST = `import type { Task } from '../types/task';
import { TaskRow } from './TaskRow';

export function TaskList({ tasks }: { tasks: Task[] }) {
  if (!tasks.length) return <p className="empty">No tasks match these filters.</p>;
  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ul>
  );
}`;
const TASK_LIST_EDITED = TASK_LIST.replace(
  "import { TaskRow } from './TaskRow';",
  "import { TaskRow } from './TaskRow';\nimport { useFilteredTasks, DEFAULT_FILTERS } from './TaskFilters';"
).replace('{tasks.map((task) => (', '{useFilteredTasks(tasks, DEFAULT_FILTERS).map((task) => (');
// What the app saves with that write: the change, from the app's own diff (src/main/tools/diff.ts).
const ts = require('typescript');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText,
    file
  );
const TASK_LIST_CHANGE = require(path.join(repo, 'src/main/tools/diff.ts')).fileChange(TASK_LIST, TASK_LIST_EDITED);
const numbered = (text) => text.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
const call = (id, name, args, result, extra = {}) => ({ id, name, arguments: JSON.stringify(args), result, ...extra });

server.listen(0, '127.0.0.1', () => {
  const now = Date.now();
  const conv = (id, agentId, title, at, root) => ({
    id, title, workspaceId: null, providerId: 'check', modelId: 'fixture', skillIds: [], roleIds: [],
    agentId, projectRoot: root, createdAt: at, updatedAt: at
  });
  const messages = [
    { id: 'u1', conversationId: 'c-dev', role: 'user', content: 'Great, that’s done. Now move on to task filters and due-date sorting.', createdAt: now - 60000 },
    { id: 'a0', conversationId: 'c-dev', role: 'assistant', createdAt: now - 58000, content: 'Sounds good. I’m working on it now.' },
    {
      id: 'a1', conversationId: 'c-dev', role: 'assistant', createdAt: now - 55000, content: '',
      toolCalls: [
        call('t1', 'list_files', { directory: 'src' }, 'src/components/TaskFilters.tsx\nsrc/components/TaskList.tsx\nsrc/components/TaskRow.tsx\nsrc/pages/Dashboard.tsx\nsrc/services/api.ts\nsrc/types/task.ts'),
        call('t2', 'read_file', { path: 'src/components/TaskList.tsx' }, numbered(TASK_LIST)),
        call('t3', 'search_code', { query: 'dueDate' }, "src/types/task.ts:7  dueDate: string;\nsrc/services/api.ts:22  params.set('sort', 'dueDate');"),
        call('t4', 'read_file', { path: 'src/pages/Dashboard.tsx' }, numbered("import { TaskList } from '../components/TaskList';\n\nexport function Dashboard() {\n  return <TaskList tasks={useTasks()} />;\n}")),
        call('t5', 'write_file', { path: 'src/components/TaskFilters.tsx', content: TASK_FILTERS }, 'Successfully wrote 1401 characters to src/components/TaskFilters.tsx.', {
          change: { added: TASK_FILTERS.split('\n').length, removed: 0, created: true }
        })
      ]
    },
    {
      id: 'a2', conversationId: 'c-dev', role: 'assistant', createdAt: now - 50000, content: '',
      toolCalls: [
        call('t6', 'run_command', { command: 'npm test -- TaskFilters' }, '> vitest run TaskFilters\n\n ✓ src/components/TaskFilters.test.tsx (4 tests) 38ms\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)'),
        call('t7', 'write_file', { path: 'src/components/TaskList.tsx', content: TASK_LIST_EDITED }, 'Successfully wrote 402 characters to src/components/TaskList.tsx.', {
          change: TASK_LIST_CHANGE
        })
      ]
    },
    { id: 'a3', conversationId: 'c-dev', role: 'assistant', createdAt: now - 48000, content: 'Filters and due-date sorting are in, and the tests pass.' },
    { id: 'u2', conversationId: 'c-back', role: 'user', content: 'Check the API docs page renders.', createdAt: now - 40000 },
    {
      id: 'b0', conversationId: 'c-back', role: 'assistant', createdAt: now - 39000, content: 'Checking the docs page in the browser.',
      toolCalls: [
        call('b1', 'run_command', { command: 'npm run dev' }, 'VITE v5.4.2  ready in 412 ms\n\n  ➜  Local:   http://localhost:5173/\n[stderr]\n(!) Some chunks are larger than 500 kB after minification.'),
        call('b2', 'mcp_playwright_browser_navigate', { url: 'http://localhost:5173/docs/api' }, 'Page: Axon API · Tasks\n\nGET /api/tasks\n  Query: status, priority, sort=dueDate\n  Returns: Task[]')
      ]
    }
  ];
  fs.mkdirSync(path.join(profile, 'data/db'), { recursive: true });
  fs.writeFileSync(
    path.join(profile, 'data/db/platform-v1.json'),
    JSON.stringify({
      version: 1,
      providers: [{ id: 'check', name: 'Check', kind: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, models: [{ id: 'fixture', displayName: 'Fixture' }], enabled: true, createdAt: now, hasApiKey: false }],
      workspaces: [], agents: [], documents: [], chunks: [], mcpServers: [], tasks: [],
      conversations: [
        conv('c-dev', 'frontend-developer', 'Task filters', now - 48000, 'C:/Users/dev/axon-platform'),
        conv('c-back', 'backend-developer', 'API docs', now - 39000, projectRoot)
      ],
      messages,
      reception: { briefedOn: localDay() },
      settings: { theme, autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true, allowShellExecution: true, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '' }
    })
  );
  require(path.join(repo, 'out/main/index.js'));
});

const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  app.exit(1);
}, 240000);
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
    const results = [];
    const check = (label, ok, detail = '') => {
      results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
    };
    try {
      const evaluate = (script) =>
        contents.executeJavaScript(script).catch((error) => {
          throw new Error(`${error.message}\n  in: ${script.slice(0, 160)}`);
        });
      const waitFor = async (script, label, tries = 150) => {
        for (let i = 0; i < tries; i++) {
          if (await evaluate(script)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      const snap = async (name) => fs.writeFileSync(path.join(output, name), (await contents.capturePage()).toPNG());
      const text = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
      const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      const clickText = (selector, pattern) =>
        evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${pattern}.test(e.textContent)).click()`);
      const choosePerson = async (name) => {
        await evaluate(`(() => { const i = document.querySelector('.office-directory input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(name)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await pause(250);
        await evaluate(`[...document.querySelectorAll('.office-search-results button')].find((b) => b.querySelector('strong')?.textContent === ${JSON.stringify(name)}).click()`);
        await waitFor(`document.querySelector('.activity-agent-meta h3').textContent === ${JSON.stringify(name)}`, name);
        await pause(500);
      };
      await waitFor('document.querySelector(".office-person-label") && !document.querySelector(".office-loading")', 'scene');
      await pause(900);
      const geometry = () =>
        evaluate(`(() => {
          const ws = document.querySelector('.office-workspace').getBoundingClientRect();
          const office = document.querySelector('.office-viewport').getBoundingClientRect();
          const div = document.querySelector('.work-divider').getBoundingClientRect();
          const panel = document.querySelector('.office-activity-panel').getBoundingClientRect();
          return { ws: [ws.width, ws.height], office: office.height, divider: [div.top, div.height, div.left + div.width / 2],
            officeShare: office.height / (ws.height - div.height), widthShare: ws.width / (ws.width + panel.width),
            valuenow: document.querySelector('.work-divider').getAttribute('aria-valuenow'),
            tab: document.querySelector('.work-tab.active')?.textContent, open: document.querySelector('.office-workspace').classList.contains('has-work'),
            file: document.querySelector('.work-editor-tab.active')?.textContent, now: document.querySelector('.work-now-text')?.textContent,
            cursor: getComputedStyle(document.querySelector('.work-divider')).cursor, size: document.querySelector('.office-workspace').dataset.officeSize,
            spill: Math.round(Math.max(...[...document.querySelectorAll('.office-viewport > *')].filter((e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).position !== 'absolute').map((e) => e.getBoundingClientRect().bottom)) - office.bottom) };
        })()`);
      const full = (g) => !g.open && g.office > g.ws[1] - 3;

      // Older work waits: the frontend developer's last run is over, so the office keeps the height.
      let g = await geometry();
      check('older work does not open the surface by itself', full(g), `${g.office} of ${g.ws[1]}`);
      check('the office offers to show their work', (await evaluate(`document.querySelector('[aria-label="Work surface"]')?.getAttribute('aria-pressed')`)) === 'false');
      // The side panel sums up the run instead of listing its tool calls.
      check('the run is summed up in the side panel', (await text('.work-summary-head')) === 'Changed 2 files', await text('.work-summary-head'));
      const rows = await evaluate(`[...document.querySelectorAll('.work-summary-row')].map((r) => r.textContent)`);
      check('files show lines added and removed', rows.some((r) => /TaskFilters\.tsx.*\+2\d−0.*Saved/.test(r)) && rows.some((r) => /TaskList\.tsx.*\+2−1.*Saved/.test(r)), rows.join(' | '));
      check('commands and what was looked at have rows', rows.some((r) => /npm test -- TaskFilters.*Done/.test(r)) && rows.some((r) => /Read 2 files · 1 search · 1 listing/.test(r)), rows.join(' | '));
      check('raw tool calls are not listed in the thread', (await evaluate(`document.querySelectorAll('.office-thread .message .tool-call-item').length`)) === 0);
      await snap('1-summary.png');

      // A file row opens the surface on that file's changes, at 60/40.
      await clickText('.work-summary-row', /TaskList\.tsx/);
      await pause(600);
      g = await geometry();
      console.log('OPENED', JSON.stringify(g));
      check('a file row opens the surface at 60/40', g.open && Math.abs(g.officeShare - 0.6) < 0.01, g.officeShare.toFixed(3));
      check('left/right is about 60/40', Math.abs(g.widthShare - 0.6) < 0.03, g.widthShare.toFixed(3));
      check('it shows that file', g.tab?.startsWith('Code') && g.file?.startsWith('TaskList.tsx'), `${g.tab} / ${g.file}`);
      check('on its changes', (await evaluate(`document.querySelector('.work-segment [aria-pressed="true"]')?.textContent`)) === 'Changes' &&
        (await evaluate(`document.querySelectorAll('.work-diff-add').length`)) === 2 && (await evaluate(`document.querySelectorAll('.work-diff-del').length`)) === 1);
      const hunks = await evaluate(`[...document.querySelectorAll('.work-diff-hunk')].map((h) => h.textContent)`);
      check('with each hunk labelled by its lines', hunks.length > 0 && hunks.every((h) => /^Lines? \d+(–\d+)?$/.test(h)), hunks.join(', '));
      check('divider cursor is row-resize', g.cursor === 'row-resize', g.cursor);
      check('nothing spills out of the office', g.spill <= 1, `${g.spill}px, size ${g.size}`);
      await snap('2-changes.png');
      await clickText('.work-segment button', /^File$/);
      await pause(200);
      check('the whole file marks the changed lines', (await evaluate(`document.querySelectorAll('.work-gutter .is-changed').length`)) === 2);
      await snap('3-file.png');

      // Dragging the divider with the mouse.
      const drag = async (fromY, toY, x, midShot) => {
        // Moves must carry leftButtonDown, or Chromium sees a released button after the first one.
        contents.sendInputEvent({ type: 'mouseMove', x, y: fromY });
        contents.sendInputEvent({ type: 'mouseDown', x, y: fromY, button: 'left', clickCount: 1 });
        for (let i = 1; i <= 8; i++) {
          contents.sendInputEvent({ type: 'mouseMove', x, y: Math.round(fromY + ((toY - fromY) * i) / 8), button: 'left', modifiers: ['leftButtonDown'] });
          await pause(16);
          if (midShot && i === 5) await snap(midShot);
        }
        contents.sendInputEvent({ type: 'mouseUp', x, y: toY, button: 'left', clickCount: 1 });
        await pause(150);
      };
      const mid = () => Math.round(g.divider[0] + g.divider[1] / 2);
      const yFor = (share) => Math.round(g.divider[0] - (g.office - share * (g.ws[1] - g.divider[1])) + g.divider[1] / 2);
      await drag(mid(), yFor(0.45), Math.round(g.divider[2]), '4-mid-drag.png');
      g = await geometry();
      check('dragging up makes the surface larger (~45/55)', Math.abs(g.officeShare - 0.45) < 0.02, `${g.officeShare.toFixed(3)} valuenow ${g.valuenow}`);
      check('nothing spills out at 45%', g.spill <= 1, `${g.spill}px, size ${g.size}`);
      for (const label of ['Terminal', 'Files', 'Code']) {
        await clickText('.work-tab', new RegExp('^' + label));
        await pause(120);
        const after = await geometry();
        check(`${label} tab keeps the split`, Math.abs(after.officeShare - g.officeShare) < 0.005 && after.tab.startsWith(label), `${after.tab} ${after.officeShare.toFixed(3)}`);
      }
      await drag(mid(), 5, Math.round(g.divider[2]));
      g = await geometry();
      check('cannot drag the office below 30%', Math.abs(g.officeShare - 0.3) < 0.01, g.officeShare.toFixed(3));
      check('nothing spills out at 30%', g.spill <= 1, `${g.spill}px, size ${g.size}`);
      await snap('5-min-office.png');
      await drag(mid(), height - 5, Math.round(g.divider[2]));
      g = await geometry();
      check('cannot drag the office above 80%', Math.abs(g.officeShare - 0.8) < 0.01, g.officeShare.toFixed(3));
      await evaluate(`document.querySelector('.work-divider').focus()`);
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' });
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Up' });
      await pause(400);
      g = await geometry();
      check('arrow up moves 5%', Math.abs(g.officeShare - 0.75) < 0.011, g.officeShare.toFixed(3));
      await drag(mid(), yFor(0.55), Math.round(g.divider[2]));
      g = await geometry();
      const kept = g.officeShare;
      check('the tight office keeps a wordmark and its team', g.size?.includes('tight') ? (await evaluate(`getComputedStyle(document.querySelector('.office-stage-mark')).display`)) === 'block' : true, g.size);

      // Frame rate while dragging the divider back and forth, against idle just before and after.
      // The office settles its quality for a few seconds after it changes size, so wait that out.
      const frames = () =>
        evaluate(`new Promise((done) => { let n = 0; const start = performance.now(); const tick = () => { n++; if (performance.now() - start < 2000) requestAnimationFrame(tick); else done(Math.round(n / ((performance.now() - start) / 1000))); }; requestAnimationFrame(tick); })`);
      const dragFrames = async () => {
        const counting = frames();
        const x = Math.round(g.divider[2]);
        contents.sendInputEvent({ type: 'mouseMove', x, y: mid() });
        contents.sendInputEvent({ type: 'mouseDown', x, y: mid(), button: 'left', clickCount: 1 });
        for (let i = 0; i < 120; i++) {
          contents.sendInputEvent({ type: 'mouseMove', x, y: mid() + Math.round(60 * Math.sin(i / 8)), button: 'left', modifiers: ['leftButtonDown'] });
          await pause(16);
        }
        const fps = await counting;
        contents.sendInputEvent({ type: 'mouseUp', x, y: mid(), button: 'left', clickCount: 1 });
        await pause(300);
        return fps;
      };
      await pause(4000);
      const idleBefore = await frames();
      // The better of two drags: one reading can catch the machine busy with something else.
      const dragging = Math.max(await dragFrames(), await dragFrames());
      const idleAfter = await frames();
      await drag(mid(), yFor(0.55), Math.round(g.divider[2]));
      g = await geometry();
      const idle = (idleBefore + idleAfter) / 2;
      console.log('FPS', JSON.stringify({ idleBefore, dragging, idleAfter }));
      // Single readings swing with power and background load (see the office-desktop check); a drag
      // used to cost 35–60% before the office drew cheaply while its divider is held.
      check('dragging keeps most of the frame rate', dragging >= idle * 0.75, `idle ${idleBefore}/${idleAfter} fps, dragging ${dragging} fps`);

      // A command row goes to the terminal, without moving the divider.
      await clickText('.work-summary-row', /npm test/);
      await pause(300);
      let after = await geometry();
      check('a command row shows the terminal', after.tab?.startsWith('Terminal') && Math.abs(after.officeShare - kept) < 0.01, `${after.tab} ${after.officeShare.toFixed(3)}`);

      // Someone else: the surface follows who is selected.
      await evaluate(`[...document.querySelectorAll('.office-team-people button')].find((b) => !/Frontend|Backend/.test(b.title)).click()`);
      await pause(500);
      check('a coworker without work: the office takes the height', full(await geometry()));
      await choosePerson('Backend Developer');
      g = await geometry();
      check('older work of another coworker waits too', full(g));
      await click('[aria-label="Work surface"]');
      await pause(500);
      g = await geometry();
      check('opened by hand, at the kept split, on their latest step', g.open && Math.abs(g.officeShare - kept) < 0.01 && g.tab?.startsWith('Browser'), `${g.officeShare.toFixed(3)} ${g.tab} · ${g.now}`);
      await snap('6-browser.png');
      await click('.work-close');
      await pause(450);
      g = await geometry();
      check('closing gives the office the height again', full(g), `open ${g.open}, office ${Math.round(g.office)} of ${Math.round(g.ws[1])}`);

      // A live run: they propose a change, you approve it on the surface; then a command, run from there.
      await evaluate('window.axon.projectChoose()');
      await evaluate(`(() => { const t = document.querySelector('.activity-composer textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Please update the notes file.'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await pause(100);
      await evaluate(`document.querySelector('.activity-composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      await waitFor(`document.querySelector('.work-file-path .work-approve')`, 'the proposal on the surface');
      await pause(700);
      g = await geometry();
      check('a live run opens the surface by itself, even after it was closed', g.open && Math.abs(g.officeShare - kept) < 0.01, g.officeShare.toFixed(3));
      check('on the proposed change', g.tab?.startsWith('Code') && g.file?.startsWith('todo.md') && (await text('.work-file-note')) === 'Proposed change', `${g.tab} ${g.file} ${await text('.work-file-note')}`);
      const liveRow = await evaluate(`[...document.querySelectorAll('.work-summary.is-live .work-summary-row')].map((r) => r.textContent).join(' | ')`);
      check('the side panel says it is waiting for you, and by how much', (await text('.work-summary.is-live .work-summary-head')) === 'Working on 1 file…' && /todo\.md.*\+2−1.*Waiting for your OK/.test(liveRow) && !/npm run dev/.test(liveRow), liveRow);
      await snap('7-proposal.png');
      await click('.work-file-path .work-approve');
      await waitFor(`document.querySelector('.work-term-note .work-approve')`, 'the command waiting on the surface');
      await pause(1000);
      g = await geometry();
      check('the next step brings the terminal forward', g.tab?.startsWith('Terminal'), `${g.tab} · ${g.now}`);
      check('the file was written as proposed', fs.readFileSync(path.join(project, 'notes', 'todo.md'), 'utf8').includes('- Docs'));
      await click('.work-term-note .work-approve');
      await waitFor(`/line 1/.test(document.querySelector('.work-terminal').textContent) && document.querySelector('.work-term-cursor')`, 'output while it runs');
      const partial = await text('.work-terminal');
      check('the terminal shows output while the command runs', /line 1/.test(partial) && !/line 5/.test(partial), partial.slice(-80));
      await snap('8-running.png');
      await waitFor(`/line 5/.test(document.querySelector('.work-terminal').textContent) && !document.querySelector('.work-term-cursor')`, 'the command to finish');
      await waitFor(`document.querySelector('.work-summary:last-of-type .work-summary-head')?.textContent === 'Changed 1 file'`, 'the run summed up');
      const done = await evaluate(`[...document.querySelectorAll('.work-summary')].at(-1).textContent`);
      check('the run is summed up when it ends', /todo\.md.*\+2−1.*Saved/.test(done) && /node -e.*Done/.test(done), done);
      g = await geometry();
      check('the surface stays while you watch them finish', g.open);
      await snap('9-done.png');
      await evaluate(`[...document.querySelectorAll('.office-team-people button')].find((b) => !/Backend/.test(b.title)).click()`);
      await pause(400);
      await choosePerson('Backend Developer');
      check('coming back after the run: it waits again', full(await geometry()));
    } catch (error) {
      results.push('ERROR ' + (error && error.stack));
    }
    console.log(results.join('\n'));
    fs.writeFileSync(path.join(output, 'results.txt'), results.join('\n'));
    clearTimeout(timeout);
    server.close();
    app.exit(results.some((r) => !r.startsWith('PASS')) ? 1 : 0);
  });
});
