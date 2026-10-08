// Settings → Accounts → Claude in the built desktop app: connect with a key that spans workspaces,
// see the account, billing and models, then disconnect. Anthropic's API is mocked inside this
// process: the key is fake, only the free model list is ever requested, and nothing is billed.
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../test-results/claude-account');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-claude-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const KEY = 'sk-ant-api03-desktop-test-not-a-real-key';
const WORKSPACE = 'wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ';
const ORG = '3f2a9c1e-0b7d-4c55-9a1e-6d2f8b4c9e01';
const anthropic = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (!/(^|\.)(anthropic\.com|claude\.ai|claude\.com)$/.test(url.hostname)) return realFetch(input, init);
  const headers = init.headers ?? {};
  anthropic.push({ method: init.method ?? 'GET', url: url.href, workspace: headers['anthropic-workspace-id'] });
  const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_desktop', ...extra } });
  if (url.hostname !== 'api.anthropic.com' || url.pathname !== '/v1/models' || (init.method ?? 'GET') !== 'GET')
    return json({ type: 'error', error: { type: 'not_found_error', message: 'Not mocked' } }, 404);
  if (headers['x-api-key'] !== KEY) return json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
  if (!headers['anthropic-workspace-id'])
    return json({ type: 'error', error: { type: 'invalid_request_error', message: 'anthropic-workspace-id is required when authenticating with an identity-linked API key; send the id of the workspace this request acts in.' } }, 400);
  return json({
    data: [
      { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', max_input_tokens: 1000000, max_tokens: 128000 },
      { type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', max_input_tokens: 1000000, max_tokens: 128000 },
      { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', max_input_tokens: 1000000, max_tokens: 128000 }
    ],
    has_more: false
  }, 200, { 'anthropic-organization-id': ORG, 'anthropic-workspace-id': WORKSPACE });
};

/** Files under the profile that contain the key in plain text. */
function plaintextCopies(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...plaintextCopies(file));
    else {
      // Chromium keeps a few files locked while it runs; they hold no app data.
      try { if (fs.statSync(file).size < 20_000_000 && fs.readFileSync(file).includes(KEY)) found.push(file); } catch { /* Locked. */ }
    }
  }
  return found;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = setTimeout(() => { console.error('CLAUDE_DESKTOP_TIMEOUT'); app.exit(1); }, 120000);
app.on('browser-window-created', (_, win) => {
  win.show = () => { win.setPosition(-2400, 0); win.showInactive(); };
  // A maximized window on a laptop at 125% scaling.
  win.setContentSize(1536, 816); win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message', (_, details) => { if (details.level === 'error') console.error('UI_ERROR', details.message); });
  win.webContents.once('did-finish-load', async () => {
    const run = (code) => win.webContents.executeJavaScript(code);
    const wait = async (code, label) => { for (let i = 0; i < 200; i++) { if (await run(code)) return; await pause(100); } throw new Error('Timed out: ' + label); };
    const click = (selector) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const clickText = (scope, text) => run(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
    const type = (selector, value) => run(`(() => {const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const card = () => run(`document.querySelector('.claude-card').innerText`);
    const snap = async (name) => { await pause(350); fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); };
    const theme = async (name) => {
      await click('#settings-tab-appearance');
      await run(`[...document.querySelectorAll('[aria-label="Theme"] button')].find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`);
      await wait(`document.documentElement.dataset.theme===${JSON.stringify(name.toLowerCase())}`, name + ' theme');
      await click('#settings-tab-accounts'); await wait(`!!document.querySelector('.claude-card')`, 'Claude card');
    };
    try {
      await wait(`!!document.querySelector('[aria-label="Office settings"]') && !document.querySelector('.office-loading')`, 'office ready');
      for (const method of ['claudeConnect', 'claudeCancel', 'claudeRefreshModels', 'claudeDisconnect', 'claudeLimits'])
        assert.equal(await run(`typeof window.axon.${method}`), 'function');
      await click('[aria-label="Office settings"]');
      await wait(`!!document.querySelector('.settings')`, 'settings');
      await theme('Light');

      // Not connected: says plainly that this is API access, and why there is no Claude sign-in.
      let text = await card();
      assert.match(text, /doesn.t let third-party apps sign in to Claude accounts/);
      assert.match(text, /billed to that Console organization, separately from any Claude subscription/);
      assert.match(text, /Why not Claude sign-in\?/);
      assert.doesNotMatch(text, /Sign in with Claude|Continue with Claude/);
      await snap('claude-card-light');

      // Connect: the key spans workspaces, so the dialog asks for one.
      await clickText('.claude-card', 'Connect Claude API key');
      await wait(`!!document.querySelector('.overlay input[type=password]')`, 'key dialog');
      assert.match(await run(`document.querySelector('.overlay').innerText`), /no message is sent/);
      assert.match(await run(`document.querySelector('.claude-billing-note').innerText`), /don.t use your Claude Pro, Max or Team usage limits/);
      await type('.overlay input[type=password]', KEY);
      await click('.overlay button[type=submit]');
      await wait(`!!document.querySelector('.overlay input[placeholder^="wrkspc_"]') && /more than one workspace/.test(document.querySelector('.overlay .claude-workspace-note')?.innerText ?? '')`, 'workspace request');
      assert.equal(await run(`document.querySelector('.overlay [role=alert]')`), null, 'a workspace question is not an error');
      await snap('claude-workspace-light');
      await type('.overlay input[placeholder^="wrkspc_"]', WORKSPACE);
      await click('.overlay button[type=submit]');
      await wait(`!document.querySelector('.overlay') && document.querySelector('.claude-card .badge')?.textContent==='Connected'`, 'connected');

      text = await card();
      assert.match(text, /Console organization 3f2a9c1e…/);
      assert.match(text, /Workspace wrkspc_01JwQv/);
      assert.match(text, /API usage, billed to this organization/);
      assert.match(text, /monthly API credits go first; Claude plan usage limits aren't used/);
      assert.match(text, /3 available · checked just now/);
      assert.match(text, /Claude connected · 3 models/);
      assert.deepEqual(plaintextCopies(profile), [], 'the key is only stored encrypted');
      await snap('claude-connected-light');

      // Prices & budgets: the model table only; the key and endpoint stay with the card.
      await clickText('.claude-card', 'Prices & budgets');
      await wait(`!!document.querySelector('.overlay .model-tokens')`, 'model details dialog');
      assert.match(await run(`document.querySelector('.overlay').innerText`), /managed in Settings → Accounts → Claude/);
      assert.equal(await run(`document.querySelector('.overlay input[type=password]').offsetParent`), null, 'no key field');
      assert.equal(await run(`document.querySelector('.overlay .preset-grid').offsetParent`), null, 'no service picker');
      await snap('claude-prices-light');
      await click('.overlay [aria-label="Close"]');
      await wait(`!document.querySelector('.overlay')`, 'dialog closed');

      await theme('Dark');
      await snap('claude-connected-dark');

      // Models & API keys lists it as an API key connection managed from Accounts.
      await click('#settings-tab-models'); await pause(200);
      const row = await run(`[...document.querySelectorAll('.settings-item')].find(r=>r.querySelector('.settings-item-title')?.textContent.startsWith('Claude'))?.innerText ?? ''`);
      assert.match(row, /Claude Console API/);
      assert.match(row, /Console organization 3f2a9c1e…/);
      assert.match(row, /claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5/);
      assert.match(row, /Account/);
      await snap('claude-models-dark');

      // Disconnect: Axon forgets the key and says where to revoke it.
      await click('#settings-tab-accounts'); await wait(`!!document.querySelector('.claude-card')`, 'Claude card');
      await clickText('.claude-card', 'Disconnect');
      await wait(`document.querySelector('.claude-card .badge')?.textContent==='API key'`, 'disconnected');
      assert.match(await card(), /Disconnected\. Axon deleted its copy of the key; the key itself works until you disable or delete it in Claude Console\./);
      await snap('claude-disconnected-dark');
      await theme('Light');

      // Only the free model list was requested: no message, no OAuth, nothing billed.
      assert.ok(anthropic.length >= 2);
      for (const request of anthropic) {
        assert.equal(request.method, 'GET');
        assert.match(request.url, /^https:\/\/api\.anthropic\.com\/v1\/models\?limit=1000$/);
      }
      assert.equal(anthropic.at(-1).workspace, WORKSPACE);
      console.log(`CLAUDE_DESKTOP_PASS: ${anthropic.length} mocked model-list requests, connect with workspace, identity, billing, models, disconnect, both themes`);
      clearTimeout(timeout); app.exit(0);
    } catch (err) {
      console.error('CLAUDE_DESKTOP_FAIL', err);
      console.error(await run(`document.body.innerText.slice(-2500)`).catch(() => ''));
      await snap('failure'); clearTimeout(timeout); app.exit(1);
    }
  });
});
app.whenReady().then(() => require('../out/main/index.js'));
