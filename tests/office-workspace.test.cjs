// The office's work surface: what a coworker's tool calls show below the office, and the split.
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const work = require('../src/renderer/src/features/office/workspace/work.ts');
const thread = require('../src/renderer/src/features/office/activity/thread.ts');

const call = (id, name, args, outcome = {}) => ({ id, name, arguments: JSON.stringify(args), ...outcome });
const assistant = (...toolCalls) => ({ id: 'm' + toolCalls[0].id, role: 'assistant', content: '', toolCalls });

test('the split starts at 60/40 and keeps both sides usable', () => {
  assert.equal(work.DEFAULT_WORK_SPLIT, 0.6);
  assert.equal(work.clampWorkSplit(0.1), 0.3);
  assert.equal(work.clampWorkSplit(0.95), 0.8);
  assert.equal(work.clampWorkSplit(0.45), 0.45);
  assert.equal(work.clampWorkSplit(NaN), 0.6);
});

test('each tool shows on its own surface; office business shows on none', () => {
  assert.equal(work.workKind('read_file', {}), 'code');
  assert.equal(work.workKind('write_file', {}), 'code');
  assert.equal(work.workKind('list_files', {}), 'files');
  assert.equal(work.workKind('search_code', {}), 'files');
  assert.equal(work.workKind('run_command', {}), 'terminal');
  assert.equal(work.workKind('git_commit', {}), 'terminal');
  assert.equal(work.workKind('mcp_playwright_browser_navigate', {}), 'browser');
  assert.equal(work.workKind('mcp_fetch_fetch', { url: 'https://example.com' }), 'browser');
  assert.equal(work.workKind('mcp_postgres_query', { sql: 'select 1' }), 'tool');
  for (const name of ['ask_colleague', 'add_task', 'complete_task', 'read_memory', 'dispatch_subagent'])
    assert.equal(work.workKind(name, {}), null, name);
});

test('a read shows the file without line numbers, from where the read started', () => {
  assert.deepEqual(work.readText('12: const a = 1;\n13: \n14: export {};'), {
    text: 'const a = 1;\n\nexport {};',
    firstLine: 12
  });
  assert.deepEqual(work.readText('(empty file)'), { text: '', firstLine: 1 });
});

test('workOf follows the files, commands and tabs of a thread in order', () => {
  const messages = [
    { id: 'u', role: 'user', content: 'Add filters' },
    assistant(
      call('a', 'list_files', { directory: 'src' }, { result: 'src/a.ts\nsrc/b.ts' }),
      call('b', 'read_file', { path: 'src/a.ts' }, { result: '1: old' })
    ),
    assistant(
      call('c', 'write_file', { path: 'src/a.ts', content: 'new' }, { result: 'Successfully wrote' }),
      call('d', 'ask_colleague', { colleague: 'Backend Developer' }, { result: 'ok' }),
      call('e', 'run_command', { command: 'npm test' })
    )
  ];
  const w = work.workOf(messages);
  assert.deepEqual(
    w.steps.map((s) => [s.id, s.kind, s.state]),
    [
      ['a', 'files', 'done'],
      ['b', 'code', 'done'],
      ['c', 'code', 'done'],
      ['e', 'terminal', 'running']
    ]
  );
  assert.equal(w.latest.id, 'e');
  assert.deepEqual(w.tabs, ['code', 'files', 'terminal']);
  assert.deepEqual(
    w.files.map((f) => [f.path, f.text, f.touch, f.step.id]),
    [['src/a.ts', 'new', 'written', 'c']]
  );
  assert.equal(work.commandLine(w.commands[0]), 'npm test');
});

test('a write waiting for approval shows what it proposes; a rejected one leaves the file as read', () => {
  const pending = work.workOf([
    assistant(call('a', 'write_file', { path: 'src\\x.ts', content: 'draft' }))
  ]);
  assert.deepEqual(
    pending.files.map((f) => [f.path, f.text, f.step.state]),
    [['src/x.ts', 'draft', 'running']]
  );
  const rejected = work.workOf([
    assistant(
      call('a', 'read_file', { path: 'x.ts' }, { result: '1: kept' }),
      call('b', 'write_file', { path: 'x.ts', content: 'draft' }, { error: 'Tool execution was rejected by the user.' })
    )
  ]);
  assert.deepEqual(
    rejected.files.map((f) => [f.text, f.touch, f.step.state]),
    [['kept', 'read', 'failed']]
  );
});

test('tool outcomes saved as tool messages reach the calls that asked for them', () => {
  const messages = thread.withOutcomes([
    assistant(call('a', 'run_command', { command: 'npm test' })),
    { id: 't', role: 'tool', toolCallId: 'a', content: 'PASS' }
  ]);
  const w = work.workOf(messages);
  assert.deepEqual([w.latest.state, w.latest.output], ['done', 'PASS']);
});

test('a commit reads as the git commands it runs', () => {
  const [step] = work.workOf([
    assistant(call('a', 'git_commit', { message: 'Add filters', files: ['src/a.ts'] }))
  ]).commands;
  assert.equal(work.commandLine(step), 'git add src/a.ts && git commit -m "Add filters"');
});

test('the browser keeps the last address for steps that do not name one', () => {
  const w = work.workOf([
    assistant(
      call('a', 'mcp_pw_browser_navigate', { url: 'http://localhost:5173' }, { result: 'ok' }),
      call('b', 'mcp_pw_browser_snapshot', {}, { result: 'page' })
    )
  ]);
  assert.equal(work.pageAddress(w.pages, w.pages[1]), 'http://localhost:5173');
  assert.equal(work.toolLabel('mcp_github_create_issue'), 'github · create issue');
  assert.equal(work.toolLabel('run_command'), 'run command');
});

test('fileTree lists folders first and joins single-folder chains', () => {
  const tree = work.fileTree([
    'src/pages/Dashboard.tsx',
    'src/components/TaskList.tsx',
    'src/components/TaskFilters.tsx',
    'prisma/schema/schema.prisma',
    'README.md'
  ]);
  const show = (nodes) => nodes.map((n) => (n.children ? [n.name, show(n.children)] : n.name));
  assert.deepEqual(show(tree), [
    ['prisma/schema', ['schema.prisma']],
    ['src', [['components', ['TaskFilters.tsx', 'TaskList.tsx']], ['pages', ['Dashboard.tsx']]]],
    'README.md'
  ]);
  assert.equal(tree[1].children[0].children[0].path, 'src/components/TaskFilters.tsx');
});

test('code files get their highlighting language', () => {
  assert.equal(work.languageOf('src/a/TaskList.tsx'), 'typescript');
  assert.equal(work.languageOf('schema.prisma'), 'typescript');
  assert.equal(work.languageOf('notes.txt'), undefined);
});

test('a call is read once: the same call gives the same step, a changed call a new one', () => {
  const running = call('a', 'run_command', { command: 'npm test' });
  const message = { id: 'm', role: 'assistant', content: '', createdAt: 5, toolCalls: [running] };
  const first = work.workOf([message]).steps[0];
  assert.equal(work.workOf([message]).steps[0], first);
  const answered = { ...running, result: 'ok' };
  const next = work.workOf([{ ...message, toolCalls: [answered] }]).steps[0];
  assert.notEqual(next, first);
  assert.deepEqual([first.state, next.state, next.at], ['running', 'done', 5]);
});

test('a running command shows its output so far; a write carries what it changed', () => {
  const w = work.workOf([
    assistant(
      call('a', 'write_file', { path: 'a.ts', content: 'x' }, { result: 'ok', change: { added: 3, removed: 1, created: false, hunks: '@@ -1,1 +1,3 @@' } }),
      { id: 'b', name: 'run_command', arguments: '{"command":"npm test"}', progress: 'PASS 1\n' }
    )
  ]);
  assert.equal(w.commands[0].output, 'PASS 1\n');
  assert.equal(w.commands[0].state, 'running');
  assert.equal(w.files[0].written.change.added, 3);
});

test('the surface opens by itself only for live work, and your choice holds for the run', () => {
  const open = (input) => work.surfaceOpen({ hasWork: true, watched: false, run: '2', ...input });
  assert.equal(open({}), false, 'older work waits to be opened');
  assert.equal(open({ watched: true }), true, 'a live run opens it');
  assert.equal(open({ watched: true, choice: { open: false, run: '2' } }), false, 'closed for this run');
  assert.equal(open({ watched: true, choice: { open: false, run: '1' } }), true, 'the next run opens again');
  assert.equal(open({ choice: { open: true, run: '2' } }), true, 'opened by hand');
  assert.equal(work.surfaceOpen({ hasWork: false, watched: true, run: '2' }), false, 'nothing to show');
});

test('runSummary sums each file’s changes, counts proposals, and gathers what was looked at', () => {
  const steps = work.workOf([
    assistant(
      call('a', 'read_file', { path: 'src/a.ts' }, { result: '1: x' }),
      call('b', 'write_file', { path: 'src/a.ts', content: 'y' }, { result: 'ok', change: { added: 4, removed: 1, created: false } }),
      call('c', 'write_file', { path: 'src\\a.ts', content: 'z' }, { result: 'ok', change: { added: 2, removed: 2, created: false } }),
      call('d', 'write_file', { path: 'src/b.ts', content: 'new' }),
      call('e', 'search_code', { query: 'due' }, { result: 'No matches found.' }),
      call('f', 'run_command', { command: 'npm test' }, { error: 'exit 1' })
    )
  ]).steps;
  const summary = work.runSummary(steps, new Map([['d', { added: 7, removed: 0, created: false }]]));
  assert.deepEqual(
    summary.files.map((f) => [f.path, f.added, f.removed, f.known, f.step.id]),
    [
      ['src/a.ts', 6, 3, true, 'c'],
      ['src/b.ts', 7, 0, true, 'd']
    ]
  );
  assert.deepEqual(summary.looked.map((s) => s.id), ['a', 'e']);
  assert.deepEqual(summary.commands.map((s) => [s.id, s.state]), [['f', 'failed']]);
});

test('diffRows reads saved hunks and approval previews alike', () => {
  const rows = work.diffRows('@@ -16,3 +16,4 @@\n line 16\n-line 17\n+line seventeen\n+line 17b\n line 18');
  assert.deepEqual(
    rows.map((r) => [r.kind, r.oldLine ?? null, r.newLine ?? null, r.at]),
    [
      ['hunk', null, null, 16],
      ['keep', 16, 16, 16],
      ['del', 17, null, 17],
      ['add', null, 17, 17],
      ['add', null, 18, 18],
      ['keep', 18, 19, 19]
    ]
  );
  assert.equal(work.firstChange(rows), 17);
  const preview = work.diffRows('--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+c');
  assert.deepEqual(preview.map((r) => r.kind), ['hunk', 'keep', 'del', 'add']);
  assert.deepEqual(work.diffStats('--- a/x\n+++ b/x\n@@ -1,1 +1,2 @@\n-b\n+c\n+d'), { added: 2, removed: 1, created: false });
  assert.deepEqual(work.diffRows('--- a/x\n+++ b/x\n@@ -1,900 +1,950 @@\n[File modified: 900 lines -> 950 lines]').map((r) => r.kind), ['hunk']);
});

test('a thread is cut into runs at your messages; replies that are only work are left to the summary', () => {
  const messages = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'On it', toolCalls: [] },
    { role: 'assistant', content: '', createdAt: 1, toolCalls: [call('x', 'read_file', { path: 'a' }, { result: '1: a' })] },
    { role: 'user', content: 'b' },
    { role: 'assistant', content: 'Done' }
  ];
  assert.deepEqual(
    work.threadRuns(messages).map((run) => [run.end, run.messages.length]),
    [
      [2, 3],
      [4, 2]
    ]
  );
  assert.equal(work.onlyWork(messages[2]), true);
  assert.equal(work.onlyWork(messages[1]), false);
  assert.equal(work.onlyWork({ ...messages[2], streaming: true }), true, 'a finished step still marked as streaming');
  const asking = { role: 'assistant', content: '', createdAt: 1, toolCalls: [call('y', 'ask_colleague', {}, { result: 'ok' })] };
  assert.equal(work.onlyWork(asking), false, 'a colleague’s answer keeps its own card');
  assert.equal(work.isWorkCall(call('z', 'write_file', { path: 'a' }), 1), true);
});

test('a run’s title says what it did, the most telling first', () => {
  const steps = (...calls) => work.workOf([assistant(...calls)]).steps;
  const summary = (s) => work.runSummary(s);
  const write = call('w', 'write_file', { path: 'a.ts', content: 'x' }, { result: 'ok', change: { added: 1, removed: 0, created: true } });
  const run = call('r', 'run_command', { command: 'npm test' }, { result: 'ok' });
  const page = call('p', 'mcp_pw_browser_navigate', { url: 'http://localhost:5173' }, { result: 'ok' });
  const read = call('d', 'read_file', { path: 'a.ts' }, { result: '1: x' });
  assert.equal(work.runTitle(summary(steps(write, run, page)), false), 'Changed 1 file, ran 1 command');
  assert.equal(work.runTitle(summary(steps(run, page)), false), 'Ran 1 command, viewed 1 page');
  assert.equal(work.runTitle(summary(steps(read)), false), 'Read 1 file');
  const search = call('q', 'search_code', { query: 'due' }, { result: 'No matches found.' });
  assert.equal(work.runTitle(summary(steps(read, search)), false), 'Read 1 file, searched once');
  assert.equal(work.runTitle(summary(steps(write, run)), true), 'Working on 1 file…');
  assert.equal(work.runTitle(summary(steps(run)), true), 'Working…');
});

test('a file the run made is known as new, from its saved change or its proposal', () => {
  const saved = work.runSummary(
    work.workOf([assistant(call('w', 'write_file', { path: 'a.ts', content: 'x' }, { result: 'ok', change: { added: 1, removed: 0, created: true } }))]).steps
  );
  assert.equal(saved.files[0].created, true);
  const proposal = work.diffStats('--- a/b.ts\n+++ b/b.ts\n@@ -1,0 +1,2 @@\n+one\n+two');
  assert.deepEqual(proposal, { added: 2, removed: 0, created: true });
  assert.equal(work.diffStats('--- a/b.ts\n+++ b/b.ts\n@@ -1,1 +1,2 @@\n one\n+two').created, false);
});

test('background processes: their tools show in the terminal, and only starting one counts as a command', () => {
  const w = work.workOf([
    assistant(
      call('s', 'start_process', { command: 'npm run dev' }, { result: 'Started', process: { id: 'p1' } }),
      call('r', 'read_process', { id: 'p1' }, { result: 'ok' }),
      call('x', 'stop_process', { id: 'p1' }, { result: 'Stopped p1.' })
    )
  ]);
  assert.deepEqual(w.steps.map((s) => [s.kind, s.processId]), [
    ['terminal', 'p1'],
    ['terminal', 'p1'],
    ['terminal', 'p1']
  ]);
  const summary = work.runSummary(w.steps);
  assert.deepEqual(summary.commands.map((s) => s.name), ['start_process']);
  assert.equal(work.runTitle(summary, false), 'Ran 1 command');
  assert.equal(work.WORK_TABS.some((t) => t.kind === 'preview'), true);
});
