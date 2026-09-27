import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { MCPServerConfig, McpStatus, McpToolAnnotations, McpToolInfo, ToolDefinition } from '../../shared/types';
import type { ToolRegistry } from '../tools/registry';

/** The MCP version Axon offers; the server's answer is used from then on. */
export const PROTOCOL_VERSION = '2025-06-18';
export const CLIENT_INFO = { name: 'axon', version: '0.2.0' };
/** How long a stdio server may take to answer `initialize`: the first npx start downloads the package. */
const STDIO_START_MS = 120_000;

/** Where a Streamable HTTP connection gets its bearer token, and a fresh one after a 401. */
export interface BearerSource {
  token(): Promise<string | null>;
  /** After a 401: a refreshed token, or null when the user has to sign in again. */
  refresh(): Promise<string | null>;
}

/** The server wants a sign-in Axon doesn't have, or has lost. */
export class NeedsSignInError extends Error {
  constructor(server: string) {
    super(`${server} needs you to sign in again.`);
    this.name = 'NeedsSignInError';
  }
}

/**
 * On Windows, finds a bare command (npx, pnpm) on PATH with its extension: npx is really npx.cmd,
 * and spawning without a shell needs the real file. Paths and names with an extension pass through.
 */
export function resolveCommand(command: string, env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  if (platform !== 'win32' || /[\\/]/.test(command) || extname(command)) return command;
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of (env.PATH ?? env.Path ?? '').split(';').filter(Boolean))
    for (const ext of exts) {
      const full = join(dir, command + ext.toLowerCase());
      if (existsSync(full)) return full;
    }
  return command;
}

/** Quotes one word for cmd.exe, which is what runs .cmd and .bat files. */
const cmdQuote = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Longest tool name OpenAI, Anthropic and Gemini all accept. */
const MAX_TOOL_NAME = 64;

/** A provider-safe tool name: `mcp_<server>_<tool>`, shortened with a hash when too long or already taken. */
export function mcpToolName(server: string, tool: string, taken: ReadonlySet<string>): string {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const name = `mcp_${clean(server)}_${clean(tool)}`;
  if (name.length <= MAX_TOOL_NAME && !taken.has(name)) return name;
  const hash = createHash('sha256').update(`${server}\0${tool}`).digest('hex').slice(0, 8);
  return `${name.slice(0, MAX_TOOL_NAME - 9)}_${hash}`;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface DiscoveredMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
}

export class McpClient {
  private nextRequestId = 1;
  private pending = new Map<number | string, { resolve: (val: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();
  private process: ChildProcess | null = null;
  private sseAbortController: AbortController | null = null;
  private sseEndpointUrl: string | null = null;
  private buffer = '';
  private sessionId: string | null = null;
  private protocolVersion = PROTOCOL_VERSION;
  private httpAbort = new AbortController();
  public status: McpStatus = 'disconnected';
  public tools: DiscoveredMcpTool[] = [];
  public errorMessage: string | null = null;
  /** Told when the status changes after connecting (a sign-in lost during a call). */
  onStatusChange: (() => void) | null = null;

  constructor(readonly config: MCPServerConfig, private readonly bearer?: BearerSource) {}

  async connect(): Promise<DiscoveredMcpTool[]> {
    this.status = 'connecting';
    this.errorMessage = null;
    try {
      if (this.config.transport === 'stdio') await this.startStdio();
      else if (this.config.transport === 'sse') await this.startSse();
      else if (this.config.transport === 'http') {
        if (!this.config.url) throw new Error('No URL specified for HTTP transport.');
      } else throw new Error(`Unsupported transport: ${this.config.transport}`);
      await this.initialize();
      this.tools = await this.listTools();
      this.status = 'connected';
      return this.tools;
    } catch (err: any) {
      // Disconnecting first: it resets the status, which must end up saying what went wrong.
      this.disconnect();
      this.status = err instanceof NeedsSignInError ? 'needs-sign-in' : 'error';
      this.errorMessage = err?.message || String(err);
      throw err;
    }
  }

  private async initialize(): Promise<void> {
    const result = await this.request('initialize', { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      this.config.transport === 'stdio' ? STDIO_START_MS : 30_000);
    if (typeof result?.protocolVersion === 'string') this.protocolVersion = result.protocolVersion;
    this.notify('notifications/initialized', {});
  }

  /** Every page of the server's tools. */
  private async listTools(): Promise<DiscoveredMcpTool[]> {
    const tools: DiscoveredMcpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await this.request('tools/list', cursor ? { cursor } : {});
      if (Array.isArray(res?.tools)) tools.push(...res.tools.filter((tool: unknown) => typeof (tool as DiscoveredMcpTool | null)?.name === 'string'));
      cursor = typeof res?.nextCursor === 'string' && res.nextCursor ? res.nextCursor : undefined;
      if (!cursor) break;
    }
    return tools;
  }

  private startStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.config.command) {
        return reject(new Error('No command specified for stdio transport.'));
      }

      try {
        const env = { ...process.env, ...(this.config.env || {}) };
        const command = resolveCommand(this.config.command, env);
        const args = this.config.args || [];
        // .cmd and .bat files only run through cmd.exe; the line is quoted here rather than joined by Node.
        const proc = /\.(cmd|bat)$/i.test(command)
          ? spawn([command, ...args].map(cmdQuote).join(' '), { env, stdio: ['pipe', 'pipe', 'pipe'], shell: true })
          : spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

        this.process = proc;

        proc.stdout?.on('data', (chunk: Buffer) => {
          this.handleStdoutChunk(chunk.toString('utf8'));
        });

        proc.stderr?.on('data', (chunk: Buffer) => {
          console.warn(`[MCP ${this.config.name} stderr]`, chunk.toString('utf8').trim());
        });

        proc.on('error', (err) => {
          console.error(`[MCP ${this.config.name} error]`, err);
          this.handleError(err);
        });

        proc.on('close', (code) => {
          this.handleClose(code);
        });

        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  private getSseHeaders(baseHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      ...baseHeaders,
      ...(this.config.headers || {})
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private async startSse(): Promise<void> {
    if (!this.config.url) throw new Error('No URL specified for SSE transport.');
    this.sseAbortController = new AbortController();
    this.sseEndpointUrl = this.config.url;

    const res = await fetch(this.config.url, {
      headers: this.getSseHeaders({ Accept: 'text/event-stream' }),
      signal: this.sseAbortController.signal
    });

    if (!res.ok) {
      throw new Error(`SSE connection failed with HTTP ${res.status}: ${res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('Failed to open readable stream for SSE.');

    // Background reader loop
    void (async () => {
      let buffer = '';
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          let currentEvent = 'message';
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) {
              currentEvent = 'message';
              continue;
            }
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              const data = line.slice(5).trim();
              if (currentEvent === 'endpoint') {
                try {
                  this.sseEndpointUrl = new URL(data, this.config.url).href;
                } catch {
                  this.sseEndpointUrl = data;
                }
              } else {
                try {
                  const msg = JSON.parse(data);
                  this.handleMessage(msg);
                } catch {
                  // ignore non-json SSE message
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn(`[MCP ${this.config.name} SSE reader ended]`, err);
        }
      } finally {
        this.status = 'disconnected';
      }
    })();
  }

  private handleStdoutChunk(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch (err) {
        console.warn(`[MCP ${this.config.name}] Unparseable JSON line:`, line.slice(0, 100));
      }
    }
  }

  private handleMessage(msg: any) {
    if (msg && typeof msg === 'object' && msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject, timer } = this.pending.get(msg.id)!;
      clearTimeout(timer);
      this.pending.delete(msg.id);

      if (msg.error) {
        reject(new Error(msg.error.message || `JSON-RPC error ${msg.error.code}`));
      } else {
        resolve(msg.result);
      }
    }
  }

  private handleError(err: Error) {
    this.status = 'error';
    this.errorMessage = err.message;
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
  }

  private handleClose(code: number | null) {
    this.status = 'disconnected';
    const err = new Error(`MCP process exited with code ${code ?? 'unknown'}`);
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
    this.process = null;
  }

  async request(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<any> {
    const id = this.nextRequestId++;
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request '${method}' timed out after ${timeoutMs / 1000}s`));
        }
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      if (this.config.transport === 'stdio') {
        if (!this.process || !this.process.stdin || this.process.stdin.destroyed) {
          clearTimeout(timer);
          this.pending.delete(id);
          return reject(new Error(`MCP server '${this.config.name}' is not running.`));
        }
        this.process.stdin.write(JSON.stringify(payload) + '\n', 'utf8', (err) => {
          if (err) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(err);
          }
        });
      } else if (this.config.transport === 'sse') {
        const url = this.sseEndpointUrl || this.config.url;
        if (!url) {
          clearTimeout(timer);
          this.pending.delete(id);
          return reject(new Error(`No URL available for MCP SSE server '${this.config.name}'`));
        }
        fetch(url, {
          method: 'POST',
          headers: this.getSseHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        }).then(async (res) => {
          if (!res.ok) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(new Error(`MCP HTTP POST failed with status ${res.status}: ${res.statusText}`));
            return;
          }
          const text = await res.text();
          if (text.trim()) {
            try {
              const parsed = JSON.parse(text);
              this.handleMessage(parsed);
            } catch {
              // result will arrive over SSE stream
            }
          }
        }).catch((err) => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        });
      } else if (this.config.transport === 'http') {
        this.postHttp(payload).catch((err) => {
          if (!this.pending.has(id)) return;
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        });
      }
    });
  }

  private bearerToken(): Promise<string | null> {
    return this.bearer ? this.bearer.token() : Promise.resolve(this.config.apiKey ?? null);
  }

  /**
   * One JSON-RPC message over Streamable HTTP. The reply (JSON or an event stream) goes to
   * handleMessage. A 401 refreshes the token once; a 404 on a session starts a new one once.
   */
  private async postHttp(payload: JsonRpcRequest, retry: { auth: boolean; session: boolean; token?: string } = { auth: true, session: true }): Promise<void> {
    const headers: Record<string, string> = {
      ...(this.config.headers || {}),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (payload.method !== 'initialize') headers['MCP-Protocol-Version'] = this.protocolVersion;
    const token = retry.token ?? await this.bearerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(this.config.url!, { method: 'POST', headers, body: JSON.stringify(payload), signal: this.httpAbort.signal });
    if (res.status === 401) {
      await res.body?.cancel();
      if (retry.auth && this.bearer) {
        const fresh = await this.bearer.refresh();
        if (fresh) return this.postHttp(payload, { ...retry, auth: false, token: fresh });
      }
      throw new NeedsSignInError(this.config.name);
    }
    if (res.status === 404 && this.sessionId && retry.session && payload.method !== 'initialize') {
      await res.body?.cancel();
      this.sessionId = null;
      await this.initialize();
      return this.postHttp(payload, { ...retry, session: false, token: undefined });
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`MCP HTTP ${res.status}${res.statusText ? `: ${res.statusText}` : ''}`);
    }
    const session = res.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) await this.readEventStream(res, payload.id);
    else if (type.includes('application/json')) {
      const text = await res.text();
      if (text.trim()) this.handleData(text);
    } else await res.body?.cancel();
  }

  /** Reads a streamed reply until the answer to `id` has arrived. */
  private async readEventStream(res: Response, id: JsonRpcRequest['id']): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    let data: string[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.replace(/\r$/, '');
          if (line === '') {
            if (data.length) this.handleData(data.join('\n'));
            data = [];
          } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (id !== undefined && !this.pending.has(id)) break;
      }
      if (data.length) this.handleData(data.join('\n'));
    } finally {
      void reader.cancel().catch(() => {});
    }
  }

  private handleData(text: string): void {
    let body: unknown;
    try { body = JSON.parse(text); } catch { return; }
    for (const msg of Array.isArray(body) ? body : [body]) this.handleMessage(msg);
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params
    };

    if (this.config.transport === 'stdio' && this.process?.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(JSON.stringify(payload) + '\n', 'utf8');
    } else if (this.config.transport === 'sse' && this.sseEndpointUrl) {
      void fetch(this.sseEndpointUrl, {
        method: 'POST',
        headers: this.getSseHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      }).catch(() => {});
    } else if (this.config.transport === 'http') {
      void this.postHttp(payload).catch(() => {});
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<{ content: string; isError?: boolean }> {
    try {
      const res = await this.request('tools/call', { name, arguments: args });
      if (!res) return { content: '(empty tool response)' };

      let textContent = '';
      if (Array.isArray(res.content)) {
        textContent = res.content
          .map((c: any) => (c.type === 'text' ? c.text : c.type === 'image' ? `[Image: ${c.mimeType}]` : JSON.stringify(c)))
          .join('\n');
      } else if (typeof res.content === 'string') {
        textContent = res.content;
      } else {
        textContent = JSON.stringify(res);
      }

      return {
        content: textContent || '(no content returned)',
        isError: Boolean(res.isError)
      };
    } catch (err: any) {
      if (err instanceof NeedsSignInError) {
        this.status = 'needs-sign-in';
        this.errorMessage = err.message;
        this.onStatusChange?.();
      }
      return {
        content: `MCP Tool execution error (${name}): ${err.message || String(err)}`,
        isError: true
      };
    }
  }

  disconnect() {
    this.status = 'disconnected';
    if (this.sseAbortController) {
      this.sseAbortController.abort();
      this.sseAbortController = null;
    }
    if (this.config.transport === 'http') {
      this.httpAbort.abort();
      this.httpAbort = new AbortController();
      const session = this.sessionId;
      this.sessionId = null;
      if (session && this.config.url) {
        const url = this.config.url;
        const headers: Record<string, string> = { ...(this.config.headers || {}), 'Mcp-Session-Id': session, 'MCP-Protocol-Version': this.protocolVersion };
        void this.bearerToken()
          .then((token) => fetch(url, { method: 'DELETE', headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers }))
          .catch(() => {});
      }
    }
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // ignore
      }
      this.process = null;
    }
    for (const [, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(new Error(`MCP client '${this.config.name}' disconnected.`));
    }
    this.pending.clear();
  }
}

export class MCPClientManager {
  private clients = new Map<string, McpClient>();
  /** The tool names each server registered, so removing one server removes exactly its tools. */
  private names = new Map<string, string[]>();

  constructor(private readonly toolRegistry: ToolRegistry) {}

  getClients(): McpClient[] {
    return Array.from(this.clients.values());
  }

  getClient(id: string): McpClient | undefined {
    return this.clients.get(id);
  }

  async syncServers(configs: MCPServerConfig[]): Promise<void> {
    const configMap = new Map(configs.map(c => [c.id, c]));

    // 1. Remove clients that no longer exist or are disabled
    for (const [id, client] of this.clients) {
      const cfg = configMap.get(id);
      if (!cfg || !cfg.enabled) {
        client.disconnect();
        this.unregisterTools(client);
        this.clients.delete(id);
      }
    }

    // 2. Add or update enabled clients
    for (const cfg of configs) {
      if (!cfg.enabled) continue;

      const existing = this.clients.get(cfg.id);
      if (existing) {
        const changed =
          existing.config.command !== cfg.command ||
          existing.config.url !== cfg.url ||
          existing.config.transport !== cfg.transport ||
          existing.config.apiKey !== cfg.apiKey ||
          JSON.stringify(existing.config.args) !== JSON.stringify(cfg.args) ||
          JSON.stringify(existing.config.env) !== JSON.stringify(cfg.env) ||
          JSON.stringify(existing.config.headers) !== JSON.stringify(cfg.headers);

        if (changed) {
          existing.disconnect();
          this.unregisterTools(existing);
          const client = new McpClient(cfg);
          this.clients.set(cfg.id, client);
          void this.initClient(client);
        }
      } else {
        const client = new McpClient(cfg);
        this.clients.set(cfg.id, client);
        void this.initClient(client);
      }
    }
  }

  private async initClient(client: McpClient) {
    try {
      const tools = await client.connect();
      this.registerTools(client, tools);
    } catch (err: any) {
      console.warn(`[MCPManager] Failed to connect to '${client.config.name}':`, err.message);
    }
  }

  private registerTools(client: McpClient, tools: DiscoveredMcpTool[]) {
    const taken = new Set(this.toolRegistry.getDefinitions().map((definition) => definition.name));
    const names: string[] = [];
    this.names.set(client.config.id, names);

    for (const tool of tools) {
      const toolName = mcpToolName(client.config.name, tool.name, taken);
      taken.add(toolName);
      names.push(toolName);

      this.toolRegistry.register({
        definition: {
          name: toolName,
          description: `[MCP: ${client.config.name}] ${tool.description || tool.name}`,
          parameters: (tool.inputSchema as any) || { type: 'object', properties: {} }
        },
        preparePreview: async (args) => {
          return {
            type: 'generic',
            content: `${client.config.name} → ${tool.name}(\n${JSON.stringify(args, null, 2)}\n)`
          };
        },
        execute: async (args) => {
          return client.callTool(tool.name, args);
        }
      });
    }
  }

  private unregisterTools(client: McpClient) {
    for (const name of this.names.get(client.config.id) ?? []) this.toolRegistry.unregister(name);
    this.names.delete(client.config.id);
  }

  stopAll() {
    for (const client of this.clients.values()) {
      client.disconnect();
      this.unregisterTools(client);
    }
    this.clients.clear();
  }
}
