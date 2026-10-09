const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { streamChat, responsesInput, endpoint, listModels } = require('../src/main/providers.ts');
const { toolPresentation } = require('../src/renderer/src/chat/workPresentation.ts');
const provider = { id: 'chatgpt-plan', kind: 'openai-responses', auth: 'chatgpt', baseUrl: 'https://api.openai.com/v1', models: [] };
const stream = (events) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));

test('ChatGPT credentials cannot be routed to a custom endpoint or protocol', () => {
  assert.throws(() => endpoint({ ...provider, baseUrl: 'https://proxy.test/v1' }), /official OpenAI/);
  assert.throws(() => endpoint({ ...provider, kind: 'openai-compatible' }), /official OpenAI/);
});

test('Responses sends plan-compatible fields and captures text, reasoning, tools, encrypted replay and usage', async (t) => {
  const oldFetch = global.fetch; t.after(() => global.fetch = oldFetch);
  const output = [{ type: 'reasoning', id: 'r1', encrypted_content: 'opaque' }, { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read_file', arguments: '{"path":"app.ts"}', namespace: 'axon' }];
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.headers.Authorization, 'Bearer token');
    const body = JSON.parse(init.body);
    assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.instructions, 'Work carefully.');
    for (const field of ['temperature', 'max_output_tokens', 'previous_response_id']) assert.equal(field in body, false);
    assert.equal(body.tools[0].type, 'namespace'); assert.equal(body.tools[0].tools[0].name, 'read_file');
    return stream([{ type: 'response.reasoning_summary_text.delta', delta: 'Inspecting the file.' }, { type: 'response.output_text.delta', delta: 'Checking now.' }, { type: 'response.completed', response: { output, usage: { input_tokens: 100, output_tokens: 30, input_tokens_details: { cached_tokens: 20 } } } }]);
  };
  const deltas = [];
  const result = await streamChat(provider, 'token', { model: 'account-model', system: 'Work carefully.', messages: [{ role: 'user', content: 'Check it' }], temperature: 0.7, maxTokens: 4096, tools: [{ name: 'read_file', description: 'Read', parameters: { type: 'object', properties: {} } }] }, (text, delta) => deltas.push(delta));
  assert.equal(result.promptTokens, 100); assert.equal(result.completionTokens, 30); assert.equal(result.cachedPromptTokens, 20);
  assert.equal(result.toolCalls[0].id, 'call-1'); assert.deepEqual(result.replay.content, output);
  const next = responsesInput([{ role: 'assistant', content: '', replay: result.replay }, { role: 'tool', toolCallId: 'call-1', content: 'file text' }]);
  assert.deepEqual(next.slice(0, 2), output); assert.equal(next[2].type, 'function_call_output');
  assert.ok(deltas.some((d) => d.type === 'thought')); assert.ok(deltas.some((d) => d.type === 'text'));
});

test('Responses keeps streamed tool calls when the completed event lists no output (ChatGPT plan)', async (t) => {
  const oldFetch = global.fetch; t.after(() => global.fetch = oldFetch);
  const reasoning = { type: 'reasoning', id: 'r1', encrypted_content: 'opaque' };
  const call = { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read_file', arguments: '{"path":"guide.md"}', namespace: 'axon' };
  const completed = { type: 'response.completed', response: { output: [], usage: { input_tokens: 10, output_tokens: 5 } } };
  const items = [{ type: 'response.output_item.done', output_index: 0, item: reasoning }, { type: 'response.output_item.done', output_index: 1, item: call }];
  const request = { model: 'm', messages: [{ role: 'user', content: 'Plan it' }], tools: [{ name: 'read_file', description: 'Read', parameters: { type: 'object', properties: {} } }] };
  // A tool call with no text before it: this used to fail as "Provider returned no response".
  global.fetch = async () => stream([...items, completed]);
  const bare = await streamChat(provider, 'token', request, () => {});
  assert.equal(bare.toolCalls?.[0]?.name, 'read_file');
  assert.deepEqual(bare.replay.content, [reasoning, call]);
  // A line of preamble, then the call: this used to end the turn with only the preamble.
  global.fetch = async () => stream([{ type: 'response.output_text.delta', delta: "I'll check the guidance." }, ...items, completed]);
  const preamble = await streamChat(provider, 'token', request, () => {});
  assert.equal(preamble.toolCalls?.[0]?.id, 'call-1');
});

test('Responses fails if the stream disconnects or reports a terminal error', async (t) => {
  const oldFetch = global.fetch; t.after(() => global.fetch = oldFetch);
  global.fetch = async () => stream([{ type: 'response.output_text.delta', delta: 'partial' }]);
  await assert.rejects(streamChat(provider, 'token', { model: 'm', messages: [] }, () => {}), /disconnected/);
  global.fetch = async () => stream([{ type: 'response.failed', response: { error: { message: 'No plan usage remaining' } } }]);
  await assert.rejects(streamChat(provider, 'token', { model: 'm', messages: [] }, () => {}), /No plan usage/);
});

test('account catalogs preserve server order and hide non-listable models', async (t) => {
  const oldFetch = global.fetch; t.after(() => global.fetch = oldFetch);
  global.fetch = async () => Response.json({ models: [{ slug: 'z', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }, { slug: 'a', visibility: 'list' }] });
  assert.deepEqual(await listModels(provider, 'token'), ['z', 'a']);
});

test('empty successful tool output is completed and incomplete JSON remains readable', () => {
  assert.equal(toolPresentation({ name: 'read_file', arguments: '{}', result: '' }).status, 'completed');
  assert.equal(toolPresentation({ name: 'read_file', arguments: '{"path":"app.ts"}' }).target, 'app.ts');
  assert.equal(toolPresentation({ name: 'custom_tool', arguments: '{' }).label, 'custom tool');
});
