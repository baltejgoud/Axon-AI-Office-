import { ROOM, WALL_THICKNESS, type FurnitureItem, type Wall } from './layout';
import type { Vec2 } from './types';

export type Obstacle =
  | { kind: 'rect'; minX: number; maxX: number; minZ: number; maxZ: number }
  | { kind: 'circle'; x: number; z: number; r: number };

export function obstaclesFrom(walls: readonly Wall[], furniture: readonly FurnitureItem[]): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const half = WALL_THICKNESS / 2;
  for (const w of walls) {
    obstacles.push({
      kind: 'rect',
      minX: Math.min(w.from.x, w.to.x) - half,
      maxX: Math.max(w.from.x, w.to.x) + half,
      minZ: Math.min(w.from.z, w.to.z) - half,
      maxZ: Math.max(w.from.z, w.to.z) + half
    });
  }
  for (const f of furniture) {
    if (!f.blocks) continue;
    if (f.round) {
      obstacles.push({ kind: 'circle', x: f.x, z: f.z, r: f.w / 2 });
      continue;
    }
    const quarterTurned = Math.abs(Math.sin(f.rotation)) > 0.5;
    const halfW = (quarterTurned ? f.d : f.w) / 2;
    const halfD = (quarterTurned ? f.w : f.d) / 2;
    obstacles.push({
      kind: 'rect',
      minX: f.x - halfW,
      maxX: f.x + halfW,
      minZ: f.z - halfD,
      maxZ: f.z + halfD
    });
  }
  return obstacles;
}

function distanceToObstacle(o: Obstacle, x: number, z: number): number {
  if (o.kind === 'circle') return Math.hypot(x - o.x, z - o.z) - o.r;
  const dx = Math.max(o.minX - x, 0, x - o.maxX);
  const dz = Math.max(o.minZ - z, 0, z - o.maxZ);
  return Math.hypot(dx, dz);
}

interface Grid {
  blocked: Uint8Array;
  comfortBlocked: Uint8Array;
}

/**
 * Walkable-floor grid with A* search. Obstacles are inflated by the body radius, so any path
 * returned keeps a person's shoulders clear of furniture and walls. Paths prefer open floor,
 * which keeps people in the aisles rather than brushing past desks.
 */
export class NavGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  private readonly grid: Grid;

  constructor(
    obstacles: readonly Obstacle[],
    options: { cellSize?: number; bodyRadius?: number; comfortRadius?: number } = {}
  ) {
    this.cellSize = options.cellSize ?? 0.2;
    const bodyRadius = options.bodyRadius ?? 0.28;
    const comfortRadius = options.comfortRadius ?? 0.5;
    this.cols = Math.ceil((ROOM.maxX - ROOM.minX) / this.cellSize);
    this.rows = Math.ceil((ROOM.maxZ - ROOM.minZ) / this.cellSize);
    const blocked = new Uint8Array(this.cols * this.rows);
    const comfortBlocked = new Uint8Array(this.cols * this.rows);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const { x, z } = this.centerOf(col, row);
        let nearest = Math.min(x - ROOM.minX, ROOM.maxX - x, z - ROOM.minZ, ROOM.maxZ - z);
        for (const o of obstacles) nearest = Math.min(nearest, distanceToObstacle(o, x, z));
        const index = row * this.cols + col;
        blocked[index] = nearest < bodyRadius ? 1 : 0;
        comfortBlocked[index] = nearest < comfortRadius ? 1 : 0;
      }
    }
    this.grid = { blocked, comfortBlocked };
  }

  private centerOf(col: number, row: number): Vec2 {
    return { x: ROOM.minX + (col + 0.5) * this.cellSize, z: ROOM.minZ + (row + 0.5) * this.cellSize };
  }

  private cellOf(p: Vec2): [number, number] {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor((p.x - ROOM.minX) / this.cellSize)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor((p.z - ROOM.minZ) / this.cellSize)));
    return [col, row];
  }

  isFree(p: Vec2): boolean {
    if (p.x <= ROOM.minX || p.x >= ROOM.maxX || p.z <= ROOM.minZ || p.z >= ROOM.maxZ) return false;
    const [col, row] = this.cellOf(p);
    return this.grid.blocked[row * this.cols + col] === 0;
  }

  /**
   * True when a body can travel the straight line between two points. Walks every cell the line
   * touches (not samples along it), so a path can never clip the corner of blocked floor.
   */
  isClearLine(a: Vec2, b: Vec2, comfortable = false): boolean {
    const cells = comfortable ? this.grid.comfortBlocked : this.grid.blocked;
    const blockedAt = (c: number, r: number) =>
      c < 0 || r < 0 || c >= this.cols || r >= this.rows || cells[r * this.cols + c] === 1;
    let [col, row] = this.cellOf(a);
    const [endCol, endRow] = this.cellOf(b);
    if (blockedAt(col, row)) return false;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const stepCol = Math.sign(dx);
    const stepRow = Math.sign(dz);
    const cellX = ROOM.minX + col * this.cellSize;
    const cellZ = ROOM.minZ + row * this.cellSize;
    let tMaxX = dx ? ((stepCol > 0 ? cellX + this.cellSize : cellX) - a.x) / dx : Infinity;
    let tMaxZ = dz ? ((stepRow > 0 ? cellZ + this.cellSize : cellZ) - a.z) / dz : Infinity;
    const tDeltaX = dx ? this.cellSize / Math.abs(dx) : Infinity;
    const tDeltaZ = dz ? this.cellSize / Math.abs(dz) : Infinity;
    let remaining = Math.abs(endCol - col) + Math.abs(endRow - row);
    while (remaining > 0) {
      if (Math.abs(tMaxX - tMaxZ) < 1e-9) {
        // Exactly through a corner: both side cells must be open too.
        if (blockedAt(col + stepCol, row) || blockedAt(col, row + stepRow)) return false;
        col += stepCol;
        row += stepRow;
        tMaxX += tDeltaX;
        tMaxZ += tDeltaZ;
        remaining -= 2;
      } else if (tMaxX < tMaxZ) {
        col += stepCol;
        tMaxX += tDeltaX;
        remaining--;
      } else {
        row += stepRow;
        tMaxZ += tDeltaZ;
        remaining--;
      }
      if (blockedAt(col, row)) return false;
    }
    return true;
  }

  private nearestFreeCell(col: number, row: number): number | null {
    const { blocked } = this.grid;
    if (!blocked[row * this.cols + col]) return row * this.cols + col;
    for (let radius = 1; radius < 12; radius++) {
      let best: number | null = null;
      let bestDistance = Infinity;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || blocked[r * this.cols + c]) continue;
          const d = dr * dr + dc * dc;
          if (d < bestDistance) {
            bestDistance = d;
            best = r * this.cols + c;
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  }

  /**
   * Waypoints from `from` to `to` (both included), or null when no route exists.
   * Straight runs are merged so people walk in natural lines, not grid staircases.
   */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    if (
      this.isClearLine(from, to, true) ||
      (Math.hypot(to.x - from.x, to.z - from.z) < 1.2 && this.isClearLine(from, to))
    )
      return [from, to];
    const start = this.nearestFreeCell(...this.cellOf(from));
    const goal = this.nearestFreeCell(...this.cellOf(to));
    if (start === null || goal === null) return null;
    const cells = this.search(start, goal);
    if (!cells) return null;
    const points = cells.map((index) => this.centerOf(index % this.cols, Math.floor(index / this.cols)));
    points[0] = from;
    points[points.length - 1] = to;
    return this.smooth(points);
  }

  private search(start: number, goal: number): number[] | null {
    const { blocked, comfortBlocked } = this.grid;
    const cols = this.cols;
    const total = cols * this.rows;
    const gScore = new Float64Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const goalCol = goal % cols;
    const goalRow = Math.floor(goal / cols);
    const heuristic = (index: number) => {
      const dc = Math.abs((index % cols) - goalCol);
      const dr = Math.abs(Math.floor(index / cols) - goalRow);
      return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
    };
    const heap = new MinHeap();
    gScore[start] = 0;
    heap.push(start, heuristic(start));
    while (heap.size) {
      const current = heap.pop();
      if (current === goal) {
        const path: number[] = [];
        for (let at = goal; at !== -1; at = cameFrom[at]) path.push(at);
        return path.reverse();
      }
      if (closed[current]) continue;
      closed[current] = 1;
      const col = current % cols;
      const row = Math.floor(current / cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const c = col + dc;
          const r = row + dr;
          if (c < 0 || r < 0 || c >= cols || r >= this.rows) continue;
          const next = r * cols + c;
          if (blocked[next] || closed[next]) continue;
          // No squeezing diagonally past a corner.
          if (dr && dc && (blocked[row * cols + c] || blocked[r * cols + col])) continue;
          const step = (dr && dc ? Math.SQRT2 : 1) * (comfortBlocked[next] ? 2.2 : 1);
          const tentative = gScore[current] + step;
          if (tentative < gScore[next]) {
            gScore[next] = tentative;
            cameFrom[next] = current;
            heap.push(next, tentative + heuristic(next));
          }
        }
      }
    }
    return null;
  }

  private smooth(points: Vec2[]): Vec2[] {
    const result = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let reach = anchor + 1;
      // Prefer long lines through open floor; near furniture, accept any line a body fits through.
      for (const comfortable of [true, false]) {
        let candidate = anchor + 1;
        while (
          candidate + 1 < points.length &&
          this.isClearLine(points[anchor], points[candidate + 1], comfortable)
        )
          candidate++;
        if (candidate > reach) reach = candidate;
        if (reach > anchor + 1) break;
      }
      result.push(points[reach]);
      anchor = reach;
    }
    return result;
  }
}

class MinHeap {
  private readonly items: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.priorities.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.priorities[0] = lastPriority;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.priorities[left] < this.priorities[smallest]) smallest = left;
        if (right < this.items.length && this.priorities[right] < this.priorities[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}
