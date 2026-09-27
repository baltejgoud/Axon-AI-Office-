// Checks every catalog connector against the live service: it answers, and signs in the way the catalog says.
// Uses the network, so it runs on demand (`npm run connectors:check`), not in `npm test`.
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../src/connectors/catalog.json', import.meta.url), 'utf8'));
const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'axon-check', version: '0' } }
};
const getJson = async (url) => {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
};

async function check(entry) {
  if (entry.command) {
    const pkg = entry.args.find((a) => !a.startsWith('-')).replace(/@latest$/, '');
    const r = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    return r?.ok ? 'ok' : `npm package ${pkg} not found`;
  }
  let r;
  try {
    r = await fetch(entry.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(init),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (e) {
    return `unreachable (${e.cause?.code || e.message})`;
  }
  await r.body?.cancel();
  if (entry.auth === 'none') return r.ok ? 'ok' : `expected no sign-in, got HTTP ${r.status}`;
  const u = new URL(entry.url);
  const hinted = /resource_metadata="([^"]+)"/.exec(r.headers.get('www-authenticate') || '')?.[1];
  const path = u.pathname.replace(/\/$/, '');
  let prm = null;
  for (const url of [hinted, `${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`].filter(Boolean)) {
    prm = await getJson(url);
    if (prm) break;
  }
  // Some servers (Google's) answer `initialize` openly and ask for a sign-in only on calls; their metadata says so.
  if (r.status !== 401 && !(r.ok && prm?.authorization_servers?.length)) return `expected a sign-in to be asked for, got HTTP ${r.status}`;
  if (entry.auth !== 'oauth') return 'ok';
  const issuer = new URL(prm?.authorization_servers?.[0] || u.origin);
  const ip = issuer.pathname.replace(/\/$/, '');
  const meta =
    (await getJson(`${issuer.origin}/.well-known/oauth-authorization-server${ip}`)) ||
    (await getJson(`${issuer.origin}/.well-known/openid-configuration${ip}`)) ||
    (await getJson(`${issuer.href.replace(/\/$/, '')}/.well-known/openid-configuration`));
  return meta?.registration_endpoint ? 'ok' : 'no registration endpoint: should it be oauth-app?';
}

const results = await Promise.all(catalog.map(async (entry) => [entry.id, await check(entry)]));
let failed = 0;
for (const [id, outcome] of results) {
  if (outcome !== 'ok') failed++;
  console.log(`${outcome === 'ok' ? 'ok  ' : 'FAIL'} ${id.padEnd(18)} ${outcome === 'ok' ? '' : outcome}`);
}
console.log(`\n${results.length - failed} of ${results.length} connectors as the catalog says.`);
process.exit(failed ? 1 : 0);
