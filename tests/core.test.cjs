const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function(name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText, path);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { endpoint, sse, streamChat } = require('../src/main/providers.ts');
const { Project, within, allowedName } = require('../src/main/project.ts');
const { search, ingest } = require('../src/main/knowledge.ts');
const { JsonStore } = require('../src/main/infra/store.ts');
const provider = { kind: 'openai-compatible', baseUrl: 'https://example.com/v1', models: [] };

test('endpoint policy rejects insecure remote and embedded credentials', () => {
  for (const baseUrl of ['http://example.com', 'https://key:secret@example.com', 'file:///tmp/a', 'https://example.com?key=x'])
    assert.throws(() => endpoint({ ...provider, baseUrl }));
  assert.equal(endpoint({ ...provider, baseUrl: 'http://127.0.0.1:1234/v1' }).hostname, '127.0.0.1');
});
test('SSE handles split UTF-8, CRLF, multiline data and final frame', async () => {
  const bytes = new TextEncoder().encode(': ping\r\ndata: héllo\r\ndata: world\r\n\r\ndata: final');
  const body = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const events = []; for await (const event of sse(body)) events.push(event);
  assert.deepEqual(events, ['héllo\nworld', 'final']);
});
test('all three protocols stream text using mocked transport', async () => {
  const savedFetch = global.fetch;
  try {
    for (const kind of ['openai-compatible', 'anthropic', 'gemini']) {
      let captured;
      global.fetch = async (url, options) => {
        captured = { url, ...options };
        const event = kind === 'anthropic' ? { delta: { text: 'hello' } } : kind === 'gemini' ? { candidates: [{ content: { parts: [{ text: 'hello' }] } }] } : { choices: [{ delta: { content: 'hello' } }] };
        return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
      };
      let output = '';
      await streamChat({ ...provider, kind }, 'test-secret', { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 256 }, text => output += text);
      assert.equal(output, 'hello'); assert.equal(captured.redirect, 'error');
      assert.ok(!captured.url.includes('test-secret'));
    }
  } finally { global.fetch = savedFetch; }
});
test('provider HTTP errors never disclose raw response bodies or keys', async () => {
  const savedFetch = global.fetch;
  global.fetch = async () => new Response('test-secret', { status: 401 });
  try { await assert.rejects(streamChat(provider, 'test-secret', { model: 'x', messages: [] }, () => {}), error => error.message.includes('401') && !error.message.includes('test-secret')); }
  finally { global.fetch = savedFetch; }
});
test('project rejects traversal, sensitive paths and junctions; writes ordinary files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-project-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-outside-'));
  try {
    const project = new Project(); await project.choose(dir);
    await assert.rejects(project.read('../secret.txt'));
    await assert.rejects(project.write('.env', 'secret'));
    await assert.rejects(project.write('file.txt:stream', 'x'));
    fs.symlinkSync(outside, path.join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(project.write('linked/escape.txt', 'x'));
    await project.write('src/hello.ts', 'export const hello = 1;');
    assert.match(await project.read('src/hello.ts'), /hello/);
    assert.equal((await project.search('hello'))[0].line, 1);
    assert.deepEqual(await project.list(), ['src/hello.ts']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});
test('knowledge ingestion chunks text and retrieval returns matching sources only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-knowledge-'));
  try {
    const file = path.join(dir, 'guide.md'); fs.writeFileSync(file, 'Electron desktop application security. '.repeat(100));
    const result = await ingest(file); assert.ok(result.chunks.length > 1);
    assert.equal(search(result.chunks, 'electron')[0].docName, 'guide.md');
    assert.deepEqual(search(result.chunks, 'bananas'), []);
    assert.deepEqual(search(result.chunks, ''), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('JSON store serializes concurrent writes and reloads final value', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-store-'));
  try {
    const store = new JsonStore(dir);
    await Promise.all(Array.from({ length: 30 }, (_, value) => store.save('test.json', { value })));
    await store.flushAll();
    assert.deepEqual(new JsonStore(dir).loadSync('test.json', {}), { value: 29 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
