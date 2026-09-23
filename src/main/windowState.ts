import { readFileSync, writeFileSync } from 'node:fs';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState {
  bounds?: Rect;
  maximized: boolean;
}

const MIN_WIDTH = 980;
const MIN_HEIGHT = 680;
const isRect = (value: unknown): value is Rect =>
  !!value &&
  typeof value === 'object' &&
  ['x', 'y', 'width', 'height'].every((key) => Number.isFinite((value as Record<string, unknown>)[key]));

/** Validates saved state: maximized unless the user left it restored, bounds only if visible and usable. */
export function restoreState(saved: unknown, displays: Rect[]): WindowState {
  if (!saved || typeof saved !== 'object' || typeof (saved as WindowState).maximized !== 'boolean')
    return { maximized: true };
  const { maximized, bounds } = saved as WindowState;
  if (!isRect(bounds) || bounds.width < MIN_WIDTH || bounds.height < MIN_HEIGHT) return { maximized };
  const visible = displays.some(
    (d) =>
      bounds.x + 100 <= d.x + d.width &&
      bounds.x + bounds.width - 100 >= d.x &&
      bounds.y >= d.y - 10 &&
      bounds.y + 40 <= d.y + d.height
  );
  return visible ? { maximized, bounds } : { maximized };
}

export function loadWindowState(file: string, displays: Rect[]): WindowState {
  try {
    return restoreState(JSON.parse(readFileSync(file, 'utf8')), displays);
  } catch {
    return { maximized: true };
  }
}

export function saveWindowState(file: string, state: WindowState): void {
  try {
    writeFileSync(file, JSON.stringify(state));
  } catch {
    // Losing the window size is harmless; never block quitting over it.
  }
}
