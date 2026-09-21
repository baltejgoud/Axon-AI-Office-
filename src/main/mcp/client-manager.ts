import { spawn, type ChildProcess } from 'node:child_process';
import type { MCPServerConfig } from '../../shared/types';
import type { ToolRegistry } from '../tools/registry';

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
}

export class McpClient {
  private nextRequestId = 1;
  private pending = new Map<number | string, { resolve: (val: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();
  private process: ChildProcess | null = null;
  private sseAbortController: AbortController | null = null;
  private sseEndpointUrl: string | null = null;
  private buffer = '';
  public status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  public tools: DiscoveredMcpTool[] = [];
  public errorMessage: string | null = null;

  constructor(readonly config: MCPServerConfig) {}

  async connect(): Promise<DiscoveredMcpTool[]> {
    this.status = 'connecting';
    this.errorMessage = null;

    try {
      if (this.config.transport === 'stdio') {
        await this.startStdio();
      } else if (this.config.transport === 'sse') {
        await this.startSse();
      } else {
        throw new Error(`Unsupported transport: ${this.config.transport}`);
      }

      // 1. Initialize
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'axon', version: '0.2.0' }
      });

      // 2. Initialized notification
      this.notify('notifications/initialized', {});

      // 3. List tools
      const listRes = await this.request('tools/list', {});
      this.tools = Array.isArray(listRes?.tools) ? listRes.tools : [];
      this.status = 'connected';
      return this.tools;
    } catch (err: any) {
      this.status = 'error';
      this.errorMessage = err.message || String(err);
      this.disconnect();
      throw err;
    }
  }

  private startStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.config.command) {
        return reject(new Error('No command specified for stdio transport.'));
      }

      try {
        const isBatch = this.config.command.endsWith('.cmd') || this.config.command.endsWith('.bat');
        const proc = spawn(this.config.command, this.config.args || [], {
          env: { ...process.env, ...(this.config.env || {}) },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: isBatch
        });

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
      }
    });
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
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
          JSON.stringify(existing.config.args) !== JSON.stringify(cfg.args) ||
          JSON.stringify(existing.config.env) !== JSON.stringify(cfg.env);

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

  private sanitize(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  }

  private registerTools(client: McpClient, tools: DiscoveredMcpTool[]) {
    const prefix = `mcp_${this.sanitize(client.config.name)}_`;

    for (const tool of tools) {
      const toolName = `${prefix}${this.sanitize(tool.name)}`;

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
    const prefix = `mcp_${this.sanitize(client.config.name)}_`;
    this.toolRegistry.unregisterByPrefix(prefix);
  }

  stopAll() {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
  }
}
