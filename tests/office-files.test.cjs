// The Files room: the folder wall kept by the main process and the file context sent with a task.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
const wall = require('../src/main/folderWall.ts');
const context = require('../src/renderer/src/features/office/activity/fileContext.ts');

test('the wall keeps the latest folder first, without duplicates, up to twelve', () => {
  let list = [];
  for (let i = 0; i < 14; i++) list = wall.remember(list, `/work/p${i}`);
  assert.equal(list.length, 12);
  assert.equal(list[0], '/work/p13');
  list = wall.remember(list, '/work/p5');
  assert.equal(list[0], '/work/p5');
  assert.equal(list.filter((f) => f === '/work/p5').length, 1);
  list = wall.forget(list, '/work/p5');
  assert.ok(!wall.isOnWall(list, '/work/p5'));
});

test('the wall survives a restart and ignores a corrupt file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-wall-'));
  try {
    const file = path.join(dir, 'office-folders.json');
    assert.deepEqual(wall.loadWall(file), []);
    wall.saveWall(file, ['/a', '/b']);
    assert.deepEqual(wall.loadWall(file), ['/a', '/b']);
    fs.writeFileSync(file, '{"not": "a list"}');
    assert.deepEqual(wall.loadWall(file), []);
    fs.writeFileSync(file, '[1, "/c", null]');
    assert.deepEqual(wall.loadWall(file), ['/c']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('handed files are appended to the task as labelled file context', () => {
  const text = context.withFileContext('Summarize this.', [
    { path: 'notes/brief.txt', content: 'Launch a prototype.' },
    { path: 'src/app.ts', content: 'export const x = 1;' }
  ]);
  assert.ok(text.startsWith('Summarize this.'));
  assert.match(text, /<file path="notes\/brief.txt">\nLaunch a prototype.\n<\/file>/);
  assert.match(text, /<file path="src\/app.ts">/);
  assert.equal(context.withFileContext('Just this.', []), 'Just this.');
});

test('large files are cut so a task stays within budget', () => {
  const big = 'x'.repeat(50000);
  const text = context.withFileContext('Read.', [{ path: 'a.txt', content: big }]);
  assert.ok(text.length < 32000, `${text.length}`);
  assert.match(text, /truncated/);
  const many = Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.txt`, content: 'y'.repeat(29000) }));
  assert.ok(context.withFileContext('Read all.', many).length <= 100000 + 2000);
});
