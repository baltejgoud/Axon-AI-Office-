import { exec, execFile } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../../shared/types';
import type { Project } from '../project';
import { createUnifiedDiff } from './diff';

/** The files a commit names; anything that isn't a plain string is left out. */
const gitFiles = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((f): f is string => typeof f === 'string' && f.trim() !== '') : [];
/** Shown in approval previews only; the command itself never goes through a shell. */
const quote = (value: string) => JSON.stringify(value);

export interface ToolContext {
  project: Project;
  allowShell: boolean;
  subagentRunner?: (role: string, task: string) => Promise<string>;
}

export interface ToolHandlerResult {
  content: string;
  isError?: boolean;
  preview?: {
    type: 'diff' | 'command' | 'generic';
    content: string;
    path?: string;
  };
}

export interface RegisteredTool {
  definition: ToolDefinition;
  preparePreview?: (args: Record<string, any>, ctx: ToolContext) => Promise<{
    type: 'diff' | 'command' | 'generic';
    content: string;
    path?: string;
  } | undefined>;
  execute: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolHandlerResult>;
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  constructor() {
    this.registerCoreTools();
  }

  register(tool: RegisteredTool) {
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
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  private registerCoreTools() {
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
          const all = await ctx.project.list();
          const prefix = String(args.directory || '').trim().replace(/^[\\/]/, '').replace(/[\\/]$/, '');
          const filtered = prefix
            ? all.filter(f => f.startsWith(prefix + '/') || f === prefix)
            : all;
          return {
            content: filtered.length > 0 ? filtered.slice(0, 1000).join('\n') : 'No files found.'
          };
        } catch (err: any) {
          return { content: `Error listing files: ${err.message}`, isError: true };
        }
      }
    });

    // 3. search_code
    this.register({
      definition: {
        name: 'search_code',
        description: 'Search for text across project files. Returns matching file paths, line numbers, and snippets.',
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
          if (!hits.length) return { content: 'No matches found.' };
          const formatted = hits.map(h => `${h.path}:${h.line}  ${h.text}`).join('\n');
          return { content: formatted };
        } catch (err: any) {
          return { content: `Error searching project: ${err.message}`, isError: true };
        }
      }
    });

    // 4. write_file
    this.register({
      definition: {
        name: 'write_file',
        description: 'Create or update a file in the project with the specified content.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path of the file to write' },
            content: { type: 'string', description: 'Complete content to write to the file' }
          },
          required: ['path', 'content']
        }
      },
      preparePreview: async (args, ctx) => {
        const filePath = String(args.path);
        let existingText = '';
        try {
          if (ctx.project.root) {
            existingText = await ctx.project.read(filePath);
          }
        } catch {
          existingText = ''; // New file
        }
        const diff = createUnifiedDiff(filePath, existingText, String(args.content));
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
          const content = String(args.content);
          await ctx.project.write(filePath, content);
          return { content: `Successfully wrote ${content.length} characters to ${filePath}.` };
        } catch (err: any) {
          return { content: `Error writing file: ${err.message}`, isError: true };
        }
      }
    });

    // 5. run_command
    this.register({
      definition: {
        name: 'run_command',
        description: 'Execute a shell command within the project directory. Streams output.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command line string to run' },
            cwd: { type: 'string', description: 'Optional working directory relative to project root' }
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
        let targetCwd = ctx.project.root;
        if (args.cwd) {
          const resolved = resolve(ctx.project.root, String(args.cwd));
          const rel = relative(ctx.project.root, resolved);
          if (rel.startsWith('..') || isAbsolute(rel)) {
            return { content: 'Working directory outside project root is not permitted.', isError: true };
          }
          targetCwd = resolved;
        }

        return new Promise<ToolHandlerResult>((resolvePromise) => {
          exec(
            cmd,
            {
              cwd: targetCwd,
              timeout: 60_000,
              maxBuffer: 2 * 1024 * 1024,
              env: { ...process.env, CI: '1' }
            },
            (error, stdout, stderr) => {
              const combined = [
                stdout ? stdout.trim() : '',
                stderr ? `[stderr]\n${stderr.trim()}` : ''
              ].filter(Boolean).join('\n\n');

              if (error) {
                resolvePromise({
                  content: combined || `Command exited with code ${error.code || 1}: ${error.message}`,
                  isError: true
                });
              } else {
                resolvePromise({
                  content: combined || '(command completed with no output)'
                });
              }
            }
          );
        });
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
        const git = (gitArgs: string[]) => new Promise<{ ok: boolean; out: string }>((resolvePromise) => {
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
        description: 'Read persistent project knowledge and notes from .axon/MEMORY.md.',
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
        description: 'Update persistent project knowledge, architectural decisions, and notes in .axon/MEMORY.md.',
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
          return { content: `Error updating memory: ${err.message}`, isError: true };
        }
      }
    });

    // 9. dispatch_subagent
    this.register({
      definition: {
        name: 'dispatch_subagent',
        description: 'Dispatch an autonomous subagent with a designated role to perform a dedicated subtask and return findings.',
        parameters: {
          type: 'object',
          properties: {
            role: { type: 'string', description: 'Designated role or title for the subagent (e.g. Code Reviewer, Security Auditor)' },
            task: { type: 'string', description: 'Clear, actionable instructions for what the subagent must do' }
          },
          required: ['role', 'task']
        }
      },
      preparePreview: async (args) => {
        return {
          type: 'generic',
          content: `Subagent [${args.role}]:\n${args.task}`
        };
      },
      execute: async (args, ctx) => {
        if (!ctx.subagentRunner) {
          return { content: 'Subagent execution is not available in the current environment.', isError: true };
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
