/** Each catalog connector's own logo, bundled from `assets/connectors/<id>.<svg|png|ico>` (see SOURCES.md there). */
const files = import.meta.glob('../assets/connectors/*.{svg,png,ico}', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>;

const byId = new Map(Object.entries(files).map(([file, url]) => [file.replace(/^.*\/|\.\w+$/g, ''), url]));

/** The logo's URL for a catalog connector; undefined for custom ones. */
export const connectorLogo = (catalogId?: string): string | undefined =>
  catalogId ? byId.get(catalogId) : undefined;
