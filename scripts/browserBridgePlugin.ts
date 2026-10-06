import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function browserBridgePlugin(): Plugin {
  return {
    name: 'axon-local-browser-bridge',
    configureServer(server) {
      server.middlewares.use('/__axon', (req, res) => {
        const remote = req.socket.remoteAddress;
        const host = req.headers.host ?? '';
        const localHost = /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host);
        const localClient = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '');
        const origin = req.headers.origin;
        if (!localHost || !localClient || (origin && origin !== `http://${host}`) ||
            req.headers['sec-fetch-site'] === 'cross-site') {
          res.writeHead(403).end();
          return;
        }
        if (!['/invoke', '/events'].includes(req.url ?? '')) {
          res.writeHead(404).end();
          return;
        }
        try {
          const { port, token } = JSON.parse(readFileSync(join(tmpdir(), 'axon-browser-bridge.json'), 'utf8'));
          const upstream = request({
            hostname: '127.0.0.1', port, path: req.url, method: req.method,
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
          }, (response) => {
            res.writeHead(response.statusCode ?? 502, {
              'Content-Type': response.headers['content-type'] ?? 'application/json',
              'Cache-Control': 'no-store'
            });
            response.pipe(res);
          });
          upstream.on('error', () => {
            if (!res.headersSent) res.writeHead(503);
            res.end(JSON.stringify({ error: 'Axon desktop connection is unavailable.' }));
          });
          res.on('close', () => upstream.destroy());
          req.pipe(upstream);
        } catch {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Open Axon with local browser control enabled.' }));
        }
      });
    }
  };
}
