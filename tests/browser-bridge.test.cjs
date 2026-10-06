const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText, file);
const { startBrowserBridge } = require('../src/main/browserBridge.ts');
const { browserBridgePlugin } = require('../scripts/browserBridgePlugin.ts');

test('bridge rejects unauthenticated and unknown calls; authenticated calls reach the service', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-bridge-test-'));
  const descriptor = path.join(directory, 'session.json');
  const calls = [];
  const bridge = await startBrowserBridge((method, args) => { calls.push({ method, args }); return 'ok'; }, ['snapshot'], descriptor);
  try {
    const { port, token } = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    const url = `http://127.0.0.1:${port}/invoke`;
    const send = (method, authorized) => fetch(url, {
      method: 'POST', headers: authorized ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ method, args: [] })
    });
    assert.equal((await send('snapshot', false)).status, 403);
    assert.equal((await send('constructor', true)).status, 400);
    const result = await send('snapshot', true);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { result: 'ok' });
    assert.deepEqual(calls, [{ method: 'snapshot', args: [] }]);
    await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ method: 'snapshot', args: [{ __axonUndefined: true }, null] }) });
    assert.deepEqual(calls[1].args, [undefined, null]);
  } finally {
    bridge.close();
    assert.equal(fs.existsSync(descriptor), false);
    fs.rmdirSync(directory);
  }
});

test('Vite bridge rejects remote clients, foreign origins and DNS-rebinding hosts', () => {
  let handler;
  browserBridgePlugin().configureServer({ middlewares: { use: (_path, middleware) => { handler = middleware; } } });
  for (const req of [
    { socket: { remoteAddress: '192.168.1.5' }, headers: { host: 'localhost:5173' } },
    { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'evil.example:5173' } },
    { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5173', origin: 'https://evil.example' } },
    { socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5173', 'sec-fetch-site': 'cross-site' } }
  ]) {
    let status;
    handler(req, { writeHead(value) { status = value; return this; }, end() {} });
    assert.equal(status, 403);
  }
});
