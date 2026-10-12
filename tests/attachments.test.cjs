// Files pasted, dropped or chosen to go with a message: what they are called, where they are kept,
// what a picture and a document each become, and the limits on the way in.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
const electron = {};
Module._load = function (name, ...args) {
  if (name === 'electron') return electron;
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Attachments, displayName, storedName, MAX_PICTURES_SENT } = require('../src/main/attachments.ts');
const { ipcPayloadTooLarge } = require('../src/main/ipc-limits.ts');
const { MAX_UPLOAD_BYTES, pastedName, isClipboardName, asBytes } = require('../src/shared/attach.ts');

/** A 1x1 PNG, and Electron's image codec as preparing one uses it (the real one is checked in attach-desktop.cjs). */
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const preview = 'data:image/png;base64,UFJFVklFVw==';
const codec = (t, size = { width: 1, height: 1 }) => {
  const calls = [];
  const image = {
    isEmpty: () => false,
    getSize: () => size,
    resize: (to) => { calls.push(to); size = { width: to.width, height: to.height }; return image; },
    toPNG: () => tinyPng, toJPEG: () => tinyPng, toDataURL: () => preview
  };
  electron.nativeImage = { createFromBuffer: () => image, createFromBitmap: () => image };
  t.after(() => { delete electron.nativeImage; });
  return calls;
};

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-attach-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const extracted = [], kept = new Map();
  let ids = 0;
  const attachments = new Attachments(path.join(dir, 'attachments'), {
    id: () => `id${++ids}`,
    // A parser as the real one behaves: plain text reads, binary data is refused.
    extract: async (file) => {
      extracted.push({ file, existed: fs.existsSync(file) });
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes('\0')) throw new Error('Unsupported binary document. Legacy .xls files must be saved as .xlsx.');
      return text;
    },
    keepText: (id, text) => kept.set(id, text)
  });
  return { dir, attachments, extracted, kept, store: path.join(dir, 'attachments') };
}

test('a file is called what it is called on screen, never a path, and nothing hides in the name', () => {
  assert.equal(displayName('report.pdf'), 'report.pdf');
  assert.equal(displayName('C:\\Users\\me\\Desktop\\report.pdf'), 'report.pdf');
  assert.equal(displayName('../../etc/passwd'), 'passwd');
  assert.equal(displayName('notes\u0000.txt\u202etxt.exe'), 'notes.txttxt.exe');
  assert.equal(displayName('  many    spaces  .md '), 'many spaces .md');
  for (const empty of ['', '   ', '..', '...', 'folder/', undefined, 42, null]) assert.equal(displayName(empty), 'Attachment');
  const long = displayName(`${'a'.repeat(300)}.docx`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.docx'));
});

test('a copy is kept under a name made from its id; only a plain short extension survives', () => {
  assert.equal(storedName('abc-123', 'Budget 2026.XLSX'), 'abc-123.xlsx');
  assert.equal(storedName('abc-123', '../../evil.pdf'), 'abc-123.pdf');
  assert.equal(storedName('abc-123', 'readme'), 'abc-123');
  assert.equal(storedName('abc-123', 'x.toolongextension'), 'abc-123');
  assert.equal(storedName('abc-123', 'x.p d'), 'abc-123');
  assert.throws(() => storedName('../x', 'a.txt'), /valid attachment id/);
  assert.throws(() => storedName('a b', 'a.txt'), /valid attachment id/);
});

test('a pasted screenshot is named from the time it was pasted', () => {
  const at = new Date(2026, 9, 11, 14, 32, 5);
  assert.equal(pastedName('image/png', at), 'Pasted image 14-32.png');
  assert.equal(pastedName('image/jpeg', at), 'Pasted image 14-32.jpg');
  assert.equal(pastedName('image/png', at, 2), 'Pasted image 14-32 (2).png');
  assert.equal(pastedName('image/x-unknown', new Date(2026, 0, 1, 9, 5)), 'Pasted image 09-05.png');
  assert.ok(isClipboardName('image.png') && isClipboardName('') && isClipboardName('IMAGE.JPEG'));
  assert.ok(!isClipboardName('photo.png') && !isClipboardName('report.pdf'));
});

test('the window may send a file up to 20 MB as bytes, and everything else is held to 2.2 MB as JSON', () => {
  const bytes = (n) => new Uint8Array(n);
  assert.equal(ipcPayloadTooLarge('attachData', ['a.png', bytes(15_000_000)]), false);
  assert.equal(ipcPayloadTooLarge('attachData', ['a.png', bytes(MAX_UPLOAD_BYTES)]), false);
  assert.equal(ipcPayloadTooLarge('attachData', ['a.png', bytes(MAX_UPLOAD_BYTES + 1)]), true);
  assert.equal(ipcPayloadTooLarge('attachData', ['a.png', new ArrayBuffer(1000)]), false);
  assert.equal(ipcPayloadTooLarge('attachData', ['a.png', 'not bytes']), true);
  assert.equal(ipcPayloadTooLarge('attachData', [42, bytes(10)]), true);
  assert.equal(ipcPayloadTooLarge('attachData', ['a.png']), true);
  assert.equal(ipcPayloadTooLarge('attachData', ['a.png', bytes(10), 'extra']), true);
  assert.equal(ipcPayloadTooLarge('attachData', ['x'.repeat(3000), bytes(10)]), true);
  assert.equal(ipcPayloadTooLarge('chatSend', ['id', 'x'.repeat(2_000_000), []]), false);
  assert.equal(ipcPayloadTooLarge('chatSend', ['id', 'x'.repeat(2_300_000), []]), true);
  // Bytes sent to any other call count as JSON, which makes them far bigger than they are.
  assert.equal(ipcPayloadTooLarge('speechTranscribe', [bytes(500_000), 'audio/webm', '']), true);
  assert.deepEqual(asBytes(new Uint8Array([1, 2]).buffer), new Uint8Array([1, 2]));
  assert.equal(asBytes('text'), null);
});

test('a pasted picture is checked by its bytes, prepared, and kept under a name of ours', async (t) => {
  codec(t);
  const { attachments, store, dir } = setup(t);
  // Its name lies about what it is, and tries to climb out of the folder.
  const file = await attachments.fromBytes('..\\..\\notes.txt', tinyPng);
  assert.deepEqual(file, { id: 'id1', name: 'notes.txt', thumbnail: preview });
  const waiting = attachments.get('id1');
  assert.equal(waiting.picture.kind, 'image');
  assert.equal(waiting.picture.mime, 'image/png');
  assert.equal(waiting.picture.path, path.join(store, 'id1.png'));
  // It waits in its own folder, so nothing unsent mixes with what conversations keep.
  assert.deepEqual(fs.readdirSync(path.join(store, 'waiting')), ['id1.png']);
  assert.deepEqual(fs.readFileSync(path.join(store, 'waiting', 'id1.png')), tinyPng);
  assert.equal(fs.existsSync(path.join(dir, 'notes.txt')), false);
});

test('a pasted document is read from a copy named by us, which is gone afterwards', async (t) => {
  const { attachments, extracted, kept, store } = setup(t);
  const file = await attachments.fromBytes('../../Meeting notes.MD', Buffer.from('# Plan\nShip on Friday.'));
  assert.deepEqual(file, { id: 'id2', name: 'Meeting notes.MD' });
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].existed, true);
  assert.equal(path.dirname(extracted[0].file), path.join(store, 'waiting'));
  assert.equal(path.basename(extracted[0].file), 'id1-upload.md');
  assert.equal(fs.existsSync(extracted[0].file), false);
  // The whole text is kept for read_attachment; what waits for the message is its start.
  assert.equal(kept.get('id2'), '# Plan\nShip on Friday.');
  assert.deepEqual(attachments.get('id2'), { name: 'Meeting notes.MD', text: '# Plan\nShip on Friday.' });
});

test('the start of a long document is what waits for the message', async (t) => {
  const { attachments, kept } = setup(t);
  const { id } = await attachments.fromBytes('long.txt', Buffer.from('word '.repeat(2000)));
  assert.equal(attachments.get(id).text.length, 1200);
  assert.equal(kept.get(id).length, 10000);
});

test('what cannot go in is turned away in plain words, with the file named', async (t) => {
  codec(t);
  const { attachments, store } = setup(t);
  await assert.rejects(attachments.fromBytes('empty.txt', new Uint8Array(0)), /empty\.txt is empty/);
  await assert.rejects(attachments.fromBytes('huge.bin', new Uint8Array(MAX_UPLOAD_BYTES + 1)), /huge\.bin is too large to attach \(over 20 MB\)/);
  await assert.rejects(attachments.fromBytes('x.txt', 'a string'), /could not be attached/);
  await assert.rejects(attachments.fromBytes(42, tinyPng), /could not be attached/);
  // Not a picture, and not a document: its bytes are not text.
  await assert.rejects(attachments.fromBytes('archive.zip', Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0])), /archive\.zip: I can't read that kind of file/);
  // An old spreadsheet does need saving as .xlsx, and says so.
  await assert.rejects(attachments.fromBytes('old.xls', Buffer.from([0xd0, 0xcf, 0, 0, 0])), /old\.xls: Unsupported binary document\. Legacy \.xls/);
  await assert.rejects(attachments.fromBytes('IMG_0001.HEIC', Buffer.from('....ftypheic....')), /IMG_0001\.HEIC: pictures must be PNG, JPEG, GIF or WebP/);
  await assert.rejects(attachments.fromBytes('photo', Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0])), /pictures must be PNG, JPEG, GIF or WebP/);
  // None of them left a file behind.
  const left = fs.existsSync(path.join(store, 'waiting')) ? fs.readdirSync(path.join(store, 'waiting')) : [];
  assert.deepEqual(left, []);
});

test('a picture bigger than models take is shrunk before it is kept', async (t) => {
  const resized = codec(t, { width: 4000, height: 2000 });
  const { attachments } = setup(t);
  await attachments.fromBytes('wide.png', tinyPng);
  // The picture is shrunk to the longest edge models take; the second shrink is its small preview.
  assert.deepEqual(resized.map((r) => [r.width, r.height]), [[1568, 784], [120, 60]]);
});

test('a picture that cannot be read says which one', async (t) => {
  electron.nativeImage = { createFromBuffer: () => ({ isEmpty: () => true }) };
  t.after(() => { delete electron.nativeImage; });
  const { attachments } = setup(t);
  await assert.rejects(attachments.fromBytes('broken.png', tinyPng), /broken\.png: That picture could not be read/);
});

test('a file chosen in the dialog is read from where it is: pictures by their bytes, documents by the parser', async (t) => {
  codec(t);
  const { dir, attachments, extracted } = setup(t);
  const shot = path.join(dir, 'screenshot'), notes = path.join(dir, 'notes.txt');
  fs.writeFileSync(shot, tinyPng);
  fs.writeFileSync(notes, 'Remember the milk.');
  const picture = await attachments.fromPath(shot);
  assert.equal(picture.name, 'screenshot');
  assert.equal(picture.thumbnail, preview);
  assert.equal(attachments.get(picture.id).picture.mime, 'image/png');
  const document = await attachments.fromPath(notes);
  assert.equal(document.name, 'notes.txt');
  // Read in place, and left where it was.
  assert.equal(extracted.at(-1).file, notes);
  assert.equal(fs.existsSync(notes), true);
  fs.writeFileSync(path.join(dir, 'phone.heic'), 'x');
  await assert.rejects(attachments.fromPath(path.join(dir, 'phone.heic')), /phone\.heic: pictures must be PNG, JPEG, GIF or WebP/);
});

test('sending moves a picture beside the conversation\'s others; it can then be read for a request', async (t) => {
  codec(t);
  const { attachments, store } = setup(t);
  const { id } = await attachments.fromBytes('shot.png', tinyPng);
  const { picture } = attachments.get(id);
  // Readable while it waits, for the request the message starts.
  const loaded = await attachments.load([picture], true);
  assert.deepEqual(loaded.get(id), { name: 'shot.png', mime: 'image/png', base64: tinyPng.toString('base64') });
  const [sent] = await attachments.keep([picture]);
  assert.equal(sent.path, path.join(store, `${id}.png`));
  assert.deepEqual(fs.readFileSync(sent.path), tinyPng);
  assert.equal(fs.existsSync(path.join(store, 'waiting', `${id}.png`)), false);
  // It goes with one message: the waiting entry is gone, and still readable from its place.
  assert.equal(attachments.get(id), undefined);
  assert.equal((await attachments.load([sent], true)).get(id).base64, tinyPng.toString('base64'));
  // Sending the same one again finds it in place; one that is truly gone says so.
  await attachments.keep([sent]);
  fs.rmSync(sent.path);
  await assert.rejects(attachments.keep([sent]), /shot\.png is no longer available/);
});

test('a model that cannot see pictures is given their names; no file is read for it', async (t) => {
  const { attachments } = setup(t);
  const gone = { id: 'x', name: 'gone.png', mime: 'image/png', size: 1, path: '/nowhere/x.png', kind: 'image' };
  const loaded = await attachments.load([gone, { ...gone, id: 'doc', kind: 'text' }], false);
  assert.deepEqual([...loaded.keys()], ['x']);
  assert.deepEqual(loaded.get('x'), { name: 'gone.png', mime: 'image/png', base64: '' });
  // And one that can see it simply goes without a picture whose file is gone.
  assert.equal((await attachments.load([gone], true)).size, 0);
});

test('a request carries the latest pictures, not every one a long conversation ever had', async (t) => {
  codec(t);
  const { attachments, store } = setup(t);
  fs.mkdirSync(store, { recursive: true });
  const all = Array.from({ length: MAX_PICTURES_SENT + 5 }, (_, i) => {
    const picture = { id: `p${i}`, name: `${i}.png`, mime: 'image/png', size: 1, path: path.join(store, `p${i}.png`), kind: 'image' };
    fs.writeFileSync(picture.path, tinyPng);
    return picture;
  });
  const loaded = await attachments.load(all, true);
  assert.equal(loaded.size, MAX_PICTURES_SENT);
  assert.ok(loaded.has(`p${all.length - 1}`) && !loaded.has('p0'));
});

test('pictures are deleted with the conversation, by the name only: a path cannot point elsewhere', async (t) => {
  const { dir, attachments, store } = setup(t);
  fs.mkdirSync(store, { recursive: true });
  const outside = path.join(dir, 'precious.txt');
  fs.writeFileSync(outside, 'keep me');
  fs.writeFileSync(path.join(store, 'p1.png'), tinyPng);
  const picture = (file) => ({ id: 'p1', name: 'p1.png', mime: 'image/png', size: 1, path: file, kind: 'image' });
  await attachments.remove([picture(path.join(store, 'p1.png')), picture(path.join(store, '..', '..', 'precious.txt'))]);
  assert.equal(fs.existsSync(path.join(store, 'p1.png')), false);
  assert.equal(fs.existsSync(outside), true);
});

test('only fifty files wait at once, and a picture let go leaves no file behind', async (t) => {
  codec(t);
  const { attachments, store } = setup(t);
  const first = await attachments.fromBytes('first.png', tinyPng);
  for (let i = 0; i < 50; i++) await attachments.fromBytes(`doc${i}.txt`, Buffer.from(`document ${i}`));
  assert.equal(attachments.get(first.id), undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fs.existsSync(path.join(store, 'waiting', `${first.id}.png`)), false);
});

test('nothing waiting survives a restart', async (t) => {
  codec(t);
  const { dir, attachments, store } = setup(t);
  await attachments.fromBytes('shot.png', tinyPng);
  assert.equal(fs.readdirSync(path.join(store, 'waiting')).length, 1);
  new Attachments(store, { id: () => 'x', extract: async () => '', keepText() {} });
  assert.equal(fs.existsSync(path.join(store, 'waiting')), false);
  assert.ok(dir);
});
