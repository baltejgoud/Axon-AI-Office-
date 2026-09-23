// Pure logic behind the office side panel, the office library and the window state.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require.extensions['.ts'] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true
      }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const thread = require('../src/renderer/src/features/office/activity/thread.ts');
const library = require('../src/renderer/src/features/office/library.ts');
const windowState = require('../src/main/windowState.ts');

const conv = (id, agentId, updatedAt) => ({ id, agentId, updatedAt, title: id });

test('agentThreads lists only that coworker, newest first', () => {
  const list = [conv('a', 'writer', 1), conv('b', 'designer', 5), conv('c', 'writer', 9)];
  assert.deepEqual(
    thread.agentThreads(list, 'writer').map((c) => c.id),
    ['c', 'a']
  );
});

test('activeThread prefers the runtime conversation, then the newest thread', () => {
  const list = [conv('a', 'writer', 1), conv('c', 'writer', 9)];
  assert.equal(thread.activeThread(list, 'writer', { conversationId: 'a' }).id, 'a');
  assert.equal(thread.activeThread(list, 'writer', {}).id, 'c');
  assert.equal(thread.activeThread(list, 'writer', undefined).id, 'c');
});

test('activeThread returns nothing when a fresh thread was requested', () => {
  const list = [conv('a', 'writer', 1)];
  assert.equal(thread.activeThread(list, 'writer', { fresh: true }), undefined);
});

test('activeThread ignores a runtime conversation that was deleted', () => {
  const list = [conv('a', 'writer', 1)];
  assert.equal(thread.activeThread(list, 'writer', { conversationId: 'gone' }).id, 'a');
});

test('officeLibraryWorkspace creates the library with every document', () => {
  const w = library.officeLibraryWorkspace(undefined, ['d1', 'd2'], 100);
  assert.equal(w.id, library.OFFICE_LIBRARY_ID);
  assert.deepEqual(w.knowledgeDocIds, ['d1', 'd2']);
  assert.equal(w.createdAt, 100);
  assert.equal(w.fileAccess.enabled, false);
});

test('officeLibraryWorkspace returns null when the documents already match', () => {
  const w = library.officeLibraryWorkspace(undefined, ['d1', 'd2'], 100);
  assert.equal(library.officeLibraryWorkspace(w, ['d2', 'd1'], 200), null);
});

test('officeLibraryWorkspace updates the documents and keeps createdAt', () => {
  const w = library.officeLibraryWorkspace(undefined, ['d1'], 100);
  const next = library.officeLibraryWorkspace(w, ['d1', 'd3'], 200);
  assert.deepEqual(next.knowledgeDocIds, ['d1', 'd3']);
  assert.equal(next.createdAt, 100);
  assert.equal(next.updatedAt, 200);
});

test('library residents are the three Library coworkers', () => {
  assert.deepEqual(
    [...library.LIBRARY_RESIDENTS].sort(),
    ['knowledge-librarian', 'research-analyst', 'writer']
  );
});

const display = { x: 0, y: 0, width: 1920, height: 1040 };

test('restoreState defaults to maximized with no bounds', () => {
  assert.deepEqual(windowState.restoreState(undefined, [display]), { maximized: true });
  assert.deepEqual(windowState.restoreState({ nonsense: 1 }, [display]), { maximized: true });
});

test('restoreState keeps normal bounds that are on a screen', () => {
  const saved = { maximized: false, bounds: { x: 100, y: 80, width: 1200, height: 800 } };
  assert.deepEqual(windowState.restoreState(saved, [display]), saved);
});

test('restoreState drops bounds that are off every screen or too small', () => {
  const off = { maximized: false, bounds: { x: 5000, y: 80, width: 1200, height: 800 } };
  assert.deepEqual(windowState.restoreState(off, [display]), { maximized: false });
  const tiny = { maximized: false, bounds: { x: 0, y: 0, width: 200, height: 100 } };
  assert.deepEqual(windowState.restoreState(tiny, [display]), { maximized: false });
});

test('load and save round-trip through a file and survive corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-window-'));
  try {
    const file = path.join(dir, 'window-state.json');
    assert.deepEqual(windowState.loadWindowState(file, [display]), { maximized: true });
    const state = { maximized: false, bounds: { x: 10, y: 10, width: 1300, height: 850 } };
    windowState.saveWindowState(file, state);
    assert.deepEqual(windowState.loadWindowState(file, [display]), state);
    fs.writeFileSync(file, '{ not json');
    assert.deepEqual(windowState.loadWindowState(file, [display]), { maximized: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
