const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contextModel, ingestModelLimits } = require('../src/main/providers.ts');
const { ChatGPTAccount } = require('../src/main/accounts/chatgpt.ts');
const { ContextBudgetPlanner } = require('../src/main/context.ts');
const provider = () => ({ id: 'chatgpt-plan', auth: 'chatgpt', kind: 'openai-responses', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol' }] });

test('existing ChatGPT accounts admit the screenshot-sized greeting without refreshing models', () => {
  const model = contextModel(provider(), 'gpt-6.1-sol');
  assert.equal(model.contextWindow, 1050000);
  const request = { model: model.id, system: 'Required instructions. '.repeat(2600), maxTokens: 16384, messages: [{ role: 'user', content: 'hi' }] };
  const plan = new ContextBudgetPlanner().compile(request, model);
  assert.ok(plan.inputTokens > 57569);
  assert.ok(plan.inputTokens + plan.outputReserve + plan.safetyMargin < model.contextWindow);
  assert.equal(plan.request.messages[0].content, 'hi');
  assert.equal(plan.request.system, request.system);
});

test('ChatGPT catalog persists limits, falls back only for known IDs and ignores invalid values', async (t) => {
  const oldFetch = global.fetch; t.after(() => global.fetch = oldFetch);
  const saved = { clientId: 'test', subject: 'test', accessToken: 'test-token', scopes: ['resource.invoke', 'chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600000 };
  const auth = new ChatGPTAccount({ vault: { get: () => JSON.stringify(saved) }, openExternal() {} });
  global.fetch = async () => Response.json({ models: [
    { slug: 'gpt-6.1-sol', visibility: 'list', context_window: 272000, max_output_tokens: 32000 },
    { slug: 'gpt-6-sol', visibility: 'list', context_window: -1 },
    { slug: 'unknown', visibility: 'list', context_window: '1000000' },
    { slug: 'hidden', visibility: 'hide' }
  ] });
  const models = await auth.models();
  assert.equal(models.length, 3);
  assert.equal(models[0].contextWindow, 272000);
  assert.equal(models[0].maxOutputTokens, 32000);
  assert.equal(models[1].contextWindow, 1050000);
  assert.equal(models[2].contextWindow, undefined);
});

test('server and manual restrictions override published capacity; custom providers do not inherit it', () => {
  const p = provider();
  p.models[0].contextWindow = 131072;
  ingestModelLimits(p, { models: [{ slug: 'gpt-6.1-sol', context_window: 65536, max_output_tokens: 8192 }] });
  assert.equal(contextModel(p, 'gpt-6.1-sol').contextWindow, 65536);
  assert.equal(contextModel(p, 'gpt-6.1-sol').maxOutputTokens, 8192);
  assert.equal(contextModel({ ...provider(), auth: undefined, baseUrl: 'https://proxy.test/v1' }, 'gpt-6.1-sol').contextWindow, undefined);
});
