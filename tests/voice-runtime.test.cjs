const ts = require('typescript'),
  fs = require('node:fs'),
  Module = require('node:module');
const { test } = require('node:test'),
  assert = require('node:assert/strict');
let slots = [],
  cursor = 0;
const react = {
  useState(value) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = value;
    return [
      slots[i],
      (next) => {
        slots[i] = typeof next === 'function' ? next(slots[i]) : next;
      }
    ];
  },
  useRef(value) {
    const i = cursor++;
    if (!(i in slots)) slots[i] = { current: value };
    return slots[i];
  },
  useCallback(fn) {
    cursor++;
    return fn;
  },
  useEffect() {
    cursor++;
  }
};
const original = Module._load;
Module._load = function (name, ...args) {
  return name === 'react' ? react : original.call(this, name, ...args);
};
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
const { useDictation } = require('../src/renderer/src/chat/useDictation.ts');
const { insertDictation } = require('../src/shared/speech.ts');
const { activitySentence, runStage } = require('../src/shared/runtimePresentation.ts');
function harness(transcribe = async () => 'spoken words', capture) {
  slots = [];
  let stopped = 0;
  const errors = [],
    words = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      platform: 'Win32',
      mediaDevices: {
        getUserMedia: capture ?? (async () => ({ getTracks: () => [{ stop: () => stopped++ }] }))
      }
    }
  });
  globalThis.window = { setInterval, axon: { speechTranscribe: transcribe } };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.AudioContext = class {
    state = 'running';
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createAnalyser() {
      return { fftSize: 1024, getFloatTimeDomainData: (samples) => samples.fill(0.04) };
    }
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported() {
      return true;
    }
    state = 'inactive';
    mimeType = 'audio/webm';
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['audio']) });
      this.onstop?.();
    }
  };
  const render = () => {
    cursor = 0;
    return useDictation({
      prompt: () => '',
      onText: (text) => words.push(text),
      onError: (error) => errors.push(error)
    });
  };
  return { render, errors, words, stopped: () => stopped };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
test('voice begins visibly before permission resolves; cancel closes late microphone', async () => {
  let release;
  let stopped = 0;
  const h = harness(undefined, () => new Promise((resolve) => (release = resolve)));
  const first = h.render();
  const start = first.start();
  assert.equal(h.render().phase, 'starting');
  first.cancel();
  assert.equal(h.render().phase, 'idle');
  release({ getTracks: () => [{ stop: () => stopped++ }] });
  await start;
  assert.equal(stopped, 1);
});
test('voice start, finish and transcription release microphone and return to idle', async () => {
  const h = harness();
  const first = h.render();
  await first.start();
  assert.equal(h.render().phase, 'recording');
  first.finish();
  assert.equal(h.render().phase, 'transcribing');
  await settle();
  assert.deepEqual(h.words, ['spoken words']);
  assert.equal(h.render().phase, 'idle');
  assert.equal(h.stopped(), 1);
});
test('canceling transcription drops late text and preserves composer contents', async () => {
  let release;
  const h = harness(() => new Promise((resolve) => (release = resolve)));
  const first = h.render();
  await first.start();
  first.finish();
  await settle();
  first.cancel();
  release('late words');
  await settle();
  assert.deepEqual(h.words, []);
  assert.equal(h.render().phase, 'idle');
  assert.equal(insertDictation('keep typed text', 'new words', 5, 5).text, 'keep new words typed text');
});
test('failed transcription can retry captured audio without reopening microphone', async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) throw new Error('Provider unavailable');
    return 'retry worked';
  });
  const first = h.render();
  await first.start();
  first.finish();
  await settle();
  assert.equal(h.render().canRetry, true);
  h.render().retry();
  await settle();
  assert.deepEqual(h.words, ['retry worked']);
  assert.equal(h.stopped(), 1);
});
test('permission errors return to idle with an actionable error', async () => {
  const h = harness(undefined, async () => {
    throw new DOMException('denied', 'NotAllowedError');
  });
  await h.render().start();
  assert.equal(h.render().phase, 'idle');
  assert.match(h.errors[0], /microphone/i);
});
test('timeline presents audit actions in readable language without dumping commands', () => {
  assert.equal(
    activitySentence({ tool: 'run_command', result: 'ok', subject: 'node -e huge internal payload' }),
    'Completed a terminal command.'
  );
  assert.match(
    activitySentence({
      tool: 'edit_file',
      result: 'ok',
      subject: 'callback.ts',
      change: { added: 32, removed: 7 }
    }),
    /Modified callback.ts/
  );
  assert.equal(runStage({ status: 'waiting_for_approval' }), 'Waiting for your approval');
  assert.equal(runStage({ status: 'working', activeTool: 'run_command' }), 'Running command');
});
