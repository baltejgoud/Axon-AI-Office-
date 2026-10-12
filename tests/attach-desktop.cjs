// Pictures and files you attach, end to end in the built app: the composer's preview, what the model is
// sent (shrunk, turned upright), the preview on your message, a model that can't see pictures, and
// files pasted or dropped into the chat box. Only the provider is a loopback fixture.
// Run after a build: npx electron-vite build && npx electron tests/attach-desktop.cjs
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app, dialog, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const output = path.resolve(__dirname, '../test-results/attach');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const localDay = () => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
};

/** A solid bitmap, BGRA as Electron takes it, with a different colour left and right of `split`. */
function bitmap(width, height, split, left, right) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) Buffer.from(x < split ? left : right).copy(data, (y * width + x) * 4);
  return nativeImage.createFromBitmap(data, { width, height });
}
const RED = [0, 0, 255, 255], BLUE = [255, 0, 0, 255], GREEN = [0, 160, 0, 255];
/** A JPEG as a phone writes it: stored sideways, with EXIF saying to turn it 90 degrees clockwise. */
function sidewaysJpeg() {
  const jpeg = bitmap(400, 200, 200, RED, BLUE).toJPEG(90);
  const tiff = Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1, 0, exif.length + 2]), exif, jpeg.subarray(2)]);
}
/** The colour at (x, y) of a decoded picture, as [r, g, b]. */
function colourAt(image, x, y) {
  const { width } = image.getSize();
  const i = (y * width + x) * 4, data = image.toBitmap();
  return [data[i + 2], data[i + 1], data[i]];
}
const imageOf = (url) => nativeImage.createFromBuffer(Buffer.from(url.split(',')[1], 'base64'));

const requests = [];
const server = http.createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const parsed = JSON.parse(body);
    requests.push(parsed);
    const asked = [...parsed.messages].reverse().find((m) => m.role === 'user');
    const question = typeof asked.content === 'string' ? asked.content : asked.content.find((p) => p.type === 'text').text;
    const pictures = parsed.messages.some((m) => Array.isArray(m.content));
    // A model that can't see pictures refuses them, as DeepSeek does.
    if (pictures && question.startsWith('Blind:')) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Failed to deserialize the JSON body: unknown variant `image_url`, expected `text`' } }));
      return;
    }
    const answer = pictures ? 'I can see the picture.' : 'I only got the file name.';
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`);
  });
});

const timeout = setTimeout(() => {
  console.error('ATTACH_CHECK_TIMEOUT');
  app.exit(1);
}, 240000);
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
      const evaluate = (script) => contents.executeJavaScript(script).catch((error) => { throw new Error(`${error.message} in: ${script.trim().slice(0, 120)}`); });
      const waitFor = async (script, label) => {
        for (let i = 0; i < 150; i++) {
          if (await evaluate(script)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      const snap = async (name) => fs.writeFileSync(path.join(output, name), (await contents.capturePage()).toPNG());
      const type = (text) => evaluate(`(() => {
        const input = document.querySelector('.composer-textarea');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const send = async () => {
        await pause(70);
        await evaluate('document.querySelector(".composer-btn-send").click()');
      };
      const chips = () => evaluate('[...document.querySelectorAll(".composer-attachment-tag:not(.handed):not(.adding)")].map(c => c.textContent.trim())');
      /** Files as the browser hands them over: a DataTransfer carrying a File for each of these. */
      const transfer = (files) => `(() => {
        const dt = new DataTransfer();
        for (const f of ${JSON.stringify(files)}) {
          const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
          dt.items.add(new File([bytes], f.name, { type: f.type }));
        }
        return dt;
      })()`;
      const paste = (files, text = '') => evaluate(`(() => {
        const dt = ${transfer(files)};
        ${text ? `dt.setData('text/plain', ${JSON.stringify(text)});` : ''}
        const box = document.querySelector('.composer-textarea');
        const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        box.dispatchEvent(event);
        return event.defaultPrevented;
      })()`);
      const dragOver = (files, type = 'dragenter') => evaluate(`(() => {
        const panel = document.querySelector('.office-activity-panel');
        panel.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { dataTransfer: ${transfer(files)}, bubbles: true, cancelable: true }));
      })()`);
      const file = (name, type, bytes) => ({ name, type, base64: Buffer.from(bytes).toString('base64') });

      await waitFor('document.querySelector(".office-person-label") && !document.querySelector(".office-loading")', 'the office');
      await pause(500);
      await evaluate(
        `(() => { const input = document.querySelector('[aria-label="Find a coworker"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'backend developer'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`
      );
      await pause(150);
      await evaluate('document.querySelector(".office-search-results > button").click()');
      await waitFor('document.querySelector(".activity-agent-meta h3")?.textContent === "Backend Developer"', 'Backend Developer');
      // Open their conversation as you would: the panel slides in, and it is the one files are dropped on.
      await evaluate('[...document.querySelectorAll("button")].find((b) => b.textContent === "Ask a question")?.click()');
      await waitFor('document.querySelector(".conversation-drawer.is-open")', 'the conversation panel');
      await pause(600);

      // 1. A screenshot chosen in the file dialog, bigger than models take: shrunk, previewed, sent as a picture.
      const wide = path.join(profile, 'screenshot.png');
      fs.writeFileSync(wide, bitmap(2400, 1200, 1200, GREEN, BLUE).toPNG());
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [wide] });
      await evaluate('document.querySelector("[aria-label=\\"Attach file\\"]").click()');
      await waitFor('document.querySelector(".composer-attachment-thumb")', 'picture preview in the composer');
      assert.match(await evaluate('document.querySelector(".composer-attachment-thumb").src'), /^data:image\/png;base64,/);
      await snap('1-composer.png');
      await type('What is in this picture?');
      await send();
      await waitFor('[...document.querySelectorAll(".office-thread .message.assistant")].some(m => m.textContent.includes("I can see the picture."))', 'answer about the picture');
      const first = requests.flatMap((r) => r.messages).find((m) => m.role === 'user' && Array.isArray(m.content));
      assert.equal(first.content[0].text, 'What is in this picture?');
      assert.match(first.content[1].image_url.url, /^data:image\/png;base64,/);
      assert.deepEqual(imageOf(first.content[1].image_url.url).getSize(), { width: 1568, height: 784 });
      await waitFor('document.querySelector(".office-thread .message.user .message-pictures img")', 'picture on your message');
      assert.deepEqual(await chips(), [], 'the composer is clear after sending');

      // 2. A screenshot pasted: named from the time, previewed; plain text pasted stays text.
      const shot = bitmap(300, 200, 150, RED, GREEN).toPNG();
      assert.equal(await paste([file('image.png', 'image/png', shot)]), true, 'the picture is taken, not pasted as text');
      await waitFor('document.querySelector(".composer-attachment-thumb")', 'pasted picture in the composer');
      const [pasted] = await chips();
      assert.match(pasted, /^Pasted image \d\d-\d\d\.png$/);
      assert.equal(await paste([file('image.png', 'image/png', shot)], 'Some copied words'), false, 'text with a picture alongside pastes as text');
      await pause(300);
      assert.equal((await chips()).length, 1, 'copied text did not attach its picture');
      await snap('2-pasted.png');
      await type('Please compare');
      await send();
      await waitFor('document.querySelectorAll(".office-thread .message.user .message-pictures img").length === 2', 'the pasted picture on your message');
      await waitFor('!document.querySelector(".composer-btn-stop")', 'the answer to the pasted picture');

      // 3. Files dragged over the panel: a calm overlay; dropped, a phone photo (stored sideways) and a document attach.
      const photo = file('photo.jpg', 'image/jpeg', sidewaysJpeg());
      const notes = file('notes.txt', 'text/plain', 'The launch is on Friday.');
      await dragOver([photo, notes]);
      await waitFor('document.querySelector(".drop-overlay")', 'the drop overlay');
      assert.match(await evaluate('document.querySelector(".drop-overlay").textContent'), /Drop files to attach/);
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".drop-overlay")).pointerEvents'), 'none');
      await pause(400);
      await snap('3-dragging.png');
      await dragOver([photo, notes], 'dragleave');
      await waitFor('!document.querySelector(".drop-overlay")', 'the overlay to go when the drag leaves');
      await dragOver([photo, notes]);
      await dragOver([photo, notes], 'drop');
      await waitFor('document.querySelectorAll(".composer-attachment-tag:not(.handed):not(.adding)").length === 2 && !document.querySelector(".composer-attachment-tag.adding")', 'the dropped files');
      assert.deepEqual(await chips(), ['photo.jpg', 'notes.txt']);
      assert.equal(await evaluate('document.querySelectorAll(".composer-attachment-thumb").length'), 1, 'only the photo has a preview');
      assert.equal(await evaluate('!document.querySelector(".drop-overlay")'), true);
      const before = requests.length;
      // This model "can't see pictures": it refuses them and still answers, and says so.
      await type('Blind: and these?');
      await send();
      // The thread redraws as the run ends, so the notice is looked for by its words rather than held as an element.
      await waitFor(`/can't see pictures/.test(document.querySelector(".office-thread .message-notice")?.textContent ?? "")`, 'the notice that the model cannot see pictures');
      const refused = requests.slice(before)[0].messages.filter((m) => m.role === 'user' && Array.isArray(m.content)).at(-1);
      const upright = imageOf(refused.content[1].image_url.url);
      assert.deepEqual(upright.getSize(), { width: 200, height: 400 });
      const [top, bottom] = [colourAt(upright, 100, 60), colourAt(upright, 100, 340)];
      assert.ok(top[0] > 200 && top[2] < 60, `top should be red, was ${top}`);
      assert.ok(bottom[2] > 200 && bottom[0] < 60, `bottom should be blue, was ${bottom}`);
      assert.match(refused.content[0].text, /The launch is on Friday\./, 'the dropped document went as text');
      // The same question again, with the photo as a name (other requests in between are background housekeeping).
      const retried = requests.slice(before).find((r) => r.messages.some((m) => typeof m.content === 'string' && /\[Picture attached: photo\.jpg\./.test(m.content)));
      assert.ok(retried, 'the question was sent again with the photo named');
      assert.ok(retried.messages.every((m) => typeof m.content === 'string'));
      assert.match(retried.messages.filter((m) => m.role === 'user').at(-1).content, /The launch is on Friday\./);
      await pause(300);
      await snap('4-thread.png');

      // 4. More than five dropped at once: five go, and the note says so plainly.
      await waitFor('!document.querySelector(".composer-btn-stop")', 'the run to end');
      const many = Array.from({ length: 7 }, (_, i) => file(`doc${i}.txt`, 'text/plain', `document ${i}`));
      await dragOver(many, 'drop');
      await waitFor('document.querySelector(".composer-notice")', 'the note about the limit');
      assert.equal((await chips()).length, 5);
      assert.match(await evaluate('document.querySelector(".composer-notice").textContent'), /up to 5 files, so I added the first 5 and left out 2/);
      await snap('5-limit.png');

      // Pictures are kept with the conversation, one file each; nothing unsent is left lying around.
      const kept = fs.readdirSync(path.join(profile, 'data', 'attachments')).filter((f) => f !== 'waiting');
      assert.equal(kept.length, 3, `kept ${kept}`);
      console.log('ATTACH_CHECK_PASS: dialog picture shrunk and sent, pasted screenshot named from the time, drop overlay, dropped photo sent upright, document dropped as text, blind model answered with a notice, five-file limit explained.');
      clearTimeout(timeout);
      server.close();
      app.exit(0);
    } catch (error) {
      console.error('ATTACH_CHECK_FAIL', error);
      console.error(await contents.executeJavaScript('JSON.stringify({ notes: [...document.querySelectorAll(".composer-notice")].map(n => n.textContent), banner: document.querySelector(".banner-error")?.textContent, chips: [...document.querySelectorAll(".composer-attachment-tag")].map(n => n.textContent) })').catch(() => 'no page state'));
      await contents.capturePage().then((image) => fs.writeFileSync(path.join(output, 'failure.png'), image.toPNG()), () => {});
      clearTimeout(timeout);
      server.close();
      app.exit(1);
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  const now = Date.now();
  fs.mkdirSync(path.join(profile, 'data/db'), { recursive: true });
  fs.writeFileSync(
    path.join(profile, 'data/db/platform-v1.json'),
    JSON.stringify({
      version: 1,
      providers: [{
        id: 'attach-check', name: 'Attach check', kind: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        models: [{ id: 'fixture', displayName: 'Fixture' }], enabled: true, createdAt: now, hasApiKey: false
      }],
      workspaces: [], conversations: [], messages: [], agents: [], documents: [], chunks: [], mcpServers: [], tasks: [],
      reception: { briefedOn: localDay() },
      settings: {
        theme: 'light', autoTitleConversations: true, defaultTemperature: 0.7, defaultMaxTokens: 4096, streamDeltas: true,
        allowShellExecution: false, shellAllowlist: [], sendCrashDiagnostics: false, dataDirectoryNote: ''
      }
    })
  );
  require('../out/main/index.js');
});
