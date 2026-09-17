import { app } from 'electron';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let minLevel: Level = app.isPackaged ? 'info' : 'debug';
let logFile: string | null = null;

export function initLogging(dir: string): void {
  logFile = join(dir, 'axon.log');
}

function write(level: Level, scope: string, message: string, meta?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${message}`;
  // eslint-disable-next-line no-console
  if (meta !== undefined) console[level === 'debug' ? 'log' : level](line, meta);
  // eslint-disable-next-line no-console
  else console[level === 'debug' ? 'log' : level](line);
  if (logFile) {
    try {
      appendFileSync(logFile, line + (meta !== undefined ? ` ${safeStringify(meta)}` : '') + '\n');
    } catch {
      /* logging must never crash the app */
    }
  }
}

function safeStringify(meta: unknown): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, meta) => write('debug', scope, m, meta),
    info: (m, meta) => write('info', scope, m, meta),
    warn: (m, meta) => write('warn', scope, m, meta),
    error: (m, meta) => write('error', scope, m, meta)
  };
}
