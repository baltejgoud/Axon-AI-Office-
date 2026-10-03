// Desktop check: voice typing in the real office composer, from microphone to words in the box.
// Run after a build: npx electron-vite build && npx electron tests/dictation-desktop.cjs
// Chromium's fake microphone plays a generated voice-like sound; Groq's endpoint is answered here,
// so the check needs no key and no network. AXON_DICTATION_WAV=<file.wav> plays your own recording.
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../test-results/dictation');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

/** Three seconds of voiced sound: a 140 Hz buzz with vowel-like overtones, in syllables. */
function voiceWav(file) {
  const rate = 48000, seconds = 3, samples = rate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 3.5 * t)) ** 0.6;
    let s = 0;
    for (let h = 1; h <= 12; h++) s += Math.sin(2 * Math.PI * 140 * h * t + h) * (h === 4 || h === 8 ? 1 : 0.5) / h;
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s * syllable * 0.5)) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
  return file;
}
const wav = process.env.AXON_DICTATION_WAV || voiceWav(path.join(profile, 'voice.wav'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', wav);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const localDay = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};

/** Every transcription request, as Groq would have received it. */
const heard = [];
const SAID = 'Add a test for the speech parser.';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).endsWith('/audio/transcriptions')) return realFetch(url, options);
  const form = options.body;
  const file = form.get('file');
  heard.push({
    url: String(url),
    authorization: options.headers?.Authorization,
    model: form.get('model'),
    language: form.get('language'),
    temperature: form.get('temperature'),
    format: form.get('response_format'),
    prompt: form.get('prompt'),
    type: file.type,
    name: file.name,
    bytes: file.size
  });
  await pause(400);
  return new Response(
    JSON.stringify({ text: ` ${SAID}`, segments: [{ text: ` ${SAID}`, no_speech_prob: 0.01, avg_logprob: -0.15 }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

const timeout = setTimeout(() => {
  console.error('DICTATION_CHECK_TIMEOUT');
  app.exit(1);
}, 120000);
app.on('browser-window-created', (_, win) => {
  win.show = () => {
    win.setPosition(-2200, 0);
    win.showInactive();
  };
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(1536, 816);
});
app.on('web-contents-created', (_, contents) => {
  contents.once('did-finish-load', async () => {
    try {
      const evaluate = (script) => contents.executeJavaScript(script, true);
      const waitFor = async (script, label, tries = 150) => {
        for (let i = 0; i < tries; i++) {
          if (await evaluate(`!!(${script})`)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      const snap = async (name) => fs.writeFileSync(path.join(output, name), (await contents.capturePage()).toPNG());
      const key = (init) =>
        evaluate(
          `document.querySelector('.composer-textarea').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...${JSON.stringify(init)} }))`
        );
      const boxText = () => evaluate('document.querySelector(".composer-textarea").value');
      /** The loudest the meter showed while recording. */
      const meterPeak = async (ms) => {
        let peak = 0;
        for (let t = 0; t < ms; t += 100) {
          peak = Math.max(peak, Number(await evaluate(`getComputedStyle(document.querySelector('.dictation')).getPropertyValue('--mic-level')`)) || 0);
          await pause(100);
        }
        return peak;
      };

      await waitFor('document.querySelector(".office-person-label") && !document.querySelector(".office-loading")', 'the office');
      await pause(500);
      await evaluate(
        `(() => { const input = document.querySelector('[aria-label="Find a coworker"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'backend developer'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(150);
      await evaluate('document.querySelector(".office-search-results > button").click()');
      await waitFor('document.querySelector(".activity-agent-meta h3")?.textContent === "Backend Developer"', 'Backend Developer');
      await waitFor('document.querySelector(".dictation-btn")', 'the microphone button');
      await snap('0-idle.png');

      // 1. Click the microphone: it records, and the meter moves with the sound.
      await evaluate('document.querySelector(".dictation-btn").click()');
      await waitFor('document.querySelector(".dictation-recording")', 'recording to start');
      const peak = await meterPeak(2500);
      assert.ok(peak > 0.05, `the meter heard the microphone (peak ${peak})`);
      assert.match(await evaluate('document.querySelector(".composer-textarea").placeholder'), /Listening/);
      assert.match(await evaluate('document.querySelector(".dictation-clock").textContent'), /0:0[1-9]/);
      await snap('1-recording.png');

      // 2. Enter finishes: the recording goes to Groq's Whisper large v3, and the words land in the box.
      await key({ key: 'Enter' });
      await waitFor('document.querySelector(".dictation-transcribing")', 'transcribing');
      await snap('2-transcribing.png');
      await waitFor('document.querySelector(".dictation-idle")', 'the words');
      assert.equal(await boxText(), SAID);
      assert.equal(heard.length, 1);
      const [request] = heard;
      assert.equal(request.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
      assert.equal(request.authorization, 'Bearer gsk_desktop_check');
      assert.equal(request.model, 'whisper-large-v3');
      assert.equal(request.language, 'en');
      assert.equal(request.temperature, '0');
      assert.equal(request.format, 'verbose_json');
      assert.equal(request.type, 'audio/webm');
      assert.equal(request.name, 'speech.webm');
      assert.ok(request.bytes > 4000, `a real recording was sent (${request.bytes} bytes)`);
      assert.match(request.prompt, /^Glossary: Axon, Backend Developer/);
      assert.equal(await evaluate('document.activeElement === document.querySelector(".composer-textarea")'), true, 'the box has focus to check and send');
      await snap('3-typed.png');

      // 3. Esc drops a recording: nothing is sent, the box is unchanged.
      await evaluate('document.querySelector(".dictation-btn").click()');
      await waitFor('document.querySelector(".dictation-recording")', 'the second recording');
      await pause(600);
      await key({ key: 'Escape' });
      await waitFor('document.querySelector(".dictation-idle")', 'Esc to cancel');
      await pause(700);
      assert.equal(heard.length, 1, 'a cancelled recording is never sent');
      assert.equal(await boxText(), SAID);

      // 4. Ctrl+M starts and finishes; the words follow what is already there, with the box as the hint's end.
      await key({ key: 'm', ctrlKey: true });
      await waitFor('document.querySelector(".dictation-recording")', 'Ctrl+M to start');
      await pause(1200);
      await key({ key: 'm', ctrlKey: true });
      await waitFor('document.querySelector(".dictation-idle")', 'Ctrl+M to finish');
      assert.equal(await boxText(), `${SAID} ${SAID}`);
      assert.equal(heard.length, 2);
      assert.match(heard[1].prompt, /Add a test for the speech parser\.$/);

      // 5. Only the microphone is allowed: the camera stays off.
      const camera = await evaluate(
        'navigator.mediaDevices.getUserMedia({ video: true }).then((s) => { s.getTracks().forEach((t) => t.stop()); return "allowed"; }, (e) => e.name)'
      );
      assert.equal(camera, 'NotAllowedError');

      // 6. Settings → Voice typing names the engine and the language.
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true, bubbles: true }))`);
      await waitFor('document.querySelector("#settings-tab-voice")', 'Settings');
      await evaluate('document.querySelector("#settings-tab-voice").click()');
      await waitFor('document.querySelector("#setting-voice-engine")', 'the voice section');
      const engine = await evaluate('document.querySelector("#setting-voice-engine").selectedOptions[0].textContent');
      assert.equal(engine, 'Groq · Whisper large v3 (most accurate)');
      assert.equal(await evaluate('document.querySelector("#setting-voice-language").value'), 'en');
      await pause(800);
      await snap('4-settings.png');

      console.log('DICTATION_CHECK_PASS', output);
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      console.error('DICTATION_CHECK_FAIL', error);
      try {
        fs.writeFileSync(path.join(output, 'failure.png'), (await contents.capturePage()).toPNG());
      } catch {}
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});

// Before Axon starts: a saved Groq provider and its key, as Settings → Models would leave them.
void app.whenReady().then(() => {
  const now = Date.now();
  fs.mkdirSync(path.join(profile, 'data/db'), { recursive: true });
  fs.mkdirSync(path.join(profile, 'secrets'), { recursive: true });
  fs.writeFileSync(
    path.join(profile, 'secrets/os-vault.json'),
    JSON.stringify({ groq: safeStorage.encryptString('gsk_desktop_check').toString('base64') })
  );
  fs.writeFileSync(
    path.join(profile, 'data/db/platform-v1.json'),
    JSON.stringify({
      version: 1,
      providers: [
        {
          id: 'groq', name: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1',
          models: [{ id: 'openai/gpt-oss-120b', displayName: 'GPT-OSS 120B' }], enabled: true, createdAt: now, hasApiKey: true
        }
      ],
      workspaces: [], conversations: [], messages: [], agents: [], documents: [], chunks: [], mcpServers: [], tasks: [],
      reception: { briefedOn: localDay() },
      settings: {
        theme: 'light', autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true,
        allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: ''
      }
    })
  );
});
require('../out/main/index.js');
