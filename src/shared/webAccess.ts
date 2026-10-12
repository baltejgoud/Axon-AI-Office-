/**
 * Web access for coworkers: they may search the web and read public pages. Both processes read
 * this: Settings to show the choice, the main process to offer and run the two tools.
 */

export type WebSearchProvider = 'duckduckgo' | 'brave' | 'tavily';
/** The search services that need a key of your own. */
export type WebKeyProvider = Exclude<WebSearchProvider, 'duckduckgo'>;

export interface WebAccessSettings {
  /** Coworkers (and your own chats) may search the web and read pages. On unless turned off. */
  enabled: boolean;
  provider: WebSearchProvider;
}

export const DEFAULT_WEB_ACCESS: Readonly<WebAccessSettings> = { enabled: true, provider: 'duckduckgo' };

export interface WebProviderInfo {
  id: WebSearchProvider;
  label: string;
  needsKey: boolean;
  /** One plain line on the service, shown under the choice. */
  hint: string;
  /** Where to get a key; absent when none is needed. */
  keyUrl?: string;
  keyPlaceholder?: string;
}

export const WEB_PROVIDERS: readonly WebProviderInfo[] = [
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    needsKey: false,
    hint: 'Free and needs no key. It may ask for a human check now and then; if searches stop working, try Brave or Tavily.'
  },
  {
    id: 'brave',
    label: 'Brave Search',
    needsKey: true,
    hint: 'Steadier than DuckDuckGo, with a free monthly allowance. Needs a Brave Search API key.',
    keyUrl: 'https://brave.com/search/api/',
    keyPlaceholder: 'BSA…'
  },
  {
    id: 'tavily',
    label: 'Tavily',
    needsKey: true,
    hint: 'Built for AI assistants, with a free monthly allowance. Needs a Tavily API key.',
    keyUrl: 'https://app.tavily.com/',
    keyPlaceholder: 'tvly-…'
  }
];

export const WEB_PROVIDER_IDS: readonly WebSearchProvider[] = WEB_PROVIDERS.map((p) => p.id);

export const isWebProvider = (value: unknown): value is WebSearchProvider =>
  typeof value === 'string' && (WEB_PROVIDER_IDS as readonly string[]).includes(value);
export const isWebKeyProvider = (value: unknown): value is WebKeyProvider =>
  value === 'brave' || value === 'tavily';

/** The two tools coworkers search and read with. */
export const WEB_TOOL_NAMES: ReadonlySet<string> = new Set(['web_search', 'read_webpage']);

/**
 * The most of a web result that reaches the model whole. Other tool results are cut to about four
 * kilobytes with the rest left to read_tool_output, which would leave a page's text out of reach:
 * a page part is already bounded (see tools/web.ts), so web results are let through up to this.
 */
export const WEB_RESULT_BYTES = 64_000;

/** Settings as saved by an older Axon, or edited by hand: what they mean now. Anything unclear is the default. */
export function normalWebAccess(value: unknown): WebAccessSettings {
  const given = value && typeof value === 'object' ? (value as Partial<WebAccessSettings>) : {};
  return {
    enabled: typeof given.enabled === 'boolean' ? given.enabled : DEFAULT_WEB_ACCESS.enabled,
    provider: isWebProvider(given.provider) ? given.provider : DEFAULT_WEB_ACCESS.provider
  };
}

/** Settings as the window sends them: absent means unchanged, anything malformed is refused. */
export function checkedWebAccess(value: unknown): WebAccessSettings {
  const given = value as Partial<WebAccessSettings> | null;
  if (!given || typeof given !== 'object' || Array.isArray(given) || typeof given.enabled !== 'boolean')
    throw new Error('Web access settings are not valid.');
  if (!isWebProvider(given.provider)) throw new Error('Choose DuckDuckGo, Brave Search or Tavily for web search.');
  return { enabled: given.enabled, provider: given.provider };
}

/** The provider's label for people. */
export const webProviderLabel = (id: WebSearchProvider): string =>
  WEB_PROVIDERS.find((p) => p.id === id)?.label ?? id;

/** What a vault entry for a search key is called. */
export const webKeySecret = (provider: WebKeyProvider): string => `web-search:${provider}`;
