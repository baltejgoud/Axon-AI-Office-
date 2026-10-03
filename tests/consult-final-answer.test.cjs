// A consult must end with an answer, not with the narration of what the colleague was reading.
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
const colleagues = require('../src/main/colleagues.ts');

const backend = shared.coworkerById('backend-developer');
const PROVIDER = { id: 'p', kind: 'openai-compatible' };
const READ = { name: 'read_file', description: '', parameters: {} };

/** Runs a consult against a scripted stream; `deps` supplies the stream and anything else. */
const consult = (deps) =>
  colleagues.consult(PROVIDER, null, 'm', backend, 'Frontend Developer', 'Which status code for a conflict?', {
    tools: [READ],
    execute: async () => 'file contents',
    ...deps
  });

test('a colleague that answers on the first turn answers once', async () => {
  const seen = [];
  const answer = await consult({
    stream: async (_p, _k, req, onChunk) => {
      seen.push(req);
      onChunk('409 Conflict.');
      return { toolCalls: [] };
    }
  });
  assert.equal(answer, '409 Conflict.');
  assert.equal(seen.length, 1, 'one turn is enough when they answer');
});

test('a tool call then an answer returns the answer, not the pre-tool narration', async () => {
  let step = 0;
  const answer = await consult({
    stream: async (_p, _k, req, onChunk) => {
      step++;
      if (step === 1) {
        onChunk('I will start by reading the router.');
        return { toolCalls: [{ id: '1', name: 'read_file', arguments: '{"path":"router.ts"}' }] };
      }
      onChunk('409 Conflict.');
      return { toolCalls: [] };
    }
  });
  assert.equal(answer, '409 Conflict.', 'only the final turn is the answer');
  assert.doesNotMatch(answer, /I will start by reading/);
});

test('five steps of tools still end in an answer, asked for without tools', async () => {
  const requests = [];
  const ran = [];
  const answer = await consult({
    stream: async (_p, _k, req, onChunk) => {
      requests.push({ last: req.messages.at(-1), tools: req.tools });
      onChunk(`Looking at file ${requests.length}.`);
      return { toolCalls: [{ id: `c${requests.length}`, name: 'read_file', arguments: `{"path":"f${requests.length}.ts"}` }] };
    },
    execute: async (name, args) => {
      ran.push(args.path);
      return 'contents';
    }
  });
  assert.equal(requests.length, 6, 'five steps, then one to answer');
  const last = requests[5];
  assert.equal(last.tools, undefined, 'the answer turn is offered no tools');
  assert.equal(last.last.role, 'user');
  assert.match(last.last.content, /Answer now/);
  assert.deepEqual(ran, ['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts'], 'the last step asks instead of reading');
});

test('the answer forced out of a tool-only colleague is what the asker gets', async () => {
  let call = 0;
  const answer = await consult({
    stream: async (_p, _k, req, onChunk) => {
      call++;
      if (call <= 5) {
        onChunk('Still reading.');
        return { toolCalls: [{ id: `c${call}`, name: 'read_file', arguments: '{}' }] };
      }
      onChunk('409 Conflict. shellAllowlist is enforced at run_command.');
      return { toolCalls: [] };
    }
  });
  assert.equal(answer, '409 Conflict. shellAllowlist is enforced at run_command.');
  assert.doesNotMatch(answer, /Still reading/, 'no narration from the earlier steps');
});

test('a colleague that says nothing at all returns (no answer)', async () => {
  const answer = await consult({ stream: async () => ({ toolCalls: [] }) });
  assert.equal(answer, '(no answer)');
});

test('tools every turn and silence in the forced turn still returns (no answer)', async () => {
  const answer = await consult({
    stream: async (_p, _k, req) => {
      const asked = req.messages.some((m) => m.role === 'user' && /Answer now/.test(m.content));
      if (asked) return { toolCalls: [] };
      return { toolCalls: [{ id: `c${req.messages.length}`, name: 'read_file', arguments: '{}' }] };
    }
  });
  assert.equal(answer, '(no answer)');
});