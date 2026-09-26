// Setting up a provider from just a key: which service a key is for, and which models to use.
const ts = require('typescript');
const fs = require('node:fs');
const loadTs = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React }
    }).outputText,
    file
  );
require.extensions['.ts'] = loadTs;
require.extensions['.tsx'] = loadTs;
const { test } = require('node:test');
const assert = require('node:assert/strict');
const choice = require('../src/renderer/src/settings/modelChoice.ts');
const { PREFERENCES, chooseModels, serviceFromKey } = choice;

test('keys that name their service pick it; plain sk- keys wait for a choice', () => {
  assert.equal(serviceFromKey('gsk_abc12345'), 'Groq');
  assert.equal(serviceFromKey('csk-abc12345'), 'Cerebras');
  assert.equal(serviceFromKey('sk-ant-api03-abc'), 'Anthropic');
  assert.equal(serviceFromKey('AIzaSyD-abc123'), 'Gemini');
  assert.equal(serviceFromKey('sk-or-v1-abc'), 'OpenRouter');
  assert.equal(serviceFromKey('sk-abc123'), null, 'OpenAI, DeepSeek, Kimi and Qwen all use sk-');
  assert.equal(serviceFromKey(''), null);
});

test('Kimi: the suggested models when the key has them, the newest Kimi when it does not', () => {
  const list = ['kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k3', 'moonshot-v1-8k'];
  assert.deepEqual(chooseModels(list, ['kimi-k3', 'kimi-k2.6'], PREFERENCES.Kimi), ['kimi-k3', 'kimi-k2.6']);
  // Last year's suggestions, on an account that has moved on:
  assert.deepEqual(chooseModels(['kimi-k4', 'kimi-k4-code'], ['kimi-k3', 'kimi-k2.6'], PREFERENCES.Kimi), ['kimi-k4']);
});

test('Qwen: a flagship, a balanced and a fast model out of hundreds, never embeddings or speech', () => {
  const list = [
    'qwen3.8-max', 'qwen3.8-max-0902', 'qwen3.7-max', 'qwen-plus', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen-turbo',
    'text-embedding-v4', 'qwen3-tts-flash', 'paraformer-realtime-v2', 'wanx2.1-t2i-turbo', 'qwen-vl-max'
  ];
  assert.deepEqual(chooseModels(list, [], PREFERENCES.Qwen), ['qwen3.8-max', 'qwen-plus', 'qwen3.8-flash']);
});

test('OpenAI, Anthropic and Gemini: the newest of each family the key can use', () => {
  const openai = ['gpt-4o', 'gpt-4o-mini', 'gpt-5', 'gpt-5.1', 'gpt-5.1-mini', 'text-embedding-3-large', 'whisper-1', 'dall-e-3', 'tts-1'];
  assert.deepEqual(chooseModels(openai, ['gpt-4o', 'gpt-4o-mini'], PREFERENCES.OpenAI), ['gpt-4o', 'gpt-4o-mini']);
  assert.deepEqual(chooseModels(openai, ['gpt-3.5-turbo'], PREFERENCES.OpenAI), ['gpt-5.1', 'gpt-5.1-mini', 'gpt-4o']);
  const anthropic = ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-1-20250805', 'claude-sonnet-4-5-20250929'];
  assert.deepEqual(chooseModels(anthropic, ['claude-opus-5'], PREFERENCES.Anthropic), ['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001']);
  const gemini = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro', 'gemini-3-flash', 'gemini-embedding-001', 'imagen-4.0-generate-001'];
  assert.deepEqual(chooseModels(gemini, [], PREFERENCES.Gemini), ['gemini-3-pro', 'gemini-3-flash']);
});

test('a local Ollama or a custom gateway: whatever chat models it has', () => {
  assert.deepEqual(chooseModels(['llama3.2:latest', 'nomic-embed-text:latest', 'qwen3:8b'], ['qwen3', 'llama3.2'], PREFERENCES.Ollama), ['llama3.2:latest', 'qwen3:8b']);
  assert.deepEqual(chooseModels([], ['m1'], PREFERENCES.Custom), []);
});

test('models the user chose stay chosen when the key has them', () => {
  assert.deepEqual(chooseModels(['kimi-k3', 'kimi-k2.7-code'], ['kimi-k2.7-code'], PREFERENCES.Kimi), ['kimi-k2.7-code']);
});

test('normalizeIconKey resolves provider names and models to official icon keys', () => {
  const { normalizeIconKey } = require('../src/renderer/src/settings/ModelIcon.tsx');
  assert.equal(normalizeIconKey('OpenAI'), 'openai');
  assert.equal(normalizeIconKey('gpt-4o'), 'openai');
  assert.equal(normalizeIconKey('Anthropic'), 'anthropic');
  assert.equal(normalizeIconKey('Claude 3.7'), 'anthropic');
  assert.equal(normalizeIconKey('Gemini'), 'gemini');
  assert.equal(normalizeIconKey('Google Gemini'), 'gemini');
  assert.equal(normalizeIconKey('DeepSeek'), 'deepseek');
  assert.equal(normalizeIconKey('Groq'), 'groq');
  assert.equal(normalizeIconKey('Cerebras'), 'cerebras');
  assert.equal(normalizeIconKey('Kimi'), 'kimi');
  assert.equal(normalizeIconKey('Moonshot'), 'kimi');
  assert.equal(normalizeIconKey('Qwen'), 'qwen');
  assert.equal(normalizeIconKey('Alibaba Model Studio'), 'qwen');
  assert.equal(normalizeIconKey('OpenRouter'), 'openrouter');
  assert.equal(normalizeIconKey('Ollama'), 'ollama');
  assert.equal(normalizeIconKey('Union Alpha'), 'union');
  assert.equal(normalizeIconKey('Custom'), 'custom');
  assert.equal(normalizeIconKey('Unknown'), '');
});
