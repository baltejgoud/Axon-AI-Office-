// The coworker directory shared by both processes, and coworkers asking each other for help.
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false }, dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
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
const shared = require('../src/shared/coworkers.ts');
const agents = require('../src/renderer/src/features/office/data/officeAgents.ts');

test('the shared directory holds the whole office, core team first', () => {
  assert.equal(shared.COWORKERS.length, 207);
  assert.deepEqual(
    shared.COWORKERS.slice(0, 8).map((c) => c.core),
    Array(8).fill(true)
  );
  assert.deepEqual(
    shared.COWORKERS.map((c) => c.id),
    agents.OFFICE_AGENTS.map((a) => a.id)
  );
  const backend = shared.coworkerById('backend-developer');
  assert.match(backend.systemPrompt, /Backend Developer/);
  assert.deepEqual(backend.roleIds, ['backend-developer']);
  assert.equal(shared.coworkerById('nobody'), undefined);
  assert.equal(shared.SPECIALIST_GROUPS.length, 22);
  // The office shows exactly what the directory says.
  for (const a of agents.OFFICE_AGENTS) {
    const c = shared.coworkerById(a.id);
    assert.equal(a.systemPrompt, c.systemPrompt, a.id);
    assert.equal(a.department, c.department, a.id);
  }
});

const colleagues = require('../src/main/colleagues.ts');
const office = require('../src/main/officeTools.ts');

test('colleagues resolve by name, id or specialty, and ambiguity is explained', () => {
  assert.equal(colleagues.resolveColleague('Backend Developer', 'frontend-developer').coworker.id, 'backend-developer');
  assert.equal(colleagues.resolveColleague('backend-developer', 'frontend-developer').coworker.id, 'backend-developer');
  assert.equal(colleagues.resolveColleague('Site Reliability Engineer', 'x').coworker.name, 'Site Reliability Engineer (SRE)');
  assert.equal(colleagues.resolveColleague('SRE', 'x').coworker.name, 'Site Reliability Engineer (SRE)');
  assert.match(colleagues.resolveColleague('engineer', 'x').error, /No single colleague matches "engineer"\. Closest: .+, .+/);
  assert.match(colleagues.resolveColleague('Frontend Developer', 'frontend-developer').error, /someone other than yourself/);
  assert.match(colleagues.ASK_COLLEAGUE.description, /Backend & APIs/);
});

test('toolsFor: coworkers can always ask a colleague; file tools still need a folder', () => {
  const registry = [{ name: 'read_file' }, { name: 'dispatch_subagent' }, { name: 'write_file' }];
  const names = (tools) => tools.map((tool) => tool.name).sort();
  assert.deepEqual(names(office.toolsFor({ agentId: 'frontend-developer', hasFolder: false, registry })), ['ask_colleague']);
  assert.deepEqual(names(office.toolsFor({ agentId: undefined, hasFolder: false, registry })), []);
  assert.deepEqual(names(office.toolsFor({ agentId: undefined, hasFolder: true, registry })), [
    'dispatch_subagent',
    'read_file',
    'write_file'
  ]);
  assert.deepEqual(names(office.toolsFor({ agentId: 'frontend-developer', hasFolder: true, registry })), [
    'ask_colleague',
    'read_file',
    'write_file'
  ]);
});

test('a consult speaks as the colleague and cannot ask further', async () => {
  const backend = shared.coworkerById('backend-developer');
  let seen;
  const answer = await colleagues.consult(
    { id: 'p', kind: 'openai-compatible' },
    null,
    'm',
    backend,
    'Frontend Developer',
    'Which status code for a conflict?',
    {
      stream: async (_p, _k, req, onChunk) => {
        seen = req;
        onChunk('409 Conflict.');
        return { toolCalls: [] };
      },
      tools: [],
      execute: async () => ''
    }
  );
  assert.equal(answer, '409 Conflict.');
  assert.match(seen.system, /Backend Developer/);
  assert.match(seen.system, /Frontend Developer is asking you a question/);
  assert.match(seen.system, /<roles>/, 'the colleague brings their role profile');
  assert.equal(seen.tools, undefined);
  assert.equal(seen.messages[0].content, 'Which status code for a conflict?');
});

test('a consult may read files when given read-only tools, and nothing else', async () => {
  const backend = shared.coworkerById('backend-developer');
  let step = 0;
  const ran = [];
  const answer = await colleagues.consult({ id: 'p', kind: 'openai-compatible' }, null, 'm', backend, 'Writer', 'Check the schema', {
    stream: async (_p, _k, req, onChunk) => {
      step++;
      if (step === 1)
        return {
          toolCalls: [
            { id: '1', name: 'read_file', arguments: '{"path":"schema.sql"}' },
            { id: '2', name: 'ask_colleague', arguments: '{}' }
          ]
        };
      const results = req.messages.filter((m) => m.role === 'tool').map((m) => m.content);
      onChunk(results.join(' | '));
      return { toolCalls: [] };
    },
    tools: [{ name: 'read_file', description: '', parameters: {} }],
    execute: async (name, args) => {
      ran.push([name, args.path]);
      return 'CREATE TABLE users';
    }
  });
  assert.deepEqual(ran, [['read_file', 'schema.sql']]);
  assert.equal(answer, 'CREATE TABLE users | Not available to you here.');
});
