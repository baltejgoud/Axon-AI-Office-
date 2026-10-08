export interface OverlayRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const overlaps = (a: OverlayRect, b: OverlayRect, gap = 8) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
/** Nearest free position above/below an anchor, keeping the whole card inside the viewport. */
export function placeOverlay(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  bounds: OverlayRect,
  obstacles: readonly OverlayRect[]
): OverlayRect | null {
  if (size.w > bounds.w || size.h > bounds.h) return null;
  const clampX = (x: number) => Math.max(bounds.x, Math.min(bounds.x + bounds.w - size.w, x));
  const clampY = (y: number) => Math.max(bounds.y, Math.min(bounds.y + bounds.h - size.h, y));
  const above = anchor.y - size.h - 24;
  const preferred = { x: anchor.x - size.w / 2, y: above < bounds.y ? anchor.y + 24 : above };
  const xs = [
    preferred.x,
    anchor.x + 24,
    anchor.x - size.w - 24,
    bounds.x,
    bounds.x + bounds.w - size.w,
    ...obstacles.flatMap((o) => [o.x - size.w - 10, o.x + o.w + 10])
  ];
  const ys = [
    preferred.y,
    anchor.y + 24,
    bounds.y,
    bounds.y + bounds.h - size.h,
    ...obstacles.flatMap((o) => [o.y - size.h - 10, o.y + o.h + 10])
  ];
  const candidates = xs
    .flatMap((x) => ys.map((y) => ({ x: clampX(x), y: clampY(y), ...size })))
    .filter((rect) => obstacles.every((o) => !overlaps(rect, o)));
  candidates.sort(
    (a, b) =>
      Math.hypot(a.x - preferred.x, a.y - preferred.y) - Math.hypot(b.x - preferred.x, b.y - preferred.y)
  );
  return candidates[0] ?? null;
}
