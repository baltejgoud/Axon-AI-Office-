// What each protocol adapter puts on the wire, and how provider failures reach the user.
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const providers = require('../src/main/providers.ts');
const { streamChat } = providers;

const anthropic = { kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', models: [] };
const gemini = { kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: [] };
const openai = { kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', models: [] };
const hi = [{ role: 'user', content: 'Hi' }];
const sseBody = (...events) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
const textEvent = { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } };

/** Replaces fetch for one test; returns the parsed request bodies it saw. */
function mockFetch(t, respond) {
  const saved = global.fetch;
  const bodies = [];
  global.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return respond(bodies.length, url, options);
  };
  t.after(() => { global.fetch = saved; });
  return bodies;
}

test('Anthropic requests always carry max_tokens, even when the caller sets none', async (t) => {
  const bodies = mockFetch(t, () => new Response(sseBody(textEvent)));
  await streamChat(anthropic, 'k', { model: 'claude-opus-5', system: 's', messages: hi }, () => {});
  assert.equal(typeof bodies[0].max_tokens, 'number');
  assert.ok(bodies[0].max_tokens > 0);
});

test('HTTP errors show the provider\'s own message, never the key', async (t) => {
  mockFetch(t, () => new Response(JSON.stringify({
    type: 'error', error: { type: 'invalid_request_error', message: 'model: claude-nope not found (key sk-secret-123)' }
  }), { status: 404 }));
  await assert.rejects(
    streamChat(anthropic, 'sk-secret-123', { model: 'claude-nope', maxTokens: 10, messages: hi }, () => {}),
    (error) => {
      assert.match(error.message, /404/);
      assert.match(error.message, /claude-nope not found/);
      assert.doesNotMatch(error.message, /sk-secret-123/);
      return true;
    }
  );
});

test('a model that rejects temperature is retried once without it', async (t) => {
  const bodies = mockFetch(t, (n) => n === 1
    ? new Response(JSON.stringify({ error: { message: '`temperature` is not supported for this model.' } }), { status: 400 })
    : new Response(sseBody(textEvent)));
  let text = '';
  await streamChat(anthropic, 'k', { model: 'claude-opus-5', maxTokens: 10, temperature: 0.7, messages: hi }, (chunk) => { text += chunk; });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].temperature, 0.7);
  assert.equal('temperature' in bodies[1], false);
  assert.equal(text, 'ok');
});

test('an overloaded provider (529) is retried before streaming starts', async (t) => {
  const bodies = mockFetch(t, (n) => n === 1 ? new Response('overloaded', { status: 529 }) : new Response(sseBody(textEvent)));
  await streamChat(anthropic, 'k', { model: 'm', maxTokens: 10, messages: hi }, () => {});
  assert.equal(bodies.length, 2);
});

test('a streamed error event carries the provider\'s message', async (t) => {
  mockFetch(t, () => new Response(sseBody({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })));
  await assert.rejects(streamChat(anthropic, 'k', { model: 'm', maxTokens: 10, messages: hi }, () => {}), /Overloaded/);
});

test('Anthropic gets every result of a parallel tool call in one user message', async (t) => {
  const bodies = mockFetch(t, () => new Response(sseBody(textEvent)));
  await streamChat(anthropic, 'k', {
    model: 'm', maxTokens: 10,
    messages: [
      { role: 'user', content: 'Read both' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: '{"path":"a"}' }, { id: 'b', name: 'read_file', arguments: '{"path":"b"}' }] },
      { role: 'tool', toolCallId: 'a', content: 'A' },
      { role: 'tool', toolCallId: 'b', content: 'B' }
    ]
  }, () => {});
  const sent = bodies[0].messages;
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[2].content.map((block) => block.tool_use_id), ['a', 'b']);
});

test('Gemini answers each function call under its own name and echoes its thought signature', async (t) => {
  const bodies = mockFetch(t, (n) => new Response(n === 1
    ? sseBody({ candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'a' } }, thoughtSignature: 'sig-1' }] } }] })
    : sseBody({ candidates: [{ content: { parts: [{ text: 'done' }] } }] })));
  const first = await streamChat(gemini, 'k', { model: 'gemini-3-pro', maxTokens: 10, messages: hi }, () => {});
  const call = first.toolCalls[0];
  await streamChat(gemini, 'k', {
    model: 'gemini-3-pro', maxTokens: 10,
    messages: [...hi, { role: 'assistant', content: '', toolCalls: [call], replay: first.replay }, { role: 'tool', toolCallId: call.id, content: '{"text":"A"}' }]
  }, () => {});
  const [, model, reply] = bodies[1].contents;
  assert.equal(model.parts[0].thoughtSignature, 'sig-1');
  assert.equal(reply.parts[0].functionResponse.name, 'read_file');
});

test('Anthropic tool rounds go back with their thinking blocks and signatures intact', async (t) => {
  const bodies = mockFetch(t, (n) => new Response(n === 1
    ? sseBody(
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Need the file.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-A' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'read_file', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"a"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } })
    : sseBody(textEvent)));
  const first = await streamChat(anthropic, 'k', { model: 'claude-opus-5', maxTokens: 100, messages: hi }, () => {});
  await streamChat(anthropic, 'k', {
    model: 'claude-opus-5', maxTokens: 100,
    messages: [...hi, { role: 'assistant', content: '', toolCalls: first.toolCalls, replay: first.replay }, { role: 'tool', toolCallId: 'tu1', content: 'A' }]
  }, () => {});
  const assistant = bodies[1].messages[1];
  assert.deepEqual(assistant.content[0], { type: 'thinking', thinking: 'Need the file.', signature: 'sig-A' });
  assert.deepEqual(assistant.content[1], { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'a' } });
});

test('OpenAI streams ask for usage so token counts are recorded', async (t) => {
  const bodies = mockFetch(t, () => new Response(sseBody(
    { choices: [{ delta: { content: 'ok' } }] },
    { choices: [], usage: { prompt_tokens: 5, completion_tokens: 1 } },
    '[DONE]'
  )));
  const usage = await streamChat(openai, 'k', { model: 'gpt-5', maxTokens: 10, messages: hi }, () => {});
  assert.deepEqual(bodies[0].stream_options, { include_usage: true });
  assert.equal(usage.promptTokens, 5);
});

test('a long stream is not cut off while events keep arriving', async (t) => {
  const saved = { ...providers.timeouts };
  t.after(() => Object.assign(providers.timeouts, saved));
  Object.assign(providers.timeouts, { headersMs: 40, idleMs: 200 });
  mockFetch(t, (_n, _url, options) => new Response(new ReadableStream({
    async start(controller) {
      for (let i = 0; i < 6; i++) {
        if (options.signal.aborted) return controller.error(options.signal.reason);
        controller.enqueue(new TextEncoder().encode(sseBody(textEvent)));
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      controller.close();
    }
  })));
  let text = '';
  await streamChat(anthropic, 'k', { model: 'm', maxTokens: 10, messages: hi }, (chunk) => { text += chunk; });
  assert.equal(text, 'ok'.repeat(6));
});

test('a stream that goes silent fails with a clear message', async (t) => {
  const saved = { ...providers.timeouts };
  t.after(() => Object.assign(providers.timeouts, saved));
  Object.assign(providers.timeouts, { headersMs: 1000, idleMs: 60 });
  mockFetch(t, (_n, _url, options) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseBody(textEvent)));
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason));
    }
  })));
  await assert.rejects(streamChat(anthropic, 'k', { model: 'm', maxTokens: 10, messages: hi }, () => {}), /stopped responding/);
});

test('OpenAI-compatible reasoning is sent back during the run\'s tool rounds', async (t) => {
  const bodies = mockFetch(t, (n) => new Response(n === 1
    ? sseBody(
      { choices: [{ delta: { reasoning_content: 'Check a.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"path":"a"}' } }] } }] },
      '[DONE]')
    : sseBody({ choices: [{ delta: { content: 'ok' } }] }, '[DONE]')));
  const deepseek = { kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', models: [] };
  const first = await streamChat(deepseek, 'k', { model: 'deepseek-reasoner', maxTokens: 10, messages: hi }, () => {});
  await streamChat(deepseek, 'k', {
    model: 'deepseek-reasoner', maxTokens: 10,
    messages: [...hi, { role: 'assistant', content: '', toolCalls: first.toolCalls, replay: first.replay }, { role: 'tool', toolCallId: 'c1', content: 'A' }]
  }, () => {});
  assert.equal(bodies[1].messages[1].reasoning_content, 'Check a.');
  assert.equal(bodies[1].messages[1].tool_calls[0].id, 'c1');
});

test('a refusal says the model declined instead of "no response"', async (t) => {
  mockFetch(t, () => new Response(sseBody({ type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { output_tokens: 0 } })));
  await assert.rejects(streamChat(anthropic, 'k', { model: 'm', maxTokens: 10, messages: hi }, () => {}), /declined/);
});

test('an answer cut off at the token limit is reported as truncated', async (t) => {
  mockFetch(t, () => new Response(sseBody(textEvent, { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 10 } })));
  const result = await streamChat(anthropic, 'k', { model: 'm', maxTokens: 10, messages: hi }, () => {});
  assert.equal(result.truncated, true);
});

test('Anthropic requests ask for prompt caching, and a proxy that refuses it is retried without', async (t) => {
  const bodies = mockFetch(t, (n) => n === 1
    ? new Response(JSON.stringify({ error: { message: 'cache_control: Extra inputs are not permitted' } }), { status: 400 })
    : new Response(sseBody(textEvent)));
  const proxy = { kind: 'anthropic', baseUrl: 'https://proxy.example/v1', models: [] };
  await streamChat(proxy, 'k', { model: 'claude-opus-5', maxTokens: 10, messages: hi }, () => {});
  assert.deepEqual(bodies[0].cache_control, { type: 'ephemeral' });
  assert.equal('cache_control' in bodies[1], false);
});

test('checkModel passes once the provider starts answering, with a tiny request and no tools', async (t) => {
  const bodies = mockFetch(t, () => new Response(sseBody({ type: 'message_start', message: { usage: { input_tokens: 3 } } }, textEvent)));
  await providers.checkModel(anthropic, 'k', 'claude-opus-5');
  assert.equal(bodies[0].model, 'claude-opus-5');
  assert.equal(bodies[0].max_tokens, 16);
  assert.equal('tools' in bodies[0], false);
});

test('checkModel fails with the provider\'s own message', async (t) => {
  mockFetch(t, () => new Response(JSON.stringify({ error: { message: 'model: claude-opsu-5 not found' } }), { status: 404 }));
  await assert.rejects(providers.checkModel(anthropic, 'k', 'claude-opsu-5'), /HTTP 404: model: claude-opsu-5 not found\. Check the endpoint URL and model ID\./);
});

test('checkModel fails when the first streamed event is an error', async (t) => {
  mockFetch(t, () => new Response(sseBody({ type: 'error', error: { type: 'permission_error', message: 'Your key cannot use this model' } })));
  await assert.rejects(providers.checkModel(anthropic, 'k', 'm'), /Your key cannot use this model/);
});

test('checkModel fails when the endpoint answers with something other than a model stream', async (t) => {
  mockFetch(t, () => new Response('<html><body>Welcome</body></html>', { status: 200 }));
  await assert.rejects(providers.checkModel(openai, 'k', 'gpt-5'), /not with a model stream/);
});

test('checkModel goes through the same fallbacks as chat', async (t) => {
  const bodies = mockFetch(t, (n) => n === 1
    ? new Response(JSON.stringify({ error: { message: 'cache_control: Extra inputs are not permitted' } }), { status: 400 })
    : new Response(sseBody(textEvent)));
  await providers.checkModel({ kind: 'anthropic', baseUrl: 'https://another-proxy.example/v1', models: [] }, 'k', 'claude-opus-5');
  assert.equal(bodies.length, 2);
});
