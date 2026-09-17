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

test('each save writes a rolling backup and prunes to ten', async () => {
  const dir = temp();
  try {
    const backupDir = path.join(dir, 'backups'), dbDir = path.join(dir, 'db');
    for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(backupDir, `state-2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z.json`), 'old');
    fs.writeFileSync(path.join(dbDir, 'platform-v1.json'), validState);
    const repo = new Repository(dbDir, backupDir); // constructor backup -> 13
    await repo.save();                              // pre-write backup -> 14, prune to 10
    const remaining = fs.readdirSync(backupDir).filter(name => name.startsWith('state-'));
    assert.equal(remaining.length, 10);
    assert.ok(remaining.every(name => name >= 'state-2026-01-01T00-00-04-000Z'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
