// Fetches every catalog connector's real logo into src/renderer/src/assets/connectors/, from pinned sources,
// and writes SOURCES.md beside them. Run it again (`npm run connectors:logos`) to refresh; the app bundles the files.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

/** The gilbarbara/logos collection (CC0), pinned to one commit. */
const GL = 'https://cdn.jsdelivr.net/gh/gilbarbara/logos@a5b65275e761a8347a99eded1101c6b130a06e52/logos/';

/**
 * Each connector's logo: its square mark, never a wordmark. From the collection where it has one; otherwise
 * the app icon the service itself publishes on its site. `crop` keeps only a wordmark SVG's mark.
 */
const LOGOS = {
  github: GL + 'github-icon.svg',
  gitlab: GL + 'gitlab-icon.svg',
  linear: GL + 'linear-icon.svg',
  sentry: GL + 'sentry-icon.svg',
  vercel: GL + 'vercel-icon.svg',
  netlify: GL + 'netlify-icon.svg',
  supabase: GL + 'supabase-icon.svg',
  neon: GL + 'neon-icon.svg',
  prisma: GL + 'prisma.svg',
  cloudflare: GL + 'cloudflare-icon.svg',
  notion: GL + 'notion-icon.svg',
  atlassian: GL + 'atlassian.svg',
  asana: GL + 'asana-icon.svg',
  monday: GL + 'monday-icon.svg',
  clickup: GL + 'clickup-icon.svg',
  todoist: GL + 'todoist-icon.svg',
  airtable: GL + 'airtable.svg',
  // Box's logo is its wordmark; box.com refuses automated downloads of its app icon.
  box: GL + 'box.svg',
  figma: GL + 'figma.svg',
  canva: 'https://static.canva.com/domain-assets/canva/static/images/android-192x192-2.png',
  webflow: 'https://cdn.prod.website-files.com/686294e263eb7e215bd232f7/686d53d0446d4237b2f38c5f_webclip.png',
  slack: GL + 'slack-icon.svg',
  gmail: GL + 'google-gmail.svg',
  'google-calendar': GL + 'google-calendar.svg',
  'google-drive': GL + 'google-drive.svg',
  intercom: GL + 'intercom-icon.svg',
  hubspot: 'https://www.hubspot.com/hubfs/HubSpot_Logos/HubSpot-Inversed-Favicon.png',
  stripe: 'https://images.stripeassets.com/fzn2n1nzq965/1hgcBNd12BfT9VLgbId7By/01d91920114b124fb4cf6d448f9f06eb/favicon.svg',
  paypal: GL + 'paypal.svg',
  'microsoft-learn': GL + 'microsoft-icon.svg',
  'cloudflare-docs': GL + 'cloudflare-icon.svg',
  deepwiki: 'https://deepwiki.com/apple-icon.png',
  context7: {
    url: 'https://raw.githubusercontent.com/upstash/context7/e275a848a420e0d11c2822f61201ee005bfd1133/docs/public/logo/logo.svg',
    crop: '0 0 28 28'
  },
  exa: GL + 'exa-icon.svg',
  huggingface: GL + 'hugging-face-icon.svg',
  composio: 'https://composio.dev/apple-touch-icon.png',
  zapier: 'https://zapier.com/favicon.ico',
  playwright: GL + 'playwright.svg',
  'chrome-devtools': GL + 'chrome.svg'
};

const out = new URL('../src/renderer/src/assets/connectors/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('../src/connectors/catalog.json', import.meta.url), 'utf8'));
const missing = catalog.map((entry) => entry.id).filter((id) => !LOGOS[id]);
if (missing.length) throw new Error(`No logo source for: ${missing.join(', ')}`);

/** The file type from the bytes themselves, not the URL or the server's word. */
function kind(bytes) {
  if (bytes.subarray(1, 4).toString('ascii') === 'PNG') return 'png';
  if (bytes.readUInt32LE(0) === 0x00010000) return 'ico';
  const head = bytes.subarray(0, 512).toString('utf8');
  if (/<svg[\s>]/.test(head) || (/<\?xml/.test(head) && bytes.toString('utf8').includes('<svg'))) return 'svg';
  throw new Error('not an image');
}

/** Only the part of an SVG inside `viewBox`: the mark of a wordmark. */
function crop(svg, viewBox) {
  const [, , w, h] = viewBox.split(' ');
  return svg.replace(/<svg\b[^>]*>/, (open) =>
    open.replace(/\sviewBox="[^"]*"/, ` viewBox="${viewBox}"`).replace(/\swidth="[^"]*"/, ` width="${w}"`).replace(/\sheight="[^"]*"/, ` height="${h}"`)
  );
}

mkdirSync(out, { recursive: true });
for (const file of readdirSync(out)) rmSync(new URL(file, out));
const rows = [];
for (const entry of catalog) {
  const source = typeof LOGOS[entry.id] === 'string' ? { url: LOGOS[entry.id] } : LOGOS[entry.id];
  const response = await fetch(source.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140 axon-logos' }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${entry.id}: HTTP ${response.status} from ${source.url}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 200_000) throw new Error(`${entry.id}: ${bytes.length} bytes is too big for an icon`);
  const type = kind(bytes);
  if (source.crop) bytes = Buffer.from(crop(bytes.toString('utf8'), source.crop));
  writeFileSync(new URL(`${entry.id}.${type}`, out), bytes);
  rows.push(`| ${entry.name} | \`${entry.id}.${type}\` | ${source.url}${source.crop ? ` (cropped to \`${source.crop}\`)` : ''} |`);
  console.log(`${entry.id.padEnd(18)} ${type}  ${bytes.length} bytes`);
}

writeFileSync(new URL('SOURCES.md', out), `# Connector logos

Each connector's own logo, fetched by \`npm run connectors:logos\` (\`scripts/connectors-logos.mjs\`). The marks
are the trademarks of their owners and are shown only to identify each service. Files from gilbarbara/logos
are CC0; the others are the icons each service publishes on its own site.

| Connector | File | Source |
| --- | --- | --- |
${rows.join('\n')}
`);
console.log(`\n${rows.length} logos written.`);
