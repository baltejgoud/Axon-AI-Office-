// Undo's memory: the version each write replaced, kept for the newest writes only.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Checkpoints, hashText } = require('../src/main/audit/checkpoints.ts');

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-checkpoints-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const point = (toolCallId, extra = {}) => ({ toolCallId, conversationId: 'c', root: '/p', path: 'a.txt', existed: true, before: 'old', afterHash: hashText('new'), ...extra });

test('a checkpoint is kept, read back and removed; any id is safe as a name', async (t) => {
  const store = new Checkpoints(temp(t));
  assert.equal(await store.save(point('call/../../evil:1')), true);
  const kept = await store.get('call/../../evil:1');
  assert.equal(kept.before, 'old');
  assert.equal(kept.afterHash, hashText('new'));
  assert.equal(typeof kept.savedAt, 'number');
  await store.remove('call/../../evil:1');
  assert.equal(await store.get('call/../../evil:1'), null);
  assert.equal(await store.get('never-saved'), null);
});

test('only the newest checkpoints are kept', async (t) => {
  let now = 1;
  const store = new Checkpoints(temp(t), { count: 3, bytes: 1e9 }, () => now++);
  for (const id of ['a', 'b', 'c', 'd']) await store.save(point(id));
  assert.equal(await store.get('a'), null);
  assert.ok(await store.get('d'));
});
