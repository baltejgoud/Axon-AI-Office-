// Accounts and source control: GitHub device sign-in, Google loopback sign-in, and the Files room's Git.
const ts = require('typescript');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { isPackaged: false } };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseStatus, parseRepoInput, validBranchName } = require('../src/main/git/parse.ts');
const { gitEnv, scrub } = require('../src/main/git/run.ts');
const { SourceControl } = require('../src/main/git/sourceControl.ts');
const { Accounts, GITHUB_TOKEN, idTokenClaims } = require('../src/main/accounts/accounts.ts');

const realFetch = global.fetch;
/** Replaces fetch for one test; `respond(url, options)` answers, or returns undefined to use the network (the loopback). */
function mockFetch(t, respond) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const answer = await respond(String(url), options);
    return answer ?? realFetch(url, options);
  };
  t.after(() => { global.fetch = realFetch; });
  return calls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-scm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
function memoryVault() {
  const entries = {};
  return { entries, get: (id) => entries[id] ?? null, set: (id, v) => { entries[id] = v; }, remove: (id) => { delete entries[id]; }, has: (id) => id in entries };
}

// ---------------------------------------------------------------- parsing

test('status: branch, ahead/behind, and every kind of change, paths with spaces included', () => {
  const out = [
    '# branch.oid 1234', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa bbb src/app.ts',
    '1 A. N... 000000 100644 100644 000 bbb new file.ts',
    '1 MM N... 100644 100644 100644 aaa bbb both.ts',
    '1 D. N... 100644 000000 000000 aaa 000 gone.ts',
    '2 R. N... 100644 100644 100644 aaa bbb R100 renamed now.ts', 'old name.ts',
    'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
    '? untracked dir/x.txt', ''
  ].join('\0');
  const s = parseStatus(out);
  assert.equal(s.branch, 'main');
  assert.equal(s.upstream, 'origin/main');
  assert.deepEqual([s.ahead, s.behind], [2, 1]);
  assert.deepEqual(s.files, [
    { path: 'src/app.ts', code: 'M', staged: false, unstaged: true },
    { path: 'new file.ts', code: 'A', staged: true, unstaged: false },
    { path: 'both.ts', code: 'M', staged: true, unstaged: true },
    { path: 'gone.ts', code: 'D', staged: true, unstaged: false },
    { path: 'renamed now.ts', code: 'R', staged: true, unstaged: false, origPath: 'old name.ts' },
    { path: 'conflict.ts', code: 'C', staged: false, unstaged: true },
    { path: 'untracked dir/x.txt', code: 'U', staged: false, unstaged: true }
  ]);
  assert.equal(parseStatus('# branch.head (detached)\0').branch, null);
});

test('clone input: owner/name or a github.com address, nothing else', () => {
  assert.deepEqual(parseRepoInput('octo/hello-world'), { url: 'https://github.com/octo/hello-world.git', name: 'hello-world' });
  assert.deepEqual(parseRepoInput(' https://github.com/octo/site.io.git/ '), { url: 'https://github.com/octo/site.io.git', name: 'site.io' });
  for (const bad of ['https://evil.com/a/b', 'git@github.com:a/b', '--upload-pack=x/y', 'a/b/c', 'octo/..', 'file:///etc/x', ''])
    assert.throws(() => parseRepoInput(bad), /GitHub repository/, bad);
});

test('branch names: Git\'s rules, and never something read as an option', () => {
  for (const good of ['main', 'feature/login', 'fix-12', 'release/1.2']) assert.ok(validBranchName(good), good);
  for (const bad of ['-f', '--force', 'a b', 'a..b', 'a~1', 'x.lock', 'a/', '.hidden', 'a//b', '@', 'a@{1}', 'x:y', ''])
    assert.ok(!validBranchName(bad), bad);
});

// ---------------------------------------------------------------- the token

test('the token reaches git through its environment for github.com only, and inherited git config is dropped', () => {
  const env = gitEnv('gho_secret', { PATH: 'x', GIT_CONFIG_COUNT: '5', GIT_CONFIG_KEY_4: 'core.sshCommand', GIT_CONFIG_VALUE_4: 'evil' });
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_CONFIG_COUNT, '2');
  assert.equal(env.GIT_CONFIG_KEY_4, undefined);
  assert.equal(env.GIT_CONFIG_KEY_1, 'http.https://github.com/.extraHeader');
  assert.equal(env.GIT_CONFIG_VALUE_1, `Authorization: Basic ${Buffer.from('x-access-token:gho_secret').toString('base64')}`);
  assert.equal(env.GIT_CONFIG_KEY_0, 'credential.https://github.com.helper');
  const plain = gitEnv(null, { PATH: 'x' });
  assert.equal(plain.GIT_CONFIG_COUNT, undefined);
  const basic = Buffer.from('x-access-token:gho_secret').toString('base64');
  assert.equal(scrub(`fatal: gho_secret and ${basic}`, 'gho_secret'), 'fatal: *** and ***');
});

// ---------------------------------------------------------------- real git

/** A repository in a temp folder, with Git's global settings shut out so the test sees only its own. */
function sandboxGit(t) {
  const dir = temp(t);
  const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  const globalFile = path.join(dir, 'gitconfig');
  fs.writeFileSync(globalFile, '');
  process.env.GIT_CONFIG_GLOBAL = globalFile;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(() => {
    for (const [key, env] of [['global', 'GIT_CONFIG_GLOBAL'], ['system', 'GIT_CONFIG_NOSYSTEM']])
      if (saved[key] === undefined) delete process.env[env]; else process.env[env] = saved[key];
  });
  return { dir, globalFile };
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const profile = { login: 'octo', name: 'Octo Cat', email: '1+octo@users.noreply.github.com', avatar: '' };
function scmFor(root, extra = {}) {
  const lines = [];
  const scm = new SourceControl({ root: () => root, token: () => extra.token ?? null, profile: () => extra.profile ?? null, progress: (l) => lines.push(l) });
  return { scm, lines };
}

test('status, diff, stage, unstage, and commit, with your GitHub name when Git has none', async (t) => {
  const { dir } = sandboxGit(t);
  const root = path.join(dir, 'app');
  fs.mkdirSync(root);
  const { scm } = scmFor(root, { profile });
  assert.equal((await scm.status()).repo, false);
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(root, 'b c.txt'), 'two\n');
  let status = await scm.status();
  assert.deepEqual(status.files.map((f) => [f.path, f.code]), [['a.txt', 'U'], ['b c.txt', 'U']]);
  assert.equal(status.hasGitignore, false);

  await scm.stage(['a.txt']);
  status = await scm.status();
  assert.deepEqual(status.files.map((f) => [f.path, f.code, f.staged]), [['a.txt', 'A', true], ['b c.txt', 'U', false]]);
  await scm.unstage(['a.txt']);
  assert.ok((await scm.status()).files.every((f) => !f.staged), 'unstaged before the first commit');

  // Nothing staged: every change is committed, and the author comes from GitHub.
  assert.deepEqual(await scm.commit('first'), { authorSet: true });
  assert.equal(git(root, 'config', 'user.email'), profile.email);
  assert.equal(git(root, 'log', '--format=%an|%s'), 'Octo Cat|first');
  assert.deepEqual((await scm.status()).files, []);

  fs.writeFileSync(path.join(root, 'a.txt'), 'one\nmore\n');
  assert.deepEqual(await scm.diff('a.txt'), { before: 'one\n', after: 'one\nmore\n' });
  await assert.rejects(scm.diff('../outside.txt'), /outside the repository/);
  await scm.stage(['a.txt']);
  fs.writeFileSync(path.join(root, 'b c.txt'), 'changed\n');
  await scm.commit('only a');
  assert.deepEqual((await scm.status()).files.map((f) => f.path), ['b c.txt'], 'staged files alone were committed');
  await assert.rejects(scm.commit('  '), /commit message/);
});

test('without a GitHub sign-in or a Git identity, commit says how to fix it', async (t) => {
  const { dir } = sandboxGit(t);
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'x'), 'x');
  await assert.rejects(scmFor(dir).scm.commit('x'), /Sign in to GitHub, or run git config/);
});

test('a subfolder of a repository: paths come from the top, and stage and diff still find them', async (t) => {
  const { dir: sandbox, globalFile } = sandboxGit(t);
  fs.writeFileSync(globalFile, '[user]\n\tname = Me\n\temail = me@example.com\n');
  const dir = path.join(sandbox, 'repo');
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'web'));
  fs.writeFileSync(path.join(dir, 'web', 'index.html'), 'hi');
  const { scm } = scmFor(path.join(dir, 'web'));
  const [file] = (await scm.status()).files;
  assert.equal(file.path, 'web/index.html');
  await scm.stage([file.path]);
  assert.equal((await scm.status()).files[0].staged, true);
  assert.equal((await scm.diff(file.path)).after, 'hi');
});

test('branches: create, list, switch; bad names are refused before git runs', async (t) => {
  const { dir, globalFile } = sandboxGit(t);
  fs.writeFileSync(globalFile, '[user]\n\tname = Me\n\temail = me@example.com\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'root');
  const { scm } = scmFor(dir);
  await scm.createBranch('feature/x');
  assert.deepEqual(await scm.branches(), { current: 'feature/x', local: ['feature/x', 'main'], remote: [] });
  await scm.checkout('main');
  assert.equal((await scm.status()).branch, 'main');
  await assert.rejects(scm.checkout('--orphan'), /not a valid branch/);
  await assert.rejects(scm.createBranch('has space'), /Branch names/);
});

test('publish commits first, then makes the GitHub repository, then pushes; sync pulls and pushes', async (t) => {
  const { dir } = sandboxGit(t);
  const remote = path.join(dir, 'remote.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  const root = path.join(dir, 'site');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
  const calls = mockFetch(t, async (url, options) => {
    if (url === 'https://api.github.com/user/repos') {
      assert.ok(git(root, 'log', '--format=%s').includes('Initial commit'), 'the local commit exists before GitHub is asked');
      assert.equal(options.headers.Authorization, 'Bearer gho_token');
      return json({ clone_url: remote, html_url: 'https://github.com/octo/site' }, 201);
    }
  });
  const { scm } = scmFor(root, { token: 'gho_token', profile });
  const page = await scm.publish({ name: 'site', description: 'My site', private: true, gitignore: true });
  assert.equal(page, 'https://github.com/octo/site');
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: 'site', description: 'My site', private: true, auto_init: false });
  assert.equal(git(remote, 'log', '--format=%s', 'main'), 'Initial commit');
  const pushed = git(remote, 'ls-tree', '--name-only', 'main').split('\n');
  assert.deepEqual(pushed.sort(), ['.gitignore', 'index.html'], '.env stayed home');
  const status = await scm.status();
  assert.equal(status.upstream, 'origin/main');
  assert.deepEqual(status.remote, { url: remote, github: false });
  await assert.rejects(scm.publish({ name: 'site', description: '', private: true, gitignore: false }), /already connected/);

  // Someone else pushes; our commit and theirs meet at Sync.
  const other = path.join(dir, 'other');
  git(dir, 'clone', '-q', remote, other);
  git(other, 'config', 'user.name', 'O'); git(other, 'config', 'user.email', 'o@x');
  fs.writeFileSync(path.join(other, 'about.html'), 'about');
  git(other, 'add', '-A'); git(other, 'commit', '-q', '-m', 'about'); git(other, 'push', '-q');
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>hello</h1>');
  await scm.commit('hello');
  await scm.sync();
  assert.ok(fs.existsSync(path.join(root, 'about.html')), 'pulled');
  assert.deepEqual([(await scm.status()).ahead, (await scm.status()).behind], [0, 0]);
  assert.match(git(remote, 'log', '--format=%s', 'main'), /hello/);
});

test('publish needs a GitHub sign-in and a valid name', async (t) => {
  const { dir } = sandboxGit(t);
  await assert.rejects(scmFor(dir).scm.publish({ name: 'x', description: '', private: true, gitignore: false }), /Sign in to GitHub/);
  await assert.rejects(scmFor(dir, { token: 't' }).scm.publish({ name: 'bad name', description: '', private: true, gitignore: false }), /Repository names/);
});

test('clone refuses a folder that is already there', async (t) => {
  const { dir } = sandboxGit(t);
  fs.mkdirSync(path.join(dir, 'hello'));
  fs.writeFileSync(path.join(dir, 'hello', 'x'), 'x');
  await assert.rejects(scmFor(dir).scm.clone('octo/hello', dir), /already exists/);
});

// ---------------------------------------------------------------- GitHub sign-in

function accounts(t, overrides = {}) {
  const dir = temp(t);
  const opened = [];
  const vault = memoryVault();
  const a = new Accounts({
    dir, vault, openExternal: (url) => { opened.push(url); },
    github: { clientId: 'gh-client' }, google: { clientId: 'g-client', clientSecret: 'g-secret' }, pollScale: 0.001, ...overrides
  });
  return { a, dir, opened, vault };
}

test('GitHub device sign-in: shows a code, waits through pending and slow_down, then keeps the token in the vault only', async (t) => {
  const { a, dir, opened, vault } = accounts(t);
  let polls = 0;
  mockFetch(t, async (url, options) => {
    if (url === 'https://github.com/login/device/code') {
      assert.equal(new URLSearchParams(options.body).get('scope'), 'repo read:user');
      return json({ device_code: 'dev', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    }
    if (url === 'https://github.com/login/oauth/access_token') {
      polls++;
      return json(polls === 1 ? { error: 'authorization_pending' } : polls === 2 ? { error: 'slow_down', interval: 10 } : { access_token: 'gho_abc' });
    }
    if (url === 'https://api.github.com/user') return json({ id: 7, login: 'octo', name: null, email: null, avatar_url: 'https://avatars.githubusercontent.com/u/7' });
    if (url.startsWith('https://avatars.githubusercontent.com/')) return new Response(Buffer.from([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
  });
  const code = await a.githubStart();
  assert.equal(code.userCode, 'ABCD-1234');
  assert.deepEqual(opened, ['https://github.com/login/device']);
  const profile = await a.githubFinish();
  assert.equal(polls, 3);
  assert.deepEqual(profile, { login: 'octo', name: 'octo', email: '7+octo@users.noreply.github.com', avatar: 'data:image/png;base64,AQID' });
  assert.equal(vault.entries[GITHUB_TOKEN], 'gho_abc');
  assert.ok(!fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8').includes('gho_abc'), 'the token is not in accounts.json');
  assert.equal(a.githubToken(), 'gho_abc');
  a.githubSignOut();
  assert.equal(a.githubProfile, null);
  assert.equal(vault.entries[GITHUB_TOKEN], undefined);
});

test('GitHub sign-in: declined and cancelled are said plainly; an unconfigured build offers none', async (t) => {
  const { a } = accounts(t);
  mockFetch(t, async (url) => {
    if (url.endsWith('/device/code')) return json({ device_code: 'd', user_code: 'U', verification_uri: 'https://github.com/login/device', interval: 1 });
    if (url.endsWith('/access_token')) return json({ error: 'access_denied' });
  });
  await a.githubStart();
  await assert.rejects(a.githubFinish(), /declined/);
  await a.githubStart();
  const waiting = a.githubFinish();
  a.githubCancel();
  await assert.rejects(waiting, /cancelled|Start GitHub/);
  const { a: bare } = accounts(t, { github: { clientId: '' } });
  assert.equal(bare.githubConfigured, false);
  await assert.rejects(bare.githubStart(), /not configured/);
});

// ---------------------------------------------------------------- Google sign-in

const idToken = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const googleClaims = (over = {}) => ({ iss: 'https://accounts.google.com', aud: 'g-client', exp: Date.now() / 1000 + 600, email: 'me@gmail.com', name: 'Me', picture: '', ...over });

test('Google sign-in: PKCE and state through the browser, identity kept, Google\'s tokens dropped', async (t) => {
  let authUrl;
  const { a, dir } = accounts(t, {
    openExternal: (url) => {
      authUrl = new URL(url);
      const back = new URL(authUrl.searchParams.get('redirect_uri'));
      back.search = new URLSearchParams({ code: 'c0de', state: authUrl.searchParams.get('state') }).toString();
      // The browser comes back to Axon's one-shot loopback address.
      setTimeout(() => void realFetch(back).catch(() => {}), 5);
    }
  });
  let tokenBody;
  mockFetch(t, async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenBody = new URLSearchParams(options.body);
      return json({ access_token: 'ya29', refresh_token: '1//r', id_token: idToken(googleClaims()) });
    }
  });
  const profile = await a.googleSignIn();
  assert.deepEqual(profile, { login: '', name: 'Me', email: 'me@gmail.com', avatar: '' });
  assert.equal(authUrl.origin + authUrl.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(authUrl.searchParams.get('scope'), 'openid email profile');
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authUrl.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.equal(tokenBody.get('code'), 'c0de');
  const challenge = require('node:crypto').createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url');
  assert.equal(challenge, authUrl.searchParams.get('code_challenge'), 'the verifier matches the challenge');
  const saved = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8');
  assert.ok(!/ya29|1\/\/r|id_token/.test(saved), 'no Google token is stored');
  a.googleSignOut();
  assert.equal(a.googleProfile, null);
});

test('Google sign-in: a wrong state is refused, and cancel stops the wait', async (t) => {
  const { a } = accounts(t, {
    openExternal: (url) => {
      const back = new URL(new URL(url).searchParams.get('redirect_uri'));
      back.search = 'code=x&state=forged';
      setTimeout(() => void realFetch(back).catch(() => {}), 5);
    }
  });
  await assert.rejects(a.googleSignIn(), /did not complete/);
  const { a: b } = accounts(t, { openExternal: () => {} });
  const waiting = b.googleSignIn();
  setTimeout(() => b.googleCancel(), 20);
  await assert.rejects(waiting, /cancelled/);
});

test('an ID token for another app, another issuer, or an expired one is refused', () => {
  assert.equal(idTokenClaims(idToken(googleClaims()), 'g-client').email, 'me@gmail.com');
  assert.throws(() => idTokenClaims(idToken(googleClaims({ aud: 'other' })), 'g-client'), /another app/);
  assert.throws(() => idTokenClaims(idToken(googleClaims({ iss: 'https://evil.example' })), 'g-client'), /another app/);
  assert.throws(() => idTokenClaims(idToken(googleClaims({ exp: 1 })), 'g-client'), /another app/);
  assert.throws(() => idTokenClaims('garbage', 'g-client'), /unreadable|another app/);
});
