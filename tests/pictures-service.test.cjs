// Pictures and files you paste, drop or choose, end to end through the service: what the model is sent,
// what stays with the conversation, and what happens when a model cannot see pictures.
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
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true }
    }).outputText,
    file
  );
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');
const providers = require('../src/main/providers.ts');

/** A 1x1 PNG, and Electron's image codec as preparing one uses it (the real one is checked in attach-desktop.cjs). */
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const preview = 'data:image/png;base64,UFJFVklFVw==';
const fakeCodec = (t) => {
  const image = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), resize: () => image, toPNG: () => tinyPng, toJPEG: () => tinyPng, toDataURL: () => preview };
  electron.nativeImage = { createFromBuffer: () => image, createFromBitmap: () => image };
  t.after(() => { delete electron.nativeImage; });
};

function setup(t, model = { id: 'm1', displayName: 'Model One' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-pictures-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: () => false, get: () => null, set() {}, remove() {} };
  const service = new Service(repo, vault, dir, () => {}, 'parser-worker-path');
  // The real parser runs in another process; here it reads plain text.
  service.parsers.extract = async (file) => fs.readFileSync(file, 'utf8');
  repo.state.providers.push({ id: 'p1', name: 'MockProvider', kind: 'openai-compatible', baseUrl: 'https://example.com/v1', models: [model], enabled: true, createdAt: 0, hasApiKey: false });
  return { dir, repo, service, store: path.join(dir, 'data', 'attachments') };
}

/** Stands in for the model: each call is recorded as the provider adapter would receive it. */
function mockModel(t, respond) {
  const saved = providers.streamChat;
  t.after(() => { providers.streamChat = saved; });
  const sent = [];
  providers.streamChat = async (_p, _k, req, onChunk) => {
    sent.push(req.messages.map((m) => ({ ...m })));
    return respond(sent.length, req, onChunk);
  };
  return sent;
}
const answer = (text) => async (_n, _req, onChunk) => { onChunk(text); return { toolCalls: [] }; };
async function waitFor(find, what) {
  for (let i = 0; i < 300; i++) {
    const found = find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const tinyBase64 = tinyPng.toString('base64');

test('a picture you paste reaches the model as a picture, and stays with your message', async (t) => {
  fakeCodec(t);
  const { repo, service, store } = setup(t);
  const attached = await service.attachData('Pasted image 14-32.png', new Uint8Array(tinyPng));
  assert.deepEqual(attached, { id: attached.id, name: 'Pasted image 14-32.png', thumbnail: preview });

  const sent = mockModel(t, answer('A tiny dot.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'What is this?', [attached.id]);
  const asked = sent[0].at(-1);
  // Words as typed: a picture adds no block of text to them.
  assert.equal(asked.content, 'What is this?');
  assert.deepEqual(asked.images, [{ name: 'Pasted image 14-32.png', mime: 'image/png', base64: tinyBase64 }]);

  const mine = repo.state.messages.find((m) => m.role === 'user');
  assert.equal(mine.content, 'What is this?');
  const [kept] = mine.attachments;
  assert.deepEqual({ kind: kept.kind, name: kept.name, mime: kept.mime, thumbnail: kept.thumbnail }, { kind: 'image', name: 'Pasted image 14-32.png', mime: 'image/png', thumbnail: preview });
  assert.equal(path.dirname(kept.path), store);
  assert.deepEqual(fs.readFileSync(kept.path), tinyPng);
  // Nothing about a picture is offered to read_attachment, which is for documents.
  assert.equal(repo.state.conversations.find((c) => c.id === chat.id).attachmentRefs, undefined);
  assert.deepEqual(fs.readdirSync(path.join(store, 'waiting')), []);

  // The next question still shows the model the picture, and sends no picture of its own.
  await service.chatSend(chat.id, 'Which colour is it?', []);
  assert.deepEqual(sent[1][0].images, asked.images);
  assert.equal(sent[1].at(-1).images, undefined);
  // The same attachment cannot be sent twice: it went with its message.
  await assert.rejects(service.chatSend(chat.id, 'Again', [attached.id]), /Attachment expired/);
});

test('a picture chosen in the file dialog is treated the same way', async (t) => {
  fakeCodec(t);
  const { dir, service } = setup(t);
  const file = path.join(dir, 'shot.png');
  fs.writeFileSync(file, tinyPng);
  electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  t.after(() => { delete electron.dialog.showOpenDialog; });
  const [attached] = await service.attach();
  assert.equal(attached.name, 'shot.png');
  assert.equal(attached.thumbnail, preview);
  const sent = mockModel(t, answer('Ok.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'Look', [attached.id]);
  assert.equal(sent[0].at(-1).images[0].base64, tinyBase64);
});

test('a document you drop is read as before: its start in the message, the rest for read_attachment', async (t) => {
  const { repo, service } = setup(t);
  const attached = await service.attachData('Meeting notes.md', new Uint8Array(Buffer.from('# Plan\nShip on Friday.')));
  assert.equal(attached.thumbnail, undefined);
  const sent = mockModel(t, answer('Noted.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'Summarise this', [attached.id]);
  const asked = sent[0].at(-1);
  assert.match(asked.content, /^Summarise this\n\n<attachment name="Meeting notes\.md" attachmentId=/);
  assert.match(asked.content, /Ship on Friday\./);
  assert.equal(asked.images, undefined);
  assert.deepEqual(repo.state.conversations.find((c) => c.id === chat.id).attachmentRefs, [{ id: attached.id, name: 'Meeting notes.md' }]);
  assert.equal(repo.state.messages.find((m) => m.role === 'user').attachments, undefined);
  assert.equal(service.toolOutputs.read(`attachment:${attached.id}`), '# Plan\nShip on Friday.');
});

test('pictures and documents go together; at most five files go with a message', async (t) => {
  fakeCodec(t);
  const { service } = setup(t);
  const picture = await service.attachData('shot.png', new Uint8Array(tinyPng));
  const notes = await service.attachData('notes.txt', new Uint8Array(Buffer.from('notes')));
  const sent = mockModel(t, answer('Ok.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await assert.rejects(service.chatSend(chat.id, 'Too many', Array.from({ length: 6 }, () => picture.id)), /At most five attachments/);
  await service.chatSend(chat.id, 'Both', [picture.id, notes.id]);
  const asked = sent[0].at(-1);
  assert.equal(asked.images.length, 1);
  assert.match(asked.content, /<attachment name="notes\.txt"/);
  assert.doesNotMatch(asked.content, /shot\.png/);
});

test('a model marked as unable to see pictures is sent their names, and the reply says so once', async (t) => {
  fakeCodec(t);
  const { repo, service } = setup(t, { id: 'm1', displayName: 'Text Only', supportsVision: false });
  const attached = await service.attachData('shot.png', new Uint8Array(tinyPng));
  const sent = mockModel(t, answer('I only see a file name.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'What is this?', [attached.id]);
  const asked = sent[0].at(-1);
  assert.equal(asked.images, undefined);
  assert.match(asked.content, /What is this\?\n\n\[Picture attached: shot\.png\./);
  const reply = repo.state.messages.find((m) => m.role === 'assistant');
  assert.equal(reply.error, undefined);
  assert.equal(reply.notice, "Text Only can't see pictures, so it only got their file names. Pick a model that can see pictures and ask again.");
  // The picture is still kept with your message, and your own words are as you typed them.
  assert.equal(repo.state.messages.find((m) => m.role === 'user').content, 'What is this?');
  assert.equal(repo.state.messages.find((m) => m.role === 'user').attachments.length, 1);
  // A later question without a picture draws no second notice, though the old picture is still named.
  await service.chatSend(chat.id, 'And now?', []);
  assert.match(sent[1][0].content, /\[Picture attached: shot\.png\./);
  assert.equal(repo.state.messages.filter((m) => m.role === 'assistant').at(-1).notice, undefined);
});

test('a model not marked either way is sent the picture; if it refuses, the reply says so', async (t) => {
  fakeCodec(t);
  const { repo, service } = setup(t);
  const attached = await service.attachData('shot.png', new Uint8Array(tinyPng));
  mockModel(t, async (_n, _req, onChunk) => { onChunk('I only see a file name.'); return { toolCalls: [], imagesDropped: true }; });
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'What is this?', [attached.id]);
  const reply = repo.state.messages.find((m) => m.role === 'assistant');
  assert.equal(reply.error, undefined);
  assert.match(reply.notice, /Model One can't see pictures/);
});

test('once a model has refused the pictures, later steps of the run do not send them again', async (t) => {
  fakeCodec(t);
  const { repo, service } = setup(t);
  const attached = await service.attachData('shot.png', new Uint8Array(tinyPng));
  const sent = mockModel(t, async (n, _req, onChunk) => {
    if (n === 1) return { toolCalls: [{ id: 'c1', name: 'search_conversation_history', arguments: '{"query":"x"}' }], imagesDropped: true };
    onChunk('Done.');
    return { toolCalls: [] };
  });
  const chat = await service.chatCreate('p1', 'm1', null, 'backend-developer');
  await service.chatSend(chat.id, 'What is this?', [attached.id]);
  assert.equal(sent.length, 2);
  assert.ok(sent[0].some((m) => m.images?.length));
  assert.ok(sent[1].every((m) => !m.images));
  assert.match(sent[1][0].content, /\[Picture attached: shot\.png\./);
  assert.match(repo.state.messages.filter((m) => m.role === 'assistant').at(-1).notice, /can't see pictures/);
});

test('a picture sent while the coworker works reaches them at their next step', async (t) => {
  fakeCodec(t);
  const { repo, service, store } = setup(t);
  const attached = await service.attachData('late.png', new Uint8Array(tinyPng));
  let open;
  const thinking = new Promise((resolve) => { open = resolve; });
  const sent = mockModel(t, async (n, _req, onChunk) => {
    if (n === 1) {
      await thinking;
      return { toolCalls: [{ id: 'c1', name: 'search_conversation_history', arguments: '{"query":"x"}' }] };
    }
    onChunk('Seen.');
    return { toolCalls: [] };
  });
  const chat = await service.chatCreate('p1', 'm1', null, 'backend-developer');
  const first = service.chatSend(chat.id, 'Look something up', []);
  await waitFor(() => sent.length === 1, 'the first call');
  await service.chatSend(chat.id, 'Also this picture', [attached.id]);
  open();
  await first;
  await waitFor(() => sent.length === 2 && !service.runs.has(chat.id), 'the run to end');
  const last = sent[1].at(-1);
  assert.equal(last.content, 'Also this picture');
  assert.equal(last.images[0].base64, tinyBase64);
  const queued = repo.state.messages.find((m) => m.role === 'user' && m.content === 'Also this picture');
  assert.equal(queued.attachments.length, 1);
  assert.deepEqual(fs.readFileSync(queued.attachments[0].path), tinyPng);
  assert.equal(path.dirname(queued.attachments[0].path), store);
});

test('deleting a conversation deletes the pictures sent in it', async (t) => {
  fakeCodec(t);
  const { repo, service } = setup(t);
  const attached = await service.attachData('keep.png', new Uint8Array(tinyPng));
  mockModel(t, answer('Ok.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'Keep this', [attached.id]);
  const kept = repo.state.messages.find((m) => m.role === 'user').attachments[0].path;
  assert.ok(fs.existsSync(kept));
  assert.equal(await service.chatDelete(chat.id), true);
  assert.equal(fs.existsSync(kept), false);
});

test('the context meter counts a picture as about 1,600 tokens, not by its bytes', async (t) => {
  fakeCodec(t);
  const { service } = setup(t);
  mockModel(t, answer('Ok.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'Hello', []);
  const before = (await service.getContextUsage(chat.id)).tokenBasis.usedTokens;
  const attached = await service.attachData('shot.png', new Uint8Array(tinyPng));
  await service.chatSend(chat.id, 'Hello', [attached.id]);
  const after = (await service.getContextUsage(chat.id)).tokenBasis.usedTokens;
  // The second turn adds a short question and answer as well as the picture.
  assert.ok(after - before >= 1600 && after - before < 2000, `grew by ${after - before}`);
});

/* ------------------------ retry and edit keep their pictures ------------------------ */

const numbered = async (n, _req, onChunk) => { onChunk(`Answer ${n}`); return { toolCalls: [] }; };

test('retry answers a message with a picture again: the picture is sent again, and no second turn is added', async (t) => {
  fakeCodec(t);
  const { repo, service } = setup(t);
  const attached = await service.attachData('shot.png', new Uint8Array(tinyPng));
  const sent = mockModel(t, numbered);
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'What is this?', [attached.id]);
  const asked = repo.conversationMessages(chat.id).find((m) => m.role === 'user');
  const [picture] = asked.attachments;
  assert.ok(fs.existsSync(picture.path));

  await service.chatRetry(chat.id);

  // The model saw the picture once more, on the very message it was asked with, and nothing else.
  assert.equal(sent.length, 2);
  assert.equal(sent[1].length, 1);
  assert.equal(sent[1][0].role, 'user');
  assert.equal(sent[1][0].content, 'What is this?');
  assert.deepEqual(sent[1][0].images, [{ name: 'shot.png', mime: 'image/png', base64: tinyBase64 }]);
  assert.equal(sent[1][0].sourceMessageId, asked.id);
  // Your message is the same one, still with its picture; only the reply is new.
  const users = repo.conversationMessages(chat.id).filter((m) => m.role === 'user');
  assert.equal(users.length, 1);
  assert.equal(users[0].id, asked.id);
  assert.deepEqual(users[0].attachments, [picture]);
  assert.ok(fs.existsSync(picture.path), 'the picture file is still there');
  assert.equal(repo.conversationMessages(chat.id).at(-1).content, 'Answer 2');
  // A second retry still has it.
  await service.chatRetry(chat.id);
  assert.deepEqual(sent[2][0].images, sent[1][0].images);
});

test('retry keeps earlier pictures in the conversation too, and the retried question\'s picture goes last', async (t) => {
  fakeCodec(t);
  const { repo, service } = setup(t);
  const first = await service.attachData('first.png', new Uint8Array(tinyPng));
  const second = await service.attachData('second.png', new Uint8Array(tinyPng));
  const sent = mockModel(t, numbered);
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'One', [first.id]);
  await service.chatSend(chat.id, 'Two', [second.id]);
  await service.chatRetry(chat.id);
  assert.deepEqual(sent[2].map((m) => [m.role, m.content, m.images?.map((i) => i.name)]), [
    ['user', 'One', ['first.png']],
    ['assistant', 'Answer 1', undefined],
    ['user', 'Two', ['second.png']]
  ]);
  assert.equal(repo.conversationMessages(chat.id).filter((m) => m.role === 'user').length, 2);
});

test('a model that cannot see pictures is still sent their names on a retry, and the new reply says so once', async (t) => {
  fakeCodec(t);
  const { repo, service } = setup(t, { id: 'm1', displayName: 'Text Only', supportsVision: false });
  const attached = await service.attachData('shot.png', new Uint8Array(tinyPng));
  const sent = mockModel(t, answer('I only see a file name.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'What is this?', [attached.id]);
  await service.chatRetry(chat.id);
  assert.equal(sent[1].length, 1);
  assert.equal(sent[1][0].images, undefined);
  assert.match(sent[1][0].content, /^What is this\?\n\n\[Picture attached: shot\.png\./);
  // Your own message is as you typed it; the picture is still kept with it.
  const users = repo.conversationMessages(chat.id).filter((m) => m.role === 'user');
  assert.equal(users.length, 1);
  assert.equal(users[0].content, 'What is this?');
  assert.equal(users[0].attachments.length, 1);
  const replies = repo.conversationMessages(chat.id).filter((m) => m.role === 'assistant');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].notice, "Text Only can't see pictures, so it only got their file names. Pick a model that can see pictures and ask again.");
});

test('editing a message with a picture sends the new words with the same picture, and the new message keeps it', async (t) => {
  fakeCodec(t);
  const { repo, service, store } = setup(t);
  const attached = await service.attachData('shot.png', new Uint8Array(tinyPng));
  const sent = mockModel(t, numbered);
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'What is this?', [attached.id]);
  await service.chatSend(chat.id, 'And then?', []);
  const original = repo.conversationMessages(chat.id).find((m) => m.role === 'user');
  const [picture] = original.attachments;

  await service.chatEdit(chat.id, original.id, 'What colour is this?');

  const asked = sent[2];
  assert.equal(asked.length, 1, 'everything after the edited message is gone');
  assert.equal(asked[0].content, 'What colour is this?');
  assert.deepEqual(asked[0].images, [{ name: 'shot.png', mime: 'image/png', base64: tinyBase64 }]);
  const messages = repo.conversationMessages(chat.id);
  assert.deepEqual(messages.map((m) => [m.role, m.content]), [['user', 'What colour is this?'], ['assistant', 'Answer 3']]);
  const edited = messages[0];
  assert.notEqual(edited.id, original.id, 'it is a new message');
  assert.deepEqual(edited.attachments, [picture], 'the same picture, on the new message');
  assert.equal(asked[0].sourceMessageId, edited.id);
  assert.ok(fs.existsSync(picture.path), 'the picture file survived the cut');
  assert.equal(path.dirname(picture.path), store);
  assert.deepEqual(fs.readdirSync(path.join(store, 'waiting')), []);
  // It can be edited again, and retried: the picture goes along each time.
  await service.chatEdit(chat.id, edited.id, 'Is it blue?');
  assert.deepEqual(sent[3][0].images, asked[0].images);
  assert.deepEqual(repo.conversationMessages(chat.id)[0].attachments, [picture]);
  await service.chatRetry(chat.id);
  assert.deepEqual(sent[4][0].images, asked[0].images);
  // Deleting the conversation still takes its picture with it.
  assert.equal(await service.chatDelete(chat.id), true);
  assert.equal(fs.existsSync(picture.path), false);
});

test('an edited message keeps its picture and its document together; a model that cannot see gets the name', async (t) => {
  fakeCodec(t);
  const { repo, service } = setup(t, { id: 'm1', displayName: 'Text Only', supportsVision: false });
  const picture = await service.attachData('shot.png', new Uint8Array(tinyPng));
  const notes = await service.attachData('notes.txt', new Uint8Array(Buffer.from('Ship on Friday.')));
  const sent = mockModel(t, answer('Ok.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'Look at both', [picture.id, notes.id]);
  const original = repo.conversationMessages(chat.id).find((m) => m.role === 'user');

  await service.chatEdit(chat.id, original.id, 'Look at both, briefly');

  const edited = repo.conversationMessages(chat.id).find((m) => m.role === 'user');
  assert.match(edited.content, /^Look at both, briefly\n\n<attachment name="notes\.txt" attachmentId=/);
  assert.deepEqual(edited.attachments, original.attachments);
  assert.equal(sent[1].length, 1);
  assert.equal(sent[1][0].images, undefined);
  assert.match(sent[1][0].content, /<attachment name="notes\.txt"/);
  assert.match(sent[1][0].content, /\[Picture attached: shot\.png\./);
  assert.match(repo.conversationMessages(chat.id).at(-1).notice, /can't see pictures/);
});

test('editing a message whose picture file has gone still sends the new words', async (t) => {
  fakeCodec(t);
  const { repo, service } = setup(t);
  const attached = await service.attachData('shot.png', new Uint8Array(tinyPng));
  const sent = mockModel(t, answer('Ok.'));
  const chat = await service.chatCreate('p1', 'm1', null);
  await service.chatSend(chat.id, 'What is this?', [attached.id]);
  const original = repo.conversationMessages(chat.id).find((m) => m.role === 'user');
  fs.rmSync(original.attachments[0].path);
  await service.chatEdit(chat.id, original.id, 'What was this?');
  assert.equal(sent[1].at(-1).content, 'What was this?');
  assert.equal(sent[1].at(-1).images, undefined, 'nothing to send for a picture that is gone');
  assert.equal(repo.conversationMessages(chat.id).at(-1).error, undefined);
});
