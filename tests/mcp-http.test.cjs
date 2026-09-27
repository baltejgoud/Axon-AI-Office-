// Streamable HTTP: sessions, paged tool lists, streamed replies, a lost session, a lost sign-in; and the manager's status.
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { McpClient, NeedsSignInError } = require('../src/main/mcp/client-manager.ts');

/** A local MCP endpoint; `handle(req, res, msg)` answers, `seen` records every request. */
function mockServer(t, handle) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = body ? JSON.parse(body) : null;
      seen.push({ method: req.method, headers: req.headers, msg });
      handle(req, res, msg);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    t.after(() => { server.closeAllConnections(); server.close(); });
    resolve({ url: `http://127.0.0.1:${server.address().port}/mcp`, seen });
  }));
}
const json = (res, body, headers = {}) => { res.writeHead(200, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const sse = (res, ...messages) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const m of messages) res.write(`event: message\ndata: ${JSON.stringify(m)}\n\n`);
  res.end();
};
const result = (msg, value) => ({ jsonrpc: '2.0', id: msg.id, result: value });
const accepted = (res) => { res.writeHead(202); res.end(); };

test('Streamable HTTP: session, paged tools with annotations, streamed replies, and a DELETE at the end', async (t) => {
  const { url, seen } = await mockServer(t, (req, res, msg) => {
    if (req.method === 'DELETE') return accepted(res);
    if (msg.method === 'initialize') return json(res, result(msg, { protocolVersion: '2025-03-26', capabilities: { tools: {} } }), { 'Mcp-Session-Id': 'sess-1' });
    if (msg.id === undefined) return accepted(res);
    if (msg.method === 'tools/list' && !msg.params?.cursor)
      return sse(res, result(msg, { tools: [{ name: 'lookup', annotations: { readOnlyHint: true } }], nextCursor: 'p2' }));
    if (msg.method === 'tools/list') return json(res, result(msg, { tools: [{ name: 'create_note' }] }));
    if (msg.method === 'tools/call')
      return sse(res, { jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } }, result(msg, { content: [{ type: 'text', text: 'found it' }] }));
  });
  const client = new McpClient({ id: 'h', name: 'Notes', transport: 'http', url, enabled: true });
  const tools = await client.connect();
  assert.deepEqual(tools.map((tool) => tool.name), ['lookup', 'create_note']);
  assert.deepEqual(tools[0].annotations, { readOnlyHint: true });
  assert.equal(client.status, 'connected');
  assert.equal((await client.callTool('lookup', { q: 'x' })).content, 'found it');
  const posts = seen.filter((s) => s.method === 'POST');
  assert.equal(posts[0].msg.params.protocolVersion, '2025-06-18');
  assert.equal(posts[0].headers['mcp-session-id'], undefined);
  for (const later of posts.slice(1)) {
    assert.equal(later.headers['mcp-session-id'], 'sess-1');
    assert.equal(later.headers['mcp-protocol-version'], '2025-03-26');
    assert.match(later.headers.accept, /application\/json/);
    assert.match(later.headers.accept, /text\/event-stream/);
  }
  client.disconnect();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.find((s) => s.method === 'DELETE').headers['mcp-session-id'], 'sess-1');
});

test('Streamable HTTP: a lost session is started again once and the request retried', async (t) => {
  let sessions = 0, lostOnce = false;
  const { url } = await mockServer(t, (req, res, msg) => {
    if (req.method === 'DELETE') return accepted(res);
    if (msg.method === 'initialize') { sessions++; return json(res, result(msg, { protocolVersion: '2025-06-18' }), { 'Mcp-Session-Id': `s${sessions}` }); }
    if (msg.id === undefined) return accepted(res);
    if (msg.method === 'tools/list') return json(res, result(msg, { tools: [{ name: 'ping' }] }));
    if (!lostOnce) { lostOnce = true; res.writeHead(404); return res.end(); }
    return json(res, result(msg, { content: [{ type: 'text', text: `pong from ${req.headers['mcp-session-id']}` }] }));
  });
  const client = new McpClient({ id: 'h', name: 'Ping', transport: 'http', url, enabled: true });
  t.after(() => client.disconnect());
  await client.connect();
  assert.equal((await client.callTool('ping', {})).content, 'pong from s2');
  assert.equal(sessions, 2);
});

test('Streamable HTTP: a 401 refreshes once; with no fresh token the server needs a sign-in', async (t) => {
  const { url } = await mockServer(t, (req, res, msg) => {
    if (req.method === 'DELETE') return accepted(res);
    if (req.headers.authorization !== 'Bearer fresh') { res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }); return res.end(); }
    if (msg.method === 'initialize') return json(res, result(msg, { protocolVersion: '2025-06-18' }));
    if (msg.id === undefined) return accepted(res);
    return json(res, result(msg, { tools: [] }));
  });
  let refreshes = 0;
  const client = new McpClient({ id: 'a', name: 'Notes', transport: 'http', url, enabled: true },
    { token: async () => 'stale', refresh: async () => { refreshes++; return 'fresh'; } });
  await client.connect();
  assert.equal(client.status, 'connected');
  assert.ok(refreshes >= 1);
  client.disconnect();
  const lost = new McpClient({ id: 'b', name: 'Notes', transport: 'http', url, enabled: true },
    { token: async () => 'stale', refresh: async () => null });
  await assert.rejects(lost.connect(), (err) => err instanceof NeedsSignInError);
  assert.equal(lost.status, 'needs-sign-in');
});

test('a failed connection keeps its error status and message', async () => {
  const client = new McpClient({ id: 'x', name: 'Broken', transport: 'stdio', command: process.execPath, args: ['-e', 'process.exit(3)'], enabled: true });
  await assert.rejects(client.connect());
  assert.equal(client.status, 'error');
  assert.match(client.errorMessage, /exited with code 3/);
});
