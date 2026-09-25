// A pasted API key, from Settings to the request: cleaned the same way for Save, Test connection,
// Find models and chat, and the model list read with the same key rules as Test connection.
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
const { Service } = require('../src/main/service.ts');
const providers = require('../src/main/providers.ts');

const kimi = {
  id: 'kimi', name: 'Kimi', kind: 'openai-compatible', baseUrl: 'https://api.moonshot.ai/v1',
  models: [{ id: 'kimi-k3', displayName: 'kimi-k3' }], enabled: true, createdAt: 0, hasApiKey: true
};

function setup(t, savedKey = 'sk-saved') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-keys-'));
  fs.mkdirSync(path.join(dir, 'db'));
  fs.mkdirSync(path.join(dir, 'backups'));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  repo.state.providers.push({ ...kimi });
  const secrets = new Map(savedKey === null ? [] : [['kimi', savedKey]]);
  const vault = {
    has: (id) => secrets.has(id),
    get: (id) => secrets.get(id) ?? null,
    set: (id, secret) => (secret ? secrets.set(id, secret) : secrets.delete(id)),
    remove: (id) => secrets.delete(id)
  };
  const service = new Service(repo, vault, dir, () => {}, 'worker');
  const checked = [];
  const listed = [];
  const originals = { checkModel: providers.checkModel, listModels: providers.listModels };
  providers.checkModel = async (provider, key, model) => { checked.push({ provider, key, model }); };
  providers.listModels = async (provider, key) => { listed.push({ provider, key }); return ['kimi-k2.6', 'kimi-k3']; };
  t.after(() => {
    Object.assign(providers, originals);
    service.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { service, secrets, checked, listed };
}

test('a pasted key is cleaned before it is saved: spaces, line breaks, quotes and a "Bearer " prefix', async (t) => {
  const { service, secrets } = setup(t, null);
  for (const pasted of ['  sk-abc123\n', '"sk-abc123"', 'Bearer sk-abc123', "'Bearer  sk-abc123'\r\n", 'sk-abc123​']) {
    await service.providerSave({ ...kimi, id: 'fresh' }, pasted);
    assert.equal(secrets.get('fresh'), 'sk-abc123', JSON.stringify(pasted));
  }
});

test('a key with a space or line break inside is refused with a clear message', async (t) => {
  const { service, secrets } = setup(t, null);
  await assert.rejects(service.providerSave({ ...kimi, id: 'fresh' }, 'sk-abc 123'), /space or line break/);
  await assert.rejects(service.providerSave({ ...kimi, id: 'fresh' }, 'sk-abc\n123'), /space or line break/);
  await assert.rejects(service.providerTest({ ...kimi }, 'sk-abc 123'), /space or line break/);
  assert.equal(secrets.has('fresh'), false);
});

test('Test connection sends the same cleaned key that Save stores', async (t) => {
  const { service, checked } = setup(t);
  await service.providerTest({ ...kimi }, ' Bearer sk-typed\n');
  assert.equal(checked[0].key, 'sk-typed');
});

test('a key saved before keys were cleaned is cleaned when it is used', async (t) => {
  const { service, checked } = setup(t, '  sk-old-paste\n');
  await service.providerTest({ ...kimi });
  assert.equal(checked[0].key, 'sk-old-paste');
});

test('an empty key removes the saved one', async (t) => {
  const { service, secrets } = setup(t);
  await service.providerSave({ ...kimi }, '');
  assert.equal(secrets.has('kimi'), false);
});

test('Find models reads the list with the typed key, or the saved key for an unchanged endpoint', async (t) => {
  const { service, listed } = setup(t);
  assert.deepEqual(await service.providerModels({ ...kimi }), { models: ['kimi-k2.6', 'kimi-k3'], savedKeyWithheld: false });
  assert.equal(listed[0].key, 'sk-saved');
  await service.providerModels({ ...kimi }, ' sk-typed ');
  assert.equal(listed[1].key, 'sk-typed');
  const moved = await service.providerModels({ ...kimi, baseUrl: 'https://proxy.example/v1' });
  assert.equal(listed[2].key, null, 'the saved key never goes to a changed endpoint');
  assert.equal(moved.savedKeyWithheld, true);
});

test('Find models checks the endpoint like Save, and needs no model IDs yet', async (t) => {
  const { service } = setup(t);
  await assert.rejects(service.providerModels({ ...kimi, baseUrl: 'http://example.com/v1' }), /HTTPS/);
  const result = await service.providerModels({ ...kimi, models: [] });
  assert.deepEqual(result.models, ['kimi-k2.6', 'kimi-k3']);
});
