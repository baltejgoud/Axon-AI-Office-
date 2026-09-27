/**
 * The one typeface across Axon: Inter, bundled with the app so it looks the same on Windows, macOS
 * and Linux. The rest of the stack only covers the moment before it loads.
 */
export const UI_FONT = '"Inter Variable", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';

/**
 * Resolves once Inter can draw text. Canvas text (office signs and task boards) does not wait for a
 * web font the way page text does, so canvases draw again when this resolves.
 */
export function uiFontReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return Promise.all([
    document.fonts.load('500 16px "Inter Variable"'),
    document.fonts.load('700 16px "Inter Variable"')
  ]).then(
    () => undefined,
    () => undefined
  );
}
