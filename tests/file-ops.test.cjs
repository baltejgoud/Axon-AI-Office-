// Coworkers deleting and moving files: only with your OK, only inside the project, and always undoable.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
/** Electron as the service sees it; a test sets the native dialog's answer. */
const electron = {
  app: { isPackaged: false, relaunch() {}, quit() {} },
  dialog: {},
  utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) }
};
Module._load = function (name, ...args) {
  if (name === 'electron') return electron;
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        resolveJsonModule: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Project } = require('../src/main/project.ts');
const { ToolRegistry } = require('../src/main/tools/registry.ts');
const { PermissionManager } = require('../src/main/security/permissions.ts');
const { Checkpoints } = require('../src/main/audit/checkpoints.ts');
const { toolsFor } = require('../src/main/officeTools.ts');
const { auditSubject, inGroup } = require('../src/shared/audit.ts');
const { activitySentence, runStage } = require('../src/shared/runtimePresentation.ts');
const { toolPresentation } = require('../src/renderer/src/chat/workPresentation.ts');
const work = require('../src/renderer/src/features/office/workspace/work.ts');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');

/* ------------------------------------------------------------------------------------------ */
/* The tools, on a real project folder                                                         */
/* ------------------------------------------------------------------------------------------ */

/** A project folder with a folder beside it that the project must never touch. */
async function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'axon-fileops-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'project');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  const project = new Project();
  await project.choose(root);
  const registry = new ToolRegistry();
  const ctx = { project, allowShell: false };
  const put = (name, text = 'hello\n') => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  const has = (name) => fs.existsSync(path.join(root, name));
  /** Runs a tool the way the service does: validate, preview, then execute. */
  const call = async (name, args) => {
    const tool = registry.get(name);
    return {
      invalid: await tool.validate(args, ctx),
      preview: await tool.preparePreview(args, ctx),
      result: await tool.execute(args, ctx)
    };
  };
  return { dir, root, outside, project, registry, ctx, put, read, has, call };
}

test('delete_file removes a file inside the project and keeps its text for Undo', async (t) => {
  const f = await fixture(t);
  f.put('notes/todo.txt', 'one\ntwo\nthree\n');
  const { invalid, preview, result } = await f.call('delete_file', { path: 'notes/todo.txt' });
  assert.equal(invalid, null);
  assert.equal(preview.type, 'generic');
  assert.equal(preview.path, 'notes/todo.txt');
  const [headline, , ...shown] = preview.content.split('\n');
  assert.equal(headline, 'Delete notes/todo.txt (3 lines, 14 bytes)');
  assert.deepEqual(shown, ['one', 'two', 'three']);
  assert.ok(!result.isError, result.content);
  assert.equal(f.has('notes/todo.txt'), false);
  assert.deepEqual(result.previous, { existed: true, content: 'one\ntwo\nthree\n' });
  assert.deepEqual(result.undoAs, { kind: 'delete', path: 'notes/todo.txt' });
  assert.deepEqual(result.change, { added: 0, removed: 3, created: false });
});

test('the card shows only the first lines of a long file, and says how many it left out', async (t) => {
  const f = await fixture(t);
  f.put('long.txt', Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n'));
  const { preview } = await f.call('delete_file', { path: 'long.txt' });
  const lines = preview.content.split('\n');
  assert.equal(lines[0], 'Delete long.txt (40 lines, 310 bytes)');
  assert.equal(lines[2], 'line 1');
  assert.equal(lines[13], 'line 12');
  assert.equal(lines.at(-1), '… and 28 more lines');
  f.put('empty.txt', '');
  assert.equal((await f.call('delete_file', { path: 'empty.txt' })).preview.content, 'Delete empty.txt (empty, 0 bytes)');
});

test('delete_file refuses, before anyone is asked, anything outside the project, in .git, or not a plain file', async (t) => {
  const f = await fixture(t);
  f.put('.git/config', '[core]\n');
  f.put('sub/a.txt');
  f.put('.env', 'KEY=1\n');
  const refused = [
    ['../outside/secret.txt', /outside the project folder/],
    [path.join(f.outside, 'secret.txt'), /outside the project folder/],
    ['sub/../../outside/secret.txt', /outside the project folder/],
    ['.git/config', /\.git folder/],
    ['sub', /is a folder/],
    ['missing.txt', /doesn't exist/],
    ['.env', /leaves alone/]
  ];
  for (const [file, why] of refused) {
    const { invalid, result } = await f.call('delete_file', { path: file });
    assert.match(String(invalid), why, file);
    assert.equal(result.isError, true, file);
    assert.match(result.content, why, file);
  }
  assert.equal(fs.readFileSync(path.join(f.outside, 'secret.txt'), 'utf8'), 'secret');
  assert.equal(f.read('.git/config'), '[core]\n');
  assert.ok(f.has('sub/a.txt') && f.has('.env'));
  // Not text at all, or not a string.
  for (const bad of [42, ['a.txt'], null, undefined, '', '   ']) {
    assert.ok(await f.registry.get('delete_file').validate({ path: bad }, f.ctx), String(bad));
  }
});

test('.git is refused however it is spelled, including a Windows short name', async (t) => {
  const f = await fixture(t);
  f.put('.git/HEAD', 'ref: refs/heads/main\n');
  for (const spelling of ['.GIT/HEAD', '.Git/HEAD', 'sub/../.git/HEAD', '.git/../.GIT/HEAD']) {
    const { invalid, result } = await f.call('delete_file', { path: spelling });
    assert.equal(typeof invalid, 'string', spelling);
    assert.equal(result.isError, true, spelling);
  }
  // 8.3 names exist on some Windows disks: GIT~1 is the same folder as .git.
  if (fs.existsSync(path.join(f.root, 'GIT~1', 'HEAD'))) {
    const { invalid, result } = await f.call('delete_file', { path: 'GIT~1/HEAD' });
    assert.match(String(invalid), /\.git folder/);
    assert.equal(result.isError, true);
    const moved = await f.call('move_file', { from: 'GIT~1/HEAD', to: 'head.txt' });
    assert.match(String(moved.invalid), /\.git folder/);
  }
  assert.equal(f.read('.git/HEAD'), 'ref: refs/heads/main\n');
});

test('delete_file will not follow a symbolic link or junction out of the project', async (t) => {
  const f = await fixture(t);
  fs.symlinkSync(f.outside, path.join(f.root, 'link'), 'junction');
  for (const file of ['link/secret.txt', 'link']) {
    const { invalid, result } = await f.call('delete_file', { path: file });
    assert.match(String(invalid), /shortcut/, file);
    assert.equal(result.isError, true, file);
  }
  assert.equal(fs.readFileSync(path.join(f.outside, 'secret.txt'), 'utf8'), 'secret', 'the file outside is untouched');
  assert.ok(fs.existsSync(path.join(f.root, 'link')), 'so is the link itself');
});

test('delete_file keeps its promise of Undo: a file Axon cannot keep a copy of is not deleted', async (t) => {
  const f = await fixture(t);
  f.put('big.txt', 'x'.repeat(1_000_001));
  f.put('binary.dat', 'a\0b');
  for (const file of ['big.txt', 'binary.dat']) {
    const { invalid, result } = await f.call('delete_file', { path: file });
    assert.match(String(invalid), /not deleted/i, file);
    assert.equal(result.isError, true, file);
    assert.ok(f.has(file), file);
  }
});

test('move_file renames a file, or moves it to a new folder it makes', async (t) => {
  const f = await fixture(t);
  f.put('a.txt', 'alpha');
  const renamed = await f.call('move_file', { from: 'a.txt', to: 'b.txt' });
  assert.equal(renamed.invalid, null);
  assert.equal(renamed.preview.type, 'generic');
  assert.equal(renamed.preview.content, 'Rename a.txt → b.txt');
  assert.equal(renamed.preview.path, 'a.txt → b.txt');
  assert.ok(!renamed.result.isError, renamed.result.content);
  assert.equal(f.has('a.txt'), false);
  assert.equal(f.read('b.txt'), 'alpha');
  assert.deepEqual(renamed.result.undoAs, { kind: 'move', path: 'a.txt', movedTo: 'b.txt' });
  assert.deepEqual(renamed.result.previous, { existed: true, content: null });

  const moved = await f.call('move_file', { from: 'b.txt', to: 'deep/er/b.txt' });
  assert.equal(moved.preview.content, 'Move b.txt → deep/er/b.txt\n\nMakes the folder deep/er/ first.');
  assert.ok(!moved.result.isError, moved.result.content);
  assert.equal(f.read('deep/er/b.txt'), 'alpha');
  assert.equal(f.has('b.txt'), false);
});

test('move_file never replaces a file that is already there', async (t) => {
  const f = await fixture(t);
  f.put('a.txt', 'mine');
  f.put('b.txt', 'theirs');
  const { invalid, result } = await f.call('move_file', { from: 'a.txt', to: 'b.txt' });
  assert.match(String(invalid), /already exists/);
  assert.equal(result.isError, true);
  assert.equal(f.read('a.txt'), 'mine');
  assert.equal(f.read('b.txt'), 'theirs');
  // The project itself holds the line too, if a caller skipped the tool's own check.
  await assert.rejects(f.project.move('a.txt', 'b.txt'), /already at/);
  assert.equal(f.read('b.txt'), 'theirs');
  // Onto itself, or onto a folder.
  f.put('dir/x.txt');
  for (const to of ['a.txt', 'dir']) {
    const same = await f.call('move_file', { from: 'a.txt', to });
    assert.equal(typeof same.invalid, 'string', to);
    assert.equal(same.result.isError, true, to);
  }
  assert.equal(f.read('a.txt'), 'mine');
});

test('move_file refuses places outside the project, .git, links, folders and files it leaves alone', async (t) => {
  const f = await fixture(t);
  f.put('a.txt', 'alpha');
  f.put('.git/config', 'cfg');
  f.put('dir/x.txt');
  fs.symlinkSync(f.outside, path.join(f.root, 'link'), 'junction');
  const cases = [
    [{ from: 'a.txt', to: '../outside/a.txt' }, /outside the project folder/],
    [{ from: 'a.txt', to: path.join(f.outside, 'a.txt') }, /outside the project folder/],
    [{ from: '../outside/secret.txt', to: 'in.txt' }, /outside the project folder/],
    [{ from: 'a.txt', to: '.git/hooks/pre-commit' }, /\.git folder/],
    [{ from: 'a.txt', to: '.GIT/a.txt' }, /\.git folder/],
    [{ from: '.git/config', to: 'cfg.txt' }, /\.git folder/],
    [{ from: 'a.txt', to: 'link/a.txt' }, /shortcut/],
    [{ from: 'link/secret.txt', to: 'in.txt' }, /shortcut/],
    [{ from: 'dir', to: 'dir2' }, /is a folder/],
    [{ from: 'nothing.txt', to: 'x.txt' }, /doesn't exist/],
    [{ from: 'a.txt', to: '.env' }, /leaves alone/],
    [{ from: 'a.txt', to: 'server.pem' }, /leaves alone/]
  ];
  for (const [args, why] of cases) {
    const { invalid, result } = await f.call('move_file', args);
    assert.match(String(invalid), why, JSON.stringify(args));
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  assert.equal(f.read('a.txt'), 'alpha');
  assert.equal(f.read('.git/config'), 'cfg');
  assert.equal(fs.readdirSync(f.outside).join(), 'secret.txt', 'nothing reached the folder outside');
  assert.equal(f.has('.env'), false);
  for (const bad of [{ from: 'a.txt' }, { from: 'a.txt', to: 7 }, { from: ['a.txt'], to: 'b.txt' }]) {
    assert.ok(await f.registry.get('move_file').validate(bad, f.ctx), JSON.stringify(bad));
  }
});

test('a letter-case rename (Readme.md to README.md) is allowed, a different file under that name is not', async (t) => {
  const f = await fixture(t);
  f.put('Readme.md', 'docs');
  const { invalid, result } = await f.call('move_file', { from: 'Readme.md', to: 'README.md' });
  assert.equal(invalid, null);
  assert.ok(!result.isError, result.content);
  assert.deepEqual(fs.readdirSync(f.root), ['README.md']);
  assert.equal(f.read('README.md'), 'docs');
  f.put('Other.md', 'other');
  const clash = await f.call('move_file', { from: 'Other.md', to: 'README.md' });
  assert.match(String(clash.invalid), /already exists/);
  assert.equal(f.read('Other.md'), 'other');
});

test('both tools say so when there is no project folder', async (t) => {
  const registry = new ToolRegistry();
  const ctx = { project: new Project(), allowShell: false };
  assert.match(String(await registry.get('delete_file').validate({ path: 'a.txt' }, ctx)), /No project folder/);
  assert.match(String(await registry.get('move_file').validate({ from: 'a', to: 'b' }, ctx)), /No project folder/);
  assert.equal((await registry.get('delete_file').execute({ path: 'a.txt' }, ctx)).isError, true);
});

test('write_file points a coworker who wants to remove a file to delete_file and move_file', () => {
  const registry = new ToolRegistry();
  const description = registry.get('write_file').definition.description;
  assert.match(description, /delete_file/);
  assert.match(description, /move_file/);
});

/* ------------------------------------------------------------------------------------------ */
/* Who may offer them, and what is asked                                                       */
/* ------------------------------------------------------------------------------------------ */

test('they are offered to runs with a folder, never to leads', () => {
  const registry = new ToolRegistry().getDefinitions();
  const names = (input) => toolsFor({ registry, ...input }).map((tool) => tool.name);
  for (const agentId of [undefined, 'frontend-developer', 'backend-developer']) {
    assert.ok(names({ agentId, hasFolder: true }).includes('delete_file'), String(agentId));
    assert.ok(names({ agentId, hasFolder: true }).includes('move_file'), String(agentId));
    assert.ok(!names({ agentId, hasFolder: false }).includes('delete_file'), `${agentId} without a folder`);
    assert.ok(!names({ agentId, hasFolder: false }).includes('move_file'), `${agentId} without a folder`);
  }
  for (const lead of ['chief-of-staff', 'ops-coordinator']) {
    assert.ok(!names({ agentId: lead, hasFolder: true }).includes('delete_file'), lead);
    assert.ok(!names({ agentId: lead, hasFolder: true }).includes('move_file'), lead);
  }
});

test('deleting and moving always ask, even when a default says otherwise', () => {
  const m = new PermissionManager(['/proj'], true, { delete_file: 'allow', move_file: 'allow', read_file: 'allow' });
  assert.equal(m.check({ toolName: 'delete_file', args: { path: 'a.txt' } }).action, 'ask');
  assert.equal(m.check({ toolName: 'move_file', args: { from: 'a.txt', to: 'b.txt' } }).action, 'ask');
  const plain = new PermissionManager(['/proj'], true);
  assert.equal(plain.check({ toolName: 'delete_file', args: { path: 'a.txt' } }).action, 'ask');
  assert.equal(plain.check({ toolName: 'read_file', args: { path: 'a.txt' } }).action, 'allow', 'reading still does not');
});

test('every path they name must be inside the run’s folders', () => {
  const m = new PermissionManager(['/proj'], true);
  const check = (toolName, args, scope) => m.check({ toolName, args }, scope).action;
  assert.equal(check('delete_file', { path: '../other/a.txt' }), 'deny');
  assert.equal(check('delete_file', { path: '/elsewhere/a.txt' }), 'deny');
  assert.equal(check('delete_file', { path: 'src/a.txt' }), 'ask');
  assert.equal(check('delete_file', { path: '/proj/src/a.txt' }), 'ask');
  assert.equal(check('move_file', { from: 'a.txt', to: '../b.txt' }), 'deny', 'the destination too');
  assert.equal(check('move_file', { from: '../a.txt', to: 'b.txt' }), 'deny', 'and the source');
  assert.equal(check('move_file', { from: 'a.txt', to: 'sub/b.txt' }), 'ask');
  // The run's own folders decide, not the manager's defaults; with none, there is nothing to work in.
  assert.equal(check('delete_file', { path: 'a.txt' }, { roots: ['/other'], allowShell: false }), 'ask');
  assert.equal(check('delete_file', { path: '/proj/a.txt' }, { roots: ['/other'], allowShell: false }), 'deny');
  assert.equal(check('delete_file', { path: 'a.txt' }, { roots: [], allowShell: false }), 'deny');
  assert.equal(check('move_file', { from: 'a', to: 'b' }, { roots: [], allowShell: false }), 'deny');
  assert.match(m.check({ toolName: 'delete_file', args: { path: '../x' } }).reason, /outside allowed workspace roots/);
});

/** Approves a request for a tool call, the way the window does. */
function approve(manager, toolName, args, how, conversationId = 'c1') {
  const { request, outcome } = manager.createApprovalRequest({ conversationId, messageId: 'm', toolCallId: 't', toolName, args });
  manager.resolveApproval({ requestId: request.id, approved: true, ...how });
  return outcome;
}

test('"Always allow" covers only the exact file or move, never every file', async () => {
  const m = new PermissionManager(['/proj'], true);
  assert.equal(await approve(m, 'delete_file', { path: 'a.txt' }, { alwaysAllowSession: true }), 'approved-session');
  const del = (file) => m.check({ toolName: 'delete_file', args: { path: file } });
  assert.deepEqual(del('a.txt'), { action: 'allow', bySession: true });
  assert.equal(del('b.txt').action, 'ask', 'another file asks');
  assert.equal(del('./a.txt').action, 'ask', 'even the same file spelled another way');
  assert.equal(m.check({ toolName: 'move_file', args: { from: 'a.txt', to: 'b.txt' } }).action, 'ask', 'a move asks');
  await approve(m, 'move_file', { from: 'a.txt', to: 'b.txt' }, { alwaysAllowSession: true });
  assert.equal(m.check({ toolName: 'move_file', args: { from: 'a.txt', to: 'b.txt' } }).bySession, true);
  assert.equal(m.check({ toolName: 'move_file', args: { from: 'a.txt', to: 'c.txt' } }).action, 'ask');
  assert.equal(m.check({ toolName: 'move_file', args: { from: 'b.txt', to: 'b2.txt' } }).action, 'ask');
});

test('letting files be saved never lets them be deleted or moved', async () => {
  const m = new PermissionManager(['/proj'], true);
  await approve(m, 'write_file', { path: 'a.txt', content: 'x' }, { alwaysAllowSession: true });
  assert.equal(m.check({ toolName: 'write_file', args: { path: 'b.txt', content: 'y' } }).action, 'allow');
  assert.equal(m.check({ toolName: 'delete_file', args: { path: 'a.txt' } }).action, 'ask');
  assert.equal(m.check({ toolName: 'move_file', args: { from: 'a.txt', to: 'b.txt' } }).action, 'ask');
});

test('"Allow for this task" covers the exact call in that conversation until its run ends', async () => {
  const m = new PermissionManager(['/proj'], true);
  assert.equal(await approve(m, 'delete_file', { path: 'a.txt' }, { allowForTask: true }), 'approved-task');
  const del = (file, conversationId = 'c1') => m.check({ toolName: 'delete_file', args: { path: file }, conversationId });
  assert.deepEqual(del('a.txt'), { action: 'allow', byTask: true });
  assert.equal(del('b.txt').action, 'ask');
  assert.equal(del('a.txt', 'c2').action, 'ask');
  assert.equal(m.check({ toolName: 'delete_file', args: { path: 'a.txt' } }).action, 'ask', 'the app as a whole');
  m.endTask('c1');
  assert.equal(del('a.txt').action, 'ask');
});

test('a grant never reaches outside the run’s folders', async () => {
  const m = new PermissionManager(['/proj'], true);
  await approve(m, 'delete_file', { path: '../x.txt' }, { alwaysAllowSession: true });
  await approve(m, 'delete_file', { path: '../y.txt' }, { allowForTask: true });
  assert.equal(m.check({ toolName: 'delete_file', args: { path: '../x.txt' } }).action, 'deny');
  assert.equal(m.check({ toolName: 'delete_file', args: { path: '../y.txt' }, conversationId: 'c1' }).action, 'deny');
  // A grant from one run does not carry into a run with other folders.
  await approve(m, 'delete_file', { path: 'a.txt' }, { alwaysAllowSession: true });
  assert.equal(m.check({ toolName: 'delete_file', args: { path: '/proj/a.txt' } }, { roots: ['/other'], allowShell: false }).action, 'deny');
});

/* ------------------------------------------------------------------------------------------ */
/* Undo's memory                                                                               */
/* ------------------------------------------------------------------------------------------ */

test('what a delete or a move needs for Undo is kept with the change, and unknown kinds are not trusted', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-fileops-ckpt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Checkpoints(dir);
  const base = { conversationId: 'c', root: '/p', path: 'a.txt', existed: true, afterHash: 'h' };
  assert.equal(await store.save({ ...base, toolCallId: 'd', before: 'text', kind: 'delete' }), true);
  assert.equal(await store.save({ ...base, toolCallId: 'm', kind: 'move', movedTo: 'b/a.txt' }), true);
  assert.equal(await store.save({ ...base, toolCallId: 'w', before: 'old' }), true);
  assert.deepEqual(
    [(await store.get('d')).kind, (await store.get('d')).before],
    ['delete', 'text']
  );
  assert.deepEqual([(await store.get('m')).kind, (await store.get('m')).movedTo], ['move', 'b/a.txt']);
  assert.equal((await store.get('w')).kind, undefined, 'a plain save has none');
  await store.save({ ...base, toolCallId: 'x', kind: 'wipe' });
  assert.equal(await store.get('x'), null, 'a kind Axon does not know');
  await store.save({ ...base, toolCallId: 'y', kind: 'move' });
  assert.equal(await store.get('y'), null, 'a move with nowhere to go back to');
});

/* ------------------------------------------------------------------------------------------ */
/* Words                                                                                       */
/* ------------------------------------------------------------------------------------------ */

test('the activity log, the work panel and the status line name them', () => {
  assert.equal(auditSubject('delete_file', { path: 'src/old.ts' }), 'src/old.ts');
  assert.equal(auditSubject('move_file', { from: 'a.ts', to: 'lib/a.ts' }), 'a.ts → lib/a.ts');
  const entry = (tool, extra = {}) => ({ id: '1', at: 1, actor: { kind: 'coworker', name: 'X' }, tool, subject: 's', decision: 'approved', ...extra });
  assert.equal(inGroup(entry('delete_file', { result: 'ok' }), 'changes'), true);
  assert.equal(inGroup(entry('move_file', { result: 'ok' }), 'changes'), true);
  assert.equal(inGroup(entry('move_file', { result: 'error' }), 'changes'), false);
  assert.equal(inGroup(entry('read_file', { result: 'ok' }), 'changes'), false);
  assert.equal(activitySentence(entry('delete_file', { subject: 'old.ts', result: 'ok' })), 'Deleted old.ts');
  assert.equal(activitySentence(entry('move_file', { subject: 'a.ts → b.ts', result: 'ok' })), 'Moved a.ts → b.ts');
  assert.equal(runStage({ status: 'working', activeTool: 'delete_file' }), 'Deleting a file');
  assert.equal(runStage({ status: 'working', activeTool: 'move_file' }), 'Moving a file');
  const shown = (name, args) => toolPresentation({ id: '1', name, arguments: JSON.stringify(args) });
  assert.deepEqual(shown('delete_file', { path: 'old.ts' }), { label: 'Delete file', target: 'old.ts', status: 'running' });
  assert.deepEqual(shown('move_file', { from: 'a.ts', to: 'b.ts' }), { label: 'Move file', target: 'a.ts → b.ts', status: 'running' });
});

test('the work summary lists a deleted or moved file as a change of its own', () => {
  const call = (id, name, args, outcome = {}) => ({ id, name, arguments: JSON.stringify(args), ...outcome });
  const steps = work.workOf([
    {
      id: 'm1',
      role: 'assistant',
      content: '',
      toolCalls: [
        call('d', 'delete_file', { path: 'old.ts' }, { result: 'Deleted old.ts (4 lines).', change: { added: 0, removed: 4, created: false, undo: 'kept' } }),
        call('m', 'move_file', { from: 'a.ts', to: 'lib/a.ts' }, { result: 'Moved a.ts to lib/a.ts.', change: { added: 0, removed: 0, created: false, undo: 'kept' } }),
        call('t', 'mcp_postgres_query', { sql: 'select 1' }, { result: 'ok' })
      ]
    }
  ]).steps;
  const summary = work.runSummary(steps);
  assert.deepEqual(summary.fileOps.map((s) => s.id), ['d', 'm']);
  assert.deepEqual(summary.tools.map((s) => s.id), ['t'], 'not counted among the other tools');
  assert.equal(work.stepPath(steps[1]), 'a.ts', 'a move is about the file where it was');
  assert.equal(work.runTitle(summary, false), 'Deleted 1 file, moved 1 file');
  assert.equal(work.runTitle(summary, true), 'Working on 2 files…');
  const onlyDelete = work.runSummary(steps.slice(0, 1));
  assert.equal(work.runTitle(onlyDelete, false), 'Deleted 1 file');
});

/* ------------------------------------------------------------------------------------------ */
/* The whole way through the service: ask, do, show, undo                                      */
/* ------------------------------------------------------------------------------------------ */

const makeService = (emit = () => {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-fileops-svc-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, emit, 'parser-worker-path');
  repo.state.providers.push({
    id: 'p1',
    name: 'MockProvider',
    kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true,
    createdAt: 0,
    hasApiKey: false
  });
  return { dir, repo, service };
};
const mockModel = (t, respond) => {
  const providersModule = require('../src/main/providers.ts');
  const saved = providersModule.streamChat;
  t.after(() => {
    providersModule.streamChat = saved;
  });
  providersModule.streamChat = respond;
};
const answerDialog = (t, response) => {
  const seen = { asked: null, count: 0 };
  electron.dialog.showMessageBox = async (options) => {
    seen.asked = options;
    seen.count++;
    return { response };
  };
  t.after(() => {
    delete electron.dialog.showMessageBox;
  });
  return seen;
};
const call =(id, name, args) => ({ id, name, arguments: JSON.stringify(args) });

/** A conversation in a project folder whose model makes the given rounds of tool calls, one round per reply. */
async function session(t, rounds) {
  const events = [];
  const made = makeService((event) => events.push(event));
  t.after(() => fs.rmSync(made.dir, { recursive: true, force: true }));
  const folder = path.join(made.dir, 'project');
  fs.mkdirSync(folder);
  await made.service.project.choose(folder);
  const chat = await made.service.chatCreate('p1', 'm1', null, undefined, undefined, folder);
  let round = 0;
  mockModel(t, async () => ({ toolCalls: rounds[round++] ?? [] }));
  const put = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    fs.writeFileSync(path.join(folder, name), text);
  };
  const toolCall = (id) => made.repo.state.messages.flatMap((m) => m.toolCalls ?? []).find((c) => c.id === id);
  const toolAnswer = (id) => made.repo.state.messages.find((m) => m.role === 'tool' && m.toolCallId === id);
  const requests = () => events.filter((e) => e.approvalRequired).map((e) => e.approvalRequired);
  /** Starts the run and answers each approval it asks for with `decide`, in turn. */
  const run = async (decide = { approved: true }) => {
    let finished = false;
    const going = made.service.chatSend(chat.id, 'Tidy up', []).finally(() => {
      finished = true;
    });
    going.catch(() => {});
    let answered = 0;
    for (let waited = 0; !finished; waited++) {
      const next = requests()[answered];
      if (next) {
        answered++;
        await made.service.toolApprove({ requestId: next.id, ...(typeof decide === 'function' ? decide(next) : decide) });
      } else {
        if (waited > 6000) throw new Error('The run did not finish');
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    await going;
  };
  return { ...made, folder, chat, put, toolCall, toolAnswer, requests, run, path: (name) => path.join(folder, name) };
}

test('a coworker deletes a file with your OK; the card shows what goes; Undo brings it back', async (t) => {
  const s = await session(t, [[call('d1', 'delete_file', { path: 'scratch.txt' })]]);
  s.put('scratch.txt', 'draft one\ndraft two\n');
  await s.run();
  const [request] = s.requests();
  assert.equal(request.toolName, 'delete_file');
  assert.equal(request.preview.type, 'generic');
  assert.match(request.preview.content, /^Delete scratch\.txt \(2 lines, 20 bytes\)\n\ndraft one\ndraft two$/);
  assert.equal(fs.existsSync(s.path('scratch.txt')), false);
  const done = s.toolCall('d1');
  assert.equal(done.change.undo, 'kept');
  assert.equal(done.change.removed, 2);
  const kept = await s.service.checkpoints.get('d1');
  assert.deepEqual([kept.kind, kept.path, kept.before], ['delete', 'scratch.txt', 'draft one\ndraft two\n']);
  const entry = s.service.audit.all().find((e) => e.tool === 'delete_file');
  assert.deepEqual([entry.subject, entry.decision, entry.result], ['scratch.txt', 'approved', 'ok']);

  const dialog = answerDialog(t, 1);
  await s.service.revertChange('d1');
  assert.match(dialog.asked.message, /Undo .*deletion of scratch\.txt/);
  assert.equal(dialog.asked.defaultId, 0, 'Cancel is the default');
  assert.equal(dialog.asked.buttons[0], 'Cancel');
  assert.equal(fs.readFileSync(s.path('scratch.txt'), 'utf8'), 'draft one\ndraft two\n');
  assert.equal(typeof s.toolCall('d1').change.revertedAt, 'number');
  const undone = s.service.audit.all().at(-1);
  assert.deepEqual([undone.tool, undone.decision, undone.subject], ['delete_file', 'reverted', 'scratch.txt']);
  assert.equal(await s.service.checkpoints.get('d1'), null);
  await assert.rejects(s.service.revertChange('d1'), /can't be undone any more/);
});

test('delete and move leave the file alone when the Undo record cannot be saved', async (t) => {
  for (const name of ['delete_file', 'move_file']) {
    const args = name === 'delete_file' ? { path: 'scratch.txt' } : { from: 'scratch.txt', to: 'moved.txt' };
    const s = await session(t, [[call(`blocked-${name}`, name, args)]]);
    s.put('scratch.txt', 'keep this\n');
    s.service.checkpoints.save = async () => false;
    await s.run();
    assert.equal(fs.readFileSync(s.path('scratch.txt'), 'utf8'), 'keep this\n');
    assert.equal(fs.existsSync(s.path('moved.txt')), false);
    assert.match(s.toolAnswer(`blocked-${name}`).content, /Could not keep an Undo record/);
  }
});

test('the Undo record exists before a file operation mutates the project', async (t) => {
  const s = await session(t, [[call('durable-delete', 'delete_file', { path: 'scratch.txt' })]]);
  s.put('scratch.txt', 'kept before delete\n');
  const originalRemove = require('../src/main/project.ts').Project.prototype.remove;
  const project = require('../src/main/project.ts').Project;
  project.prototype.remove = async function (name) {
    const point = await s.service.checkpoints.get('durable-delete');
    assert.equal(point.before, 'kept before delete\n');
    return originalRemove.call(this, name);
  };
  t.after(() => { project.prototype.remove = originalRemove; });
  await s.run();
  assert.equal(fs.existsSync(s.path('scratch.txt')), false);
});

test('rejecting a deletion leaves the file alone, and Cancel on Undo changes nothing', async (t) => {
  const s = await session(t, [[call('d1', 'delete_file', { path: 'keep.txt' })], [call('d2', 'delete_file', { path: 'gone.txt' })]]);
  s.put('keep.txt', 'keep me');
  s.put('gone.txt', 'bye');
  await s.run((request) => ({ approved: request.toolCallId === 'd2' }));
  assert.equal(fs.readFileSync(s.path('keep.txt'), 'utf8'), 'keep me');
  assert.equal(s.toolAnswer('d1').error, 'Tool execution was rejected by the user.');
  assert.equal(fs.existsSync(s.path('gone.txt')), false, 'the one you approved went');
  assert.equal(s.service.audit.all().filter((e) => e.tool === 'delete_file' && e.decision === 'rejected').length, 1);
  assert.equal(await s.service.checkpoints.get('d1'), null, 'a rejected call keeps nothing');
});

test('Cancel on the Undo question changes nothing', async (t) => {
  const s = await session(t, [[call('d1', 'delete_file', { path: 'a.txt' })]]);
  s.put('a.txt', 'text');
  await s.run();
  answerDialog(t, 0);
  await assert.rejects(s.service.revertChange('d1'), /cancelled/);
  assert.equal(fs.existsSync(s.path('a.txt')), false);
  assert.ok(await s.service.checkpoints.get('d1'), 'still undoable');
});

test('a call that cannot work goes back to the model, and nobody is asked', async (t) => {
  const s = await session(t, [
    [
      call('f', 'delete_file', { path: 'folder' }),
      call('o', 'delete_file', { path: '../outside.txt' }),
      call('g', 'delete_file', { path: '.git/config' }),
      call('n', 'move_file', { from: 'nothing.txt', to: 'x.txt' }),
      call('m', 'move_file', { from: 'a.txt', to: '../a.txt' })
    ]
  ]);
  s.put('folder/inside.txt', 'x');
  s.put('a.txt', 'a');
  s.put('.git/config', 'cfg');
  fs.writeFileSync(path.join(path.dirname(s.folder), 'outside.txt'), 'outside');
  await s.run();
  assert.deepEqual(s.requests(), [], 'no approval card for any of them');
  assert.match(s.toolAnswer('f').content, /is a folder/);
  assert.match(s.toolAnswer('o').content, /outside allowed workspace roots/);
  assert.match(s.toolAnswer('g').content, /\.git folder/);
  assert.match(s.toolAnswer('n').content, /doesn't exist/);
  assert.match(s.toolAnswer('m').content, /outside allowed workspace roots/);
  const decisions = Object.fromEntries(s.service.audit.all().filter((e) => /_file$/.test(e.tool)).map((e) => [e.toolCallId, e.decision]));
  assert.deepEqual(decisions, { f: 'skipped', o: 'denied', g: 'skipped', n: 'skipped', m: 'denied' });
  assert.equal(fs.readFileSync(path.join(path.dirname(s.folder), 'outside.txt'), 'utf8'), 'outside');
  assert.equal(fs.readFileSync(s.path('a.txt'), 'utf8'), 'a');
});

test('a move is shown, done with your OK, and Undo moves it back (never over something else)', async (t) => {
  const s = await session(t, [
    [call('m1', 'move_file', { from: 'draft.txt', to: 'docs/final.txt' })],
    [call('m2', 'move_file', { from: 'x.txt', to: 'y.txt' })]
  ]);
  s.put('draft.txt', 'the text');
  s.put('x.txt', 'ex');
  await s.run();
  assert.equal(s.requests()[0].preview.content, 'Move draft.txt → docs/final.txt\n\nMakes the folder docs/ first.');
  assert.equal(s.requests()[1].preview.content, 'Rename x.txt → y.txt');
  assert.equal(fs.readFileSync(s.path('docs/final.txt'), 'utf8'), 'the text');
  assert.equal(s.toolCall('m1').change.undo, 'kept');
  const kept = await s.service.checkpoints.get('m1');
  assert.deepEqual([kept.kind, kept.path, kept.movedTo], ['move', 'draft.txt', 'docs/final.txt']);
  assert.equal(s.service.audit.all().find((e) => e.tool === 'move_file').subject, 'draft.txt → docs/final.txt');

  const dialog = answerDialog(t, 1);
  await s.service.revertChange('m1');
  assert.match(dialog.asked.message, /Undo .*move of draft\.txt/);
  assert.equal(fs.readFileSync(s.path('draft.txt'), 'utf8'), 'the text');
  assert.equal(fs.existsSync(s.path('docs/final.txt')), false);
  assert.equal(s.service.audit.all().at(-1).decision, 'reverted');

  // Something else has taken the old name: Undo refuses, asks nothing, and the file stays where it is.
  fs.writeFileSync(s.path('x.txt'), 'someone else');
  dialog.count = 0;
  await assert.rejects(s.service.revertChange('m2'), /Something else is at x\.txt now/);
  assert.equal(dialog.count, 0);
  assert.equal(fs.readFileSync(s.path('y.txt'), 'utf8'), 'ex');
  assert.equal(fs.readFileSync(s.path('x.txt'), 'utf8'), 'someone else');
  fs.rmSync(s.path('y.txt'));
  await assert.rejects(s.service.revertChange('m2'), /isn't there any more/);
});

test('Undo all takes a task’s saves, deletions and moves back, newest first, in one confirmation', async (t) => {
  const s = await session(t, [
    [
      call('w1', 'write_file', { path: 'new.txt', content: 'brand new' }),
      call('e1', 'edit_file', { path: 'keep.txt', old_string: 'one', new_string: 'ONE' })
    ],
    [call('m1', 'move_file', { from: 'new.txt', to: 'sub/renamed.txt' }), call('d1', 'delete_file', { path: 'old.txt' })],
    [call('w2', 'write_file', { path: 'old.txt', content: 'recreated' })]
  ]);
  s.put('keep.txt', 'one two');
  s.put('old.txt', 'the original');
  await s.run({ approved: true, allowForTask: true });
  assert.equal(fs.existsSync(s.path('new.txt')), false);
  assert.equal(fs.readFileSync(s.path('sub/renamed.txt'), 'utf8'), 'brand new');
  assert.equal(fs.readFileSync(s.path('keep.txt'), 'utf8'), 'ONE two');
  assert.equal(fs.readFileSync(s.path('old.txt'), 'utf8'), 'recreated', 'deleted, then written again');

  const dialog = answerDialog(t, 0);
  await assert.rejects(s.service.revertChanges(['w1', 'e1', 'm1', 'd1', 'w2']), /cancelled/);
  assert.equal(fs.readFileSync(s.path('keep.txt'), 'utf8'), 'ONE two', 'Cancel changes nothing');
  assert.match(dialog.asked.message, /Undo all/);
  assert.equal(dialog.asked.defaultId, 0);
  assert.match(dialog.asked.detail, /5 changes are taken back, newest first/);

  answerDialog(t, 1);
  assert.deepEqual(await s.service.revertChanges(['w1', 'e1', 'm1', 'd1', 'w2']), { undone: 5, skipped: 0 });
  assert.equal(fs.readFileSync(s.path('old.txt'), 'utf8'), 'the original', 'the file as it was before the task');
  assert.equal(fs.readFileSync(s.path('keep.txt'), 'utf8'), 'one two');
  assert.equal(fs.existsSync(s.path('new.txt')), false, 'a file the task made is gone');
  assert.equal(fs.existsSync(s.path('sub/renamed.txt')), false);
  for (const id of ['w1', 'e1', 'm1', 'd1', 'w2']) {
    assert.equal(typeof s.toolCall(id).change.revertedAt, 'number', id);
    assert.equal(await s.service.checkpoints.get(id), null, id);
  }
  assert.equal(s.service.audit.all().filter((e) => e.decision === 'reverted').length, 5);
});

test('Undo all leaves a change it cannot reverse, says so, and still does the rest', async (t) => {
  const s = await session(t, [[call('m1', 'move_file', { from: 'a.txt', to: 'b.txt' }), call('d1', 'delete_file', { path: 'c.txt' })]]);
  s.put('a.txt', 'a');
  s.put('c.txt', 'c');
  await s.run({ approved: true, allowForTask: false });
  // Another file takes a.txt's place, so b.txt cannot go back; c.txt can.
  fs.writeFileSync(s.path('a.txt'), 'someone else');
  answerDialog(t, 1);
  assert.deepEqual(await s.service.revertChanges(['m1', 'd1']), { undone: 1, skipped: 1 });
  assert.equal(fs.readFileSync(s.path('c.txt'), 'utf8'), 'c');
  assert.equal(fs.readFileSync(s.path('b.txt'), 'utf8'), 'a');
  assert.equal(fs.readFileSync(s.path('a.txt'), 'utf8'), 'someone else');
  assert.ok(await s.service.checkpoints.get('m1'), 'the move stays undoable once a.txt is free');
});

test('"Allow for this task" on a deletion covers that file only', async (t) => {
  const s = await session(t, [
    [call('d1', 'delete_file', { path: 'a.txt' })],
    [call('w1', 'write_file', { path: 'a.txt', content: 'again' })],
    [call('d2', 'delete_file', { path: 'a.txt' })],
    [call('d3', 'delete_file', { path: 'b.txt' })]
  ]);
  s.put('a.txt', 'a');
  s.put('b.txt', 'b');
  const asked = [];
  await s.run((request) => {
    asked.push(request.toolCallId);
    return { approved: true, allowForTask: true };
  });
  // d2 is the same file as d1, so it was not asked again; b.txt is another file, so it was.
  assert.deepEqual(asked, ['d1', 'w1', 'd3']);
  assert.equal(fs.existsSync(s.path('a.txt')), false);
  assert.equal(fs.existsSync(s.path('b.txt')), false);
  const second = s.service.audit.all().find((e) => e.toolCallId === 'd2');
  assert.deepEqual([second.decision, second.detail], ['allowed', 'Allowed for this task']);
});
