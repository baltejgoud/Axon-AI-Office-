const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
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
const { Project } = require('../src/main/project.ts');
const { ToolRegistry, shellNote, missingArguments } = require('../src/main/tools/registry.ts');
const { PermissionManager } = require('../src/main/security/permissions.ts');

/** A project folder with these files in it, removed after the test. */
async function projectWith(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-agent-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  const project = new Project();
  await project.choose(dir);
  return { dir, project, ctx: { project, allowShell: false } };
}

const lines = (n, prefix = 'line') =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';

test('edit_file changes only the text it names and keeps the rest of the file', async (t) => {
  const { dir, ctx } = await projectWith(t, { 'a.ts': 'const a = 1;\nconst b = 2;\n// keep me\n' });
  const edit = new ToolRegistry().get('edit_file');
  assert.ok(edit, 'edit_file is registered');
  const result = await edit.execute(
    { path: 'a.ts', old_string: 'const b = 2;', new_string: 'const b = 3;' },
    ctx
  );
  assert.ok(!result.isError, result.content);
  assert.equal(fs.readFileSync(path.join(dir, 'a.ts'), 'utf8'), 'const a = 1;\nconst b = 3;\n// keep me\n');
  assert.deepEqual([result.change.added, result.change.removed, result.change.created], [1, 1, false]);
  assert.deepEqual(result.previous, { existed: true, content: 'const a = 1;\nconst b = 2;\n// keep me\n' });
  assert.equal(result.written, 'const a = 1;\nconst b = 3;\n// keep me\n');
});

test('edit_file that cannot apply is refused before anyone is asked, with the reason', async (t) => {
  const { ctx } = await projectWith(t, { 'a.ts': 'x\nx\n' });
  const edit = new ToolRegistry().get('edit_file');
  assert.match(await edit.validate({ path: 'a.ts', old_string: 'nope', new_string: 'y' }, ctx), /not found/);
  assert.match(await edit.validate({ path: 'a.ts', old_string: 'x', new_string: 'y' }, ctx), /2 times/);
  assert.match(
    await edit.validate({ path: 'missing.ts', old_string: 'x', new_string: 'y' }, ctx),
    /write_file/
  );
  assert.equal(
    await edit.validate({ path: 'a.ts', old_string: 'x', new_string: 'y', replace_all: true }, ctx),
    null
  );
});

test('edit_file previews its change as a diff', async (t) => {
  const { ctx } = await projectWith(t, { 'a.ts': 'one\ntwo\n' });
  const preview = await new ToolRegistry()
    .get('edit_file')
    .preparePreview({ path: 'a.ts', old_string: 'two', new_string: 'TWO' }, ctx);
  assert.equal(preview.type, 'diff');
  assert.ok(preview.content.includes('-two') && preview.content.includes('+TWO'), preview.content);
});

test('a whole-file write that drops most of an existing file is refused, pointing at edit_file', async (t) => {
  const { ctx } = await projectWith(t, { 'big.ts': lines(120) });
  const write = new ToolRegistry().get('write_file');
  const reason = await write.validate({ path: 'big.ts', content: 'line 1\nline 2\n' }, ctx);
  assert.match(reason, /edit_file/);
  // A small edit and a new file are fine.
  assert.equal(
    await write.validate({ path: 'big.ts', content: lines(120).replace('line 7\n', 'line seven\n') }, ctx),
    null
  );
  assert.equal(await write.validate({ path: 'new.ts', content: 'hello\n' }, ctx), null);
  // The guard holds even if the call is made without asking first.
  const run = await write.execute({ path: 'big.ts', content: 'line 1\n' }, ctx);
  assert.ok(run.isError);
});

test('a whole-file write keeps the final newline the file had', async (t) => {
  const { dir, ctx } = await projectWith(t, { 'a.ts': 'one\ntwo\n' });
  const result = await new ToolRegistry()
    .get('write_file')
    .execute({ path: 'a.ts', content: 'one\nTWO' }, ctx);
  assert.ok(!result.isError, result.content);
  assert.equal(fs.readFileSync(path.join(dir, 'a.ts'), 'utf8'), 'one\nTWO\n');
  assert.equal(result.written, 'one\nTWO\n');
});

test('a call missing a required argument is named, so it never reaches an approval card as "undefined"', () => {
  const write = new ToolRegistry().get('write_file').definition;
  assert.match(missingArguments(write, { content: 'x' }), /path/);
  assert.match(missingArguments(write, { path: '  ', content: 'x' }), /path/);
  assert.equal(missingArguments(write, { path: 'a.ts', content: '' }), null, 'an empty file is a real write');
  assert.equal(missingArguments(write, { path: 'a.ts', content: 'x' }), null);
});

test('list_files of a folder walks that folder, even when the rest of the project is past the cap', async (t) => {
  const files = { 'tests/one.test.cjs': 'x' };
  for (let i = 0; i < 30; i++) files[`aaa/f${i}.txt`] = 'x';
  const { project } = await projectWith(t, files);
  // A small cap stands in for 5000 files: the whole project is cut short, the folder is not.
  assert.equal((await project.list(undefined, 10)).includes('tests/one.test.cjs'), false);
  assert.equal(project.listTruncated, true);
  assert.deepEqual(await project.list('tests', 10), ['tests/one.test.cjs']);
  assert.equal(project.listTruncated, false);
});

test('list_files says when a listing was cut short instead of looking empty', async (t) => {
  const { ctx } = await projectWith(t, { 'src/a.ts': 'x' });
  ctx.project.list = async function () {
    this.listTruncated = true;
    return [];
  };
  const result = await new ToolRegistry().get('list_files').execute({ directory: 'tests' }, ctx);
  assert.doesNotMatch(result.content, /^No files found\.$/);
  assert.match(result.content, /cut short|cap/);
});

test('list_files of a file path lists that file, as it did before', async (t) => {
  const { ctx } = await projectWith(t, { 'src/a.ts': 'x' });
  const result = await new ToolRegistry().get('list_files').execute({ directory: 'src/a.ts' }, ctx);
  assert.equal(result.content, 'src/a.ts');
});

test('list_files says when a folder does not exist', async (t) => {
  const { ctx } = await projectWith(t, { 'src/a.ts': 'x' });
  const result = await new ToolRegistry().get('list_files').execute({ directory: 'nope' }, ctx);
  assert.match(result.content, /No files/);
});

test('search_code says when it stopped early, so no match is not mistaken for none', async (t) => {
  const many = {};
  for (let i = 0; i < 200; i++) many[`f${i}.txt`] = 'needle\n';
  const { ctx } = await projectWith(t, many);
  const result = await new ToolRegistry().get('search_code').execute({ query: 'needle' }, ctx);
  assert.match(result.content, /first 150/);
});

test('the shell tools say which shell runs the command', () => {
  assert.match(shellNote('win32'), /powershell|pwsh|cmd/i);
  assert.match(shellNote('win32'), /native syntax/i);
  assert.match(shellNote('linux'), /sh/);
  const run = new ToolRegistry().get('run_command').definition.description;
  assert.ok(run.includes(shellNote(process.platform)), run);
});

test(
  'an unknown command comes back with its actual shell identity',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { project } = await projectWith(t, { 'a.txt': 'x' });
    const result = await new ToolRegistry()
      .get('run_command')
      .execute({ command: 'axonnosuchcommand -n 1 a.txt' }, { project, allowShell: true });
    assert.ok(result.isError);
    assert.match(result.content, /powershell|pwsh|cmd/i);
  }
);

test('edit_file is checked like write_file: inside the folder, and asked about', () => {
  const permissions = new PermissionManager();
  const scope = { roots: [path.resolve('/project')], allowShell: false };
  assert.equal(permissions.check({ toolName: 'edit_file', args: { path: 'a.ts' } }, scope).action, 'ask');
  assert.equal(
    permissions.check({ toolName: 'edit_file', args: { path: '../outside.ts' } }, scope).action,
    'deny'
  );
});
