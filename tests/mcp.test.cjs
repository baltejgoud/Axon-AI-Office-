const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
Module._load = function(name, ...args) {
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
const { ToolRegistry } = require('../src/main/tools/registry.ts');
const { McpClient, MCPClientManager } = require('../src/main/mcp/client-manager.ts');

test('MCPClient connects via stdio and executes tools', async () => {
  // A tiny Node script that acts as a standard JSON-RPC 2.0 MCP server
  const serverScript = `
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', line => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'test-mcp', version: '1.0.0' } }
          }) + '\\n');
        } else if (msg.method === 'notifications/initialized') {
          // ack
        } else if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              tools: [
                { name: 'echo', description: 'Echo test input', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }
              ]
            }
          }) + '\\n');
        } else if (msg.method === 'tools/call') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: [{ type: 'text', text: 'Echo: ' + (msg.params?.arguments?.text || '') }]
            }
          }) + '\\n');
        }
      } catch (e) {}
    });
  `;

  const client = new McpClient({
    id: 'test-server',
    name: 'test-server',
    transport: 'stdio',
    command: process.execPath,
    args: ['-e', serverScript],
    enabled: true
  });

  try {
    const tools = await client.connect();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'echo');
    assert.equal(client.status, 'connected');

    const result = await client.callTool('echo', { text: 'Hello Axon' });
    assert.equal(result.isError, false);
    assert.equal(result.content, 'Echo: Hello Axon');
  } finally {
    client.disconnect();
  }
});

test('MCPClientManager registers discovered tools into ToolRegistry', async () => {
  const serverScript = `
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', line => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'calc-mcp', version: '1.0.0' } }
          }) + '\\n');
        } else if (msg.method === 'notifications/initialized') {
          // ack
        } else if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              tools: [
                { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object' } }
              ]
            }
          }) + '\\n');
        } else if (msg.method === 'tools/call') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { content: [{ type: 'text', text: '42' }] }
          }) + '\\n');
        }
      } catch (e) {}
    });
  `;

  const registry = new ToolRegistry();
  const manager = new MCPClientManager(registry);

  try {
    await manager.syncServers([
      {
        id: 'calc-srv',
        name: 'Calculator',
        transport: 'stdio',
        command: process.execPath,
        args: ['-e', serverScript],
        enabled: true
      }
    ]);

    // Give it a brief moment to finish connecting and registering
    await new Promise(r => setTimeout(r, 400));

    const tool = registry.get('mcp_calculator_add');
    assert.ok(tool, 'Tool mcp_calculator_add should be registered');
    assert.ok(tool.definition.description.includes('Calculator'));

    const res = await tool.execute({ a: 20, b: 22 }, { project: {}, allowShell: false });
    assert.equal(res.content, '42');
  } finally {
    manager.stopAll();
  }
});

test('MCPClient sends Bearer auth and custom headers for SSE transport', async () => {
  const http = require('node:http');
  const recordedHeaders = [];
  const server = http.createServer((req, res) => {
    recordedHeaders.push(req.headers);
    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write('event: endpoint\ndata: /messages\n\n');
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const json = JSON.parse(body);
        if (json.method === 'initialize') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'sse-test', version: '1.0' } }
          }));
        } else if (json.method === 'notifications/initialized') {
          res.writeHead(200);
          res.end();
        } else if (json.method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: { tools: [{ name: 'ping', description: 'ping' }] }
          }));
        }
      });
    }
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/sse`;

  const client = new McpClient({
    id: 'sse-auth-test',
    name: 'RemoteSse',
    transport: 'sse',
    url,
    apiKey: 'my-secret-token',
    headers: { 'x-custom-header': 'AxonTest' },
    enabled: true
  });

  try {
    const tools = await client.connect();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'ping');

    // Verify GET request received auth and custom headers
    const getReq = recordedHeaders.find(h => h.accept === 'text/event-stream');
    assert.ok(getReq);
    assert.equal(getReq['authorization'], 'Bearer my-secret-token');
    assert.equal(getReq['x-custom-header'], 'AxonTest');

    // Verify POST request received auth and custom headers
    const postReq = recordedHeaders.find(h => h['content-type'] === 'application/json');
    assert.ok(postReq);
    assert.equal(postReq['authorization'], 'Bearer my-secret-token');
    assert.equal(postReq['x-custom-header'], 'AxonTest');
  } finally {
    client.disconnect();
    server.close();
  }
});
