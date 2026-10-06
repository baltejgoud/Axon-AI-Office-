const { app } = require('electron');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-runtime-desktop-'));
app.setPath('userData', profile);
fs.mkdirSync(path.join(profile, 'data', 'db'), { recursive: true });
const root = path.join(profile, 'project');
fs.mkdirSync(root);
fs.writeFileSync(path.join(root, 'a.txt'), 'test project');
const now = Date.now();
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const request = JSON.parse(body);
    const last = request.messages.at(-1);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (last?.role === 'user' && last.content === 'Run the terminal check')
      res.write(
        'data: ' +
          JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'native-command',
                      type: 'function',
                      function: {
                        name: 'run_command',
                        arguments: JSON.stringify({
                          command:
                            process.platform === 'win32'
                              ? 'Write-Output AXON_AGENT_PTY; Get-Location'
                              : 'printf AXON_AGENT_PTY; pwd'
                        })
                      }
                    }
                  ]
                }
              }
            ]
          }) +
          '\n\n'
      );
    else
      res.write(
        'data: ' +
          JSON.stringify({ choices: [{ delta: { content: 'The terminal check passed.' } }] }) +
          '\n\n'
      );
    res.end('data: [DONE]\n\n');
  });
});
const timeout = setTimeout(() => {
  console.error('RUNTIME_DESKTOP_TIMEOUT');
  app.exit(1);
}, 90000);
app.on('web-contents-created', (_, contents) =>
  contents.once('did-finish-load', async () => {
    try {
      const evaluate = (source) =>
        contents.executeJavaScript(source).catch((error) => {
          console.error('RUNTIME_SCRIPT', source.slice(0, 200));
          throw error;
        });
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (source, label) => {
        for (let n = 0; n < 150; n++) {
          if (await evaluate(source)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      await until('!!document.querySelector(".office-activity-panel")', 'office');
      await evaluate(
        `(() => { window.checkWork = window.axon.chatSend('backend-chat', 'Run the terminal check', []); return true; })()`
      );
      await until('window.axon.snapshot().then(s => s.pendingApprovals.length > 0)', 'approval');
      const request = await evaluate('window.axon.snapshot().then(s => s.pendingApprovals[0])');
      await evaluate(`window.axon.toolApprove({requestId:${JSON.stringify(request.id)},approved:true})`);
      await evaluate('window.checkWork');
      const terminals = await evaluate("window.axon.terminalList('backend-chat')");
      assert.ok(
        terminals.some((s) => s.owner === 'agent' && s.output.includes('AXON_AGENT_PTY') && s.exitCode === 0)
      );
      const user = await evaluate("window.axon.terminalOpen('backend-chat')");
      await evaluate(
        `window.axon.terminalWrite(${JSON.stringify(user.id)}, ${JSON.stringify(process.platform === 'win32' ? 'Write-Output AXON_USER_PTY\r' : 'printf AXON_USER_PTY\\n\r')})`
      );
      await until(
        "window.axon.terminalList('backend-chat').then(s => s.some(t => t.output.includes('AXON_USER_PTY')))",
        'interactive input'
      );
      await evaluate(
        `(() => { const input = document.querySelector('[aria-label="Find a coworker"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Backend Developer'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`
      );
      await pause(200);
      await evaluate('document.querySelector(".office-search-results > button").click()');
      await until('!!document.querySelector("#activity-tab-updates")', 'Multi Agents tab');
      await evaluate('document.querySelector("#activity-tab-updates").click()');
      await pause(400);
      assert.ok(
        await evaluate('document.querySelector(".multi-agents").textContent.includes("Backend Developer")')
      );
      fs.writeFileSync(path.resolve('test-results/multi-agents.png'), (await contents.capturePage()).toPNG());
      await evaluate(
        "[...document.querySelectorAll('.multi-agents nav button')].find(b=>b.textContent==='Timeline').click()"
      );
      await pause(400);
      assert.ok(
        await evaluate(
          'document.querySelector(".multi-agents").textContent.includes("Completed a terminal command")'
        )
      );
      fs.writeFileSync(
        path.resolve('test-results/runtime-timeline.png'),
        (await contents.capturePage()).toPNG()
      );
      await evaluate(`document.querySelector('[aria-label="Work surface"]').click()`);
      await pause(300);
      await evaluate(`document.querySelector('#work-tab-terminal').click()`);
      await until('!!document.querySelector(".xterm-screen")', 'xterm screen');
      fs.writeFileSync(
        path.resolve('test-results/live-terminal.png'),
        (await contents.capturePage()).toPNG()
      );
      await evaluate(`window.axon.terminalKill(${JSON.stringify(user.id)})`);
      await until(
        "window.axon.terminalList('backend-chat').then(s => s.every(t => !t.running))",
        'terminal cleanup'
      );
      console.log(
        'RUNTIME_DESKTOP_PASS',
        JSON.stringify({
          nativeAgentPty: true,
          interactiveUserPty: true,
          taskGraph: true,
          auditTimeline: true,
          terminalUI: true,
          cleanup: true
        })
      );
      clearTimeout(timeout);
      server.close();
      app.quit();
    } catch (error) {
      console.error('RUNTIME_DESKTOP_FAIL', error);
      fs.writeFileSync(
        path.resolve('test-results/runtime-failure.png'),
        (await contents.capturePage()).toPNG()
      );
      clearTimeout(timeout);
      server.close();
      app.exit(1);
    }
  })
);
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(
    path.join(profile, 'data/db/platform-v1.json'),
    JSON.stringify({
      version: 1,
      providers: [
        {
          id: 'mock',
          name: 'Local test',
          kind: 'openai-compatible',
          baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
          models: [{ id: 'mock', displayName: 'Test model' }],
          enabled: true,
          hasApiKey: false,
          createdAt: now
        }
      ],
      conversations: [
        {
          id: 'backend-chat',
          title: 'Terminal verification',
          providerId: 'mock',
          modelId: 'mock',
          agentId: 'backend-developer',
          projectRoot: root,
          workspaceId: null,
          skillIds: [],
          roleIds: [],
          createdAt: now,
          updatedAt: now
        }
      ],
      messages: [],
      agents: [],
      workspaces: [],
      documents: [],
      chunks: [],
      tasks: [],
      teams: [],
      reception: { briefedOn: new Date().toLocaleDateString('en-CA') },
      settings: {
        theme: 'dark',
        defaultMaxTokens: 4096,
        defaultTemperature: 0.3,
        autoTitleConversations: false,
        streamDeltas: true,
        allowShellExecution: true,
        shellAllowlist: [],
        sendCrashDiagnostics: false,
        dataDirectoryNote: '',
        keepInTray: false
      }
    })
  );
  require('../out/main/index.js');
});
