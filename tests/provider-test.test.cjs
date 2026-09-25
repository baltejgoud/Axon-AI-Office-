// Settings' Test connection: which key it sends, which models it checks, and what it reports.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false }, dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Repository } = require('../src/main/repository.ts');
const service_ = require('../src/main/service.ts');
const { Service, PROVIDER_TEST } = service_;
const providers = require('../src/main/providers.ts');

const saved = {
  id: 'p1', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
  models: [{ id: 'claude-opus-5', displayName: 'claude-opus-5' }], enabled: true, createdAt: 0, hasApiKey: true
};

function setup(t, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-ptest-'));
  fs.mkdirSync(path.join(dir, 'db'));
  fs.mkdirSync(path.join(dir, 'backups'));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  repo.state.providers.push({ ...saved });
  const secrets = new Map([['p1', 'saved-key']]);
  const vault = { has: (id) => secrets.has(id), get: (id) => secrets.get(id) ?? null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, () => {}, 'worker');
  const calls = [];
  const originalCheck = providers.checkModel;
  providers.checkModel = async (provider, key, model, signal) => { calls.push({ provider, key, model, signal }); return check?.(model, signal); };
  t.after(() => { providers.checkModel = originalCheck; service.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { service, calls };
}

test('a key typed in the form is the one tested', async (t) => {
  const { service, calls } = setup(t);
  const result = await service.providerTest({ ...saved }, 'typed-key');
  assert.equal(calls[0].key, 'typed-key');
  assert.equal(result.savedKeyWithheld, false);
  assert.equal(result.results[0].ok, true);
  assert.equal(typeof result.results[0].ms, 'number');
});

test('with no key typed, the saved key is tested while the endpoint is unchanged', async (t) => {
  const { service, calls } = setup(t);
  await service.providerTest({ ...saved });
  assert.equal(calls[0].key, 'saved-key');
});

test('the saved key never goes to an endpoint changed in the form', async (t) => {
  const { service, calls } = setup(t);
  const result = await service.providerTest({ ...saved, baseUrl: 'https://proxy.example/v1' });
  assert.equal(calls[0].key, null);
  assert.equal(result.savedKeyWithheld, true);
});

test('every listed model is checked, up to ten, and each failure keeps its own message', async (t) => {
  const { service, calls } = setup(t, (model) => { if (model === 'm2') throw new Error('Provider returned HTTP 404: model: m2 not found.'); });
  const models = Array.from({ length: 12 }, (_, i) => ({ id: `m${i + 1}`, displayName: `m${i + 1}` }));
  const result = await service.providerTest({ ...saved, models });
  assert.deepEqual(calls.map((c) => c.model), models.slice(0, 10).map((m) => m.id));
  assert.equal(result.results.length, 10);
  assert.equal(result.untested, 2);
  assert.deepEqual(result.results.map((r) => r.ok), [true, false, ...Array(8).fill(true)]);
  assert.match(result.results[1].error, /m2 not found/);
});

test('a model that never answers fails after the time limit', async (t) => {
  const saved_ = PROVIDER_TEST.timeoutMs;
  PROVIDER_TEST.timeoutMs = 50;
  t.after(() => { PROVIDER_TEST.timeoutMs = saved_; });
  const { service } = setup(t, (_model, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
  const result = await service.providerTest({ ...saved });
  assert.equal(result.results[0].ok, false);
  assert.match(result.results[0].error, /No answer within/);
});

test('the form is checked like Save: endpoint policy and model IDs', async (t) => {
  const { service } = setup(t);
  await assert.rejects(service.providerTest({ ...saved, baseUrl: 'http://example.com/v1' }), /HTTPS/);
  await assert.rejects(service.providerTest({ ...saved, models: [] }), /between 1 and 100 models/);
});
