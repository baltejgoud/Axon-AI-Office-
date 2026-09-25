// MCP servers keep their credentials in the OS vault, start by bare command names on Windows, and name tools providers accept.
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
const { ToolRegistry } = require('../src/main/tools/registry.ts');
const { McpClient, MCPClientManager, resolveCommand, mcpToolName } = require('../src/main/mcp/client-manager.ts');

function makeService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-mcp-'));
  fs.mkdirSync(path.join(dir, 'db'));
  fs.mkdirSync(path.join(dir, 'backups'));
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const secrets = new Map();
  const vault = { has: (id) => secrets.has(id), get: (id) => secrets.get(id) ?? null, set: (id, v) => (v ? secrets.set(id, v) : secrets.delete(id)), remove: (id) => secrets.delete(id) };
  const service = new Service(repo, vault, dir, () => {}, 'worker');
  const synced = [];
  service.mcp.syncServers = async (configs) => { synced.push(configs); };
  return { dir, repo, service, secrets, synced };
}

const server = { id: 's1', name: 'Remote', transport: 'sse', url: 'https://mcp.example/sse', headers: { 'X-Team': 'blue' }, apiKey: 'mcp-secret', enabled: true };

test('an MCP server\'s API key goes to the vault and its headers are kept', async (t) => {
  const { dir, repo, service, secrets, synced } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await service.mcpServerSave(server);
  assert.equal(secrets.get('mcp:s1'), 'mcp-secret');
  const saved = repo.state.mcpServers[0];
  assert.deepEqual(saved.headers, { 'X-Team': 'blue' });
  assert.equal('apiKey' in saved, false);
  assert.ok(!fs.readFileSync(path.join(dir, 'db', 'platform-v1.json'), 'utf8').includes('mcp-secret'));
  const shown = service.snapshot().mcpServers[0];
  assert.equal(shown.hasApiKey, true);
  assert.equal(shown.apiKey, undefined);
  // The connection itself gets the key.
  assert.equal(synced.at(-1)[0].apiKey, 'mcp-secret');
});

test('saving an MCP server without a new key keeps the old one; deleting it removes the key', async (t) => {
  const { dir, service, secrets } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await service.mcpServerSave(server);
  await service.mcpServerSave({ ...server, apiKey: undefined, name: 'Remote 2' });
  assert.equal(secrets.get('mcp:s1'), 'mcp-secret');
  await service.mcpServerDelete('s1');
  assert.equal(secrets.has('mcp:s1'), false);
});

test('SSE notifications carry the same auth as requests', async (t) => {
  const saved = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => { seen.push(options.headers); return new Response(''); };
  t.after(() => { global.fetch = saved; });
  const client = new McpClient({ ...server });
  client.sseEndpointUrl = 'https://mcp.example/messages';
  client.notify('notifications/initialized', {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(seen[0].Authorization, 'Bearer mcp-secret');
  assert.equal(seen[0]['X-Team'], 'blue');
});

test('on Windows a bare command like npx resolves to its .cmd on PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-path-'));
  try {
    fs.writeFileSync(path.join(dir, 'fake-mcp.cmd'), '@echo off');
    assert.equal(resolveCommand('fake-mcp', { PATH: dir, PATHEXT: '.EXE;.CMD' }, 'win32').toLowerCase(), path.join(dir, 'fake-mcp.cmd').toLowerCase());
    assert.equal(resolveCommand('fake-mcp', { PATH: dir }, 'linux'), 'fake-mcp');
    assert.equal(resolveCommand('C:\\tools\\x.exe', { PATH: dir }, 'win32'), 'C:\\tools\\x.exe');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a stdio server started through a .cmd shim by bare name connects', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-shim-'));
  const script = path.join(dir, 'server.js');
  fs.writeFileSync(script, `
    const rl = require('readline').createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\\n');
      if (msg.method === 'tools/list') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'ping' }] } }) + '\\n');
    });`);
  fs.writeFileSync(path.join(dir, 'shim-mcp.cmd'), `@"${process.execPath}" "%~dp0server.js" %*\r\n`);
  const client = new McpClient({ id: 'x', name: 'shim', transport: 'stdio', command: 'shim-mcp', args: ['--flag with space'], env: { PATH: `${dir};${process.env.PATH}` }, enabled: true });
  try {
    const tools = await client.connect();
    assert.deepEqual(tools.map((tool) => tool.name), ['ping']);
  } finally {
    client.disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MCP tool names stay within 64 characters and never collide', () => {
  const long = mcpToolName('My Extremely Long Integration Server Name', 'list_all_pull_request_review_comments_for_repository', new Set());
  assert.ok(long.length <= 64, long);
  assert.match(long, /^[a-z0-9_]+$/);
  const taken = new Set(['mcp_a_b_c']);
  const next = mcpToolName('a', 'b c', taken);
  assert.notEqual(next, 'mcp_a_b_c');
});

test('removing one server leaves another server\'s tools alone, even with a shared name prefix', () => {
  const registry = new ToolRegistry();
  const manager = new MCPClientManager(registry);
  const a = { config: { id: 'a', name: 'git' } };
  const b = { config: { id: 'b', name: 'git hub' } };
  manager.registerTools(a, [{ name: 'status' }]);
  manager.registerTools(b, [{ name: 'issues' }]);
  manager.unregisterTools(a);
  assert.equal(registry.get('mcp_git_status'), undefined);
  assert.ok(registry.get('mcp_git_hub_issues'));
});
