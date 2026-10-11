// Each place in the office is named once at every zoom: a district by its sign in the world, a
// department by its chip. Counts the names in view at the opening view and the whole campus, checks
// no chip sits on a sign, and photographs both.
// Build first (npx electron-vite build), then:
//   npx electron tests/place-labels-desktop.cjs [1536x816] [dark]
// Screenshots go to test-results/place-labels.
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT', error);
  process.exit(1);
});
process.env.AXON_QUIET_NOTIFICATIONS = '1';
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '..');
const [width, height] = (process.argv.find((a) => /^\d+x\d+$/.test(a)) ?? '1536x816').split('x').map(Number);
const theme = process.argv.includes('dark') ? 'dark' : 'light';
const output = path.join(repo, 'test-results/place-labels');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
app.setPath('userData', profile);
app.on('quit', () => {
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    // Left for the next run's tidy-up.
  }
});
fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({ maximized: false }));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const settings = {
  theme,
  autoTitleConversations: true,
  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,
  streamDeltas: true,
  allowShellExecution: false,
  shellAllowlist: [],
  sendCrashDiagnostics: false,
  dataDirectoryNote: '',
  welcomeDone: true
};
const state = {
  version: 1,
  providers: [],
  workspaces: [],
  agents: [],
  documents: [],
  chunks: [],
  mcpServers: [],
  tasks: [],
  conversations: [],
  messages: [],
  settings
};
fs.mkdirSync(path.join(profile, 'data/db'), { recursive: true });
fs.writeFileSync(path.join(profile, 'data/db/platform-v1.json'), JSON.stringify(state));
require(path.join(repo, 'out/main/index.js'));

const timeout = setTimeout(() => {
  console.error('TIMEOUT');
  app.exit(1);
}, 120000);
app.on('browser-window-created', (_, win) => {
  win.show = () => {
    win.setPosition(-2400, 0);
    win.showInactive();
  };
  win.webContents.setBackgroundThrottling(false);
  win.setContentSize(width, height);
});
let reloaded = false;
app.on('web-contents-created', (_, contents) => {
  contents.on('did-finish-load', async () => {
    const evaluate = (script) => contents.executeJavaScript(script);
    if (!reloaded) {
      // The debug handle reads sign positions; it is switched on before the page loads.
      reloaded = true;
      await evaluate("localStorage.setItem('axon.officeDebug', '1')");
      contents.reload();
      return;
    }
    const problems = [];
    try {
      const waitFor = async (script, label, tries = 300) => {
        for (let i = 0; i < tries; i++) {
          if (await evaluate(script)) return;
          await pause(100);
        }
        throw new Error('Timed out: ' + label);
      };
      const snap = async (name) => {
        await pause(200);
        const image = await contents.capturePage();
        fs.writeFileSync(path.join(output, `${name}-${width}x${height}-${theme}.png`), image.toPNG());
      };
      const check = (ok, problem) => {
        if (!ok) problems.push(problem);
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${problem}`);
      };
      /** The names in view: HTML chips and the district signs drawn in the world, in page pixels. */
      const names = () =>
        evaluate(`(() => {
          const canvas = document.querySelector('.office-canvas-container canvas').getBoundingClientRect();
          const tier = [...document.querySelector('.office-scene-labels').classList].find((c) => c.startsWith('tier-'));
          const chips = [...document.querySelectorAll('.office-place-label')]
            .filter((l) => getComputedStyle(l).visibility !== 'hidden' && getComputedStyle(l).opacity !== '0')
            .map((l) => {
              const r = l.getBoundingClientRect();
              return { id: l.dataset.anchor.slice(6), text: l.innerText.replace(/\\s+/g, ' '), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            })
            .filter((c) => c.right > canvas.left && c.left < canvas.right && c.bottom > canvas.top && c.top < canvas.bottom);
          const signs = window.__axonOffice.signs()
            .filter((s) => s.kind === 'district' && s.opacity > 0)
            .map((s) => ({ id: s.id, opacity: s.opacity, ...window.__axonOffice.signPoint(s.id) }))
            .map((s) => ({ ...s, x: s.x + canvas.left, y: s.y + canvas.top }))
            .filter((s) => s.x > canvas.left && s.x < canvas.right && s.y > canvas.top && s.y < canvas.bottom);
          return { tier, chips, signs };
        })()`);
      /** A chip on top of a sign: the sign's face centre within 40 px of the chip. */
      const covering = ({ chips, signs }) =>
        chips.flatMap((c) =>
          signs
            .filter(
              (s) =>
                s.opacity === 1 &&
                s.x > c.left - 40 &&
                s.x < c.right + 40 &&
                s.y > c.top - 40 &&
                s.y < c.bottom + 40
            )
            .map((s) => `${c.text} on ${s.id}`)
        );

      await waitFor('window.__axonOffice && !document.querySelector(".office-loading")', 'office');
      await pause(2500);

      // ---------------------------------------------------------------- the opening view
      const opening = await names();
      console.log(
        'opening',
        opening.tier,
        JSON.stringify(opening.chips.map((c) => c.text)),
        JSON.stringify(opening.signs.map((s) => s.id))
      );
      check(
        opening.chips.every((c) => c.id.startsWith('department:')),
        'opening view: chips name departments only'
      );
      const openingCover = covering(opening);
      check(
        openingCover.length === 0,
        `opening view: no chip covers a district sign ${JSON.stringify(openingCover)}`
      );
      await snap('1-opening');

      // ---------------------------------------------------------------- the whole campus
      await evaluate(`document.querySelector('[aria-label="Whole campus"]').click()`);
      await waitFor(
        "window.__axonOffice.signs().filter((s) => s.kind === 'district' && s.opacity === 1).length === 9",
        'district signs'
      );
      await waitFor(
        `document.querySelector('.office-scene-labels').classList.contains('tier-far')`,
        'far labels'
      );
      await pause(2500);
      const campus = await names();
      console.log(
        'campus',
        campus.tier,
        JSON.stringify(campus.chips.map((c) => c.text)),
        JSON.stringify(campus.signs.map((s) => s.id))
      );
      const named = new Map();
      for (const s of campus.signs) named.set(s.id, (named.get(s.id) ?? 0) + 1);
      for (const c of campus.chips) named.set(c.id, (named.get(c.id) ?? 0) + 1);
      const twice = [...named].filter(([, n]) => n > 1).map(([id]) => id);
      check(twice.length === 0, `whole campus: each district named once ${JSON.stringify(twice)}`);
      check(
        campus.signs.length >= 8,
        `whole campus: the district signs are up (${campus.signs.length} in view)`
      );
      const campusCover = covering(campus);
      check(
        campusCover.length === 0,
        `whole campus: no chip covers a district sign ${JSON.stringify(campusCover)}`
      );
      await snap('2-campus');
    } catch (error) {
      problems.push(String(error?.stack ?? error));
      console.error(error);
    }
    clearTimeout(timeout);
    console.log(problems.length ? `FAILED: ${problems.length}` : 'ALL CHECKS PASSED');
    app.exit(problems.length ? 1 : 0);
  });
});
