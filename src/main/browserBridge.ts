import { createServer, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StreamEvent } from '../shared/types';

export const browserBridgeFile = join(tmpdir(), 'axon-browser-bridge.json');

/** Explicit development opt-in. Only the local Vite proxy receives the session secret. */
export async function startBrowserBridge(
  invoke: (method: string, args: unknown[]) => unknown,
  methods: readonly string[],
  descriptorFile = browserBridgeFile
) {
  const token = randomBytes(32).toString('hex');
  const clients = new Set<ServerResponse>();
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end();
      return;
    }
    if (req.url === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.url !== '/invoke' || req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 2200000) throw new Error('Request too large.');
      }
      const { method, args } = JSON.parse(body);
      if (!methods.includes(method) || !Array.isArray(args)) throw new Error('Invalid request.');
      const values = args.map((value: unknown) =>
        value && typeof value === 'object' && Object.keys(value).length === 1 &&
        '__axonUndefined' in value && value.__axonUndefined === true ? undefined : value
      );
      const result = await invoke(method, values);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Request failed.' }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local bridge failed to start.');
  writeFileSync(descriptorFile, JSON.stringify({ port: address.port, token }), { mode: 0o600 });
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': heartbeat\n\n');
  }, 15000);
  heartbeat.unref();
  return {
    emit(event: StreamEvent) {
      for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      server.close();
      try { unlinkSync(descriptorFile); } catch { /* Already removed. */ }
    }
  };
}
