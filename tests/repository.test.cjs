// Focused tests for the hardened Repository: quarantine, validation, rolling backups.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Repository } = require('../src/main/repository.ts');

const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-repo-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  return dir;
};
const validState = JSON.stringify({ version: 1, settings: {}, providers: [], conversations: [], messages: [], workspaces: [], agents: [], documents: [], chunks: [] });

test('corrupt saved data is quarantined and replaced with a fresh workspace', () => {
  const dir = temp();
  try {
    fs.writeFileSync(path.join(dir, 'db', 'platform-v1.json'), '{ not json !!!');
    const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
    assert.equal(repo.state.workspaces[0].id, 'code');
    assert.equal(repo.state.providers.length, 0);
    assert.ok(fs.readdirSync(path.join(dir, 'backups')).some(f => f.startsWith('corrupt-')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('parseable but structurally invalid data fails validation and is quarantined', () => {
  const dir = temp();
  try {
    const invalid = JSON.stringify({ version: 1, settings: {}, providers: [{ id: 'a' }, { id: 'a' }], conversations: [], messages: [], workspaces: [], agents: [], documents: [], chunks: [] });
    fs.writeFileSync(path.join(dir, 'db', 'platform-v1.json'), invalid);
    const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
    assert.equal(repo.state.providers.length, 0);
    assert.ok(fs.readdirSync(path.join(dir, 'backups')).some(f => f.startsWith('corrupt-')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('valid data loads as-is and survives a restart', () => {
  const dir = temp();
  try {
    fs.writeFileSync(path.join(dir, 'db', 'platform-v1.json'), validState);
    new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
    const again = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
    assert.equal(again.state.version, 1);
    assert.ok(!fs.readdirSync(path.join(dir, 'backups')).some(f => f.startsWith('corrupt-')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('backups are taken at start-up and then at most every ten minutes, keeping ten', async () => {
  const dir = temp();
  try {
    const backupDir = path.join(dir, 'backups'), dbDir = path.join(dir, 'db');
    for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(backupDir, `state-2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z.json`), 'old');
    fs.writeFileSync(path.join(dbDir, 'platform-v1.json'), validState);
    let now = Date.parse('2026-09-25T10:00:00Z');
    const repo = new Repository(dbDir, backupDir, () => now); // start-up backup -> 13, pruned to 10
    const count = () => fs.readdirSync(backupDir).filter(name => name.startsWith('state-')).length;
    assert.equal(count(), 10);
    await repo.save(); await repo.save(); await repo.save();
    assert.deepEqual(fs.readdirSync(backupDir).filter(name => name.startsWith('state-')).sort().slice(0, 1), ['state-2026-01-01T00-00-03-000Z.json'], 'saves in quick succession add no backups');
    now += 10 * 60_000;
    await repo.save();
    const remaining = fs.readdirSync(backupDir).filter(name => name.startsWith('state-'));
    assert.equal(remaining.length, 10);
    assert.ok(remaining.every(name => name >= 'state-2026-01-01T00-00-04-000Z'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('saved state is written compactly', async () => {
  const dir = temp();
  try {
    const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
    await repo.save();
    assert.ok(!fs.readFileSync(path.join(dir, 'db', 'platform-v1.json'), 'utf8').includes('\n  '));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an unreadable key vault is set aside instead of stopping Axon from starting', () => {
  const dir = temp();
  try {
    const { Vault } = require('../src/main/infra/vault.ts');
    fs.writeFileSync(path.join(dir, 'os-vault.json'), '{ broken');
    const vault = new Vault(dir);
    assert.equal(vault.has('anything'), false);
    assert.ok(fs.readdirSync(dir).some(name => name.startsWith('os-vault.json.corrupt-')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('migrate defaults skillIds/roleIds on old data and validate rejects non-arrays', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-repo-'));
  try {
    const db = path.join(dir, 'db'); fs.mkdirSync(db);
    const now = Date.now();
    const legacy = {
      version: 1, providers: [], messages: [], agents: [{ id: 'a', name: 'A', systemPrompt: 's', providerId: null, modelId: null, tools: [], workspaceId: null, maxSteps: 1, schedule: { kind: 'manual' }, createdAt: now, updatedAt: now }],
      documents: [], chunks: [],
      conversations: [{ id: 'c', title: 't', providerId: 'p', modelId: 'm', workspaceId: null, createdAt: now, updatedAt: now }],
      workspaces: [{ id: 'w', name: 'W', systemPrompt: '', defaultProviderId: null, defaultModelId: null, enabledTools: [], knowledgeDocIds: [], fileAccess: { enabled: false, roots: [] }, createdAt: now, updatedAt: now }],
      settings: { theme: 'dark', autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true, allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: '' }
    };
    fs.writeFileSync(path.join(db, 'platform-v1.json'), JSON.stringify(legacy));
    const repo = new Repository(db, path.join(dir, 'backups'));
    assert.deepEqual(repo.state.conversations[0].skillIds, []);
    assert.deepEqual(repo.state.workspaces[0].roleIds, []);
    assert.deepEqual(repo.state.agents[0].skillIds, []);

    const bad = { ...legacy, conversations: [{ ...legacy.conversations[0], skillIds: 'nope' }] };
    fs.writeFileSync(path.join(db, 'platform-v1.json'), JSON.stringify(bad));
    const fresh = new Repository(db, path.join(dir, 'backups'));
    assert.equal(fresh.state.conversations.length, 0, 'invalid file is quarantined and replaced');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('interval schedules saved by older builds load switched off, keeping their prompt', () => {
  const dir = temp();
  try {
    const now = Date.now();
    const state = JSON.parse(validState);
    state.agents = [{ id: 'a', name: 'Nightly digest', systemPrompt: 's', providerId: null, modelId: null, tools: [], workspaceId: null, skillIds: [], roleIds: [],
      maxSteps: 3, schedule: { kind: 'interval', intervalMinutes: 60, input: 'Write the digest.' }, createdAt: now, updatedAt: now }];
    fs.writeFileSync(path.join(dir, 'db', 'platform-v1.json'), JSON.stringify(state));
    const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
    assert.equal(repo.state.agents[0].schedule.kind, 'manual');
    assert.equal(repo.state.agents[0].schedule.input, 'Write the digest.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const stateWith = (extra = {}) => JSON.stringify({ version: 1, settings: {}, providers: [], conversations: [], messages: [], workspaces: [], agents: [], documents: [], chunks: [], ...extra });
/** A rolling backup's name, as the repository writes it. */
const backupName = (iso) => `state-${iso.replace(/[:.]/g, '-')}.json`;
const ids = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).conversations.map((c) => c.id);

test('restore points: none yet is an empty list', async () => {
  const dir = temp();
  try {
    const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
    assert.deepEqual(await repo.listBackups(), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restore points list each backup newest first, with what it holds; a damaged one is left out', async () => {
  const dir = temp();
  try {
    const backups = path.join(dir, 'backups');
    fs.writeFileSync(path.join(backups, backupName('2026-09-20T08:00:00.000Z')), stateWith({
      providers: [{ id: 'a' }], conversations: [{ id: 'c1' }, { id: 'c2' }],
      messages: [{ id: 'm1', conversationId: 'c1', role: 'user', content: 'hi', createdAt: 1000 }, { id: 'm2', conversationId: 'c2', role: 'assistant', content: 'yo', createdAt: 5000 }]
    }));
    fs.writeFileSync(path.join(backups, backupName('2026-09-26T08:00:00.000Z')), stateWith());
    fs.writeFileSync(path.join(backups, backupName('2026-09-24T08:00:00.000Z')), '{ half a file');
    fs.writeFileSync(path.join(backups, backupName('2026-09-25T08:00:00.000Z')), stateWith({ providers: [{ id: 'a' }, { id: 'a' }] }));
    fs.writeFileSync(path.join(backups, 'corrupt-123.json'), stateWith());
    const repo = new Repository(path.join(dir, 'db'), backups);
    const list = await repo.listBackups();
    assert.deepEqual(list.map((b) => b.file), [backupName('2026-09-26T08:00:00.000Z'), backupName('2026-09-20T08:00:00.000Z')]);
    assert.deepEqual(list[1], { file: backupName('2026-09-20T08:00:00.000Z'), timestamp: Date.parse('2026-09-20T08:00:00.000Z'), conversations: 2, workspaces: 0, providers: 1, lastMessageAt: 5000 });
    assert.equal(list[0].lastMessageAt, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restoring refuses anything but one of its own backups, and changes nothing', async () => {
  const dir = temp();
  try {
    const db = path.join(dir, 'db'), backups = path.join(dir, 'backups');
    fs.writeFileSync(path.join(db, 'platform-v1.json'), validState);
    const repo = new Repository(db, backups);
    const before = fs.readdirSync(backups).sort();
    const real = backupName('2026-09-20T08:00:00.000Z');
    for (const file of ['../db/platform-v1.json', '..\\db\\platform-v1.json', path.join(backups, real), 'corrupt-1.json', 'state-../../x.json', '', 42])
      await assert.rejects(repo.restoreBackup(file), /not one of Axon's backups/, String(file));
    assert.equal(fs.readFileSync(path.join(db, 'platform-v1.json'), 'utf8'), validState);
    assert.deepEqual(fs.readdirSync(backups).sort(), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a backup that fails validation is refused, and the current state and backups are untouched', async () => {
  const dir = temp();
  try {
    const db = path.join(dir, 'db'), backups = path.join(dir, 'backups');
    fs.writeFileSync(path.join(db, 'platform-v1.json'), validState);
    const bad = backupName('2026-09-20T08:00:00.000Z');
    fs.writeFileSync(path.join(backups, bad), stateWith({ providers: [{ id: 'a' }, { id: 'a' }] }));
    const repo = new Repository(db, backups);
    const before = fs.readdirSync(backups).sort();
    await assert.rejects(repo.restoreBackup(bad), /damaged/);
    assert.equal(fs.readFileSync(path.join(db, 'platform-v1.json'), 'utf8'), validState);
    assert.deepEqual(fs.readdirSync(backups).sort(), before, 'no pre-restore backup for a restore that never happened');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restoring backs up the current state first, then puts the backup back for the next start', async () => {
  const dir = temp();
  try {
    const db = path.join(dir, 'db'), backups = path.join(dir, 'backups');
    fs.writeFileSync(path.join(db, 'platform-v1.json'), validState);
    const older = backupName('2026-09-20T08:00:00.000Z');
    fs.writeFileSync(path.join(backups, older), stateWith({ conversations: [{ id: 'old-chat' }] }));
    let now = Date.parse('2026-09-27T10:00:00.000Z');
    const repo = new Repository(db, backups, () => now);
    repo.state.conversations.push({ id: 'unsaved', title: 'Only in memory', skillIds: [], roleIds: [] });
    now += 60_000;
    await repo.restoreBackup(older);
    const undo = path.join(backups, backupName('2026-09-27T10:01:00.000Z'));
    assert.ok(fs.existsSync(undo), 'the state being replaced is backed up first');
    assert.deepEqual(ids(undo), ['unsaved'], 'including what was only in memory');
    assert.deepEqual(ids(path.join(db, 'platform-v1.json')), ['old-chat']);
    // The running app still holds the old state: nothing it saves, even at quit, may overwrite the restore.
    await repo.save();
    await repo.store.flushAll();
    assert.deepEqual(ids(path.join(db, 'platform-v1.json')), ['old-chat']);
    assert.deepEqual(new Repository(db, backups).state.conversations.map((c) => c.id), ['old-chat'], 'the next start loads it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the oldest of ten backups can be restored, though backing up first prunes it', async () => {
  const dir = temp();
  try {
    const db = path.join(dir, 'db'), backups = path.join(dir, 'backups');
    const names = Array.from({ length: 10 }, (_, i) => backupName(`2026-09-${String(10 + i).padStart(2, '0')}T08:00:00.000Z`));
    names.forEach((name, i) => fs.writeFileSync(path.join(backups, name), stateWith({ conversations: [{ id: `chat-${i}` }] })));
    const repo = new Repository(db, backups, () => Date.parse('2026-09-27T10:00:00.000Z'));
    await repo.restoreBackup(names[0]);
    assert.deepEqual(ids(path.join(db, 'platform-v1.json')), ['chat-0']);
    assert.ok(!fs.existsSync(path.join(backups, names[0])), 'pruned by the pre-restore backup, yet restored');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a backup from an older build is brought up to date as it is restored', async () => {
  const dir = temp();
  try {
    const db = path.join(dir, 'db'), backups = path.join(dir, 'backups');
    const older = backupName('2026-09-01T08:00:00.000Z');
    fs.writeFileSync(path.join(backups, older), stateWith({ conversations: [{ id: 'c' }] })); // no tasks, no skillIds
    const repo = new Repository(db, backups);
    await repo.restoreBackup(older);
    const saved = JSON.parse(fs.readFileSync(path.join(db, 'platform-v1.json'), 'utf8'));
    assert.deepEqual(saved.tasks, []);
    assert.deepEqual(saved.conversations[0].skillIds, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
