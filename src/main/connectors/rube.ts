/** Rube's tools, as the bundled integration skills name them. */
const RUBE = /\bRUBE_([A-Z0-9_]+)\b/g;

/**
 * A skill written for Rube (retired May 2026), pointed at Composio Connect: each `RUBE_<X>` becomes
 * the model-facing name of Composio's `COMPOSIO_<X>`. Names Composio doesn't offer stay as written.
 */
export function pointAtComposio(body: string, composio: ReadonlyMap<string, string>): string {
  return composio.size ? body.replace(RUBE, (whole, rest: string) => composio.get(`COMPOSIO_${rest}`) ?? whole) : body;
}
