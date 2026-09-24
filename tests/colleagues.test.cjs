// The coworker directory shared by both processes, and coworkers asking each other for help.
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false }, dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
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
const shared = require('../src/shared/coworkers.ts');
const agents = require('../src/renderer/src/features/office/data/officeAgents.ts');

test('the shared directory holds the whole office, core team first', () => {
  assert.equal(shared.COWORKERS.length, 207);
  assert.deepEqual(
    shared.COWORKERS.slice(0, 8).map((c) => c.core),
    Array(8).fill(true)
  );
  assert.deepEqual(
    shared.COWORKERS.map((c) => c.id),
    agents.OFFICE_AGENTS.map((a) => a.id)
  );
  const backend = shared.coworkerById('backend-developer');
  assert.match(backend.systemPrompt, /Backend Developer/);
  assert.deepEqual(backend.roleIds, ['backend-developer']);
  assert.equal(shared.coworkerById('nobody'), undefined);
  assert.equal(shared.SPECIALIST_GROUPS.length, 22);
  // The office shows exactly what the directory says.
  for (const a of agents.OFFICE_AGENTS) {
    const c = shared.coworkerById(a.id);
    assert.equal(a.systemPrompt, c.systemPrompt, a.id);
    assert.equal(a.department, c.department, a.id);
  }
});
