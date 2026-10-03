// Voice typing: which engine transcribes, the hint it gets, what goes on the wire, and what comes back.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const original = Module._load;
const electron = { app: { isPackaged: false, relaunch() {}, quit() {} }, dialog: {}, utilityProcess: { fork: () => ({ on() {}, postMessage() {}, kill() {} }) } };
Module._load = function (name, ...args) {
  if (name === 'electron') return electron;
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, resolveJsonModule: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PROMPT_MAX, chosenEngine, distinctiveTerms, insertDictation, speechEngines, speechPrompt
} = require('../src/shared/speech.ts');
const { audioFormat, cleanVoice, spokenText, transcribe } = require('../src/main/speech.ts');
const { Repository } = require('../src/main/repository.ts');
const { Service } = require('../src/main/service.ts');

const provider = (id, baseUrl, extra = {}) => ({
  id, name: id, kind: 'openai-compatible', baseUrl, models: [], enabled: true, createdAt: 0, hasApiKey: true, ...extra
});
const groq = provider('Groq', 'https://api.groq.com/openai/v1');
const openai = provider('OpenAI', 'https://api.openai.com/v1');
const whisper = { id: 'whisper-large-v3', label: 'Whisper', segments: true };
const gpt4o = { id: 'gpt-4o-transcribe', label: 'GPT-4o', segments: false };

/** Replaces fetch for one test; returns the requests it saw. */
function mockFetch(t, respond) {
  const saved = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    seen.push({ url, options });
    return respond(url, options);
  };
  t.after(() => { global.fetch = saved; });
  return seen;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const audio = new Uint8Array([26, 69, 223, 163, 1, 2, 3, 4]);

test('engines: only providers with a key and a transcription endpoint, most accurate model first', () => {
  const engines = speechEngines([
    groq,
    provider('NoKey', 'https://api.groq.com/openai/v1', { hasApiKey: false }),
    provider('DeepSeek', 'https://api.deepseek.com/v1'),
    { ...provider('Claude', 'https://api.anthropic.com/v1'), kind: 'anthropic' },
    openai
  ]);
  assert.deepEqual(engines.map((e) => `${e.providerId}/${e.model.id}`), [
    'Groq/whisper-large-v3', 'Groq/whisper-large-v3-turbo',
    'OpenAI/gpt-4o-transcribe', 'OpenAI/gpt-4o-mini-transcribe', 'OpenAI/whisper-1'
  ]);
});

test('the chosen engine: yours while it exists, else the first that can transcribe', () => {
  const both = [groq, openai];
  assert.equal(chosenEngine(both, undefined).model.id, 'whisper-large-v3');
  assert.equal(chosenEngine(both, { providerId: 'OpenAI', model: 'whisper-1', language: 'en' }).model.id, 'whisper-1');
  // A model the provider no longer offers falls back to its best.
  assert.equal(chosenEngine(both, { providerId: 'OpenAI', model: 'gone', language: 'en' }).model.id, 'gpt-4o-transcribe');
  // A removed provider falls back to the first engine.
  assert.equal(chosenEngine([groq], { providerId: 'OpenAI', model: 'whisper-1', language: 'en' }).providerId, 'Groq');
  assert.equal(chosenEngine([provider('DeepSeek', 'https://api.deepseek.com/v1')], undefined), null);
});

test('distinctive terms: file names, identifiers and acronyms, newest first, each once', () => {
  const terms = distinctiveTerms('Open AgentComposer.tsx and call speechTranscribe over IPC. Then AgentComposer.tsx again, and use_dictation in the UI.');
  assert.deepEqual(terms, ['use_dictation', 'AgentComposer.tsx', 'IPC', 'speechTranscribe']);
});

test('the hint names who and what you are likely to say, ends with the draft, and stays short', () => {
  const prompt = speechPrompt({
    names: ['Axon', 'Ada', '', 'Axon'],
    recent: 'The bug is in useDictation and DictationButton.tsx.',
    draft: 'Please fix the'
  });
  assert.equal(prompt, 'Glossary: Axon, Ada, DictationButton.tsx, useDictation. Please fix the');
  const long = speechPrompt({
    names: ['Axon'],
    recent: Array.from({ length: 200 }, (_, i) => `someIdentifier${i}`).join(' '),
    draft: 'word '.repeat(100)
  });
  assert.ok(long.length <= PROMPT_MAX, `${long.length} > ${PROMPT_MAX}`);
  assert.match(long, /^Glossary: Axon, someIdentifier199,/);
  assert.match(long, /word word$/);
  assert.equal(speechPrompt({ names: [], recent: '', draft: '' }), '');
});

test('dictated words go where the cursor was, with spaces only where needed', () => {
  assert.deepEqual(insertDictation('', ' Hello there. ', 0), { text: 'Hello there.', caret: 12 });
  assert.deepEqual(insertDictation('Fix', 'the bug', 3), { text: 'Fix the bug', caret: 11 });
  assert.deepEqual(insertDictation('Fix  now', 'the bug', 4), { text: 'Fix the bug now', caret: 11 });
  assert.deepEqual(insertDictation('Fix.', 'the bug', 3), { text: 'Fix the bug.', caret: 11 });
  // A selection is replaced.
  assert.deepEqual(insertDictation('Fix that thing', 'this', 4, 8), { text: 'Fix this thing', caret: 8 });
  assert.deepEqual(insertDictation('Keep', '   ', 4), { text: 'Keep', caret: 4 });
});

test('Groq gets the recording, Whisper large v3, temperature 0, the language and the hint', async (t) => {
  const seen = mockFetch(t, () => json({ text: ' Hello Axon.', segments: [{ text: ' Hello Axon.', no_speech_prob: 0.01, avg_logprob: -0.2 }] }));
  const text = await transcribe(groq, 'gsk_secret', { audio, mime: 'audio/webm;codecs=opus', model: whisper, language: 'en', prompt: 'Glossary: Axon.' });
  assert.equal(text, 'Hello Axon.');
  const [{ url, options }] = seen;
  assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer gsk_secret');
  const form = options.body;
  assert.equal(form.get('model'), 'whisper-large-v3');
  assert.equal(form.get('temperature'), '0');
  assert.equal(form.get('response_format'), 'verbose_json');
  assert.equal(form.get('language'), 'en');
  assert.equal(form.get('prompt'), 'Glossary: Axon.');
  const file = form.get('file');
  assert.equal(file.name, 'speech.webm');
  assert.equal(file.type, 'audio/webm');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), audio);
});

test('GPT-4o Transcribe is asked for plain JSON; a detected language sends none', async (t) => {
  const seen = mockFetch(t, () => json({ text: 'Ship it.' }));
  assert.equal(await transcribe(openai, 'sk-x', { audio, mime: 'audio/webm', model: gpt4o, language: '', prompt: '' }), 'Ship it.');
  const form = seen[0].options.body;
  assert.equal(form.get('response_format'), 'json');
  assert.equal(form.get('language'), null);
  assert.equal(form.get('prompt'), null);
});

test('stretches Whisper judged to be silence, and a read-back hint, are dropped', () => {
  assert.equal(spokenText({ segments: [
    { text: ' Add a test', no_speech_prob: 0.02, avg_logprob: -0.3 },
    { text: ' for the parser.', no_speech_prob: 0.7, avg_logprob: -0.5 },
    { text: ' Thank you for watching.', no_speech_prob: 0.92, avg_logprob: -1.4 },
    { text: ' Glossary: Axon, Ada.', no_speech_prob: 0.1, avg_logprob: -0.2 }
  ] }), 'Add a test for the parser.');
  assert.equal(spokenText({ text: 'Glossary: Axon.' }), '');
  assert.equal(spokenText({ text: '  Two\nlines ' }), 'Two lines');
  assert.throws(() => spokenText({ nope: true }), /not with a transcript/);
});

test('a refused key says to check it, without showing it', async (t) => {
  mockFetch(t, () => json({ error: { message: 'Invalid API Key gsk_secret' } }, 401));
  await assert.rejects(
    transcribe(groq, 'gsk_secret', { audio, mime: 'audio/webm', model: whisper, language: 'en', prompt: '' }),
    (error) => /HTTP 401/.test(error.message) && /Check the API key/.test(error.message) && !error.message.includes('gsk_secret')
  );
});

test('audio formats: the codecs are left off; video and unknown types are refused', () => {
  assert.deepEqual(audioFormat('audio/webm;codecs=opus'), { type: 'audio/webm', extension: 'webm' });
  assert.deepEqual(audioFormat('audio/mp4'), { type: 'audio/mp4', extension: 'm4a' });
  assert.equal(audioFormat('video/webm'), null);
  assert.equal(audioFormat('text/plain'), null);
});

test('voice settings: missing is the default; nonsense is refused', () => {
  assert.deepEqual(cleanVoice(undefined), { providerId: null, model: '', language: 'en' });
  assert.deepEqual(cleanVoice({ providerId: 'Groq', model: 'whisper-large-v3', language: '' }), { providerId: 'Groq', model: 'whisper-large-v3', language: '' });
  assert.throws(() => cleanVoice({ language: 'english' }), /Invalid voice settings/);
  assert.throws(() => cleanVoice({ providerId: 7 }), /Invalid voice settings/);
});

const makeService = (keys = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-speech-'));
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const repo = new Repository(path.join(dir, 'db'), path.join(dir, 'backups'));
  const vault = { has: (id) => id in keys, get: (id) => keys[id] ?? null, set() {}, remove() {} };
  return { dir, repo, service: new Service(repo, vault, dir, () => {}, 'parser-worker-path') };
};

test('the service transcribes with the saved key and your language, and bounds the hint', async (t) => {
  const { dir, repo, service } = makeService({ Groq: 'gsk_saved' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  repo.state.providers.push({ ...groq, hasApiKey: false });
  await service.settingsSave({ ...repo.state.settings, voice: { providerId: null, model: '', language: 'pa' } });
  const seen = mockFetch(t, () => json({ text: 'Sat sri akal' }));
  const buffer = audio.buffer.slice(0);
  assert.equal(await service.speechTranscribe(buffer, 'audio/webm;codecs=opus', 'x'.repeat(5000)), 'Sat sri akal');
  const { url, options } = seen[0];
  assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(options.headers.Authorization, 'Bearer gsk_saved');
  assert.equal(options.body.get('language'), 'pa');
  assert.equal(options.body.get('prompt').length, PROMPT_MAX);
  // Electron hands typed arrays over as views.
  assert.equal(await service.speechTranscribe(new Uint8Array(audio), 'audio/webm', ''), 'Sat sri akal');
});

test('the service refuses an empty or oversized recording, and says what to add when nothing can transcribe', async (t) => {
  const { dir, repo, service } = makeService({});
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(service.speechTranscribe(new ArrayBuffer(0), 'audio/webm', ''), /recording is empty/);
  await assert.rejects(service.speechTranscribe(new ArrayBuffer(25 * 1024 * 1024), 'audio/webm', ''), /too long/);
  repo.state.providers.push({ ...groq });
  await assert.rejects(service.speechTranscribe(audio.buffer.slice(0), 'audio/webm', ''), /needs a Groq or OpenAI key/);
  await assert.rejects(service.settingsSave({ ...repo.state.settings, voice: { providerId: null, model: '', language: 'English' } }), /Invalid voice settings/);
});
