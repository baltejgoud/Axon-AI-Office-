import { CodeContextCache } from '../code-context';
import { TerminalService, defaultShell } from '../runtime/terminal';
import { exec, execFile } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import type { FileChange, ToolDefinition } from '../../shared/types';
import { SEARCH_HITS, type Project } from '../project';
import { createUnifiedDiff, fileChange } from './diff';
import { applyUniqueEdit } from './editFile';
import { assessWrite, preserveTrailingNewline } from './writeGuard';
import type { ProcessManager } from './processes';

/** A command's working folder: the project, or a folder inside it; null for anywhere else. */
function workingFolder(root: string, cwd: unknown): string | null {
  if (!cwd) return root;
  const resolved = resolve(root, String(cwd));
  const rel = relative(root, resolved);
  return rel.startsWith('..') || isAbsolute(rel) ? null : resolved;
}

/** How often a running command's output goes to the window, and how much of its tail. */
const OUTPUT_EVERY_MS = 120;
const OUTPUT_TAIL = 64_000;

/** How many paths one list_files call may return. */
const LIST_FILES_LIMIT = 1000;

/** Which shell runs a command, for the model: on Windows it is cmd.exe, and models assume bash otherwise. */
export function shellNote(platform: string): string {
  return `Commands use ${defaultShell(platform as NodeJS.Platform)}. Use native syntax for this shell. Prefer list_files, search_code and read_file for filesystem discovery.`;
}
const SHELL_NOTE = shellNote(process.platform);
/** What cmd.exe says about a program it can't find. */
const NOT_A_COMMAND = /is not recognized as an internal or external command/i;

/** Arguments that are text to write, where empty is a real value (an empty file, a deletion). */
const MAY_BE_EMPTY = new Set(['content', 'new_string', 'old_string']);
/** Names the required arguments a call left out (or sent blank), so it is refused before anyone is asked; null when complete. */
export function missingArguments(definition: ToolDefinition, args: Record<string, unknown>): string | null {
  const required = (definition.parameters as { required?: unknown }).required;
  if (!Array.isArray(required)) return null;
  const blank = (name: string) =>
    !MAY_BE_EMPTY.has(name) && typeof args[name] === 'string' && !(args[name] as string).trim();
  const missing = required.filter(
    (name): name is string =>
      typeof name === 'string' && (args[name] === undefined || args[name] === null || blank(name))
  );
  return missing.length
    ? `${definition.name} needs ${missing.map((name) => `'${name}'`).join(' and ')}, which ${missing.length > 1 ? 'were' : 'was'} missing, so it was not run. Call it again with every required argument.`
    : null;
}

/** Whether a file is there, and its text: null for a new file, or one too big (or too binary) to read, which is not a new file. */
async function readBefore(
  project: Project,
  path: string
): Promise<{ existed: boolean; before: string | null }> {
  const existed = await project.exists(path);
  if (!existed) return { existed, before: null };
  try {
    return { existed, before: await project.read(path) };
  } catch {
    return { existed, before: null };
  }
}

/** The files a commit names; anything that isn't a plain string is left out. */
const gitFiles = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((f): f is string => typeof f === 'string' && f.trim() !== '') : [];
/** Shown in approval previews only; the command itself never goes through a shell. */
const quote = (value: string) => JSON.stringify(value);

export interface ToolContext {
  project: Project;
  terminals?: TerminalService;
  signal?: AbortSignal;
  runId?: string;
  allowShell: boolean;
  subagentRunner?: (role: string, task: string) => Promise<string>;
  /** A running command's output so far, a few times a second, for the window. */
  onOutput?: (soFar: string) => void;
  /** Commands left running in the background, and the conversation asking. */
  processes?: ProcessManager;
  conversationId?: string;
}

export interface ToolHandlerResult {
  content: string;
  isError?: boolean;
  /** A file write's change, kept with the call for the window. */
  change?: FileChange;
  /** The background process a call started. */
  process?: { id: string };
  /** A write's previous content, for undo; kept by the service, never sent to the model or the window. */
  previous?: { existed: boolean; content: string | null };
  /** What a write left in the file, so undo can tell whether it changed since. */
  written?: string;
  preview?: {
    type: 'diff' | 'command' | 'generic';
    content: string;
    path?: string;
  };
}

export interface RegisteredTool {
  definition: ToolDefinition;
  preparePreview?: (
    args: Record<string, any>,
    ctx: ToolContext
  ) => Promise<
    | {
        type: 'diff' | 'command' | 'generic';
        content: string;
        path?: string;
      }
    | undefined
  >;
  /** Refuses a call that cannot work before anyone is asked to approve it; the reason goes back to the model. */
  validate?: (args: Record<string, any>, ctx: ToolContext) => Promise<string | null>;
  execute: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolHandlerResult>;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  constructor() {
    this.registerCoreTools();
  }

  register(tool: RegisteredTool) {
    tool.definition.retentionPolicy ??= tool.definition.name === 'list_files' ? 'EPHEMERAL'
      : /command|process|mcp/.test(tool.definition.name) ? 'SUMMARIZE'
      : /read_file|file_context|get_symbol/.test(tool.definition.name) ? 'REFERENCE_ONLY' : 'PIN_CURRENT_TASK';
    this.tools.set(tool.definition.name, tool);
  }

  unregister(name: string) {
    this.tools.delete(name);
  }

  unregisterByPrefix(prefix: string) {
    for (const key of Array.from(this.tools.keys())) {
      if (key.startsWith(prefix)) {
        this.tools.delete(key);
      }
    }
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  private registerCoreTools() {
    const codeContext = new CodeContextCache();
    for (const name of ['file_context', 'get_symbol']) this.register({
      definition: { name, description: name === 'file_context' ? 'Get a hashed file snapshot and symbol/import index without loading its full code. TypeScript and JavaScript supported.' : 'Retrieve exact source lines of a named symbol from a TypeScript or JavaScript file.',
        parameters: { type: 'object', properties: { path: { type: 'string' }, symbol: { type: 'string' } }, required: name === 'get_symbol' ? ['path', 'symbol'] : ['path'] } },
      execute: async (args, ctx) => {
        try {
          const path = String(args.path), raw = await ctx.project.read(path);
          const snapshot = await codeContext.snapshot(path, raw);
          if (name === 'file_context') return { content: JSON.stringify({ ...snapshot, symbols: snapshot.symbols.slice(0, 100), totalSymbols: snapshot.symbols.length }) };
          const symbol = snapshot.symbols.find(s => s.name === args.symbol);
          if (!symbol) return { content: 'Symbol not found. Use file_context for available symbols, or read_file for other languages.', isError: true };
          const end = Math.min(symbol.endLine, symbol.startLine + 199);
          return { content: JSON.stringify({ ...symbol, hash: snapshot.hash, excerptEndLine: end,
            code: raw.split('\n').slice(symbol.startLine - 1, end).map((line, i) => `${symbol.startLine + i}: ${line}`).join('\n') }) };
        } catch (error) { return { content: String(error), isError: true }; }
      }
    });
    // 1. read_file
    this.register({
      definition: {
        name: 'read_file',
        description: 'Read the contents of a file in the project. Returns line-numbered contents.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of the file to read' },
            offset: { type: 'number', description: 'Optional 1-based start line number' },
            limit: { type: 'number', description: 'Optional maximum number of lines to read' }
          },
          required: ['path']
        }
      },
      execute: async (args, ctx) => {
        try {
          if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
          const raw = await ctx.project.read(String(args.path));
          const lines = raw.split('\n');
          const offset = Math.max(1, Number(args.offset) || 1);
          const limit = Number(args.limit) && Number(args.limit) > 0 ? Number(args.limit) : lines.length;
          const slice = lines.slice(offset - 1, offset - 1 + limit);
          const numbered = slice.map((line, idx) => `${offset + idx}: ${line}`).join('\n');
          return { content: numbered || '(empty file)' };
        } catch (err: any) {
          return { content: `Error reading file: ${err.message}`, isError: true };
        }
      }
    });

    // 2. list_files
    this.register({
      definition: {
        name: 'list_files',
        description: 'List file paths in the active project, optionally filtered by directory prefix.',
        parameters: {
          type: 'object',
          properties: {
            directory: { type: 'string', description: 'Optional subdirectory prefix to list files from' }
          }
        }
      },
      execute: async (args, ctx) => {
        try {
          if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
          const prefix = String(args.directory || '')
            .trim()
            .replace(/^[\\/]+/, '')
            .replace(/[\\/]+$/, '');
          // Only that folder is walked, so a huge sibling can't use up the cap first.
          const filtered = await ctx.project.list(prefix || undefined);
          // A listing cut short says so. It must never look like an empty directory.
          const note = ctx.project.listTruncated
            ? `\n\n(listing cut short at a cap: this is what was reached first, not everything. Narrow 'directory', for example 'src'. Never assume a file or folder is missing because it is not here.)`
            : filtered.length > LIST_FILES_LIMIT
              ? `\n\n(showing ${LIST_FILES_LIMIT} of ${filtered.length} files; narrow 'directory' to see the rest.)`
              : '';
          if (!filtered.length)
            return {
              content: ctx.project.listTruncated
                ? `No files reached.${note}`
                : prefix
                  ? `No files found in ${prefix}/.`
                  : 'No files found.'
            };
          return { content: filtered.slice(0, LIST_FILES_LIMIT).join('\n') + note };
        } catch (err: any) {
          return { content: `Error listing files: ${err.message}`, isError: true };
        }
      }
    });

    // 3. search_code
    this.register({
      definition: {
        name: 'search_code',
        description:
          'Search for text across project files. Returns matching file paths, line numbers, and snippets.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or query string' }
          },
          required: ['query']
        }
      },
      execute: async (args, ctx) => {
        try {
          if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
          const hits = await ctx.project.search(String(args.query));
          // A search that stopped early says so: what it didn't reach was not searched.
          const note = [
            hits.length >= SEARCH_HITS
              ? `(showing the first ${SEARCH_HITS} matches; search for something more specific to see others.)`
              : '',
            ctx.project.listTruncated
              ? '(the project has more files than one search reads, so some were not searched. A missing match is not proof there is none.)'
              : ''
          ]
            .filter(Boolean)
            .join('\n');
          if (!hits.length) return { content: note ? `No matches found.\n\n${note}` : 'No matches found.' };
          const formatted = hits.map((h) => `${h.path}:${h.line}  ${h.text}`).join('\n');
          return { content: note ? `${formatted}\n\n${note}` : formatted };
        } catch (err: any) {
          return { content: `Error searching project: ${err.message}`, isError: true };
        }
      }
    });

    // 4. write_file: new files, and whole-file replacements a guard keeps proportionate
    /** What a whole-file write would leave: the text sent, with the final newline the file had. */
    const written = (before: string | null, content: string) =>
      before === null ? content : preserveTrailingNewline(before, content);
    /** Why a whole-file write would eat far more of an existing file than it adds; null when it wouldn't. */
    const guard = (before: string | null, after: string) => {
      if (before === null) return null;
      const change = fileChange(before, after);
      return assessWrite({ created: false, added: change.added, removed: change.removed }).reason ?? null;
    };
    this.register({
      definition: {
        name: 'write_file',
        description:
          'Create a new file, or replace a whole file with the complete content you send. To change part of an existing file, use edit_file instead: a whole-file write must repeat every line you are not changing, exactly.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of the file to write' },
            content: { type: 'string', description: 'Complete content to write to the file' }
          },
          required: ['path', 'content']
        }
      },
      validate: async (args, ctx) => {
        if (!ctx.project.root) return null;
        const { before } = await readBefore(ctx.project, String(args.path));
        return guard(before, written(before, String(args.content)));
      },
      preparePreview: async (args, ctx) => {
        const filePath = String(args.path);
        const { before } = ctx.project.root ? await readBefore(ctx.project, filePath) : { before: null };
        const diff = createUnifiedDiff(filePath, before ?? '', written(before, String(args.content)));
        return {
          type: 'diff',
          content: diff,
          path: filePath
        };
      },
      execute: async (args, ctx) => {
        try {
          if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
          const filePath = String(args.path);
          const { existed, before } = await readBefore(ctx.project, filePath);
          const content = written(before, String(args.content));
          const blocked = guard(before, content);
          if (blocked) return { content: blocked, isError: true };
          await ctx.project.write(filePath, content);
          const change = fileChange(before, content);
          if (existed && before === null) change.created = false;
          return {
            content: `Successfully wrote ${content.length} characters to ${filePath}.`,
            change,
            previous: { existed, content: before },
            written: content
          };
        } catch (err: any) {
          return { content: `Error writing file: ${err.message}`, isError: true };
        }
      }
    });

    // 4b. edit_file: one targeted change, leaving every other line exactly as it was
    /** The file after the edit the call names, or why it can't be made. */
    const edited = async (args: Record<string, any>, project: Project) => {
      const filePath = String(args.path);
      const { existed, before } = await readBefore(project, filePath);
      if (!existed) return { error: `${filePath} does not exist. Use write_file to create a new file.` };
      if (before === null) return { error: `${filePath} can't be edited: it is over 1 MB or not text.` };
      const result = applyUniqueEdit(
        before,
        String(args.old_string ?? ''),
        String(args.new_string ?? ''),
        args.replace_all === true
      );
      if (!result.ok)
        return {
          error: `${result.reason} in ${filePath}. Read the file again and copy old_string exactly, including indentation.`
        };
      return { before, after: result.text, replacements: result.replacements };
    };
    this.register({
      definition: {
        name: 'edit_file',
        description:
          'Change part of an existing file: replaces old_string with new_string and leaves every other line exactly as it is. old_string must match the file exactly (read it first) and only once, unless replace_all is true. Prefer this to write_file for any change to an existing file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of the file to edit' },
            old_string: {
              type: 'string',
              description: 'The exact text to replace, with enough surrounding lines to be unique'
            },
            new_string: { type: 'string', description: 'The text to put in its place (empty to delete it)' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence instead of exactly one' }
          },
          required: ['path', 'old_string', 'new_string']
        }
      },
      validate: async (args, ctx) =>
        ctx.project.root ? ((await edited(args, ctx.project)).error ?? null) : null,
      preparePreview: async (args, ctx) => {
        const result = await edited(args, ctx.project);
        return result.error === undefined
          ? {
              type: 'diff',
              content: createUnifiedDiff(String(args.path), result.before!, result.after!),
              path: String(args.path)
            }
          : { type: 'generic', content: result.error, path: String(args.path) };
      },
      execute: async (args, ctx) => {
        try {
          if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
          const filePath = String(args.path);
          const result = await edited(args, ctx.project);
          if (result.error !== undefined) return { content: result.error, isError: true };
          await ctx.project.write(filePath, result.after!);
          return {
            content: `Edited ${filePath}: ${result.replacements} ${result.replacements === 1 ? 'replacement' : 'replacements'}.`,
            change: fileChange(result.before!, result.after!),
            previous: { existed: true, content: result.before! },
            written: result.after!
          };
        } catch (err: any) {
          return { content: `Error editing file: ${err.message}`, isError: true };
        }
      }
    });

    // 5. run_command
    this.register({
      definition: {
        name: 'run_command',
        description: `Execute a shell command within the project directory. Streams output. ${SHELL_NOTE}`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command line to run' },
            cwd: { type: 'string', description: 'Optional working directory relative to project root' },
            timeout: { type: 'number', description: 'Maximum command duration in milliseconds, up to 600000' }
          },
          required: ['command']
        }
      },
      preparePreview: async (args) => {
        return {
          type: 'command',
          content: String(args.command),
          path: args.cwd ? String(args.cwd) : undefined
        };
      },
      execute: async (args, ctx) => {
        if (!ctx.allowShell) {
          return { content: 'Shell execution is disabled in settings.', isError: true };
        }
        if (!ctx.project.root) {
          return { content: 'No project folder is open.', isError: true };
        }

        const cmd = String(args.command).trim();
        const targetCwd = workingFolder(ctx.project.root, args.cwd);
        if (!targetCwd)
          return { content: 'Working directory outside project root is not permitted.', isError: true };

        const terminals =
          ctx.terminals ??
          new TerminalService((session, data) => {
            if (data) ctx.onOutput?.(session.output);
          });
        try {
          const result = await terminals.run({
            conversationId: ctx.conversationId ?? 'command',
            runId: ctx.runId,
            root: ctx.project.root,
            command: cmd,
            cwd: args.cwd,
            timeout: args.timeout,
            signal: ctx.signal
          });
          return { content: JSON.stringify(result), isError: result.exitCode !== 0 };
        } catch (error) {
          return { content: error instanceof Error ? error.message : String(error), isError: true };
        }
      }
    });

    // 5b. Background processes: development servers and watchers that outlive the call
    this.register({
      definition: {
        name: 'start_process',
        description: `Start a long-running command in the background in the project folder, such as a development server (npm run dev) or a file watcher. Returns its first output and the local address it serves, which the user sees in a live Preview. Use run_command for commands that finish. ${SHELL_NOTE}`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command line to start' },
            cwd: { type: 'string', description: 'Optional working directory relative to project root' },
            timeout: { type: 'number', description: 'Maximum command duration in milliseconds, up to 600000' }
          },
          required: ['command']
        }
      },
      preparePreview: async (args) => ({
        type: 'command',
        content: String(args.command),
        path: args.cwd ? String(args.cwd) : undefined
      }),
      execute: async (args, ctx) => {
        if (!ctx.allowShell) return { content: 'Shell execution is disabled in settings.', isError: true };
        if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
        if (!ctx.processes || !ctx.conversationId)
          return { content: 'Background processes are not available here.', isError: true };
        const cmd = String(args.command).trim();
        const cwd = workingFolder(ctx.project.root, args.cwd);
        if (!cwd)
          return { content: 'Working directory outside project root is not permitted.', isError: true };
        try {
          const info = await ctx.processes.start(ctx.conversationId, cmd, cwd);
          const state = info.running
            ? info.url
              ? `It serves ${info.url}; the user sees that page in the Preview.`
              : 'It is running.'
            : `It ended with exit code ${info.exitCode ?? 'unknown'}.`;
          return {
            content: `Started \`${cmd}\` as ${info.id}. ${state}\n\nOutput so far:\n${info.output.slice(-4000) || '(nothing yet)'}`,
            isError: !info.running && info.exitCode !== 0,
            process: { id: info.id }
          };
        } catch (err: any) {
          return { content: err.message, isError: true };
        }
      }
    });
    this.register({
      definition: {
        name: 'read_process',
        description:
          'Read the latest output of a background process started with start_process, and whether it is still running.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The process id start_process gave, such as p1' }
          },
          required: ['id']
        }
      },
      execute: async (args, ctx) => {
        const info = ctx.processes?.read(String(args.id));
        if (!info || info.conversationId !== ctx.conversationId)
          return { content: `No background process ${String(args.id)} in this conversation.`, isError: true };
        const state = info.running ? 'is running' : `ended with exit code ${info.exitCode ?? 'unknown'}`;
        return {
          content: `${info.id} (\`${info.command}\`) ${state}.${info.url ? ` It serves ${info.url}.` : ''}\n\n${info.output.slice(-8000) || '(no output)'}`
        };
      }
    });
    this.register({
      definition: {
        name: 'stop_process',
        description: 'Stop a background process started with start_process.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The process id start_process gave, such as p1' }
          },
          required: ['id']
        }
      },
      execute: async (args, ctx) => {
        const info = ctx.processes?.read(String(args.id));
        if (!info || info.conversationId !== ctx.conversationId)
          return { content: `No background process ${String(args.id)} in this conversation.`, isError: true };
        return {
          content: ctx.processes!.stop(info.id) ? `Stopped ${info.id}.` : `${info.id} is not running.`
        };
      }
    });

    // 6. git_commit
    this.register({
      definition: {
        name: 'git_commit',
        description: 'Stage files and create a git commit in the project repository.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of file paths to stage. If omitted, stages all changes.'
            }
          },
          required: ['message']
        }
      },
      preparePreview: async (args) => {
        const files = gitFiles(args.files);
        return {
          type: 'command',
          content: `git add ${files.length ? `-- ${files.map(quote).join(' ')}` : '-A'}\ngit commit -m ${quote(String(args.message ?? ''))}`
        };
      },
      execute: async (args, ctx) => {
        if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
        const msg = String(args.message ?? '').trim();
        if (!msg) return { content: 'Commit message is required.', isError: true };
        const files = gitFiles(args.files);
        // git runs directly, never through a shell, so a message or file name can't start another command.
        const git = (gitArgs: string[]) =>
          new Promise<{ ok: boolean; out: string }>((resolvePromise) => {
            execFile('git', gitArgs, { cwd: ctx.project.root!, timeout: 60_000 }, (err, stdout, stderr) => {
              resolvePromise({ ok: !err, out: String(stdout || stderr || err?.message || '') });
            });
          });
        const added = await git(files.length ? ['add', '--', ...files] : ['add', '-A']);
        if (!added.ok) return { content: `Git add failed: ${added.out}`, isError: true };
        const committed = await git(['commit', '-m', msg]);
        return committed.ok
          ? { content: committed.out || 'Committed successfully.' }
          : { content: `Git commit failed: ${committed.out}`, isError: true };
      }
    });

    // 7. read_memory
    this.register({
      definition: {
        name: 'read_memory',
        description: 'Read persistent project knowledge and notes in .axon/MEMORY.md.',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      execute: async (_args, ctx) => {
        try {
          if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
          try {
            const mem = await ctx.project.read('.axon/MEMORY.md');
            return { content: mem || '(memory file is empty)' };
          } catch {
            return { content: 'No persistent memory found (.axon/MEMORY.md does not exist yet).' };
          }
        } catch (err: any) {
          return { content: `Error reading memory: ${err.message}`, isError: true };
        }
      }
    });

    // 8. update_memory
    this.register({
      definition: {
        name: 'update_memory',
        description:
          'Update persistent project knowledge, architectural decisions, and notes in .axon/MEMORY.md.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Complete markdown text to store in .axon/MEMORY.md' }
          },
          required: ['content']
        }
      },
      preparePreview: async (args, ctx) => {
        let existing = '';
        try {
          if (ctx.project.root) {
            existing = await ctx.project.read('.axon/MEMORY.md');
          }
        } catch {
          existing = '';
        }
        return {
          type: 'diff',
          content: createUnifiedDiff('.axon/MEMORY.md', existing, String(args.content)),
          path: '.axon/MEMORY.md'
        };
      },
      execute: async (args, ctx) => {
        try {
          if (!ctx.project.root) return { content: 'No project folder is open.', isError: true };
          const content = String(args.content);
          await ctx.project.write('.axon/MEMORY.md', content);
          return { content: 'Successfully updated persistent memory in .axon/MEMORY.md.' };
        } catch (err: any) {
          return { content: `Error writing memory: ${err.message}`, isError: true };
        }
      }
    });

    // 9. dispatch_subagent
    this.register({
      definition: {
        name: 'dispatch_subagent',
        description:
          'Dispatch an autonomous subagent with a designated role to perform a dedicated subtask and return findings.',
        parameters: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              description: 'Designated role or title for the subagent (e.g. Code Reviewer, Security Auditor)'
            },
            task: {
              type: 'string',
              description: 'Clear, actionable instructions for what the subagent must do'
            }
          },
          required: ['role', 'task']
        }
      },
      preparePreview: async (args) => ({
        type: 'generic',
        content: `Subagent [${args.role}]:\n${args.task}`
      }),
      execute: async (args, ctx) => {
        if (!ctx.subagentRunner) {
          return {
            content: 'Subagent execution is not available in the current environment.',
            isError: true
          };
        }
        try {
          const result = await ctx.subagentRunner(String(args.role), String(args.task));
          return { content: result };
        } catch (err: any) {
          return { content: `Subagent failed: ${err.message}`, isError: true };
        }
      }
    });
  }
}
