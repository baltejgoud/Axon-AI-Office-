import { readFileSync, writeFileSync } from 'node:fs';

/** Most folders kept on the Files room wall. */
export const WALL_SIZE = 12;

const sameFolder = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Puts a folder first on the wall (moving it if already there), keeping at most WALL_SIZE. */
export function remember(wall: readonly string[], folder: string): string[] {
  return [folder, ...wall.filter((item) => !sameFolder(item, folder))].slice(0, WALL_SIZE);
}

export function forget(wall: readonly string[], folder: string): string[] {
  return wall.filter((item) => !sameFolder(item, folder));
}

export function isOnWall(wall: readonly string[], folder: string): boolean {
  return wall.some((item) => sameFolder(item, folder));
}

/** The saved wall; anything unreadable or malformed means an empty wall. */
export function loadWall(file: string): string[] {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, WALL_SIZE)
      : [];
  } catch {
    return [];
  }
}

export function saveWall(file: string, wall: readonly string[]): void {
  try {
    writeFileSync(file, JSON.stringify(wall));
  } catch {
    // The wall is a convenience; losing it only means choosing folders again.
  }
}
