const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewCompletion } = require('../src/main/team/completion.ts');
const { TeamRunner } = require('../src/main/team/runner.ts');
const { openMeetings } = require('../src/renderer/src/features/office/team.ts');
const assignment = { title: 'Send outreach', brief: 'Send the approved email to three leads.' };
const model = (reply) => ({ provider: {}, key: null, modelId: 'm', stream: async (_p, _k, _r, chunk) => { chunk(reply); return {}; } });

test('completion review rejects missing deliverables, contradictory and malformed verdicts', async () => {
  assert.equal((await reviewCompletion(assignment, '', '', model('{}'))).complete, false);
  assert.equal((await reviewCompletion(assignment, 'Draft ready', '', model('{"complete":false,"blockers":["No email sent"]}'))).complete, false);
  assert.equal((await reviewCompletion(assignment, 'Sent', '', model('{"complete":true,"blockers":["Missing recipient"]}'))).complete, false);
  assert.equal((await reviewCompletion(assignment, 'Sent', '', model('not JSON'))).complete, false);
  assert.equal((await reviewCompletion(assignment, 'Sent', 'email_send: delivered', model('{"complete":true,"blockers":[]}'))).complete, true);
});

test('only members with unfinished assignments stay, including failed tasks and multiple tasks per owner', () => {
  const team = { id: 't', status: 'working', leadId: 'lead', attendees: ['a', 'b', 'c'], plan: { assignments: [
    { ownerId: 'a', status: 'done' }, { ownerId: 'b', status: 'done' }, { ownerId: 'b', status: 'waiting' }, { ownerId: 'c', status: 'failed' }
  ] } };
  assert.deepEqual(openMeetings([team])[0].attendees, ['b', 'c']);
  assert.deepEqual(openMeetings([{ ...team, status: 'failed' }])[0].attendees, ['b', 'c']);
  assert.deepEqual(openMeetings([{ ...team, status: 'stopped' }]), []);
  assert.deepEqual(openMeetings([{ ...team, status: 'planned' }])[0].attendees, ['a', 'b', 'c']);
});

test('an empty or failed final report keeps the team incomplete; retry writes the report without rerunning completed work', async () => {
  for (const first of ['', new Error('offline')]) {
    const teams = []; let reports = 0; let work = 0;
    const runner = new TeamRunner({ teams: () => teams, id: () => 't', changed() {},
      contribute: async () => 'input', plan: async () => ({ plan: { summary: '', assignments: [{ id: 'a', ownerId: 'a', status: 'waiting', dependsOn: [], files: [] }] } }),
      work: async () => { work++; return { outcome: 'done', answer: 'Delivered' }; }, stopWork() {},
      report: async () => { reports++; if (reports === 1) { if (first instanceof Error) throw first; return first; } return 'Detailed report'; }
    });
    const team = runner.create({ leadId: 'lead', attendees: ['a'], goal: 'g', conversationId: 'c', providerId: 'p', modelId: 'm' });
    await runner.meet(team.id); runner.start(team.id); await runner.idle(team.id);
    assert.equal(team.status, 'failed'); assert.match(team.note, /report/);
    runner.retry(team.id); await runner.idle(team.id);
    assert.equal(team.status, 'done'); assert.equal(work, 1); assert.equal(team.report, 'Detailed report');
  }
});
