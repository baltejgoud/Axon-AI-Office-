import { spawn } from 'node:child_process';

export interface GitResult { ok: boolean; code: number | null; out: string; err: string }
export interface GitOptions {
  cwd: string;
  /** A GitHub token for this one command; it reaches git through its environment, never argv or .git/config. */
  token?: string | null;
  timeoutMs?: number;
  /** Progress lines from stderr (clone, push and pull write them there). */
  onProgress?: (line: string) => void;
}
/** Output past this is dropped: a status of a huge tree shouldn't fill memory. */
const MAX_OUTPUT = 20 * 1024 * 1024;

/** The environment for one git command: never prompts, and carries the token for github.com only. */
export function gitEnv(token?: string | null, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LITERAL_PATHSPECS: '1' };
  for (const key of Object.keys(env)) if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete env[key];
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    Object.assign(env, {
      GIT_CONFIG_COUNT: '2',
      // An empty helper clears the user's credential helpers for github.com, so no sign-in window opens over ours.
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper', GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'http.https://github.com/.extraHeader', GIT_CONFIG_VALUE_1: `Authorization: Basic ${basic}`
    });
  }
  return env;
}

/** Removes the token, in either form, from text bound for the screen or a log. */
export function scrub(text: string, token?: string | null): string {
  if (!token) return text;
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return text.split(token).join('***').split(basic).join('***');
}

/** Runs git directly (never through a shell), so no argument can start another command. */
export function runGit(args: string[], options: GitOptions): Promise<GitResult> {
  return new Promise(resolve => {
    let out = '', err = '', settled = false, partial = '';
    const done = (result: GitResult) => { if (!settled) { settled = true; resolve(result); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', args, { cwd: options.cwd, env: gitEnv(options.token), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      return done({ ok: false, code: null, out: '', err: error instanceof Error ? error.message : String(error) });
    }
    const timer = setTimeout(() => { child.kill(); done({ ok: false, code: null, out, err: `${err}\ngit took too long and was stopped.`.trim() }); }, options.timeoutMs ?? 60_000);
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => { if (out.length < MAX_OUTPUT) out += chunk; });
    child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
      if (err.length < MAX_OUTPUT) err += chunk;
      if (!options.onProgress) return;
      const lines = (partial + chunk).split(/[\r\n]/);
      partial = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) options.onProgress(scrub(line.trim(), options.token));
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      done({ ok: false, code: null, out, err: error.code === 'ENOENT' ? 'Git is not installed.' : error.message });
    });
    child.on('close', code => {
      clearTimeout(timer);
      done({ ok: code === 0, code, out, err: scrub(err, options.token) });
    });
  });
}

/** The installed Git's version ("2.47.1"), or null when there is none. */
export async function gitVersion(cwd: string): Promise<string | null> {
  const result = await runGit(['--version'], { cwd, timeoutMs: 10_000 });
  return result.ok ? /(\d+\.\d+(?:\.\d+)?)/.exec(result.out)?.[1] ?? result.out.trim() : null;
}

/** Git's own words for a failure, without the progress chatter before it. */
export function gitFailure(result: GitResult, fallback: string): string {
  const lines = result.err.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(remote: )?(Counting|Compressing|Receiving|Resolving|Enumerating|Writing|Total|Delta)/.test(l));
  const important = lines.filter(l => /^(fatal|error|hint: Updates were rejected|CONFLICT|! \[)/.test(l));
  return (important.length ? important : lines).slice(0, 6).join('\n') || fallback;
}
