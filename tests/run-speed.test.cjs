// Quick answers: house rules, the project map only for builders, quick replies, capped tool output,
// repeated lookups answered without running, and a Chief of Staff who delegates instead of building.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
const electron = {
  app: { isPackaged: false, relaunch() {}, quit() {} },
  dialog: {},
  utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) }
};
Module._load = function (name, ...args) {
  if (name === 'electron') return electron;
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        resolveJsonModule: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RepeatGuard, TOOL_RESULT_LIMIT, capToolResult } = require('../src/main/runGuards.ts');
const { buildsSoftware } = require('../src/shared/coworkers.ts');
const { HOUSE_RULES } = require('../src/main/prompt.ts');
const providers = require('../src/main/providers.ts');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');

test('a tool result past the limit keeps its start and says what was cut', () => {
  assert.equal(capToolResult('short'), 'short');
  const huge = 'x'.repeat(TOOL_RESULT_LIMIT + 2_067_152);
  const capped = capToolResult(huge);
  assert.ok(capped.length < TOOL_RESULT_LIMIT + 300);
  assert.ok(capped.startsWith('x'.repeat(TOOL_RESULT_LIMIT)));
  assert.match(capped, /2,067,152 more characters cut/);
});

test('a lookup already made in a run is recognised, whatever the key order; actions never are', () => {
  const guard = new RepeatGuard();
  assert.equal(guard.repeat('search_code', { query: 'marketing' }), null);
  guard.remember('search_code', { query: 'marketing' });
  assert.match(
    guard.repeat('search_code', { query: ' marketing ' }),
    /Already done in this task: search_code/
  );
  guard.remember('read_file', { path: 'a.ts', start: 1 });
  assert.ok(guard.repeat('read_file', { start: 1, path: 'a.ts' }));
  assert.equal(guard.repeat('read_file', { path: 'b.ts' }), null);
  guard.remember('run_command', { command: 'npm test' });
  assert.equal(
    guard.repeat('run_command', { command: 'npm test' }),
    null,
    'running tests again is real work'
  );
  guard.remember('find_people', { need: 'leads' });
  assert.ok(guard.repeat('find_people', { need: 'leads' }));
});

test('the project map goes to those who build software, and to your own chats', () => {
  assert.equal(buildsSoftware(undefined), true);
  assert.equal(buildsSoftware('backend-developer'), true);
  assert.equal(buildsSoftware('files-agent'), true);
  assert.equal(buildsSoftware('chief-of-staff'), false);
  assert.equal(buildsSoftware('marketing-strategist'), false);
  assert.equal(buildsSoftware('social-media-manager'), false);
});

/** Replaces fetch for one test; returns the parsed request bodies it saw. */
function mockFetch(t, respond) {
  const saved = global.fetch;
  const bodies = [];
  global.fetch = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return respond(bodies.length, url, options);
  };
  t.after(() => {
    global.fetch = saved;
  });
  return bodies;
}
const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
const hi = [{ role: 'user', content: 'Hi' }];

test('quick replies ask OpenRouter to skip thinking; a model that must think is asked once, then left alone', async (t) => {
  const openrouter = { kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', models: [] };
  const bodies = mockFetch(t, (n, url, options) => {
    const body = JSON.parse(options.body);
    if (body.model === 'stealth/must-think' && body.reasoning)
      return new Response(
        JSON.stringify({
          error: { message: 'Reasoning is mandatory for this endpoint and cannot be disabled.', code: 400 }
        }),
        { status: 400 }
      );
    return new Response(sse);
  });
  await providers.streamChat(
    openrouter,
    'k',
    { model: 'nvidia/nemotron', messages: hi, quick: true },
    () => {}
  );
  assert.deepEqual(bodies[0].reasoning, { enabled: false });
  await providers.streamChat(openrouter, 'k', { model: 'nvidia/nemotron', messages: hi }, () => {});
  assert.equal(bodies[1].reasoning, undefined, 'quick replies off: the model thinks as usual');

  await providers.streamChat(
    openrouter,
    'k',
    { model: 'stealth/must-think', messages: hi, quick: true },
    () => {}
  );
  assert.deepEqual(
    bodies.slice(2).map((b) => b.reasoning),
    [{ enabled: false }, undefined]
  );
  await providers.streamChat(
    openrouter,
    'k',
    { model: 'stealth/must-think', messages: hi, quick: true },
    () => {}
  );
  assert.equal(bodies.length, 5, 'remembered: no refused request the second time');
  assert.equal(bodies[4].reasoning, undefined);

  await providers.streamChat(
    { kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', models: [] },
    'k',
    { model: 'deepseek-flash', messages: hi, quick: true },
    () => {}
  );
  assert.equal(bodies[5].reasoning, undefined, 'only OpenRouter knows this field');
});

const makeService = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-speed-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, () => {}, 'parser-worker-path');
  repo.state.providers.push({
    id: 'p1',
    name: 'Mock',
    kind: 'openai-compatible',
    baseUrl: 'https://example.com/v1',
    models: [{ id: 'm1', displayName: 'm1' }],
    enabled: true,
    createdAt: 0,
    hasApiKey: false
  });
  return { dir, repo, service };
};
const mockModel = (t, respond) => {
  const saved = providers.streamChat;
  t.after(() => {
    providers.streamChat = saved;
  });
  providers.streamChat = respond;
};
const coworkerChat = (service, agentId) =>
  service.chatCreate(
    'p1',
    'm1',
    null,
    agentId,
    { skillIds: [], roleIds: [] },
    null,
    `You are Axon's ${agentId}.`
  );
async function withProject(t, service, dir) {
  const project = path.join(dir, 'project');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'app.ts'), 'export const marketing = 1;\n');
  fs.writeFileSync(path.join(project, 'big.log'), 'line\n'.repeat(20000));
  await service.project.choose(project);
}

test('the Chief of Staff gets the house rules, no project map, read-only files and his team tools; quick replies are on', async (t) => {
  const { dir, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await withProject(t, service, dir);
  const seen = {};
  mockModel(t, async (_p, _k, req, onChunk) => {
    seen.system = req.system;
    seen.tools = (req.tools ?? []).map((tool) => tool.name).sort();
    seen.quick = req.quick;
    onChunk('Done.');
    return { toolCalls: [] };
  });
  const chief = await coworkerChat(service, 'chief-of-staff');
  await service.chatSend(chief.id, 'Get me a team for leads', []);
  assert.ok(seen.system.includes(HOUSE_RULES));
  assert.ok(!seen.system.includes('Project Structure'), 'no map to go exploring');
  assert.deepEqual(seen.tools, [
    'ask_colleague',
    'call_team_meeting',
    'file_context',
    'find_people',
    'get_symbol',
    'list_files',
    'read_attachment',
    'read_file',
    'read_tool_output',
    'retrieve_conversation_turns',
    'search_code',
    'search_conversation_history'
  ]);
  assert.equal(seen.quick, true);

  const builder = await coworkerChat(service, 'backend-developer');
  await service.chatSend(builder.id, 'Add a route', []);
  assert.ok(seen.system.includes('Project Structure'), 'a builder starts with the map');
  assert.ok(seen.tools.includes('write_file') && seen.tools.includes('run_command'));

  await service.settingsSave({ ...service.snapshot().settings, quickReplies: false });
  await service.chatSend(builder.id, 'And a test', []);
  assert.equal(seen.quick, false);
});

test('a run answers a repeated search without running it, and caps a huge result', async (t) => {
  const { dir, repo, service } = makeService();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await withProject(t, service, dir);
  let step = 0;
  const sent = [];
  mockModel(t, async (_p, _k, req, onChunk) => {
    sent.push(req.messages.at(-1));
    step++;
    const call = (id, name, args) => ({ id, name, arguments: JSON.stringify(args) });
    if (step === 1) return { toolCalls: [call('s1', 'search_code', { query: 'marketing' })] };
    if (step === 2)
      return {
        toolCalls: [
          call('s2', 'search_code', { query: 'marketing' }),
          call('r1', 'read_file', { path: 'big.log' })
        ]
      };
    onChunk('Found it in src/app.ts.');
    return { toolCalls: [] };
  });
  let searches = 0;
  const tool = service.tools.get('search_code');
  const realSearch = tool.execute;
  tool.execute = (args, ctx) => {
    searches++;
    return realSearch(args, ctx);
  };
  const chat = await coworkerChat(service, 'backend-developer');
  await service.chatSend(chat.id, 'Where is marketing defined?', []);
  assert.equal(searches, 1, 'the second, identical search did not run');
  const results = repo.state.messages.filter((m) => m.conversationId === chat.id && m.role === 'tool');
  assert.match(results[1].content, /Already done in this task: search_code/);
  assert.equal(results[1].error, undefined);
  assert.ok(results[2].content.length < 4096, 'hot conversation holds a bounded reference');
  assert.ok(service.toolOutputs.read(results[2].toolOutputId).length > 31000, 'full original remains saved locally');
  assert.match(repo.state.messages.find(m => m.toolCalls?.some(t => t.name === 'read_file')).toolCalls.find(t => t.name === 'read_file').result, /read_tool_output/);
});
