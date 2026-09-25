import { hashString } from '../../simulation/random';
import type { ScreenApp } from './screenApps';

/**
 * One picture per app, in two variants: the real app's layout and colours, text as lines (at the
 * office's zoom words would not be legible). Painters draw through a `Pen` in tile pixels (256 × 160,
 * y down), so they need no DOM and can be tested; screenSheet.ts runs them onto a canvas. Where an
 * app scrolls (see SCROLL in screenApps.ts), its band is drawn as rows that repeat every band height.
 */

export interface Pen {
  rect(color: string, x: number, y: number, w: number, h: number): void;
  round(color: string, x: number, y: number, w: number, h: number, radius: number): void;
  dot(color: string, x: number, y: number, radius: number): void;
  line(color: string, width: number, points: readonly (readonly [number, number])[]): void;
}

export type Painter = (pen: Pen, random: () => number, variant: 0 | 1) => void;

/** The seed an app's variant is painted with. */
export const paintSeed = (app: ScreenApp, variant: 0 | 1): number => hashString(`${app}:${variant}`);

const W = 256;
const H = 160;
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
const AVATARS = ['#fca5a5', '#93c5fd', '#fcd34d', '#a7f3d0'];

/** A line of text: a bar three pixels tall. */
const text = (pen: Pen, color: string, x: number, y: number, width: number) =>
  pen.rect(color, x, y, Math.max(2, width), 3);

/** `rows` lines of text, `gap` apart, each a random share (at least `shortest`) of `width`. */
function lines(
  pen: Pen,
  random: () => number,
  color: string,
  x: number,
  y: number,
  width: number,
  rows: number,
  gap: number,
  shortest = 0.35
): void {
  for (let i = 0; i < rows; i++)
    text(pen, color, x, y + i * gap, width * (shortest + random() * (1 - shortest)));
}

const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)];

/** An app window: background, a 10 px title bar and its three buttons. */
function frame(pen: Pen, background: string, bar: string): void {
  pen.rect(background, 0, 0, W, H);
  pen.rect(bar, 0, 0, W, 10);
  pen.dot('#ff5f57', 6, 5, 2);
  pen.dot('#febc2e', 13, 5, 2);
  pen.dot('#28c840', 20, 5, 2);
}

/** A random walk across `w`, for graphs. */
function walk(random: () => number, x: number, y: number, w: number, h: number): [number, number][] {
  const points: [number, number][] = [];
  let v = 0.5;
  for (let i = 0; i <= 24; i++) {
    v = Math.min(0.95, Math.max(0.05, v + (random() - 0.5) * 0.25));
    points.push([x + (w * i) / 24, y + h - v * h]);
  }
  return points;
}

export const PAINTERS: Record<ScreenApp, Painter> = {
  editor(pen, random, variant) {
    const syntax = variant
      ? ['#c586c0', '#9cdcfe', '#ce9178', '#dcdcaa', '#4ec9b0']
      : ['#569cd6', '#9cdcfe', '#ce9178', '#b5cea8', '#6a9955'];
    pen.rect('#1e1e1e', 0, 0, W, H);
    pen.rect('#333333', 0, 0, 10, H);
    for (const y of [6, 20, 34, 48]) pen.rect('#858585', 3, y, 4, 4);
    pen.rect('#252526', 10, 0, 50, H);
    pen.rect('#37373d', 10, 14 + 8 * Math.floor(random() * 10), 50, 7);
    for (let i = 0; i < 16; i++) text(pen, '#8a8a8a', i % 3 === 0 ? 16 : 22, 16 + i * 8, 14 + random() * 22);
    pen.rect('#2d2d2d', 60, 0, W - 60, 14);
    pen.rect('#1e1e1e', 60, 0, 46, 14);
    text(pen, '#cccccc', 66, 6, 30);
    text(pen, '#8a8a8a', 112, 6, 28);
    // The code pane scrolls: 18 rows of 7 px fill its band (21..147) exactly.
    let indent = 0;
    for (let i = 0; i < 18; i++) {
      const y = 23 + i * 7;
      text(pen, '#5a5a5a', 62, y, 7);
      indent = Math.max(0, Math.min(3, indent + (random() < 0.3 ? 1 : random() < 0.35 ? -1 : 0)));
      let x = 74 + indent * 8;
      const words = 1 + Math.floor(random() * 4);
      for (let w = 0; w < words && x < 222; w++) {
        const width = Math.min(6 + random() * 24, 228 - x);
        text(pen, pick(random, syntax), x, y, width);
        x += width + 3;
      }
    }
    pen.rect('#252526', 232, 14, 24, 136);
    for (let y = 18; y < 146; y += 3) pen.rect('#4b4b4b', 236, y, 4 + random() * 14, 1);
    pen.rect(variant ? '#16825d' : '#007acc', 0, 150, W, 10);
    text(pen, '#ffffff', 6, 154, 34);
    text(pen, '#ffffff', 196, 154, 52);
  },

  terminal(pen, random, variant) {
    frame(pen, '#0c0c0c', '#2b2b2b');
    const output = variant
      ? ['#d3d7cf', '#d3d7cf', '#8ae234', '#fce94f', '#729fcf']
      : ['#cccccc', '#cccccc', '#cccccc', '#16c60c', '#f9f1a5', '#e74856'];
    // 20 rows of 7 px fill the band (14..154).
    for (let i = 0; i < 20; i++) {
      const y = 16 + i * 7;
      if (random() < 0.22) {
        text(pen, '#16c60c', 6, y, 12);
        text(pen, '#3b78ff', 20, y, 18);
        text(pen, '#f2f2f2', 42, y, 24 + random() * 100);
      } else {
        text(pen, '#767676', 6, y, 18);
        text(pen, pick(random, output), 28, y, 30 + random() * 190);
      }
    }
    if (variant) {
      pen.rect('#16c60c', 0, 155, W, 5);
      pen.rect('#0c0c0c', 4, 156, 40, 3);
    }
  },

  'browser-devtools'(pen, random, variant) {
    const brand = variant ? '#7c3aed' : '#2563eb';
    frame(pen, '#ffffff', '#dee1e6');
    pen.round('#f1f3f4', 30, 12, 196, 8, 4);
    text(pen, '#5f6368', 38, 15, 70);
    pen.rect('#111827', 0, 22, W, 10);
    text(pen, '#ffffff', 8, 26, 24);
    for (let i = 0; i < 4; i++) text(pen, '#9ca3af', 150 + i * 24, 26, 16);
    pen.rect(variant ? '#ede9fe' : '#dbeafe', 0, 32, W, 30);
    pen.rect('#111827', 20, 38, 110, 5);
    lines(pen, random, '#6b7280', 20, 47, 120, 2, 5);
    pen.round(brand, 20, 55, 36, 6, 3);
    pen.round('#ffffff', 160, 36, 76, 22, 3);
    pen.rect(brand, 166, 42, 30, 10);
    for (let i = 0; i < 3; i++) {
      const x = 16 + i * 78;
      pen.round('#f3f4f6', x, 66, 70, 24, 3);
      pen.rect(pick(random, ['#fca5a5', '#93c5fd', '#86efac', '#fcd34d']), x + 4, 70, 18, 16);
      lines(pen, random, '#9ca3af', x + 26, 72, 40, 3, 5);
    }
    pen.rect('#242424', 0, 94, W, 66);
    pen.rect('#333333', 0, 94, W, 9);
    ['#a8c7fa', '#9aa0a6', '#9aa0a6', '#9aa0a6'].forEach((color, i) => text(pen, color, 6 + i * 34, 97, 24));
    for (let i = 0; i < 7; i++) {
      const y = 107 + i * 7;
      const indent = 6 + Math.floor(random() * 4) * 8;
      text(pen, '#5db0d7', indent, y, 16);
      text(pen, '#f28b54', indent + 20, y, 14 + random() * 20);
      text(pen, '#9aa0a6', indent + 60, y, 20 + random() * 40);
    }
    pen.rect('#303134', 170, 103, 1, 57);
    lines(pen, random, '#9aa0a6', 176, 108, 70, 7, 7);
  },

  browser(pen, random, variant) {
    frame(pen, '#ffffff', '#dee1e6');
    pen.round('#f1f3f4', 30, 12, 196, 8, 4);
    text(pen, '#5f6368', 38, 15, 90);
    pen.rect(variant ? '#1a1a1a' : '#0f766e', 0, 22, W, 12);
    text(pen, '#ffffff', 10, 27, 40);
    pen.rect('#111111', 30, 42, 150, 6);
    pen.rect('#111111', 30, 51, 100, 6);
    text(pen, '#9ca3af', 30, 61, 60);
    pen.rect(pick(random, ['#bfdbfe', '#fde68a', '#bbf7d0', '#fecaca']), 30, 68, 150, 36);
    lines(pen, random, '#4b5563', 30, 110, 150, 7, 6);
    for (let i = 0; i < 3; i++) {
      pen.rect('#e5e7eb', 196, 44 + i * 30, 44, 22);
      text(pen, '#6b7280', 196, 69 + i * 30, 20 + random() * 20);
    }
  },

  sql(pen, random, variant) {
    pen.rect('#1e1f22', 0, 0, W, H);
    pen.rect('#2b2d30', 0, 0, W, 10);
    pen.round('#6aab73', 6, 2, 10, 6, 2);
    pen.round('#56a8f5', 20, 2, 10, 6, 2);
    const keywords = [20, 24, 30, 34, 26];
    const values = ['#bcbec4', '#bcbec4', '#6aab73', '#bcbec4', '#2aacb8'];
    keywords.forEach((width, i) => {
      const y = 16 + i * 8;
      text(pen, '#6f737a', 4, y, 8);
      text(pen, '#cf8e6d', 16, y, width);
      text(pen, values[i], 20 + width, y, 20 + random() * 70);
    });
    pen.rect('#2b2d30', 0, 58, W, 10);
    text(pen, '#bcbec4', 6, 61, 40);
    text(pen, variant ? '#f75464' : '#6aab73', 200, 61, 40);
    const columns = [4, 44, 110, 170, 214];
    pen.rect('#2b2d30', 0, 68, W, 9);
    columns.forEach((x) => text(pen, '#dfe1e5', x + 2, 71, 26));
    for (let r = 0; r < 11; r++) {
      const y = 79 + r * 7;
      if (r % 2) pen.rect('#232427', 0, y - 2, W, 7);
      columns.forEach((x, c) =>
        text(pen, c === 0 ? '#6f737a' : c === 3 ? '#2aacb8' : '#bcbec4', x + 2, y, 10 + random() * 26)
      );
    }
  },

  simulator(pen, random, variant) {
    pen.rect('#1e1e1e', 0, 0, W, H);
    pen.rect('#252526', 0, 0, 36, H);
    lines(pen, random, '#8a8a8a', 5, 8, 26, 18, 8);
    const syntax = ['#fc5fa3', '#67b7a4', '#d0bf69', '#a167e6', '#ffffff'];
    for (let i = 0; i < 19; i++) {
      const y = 8 + i * 7;
      let x = 42 + Math.floor(random() * 3) * 8;
      for (let w = 0; w < 3 && x < 150; w++) {
        const width = Math.min(6 + random() * 20, 156 - x);
        text(pen, pick(random, syntax), x, y, width);
        x += width + 3;
      }
    }
    const app = variant ? '#34c759' : '#0a84ff';
    pen.rect('#2d2d2d', 164, 0, 92, H);
    pen.round('#0b0b0b', 186, 8, 48, 146, 8);
    pen.round('#ffffff', 189, 13, 42, 136, 5);
    pen.rect(app, 189, 18, 42, 14);
    text(pen, '#ffffff', 194, 23, 22);
    for (let i = 0; i < 6; i++) {
      const y = 36 + i * 16;
      pen.dot(pick(random, ['#ff9f0a', '#bf5af2', '#64d2ff', '#ff375f']), 197, y + 5, 4);
      text(pen, '#1c1c1e', 204, y + 2, 20);
      text(pen, '#8e8e93', 204, y + 7, 14);
    }
    pen.rect('#f2f2f7', 189, 134, 42, 12);
    for (let i = 0; i < 4; i++) pen.dot(i === 0 ? app : '#8e8e93', 195 + i * 10, 140, 2);
  },

  monitoring(pen, random, variant) {
    pen.rect('#111217', 0, 0, W, H);
    pen.rect('#181b1f', 0, 0, W, 10);
    text(pen, '#ccccdc', 6, 4, 50);
    pen.round('#3d71d9', 210, 2, 40, 6, 2);
    const panel = (x: number, y: number, w: number, h: number) => {
      pen.round('#181b1f', x, y, w, h, 2);
      text(pen, '#ccccdc', x + 4, y + 3, 30);
    };
    panel(4, 14, 122, 66);
    pen.line('#73bf69', 1.5, walk(random, 8, 26, 114, 48));
    pen.line('#f2cc0c', 1.5, walk(random, 8, 26, 114, 48));
    panel(130, 14, 122, 66);
    pen.line(variant ? '#ff9830' : '#5794f2', 1.5, walk(random, 134, 26, 114, 48));
    const stats: [string, string][] = [
      ['#73bf69', '#1a3d1a'],
      ['#f2cc0c', '#3d3510'],
      [variant ? '#f2495c' : '#73bf69', '#1a2d1a']
    ];
    stats.forEach(([fg, bg], i) => {
      const x = 4 + i * 84;
      pen.round(bg, x, 84, 80, 30, 2);
      pen.rect(fg, x + 8, 92, 40, 12);
      text(pen, fg, x + 8, 108, 24);
    });
    panel(4, 118, 248, 38);
    for (let i = 0; i < 24; i++) {
      const h = 6 + random() * 20;
      pen.rect(i % 7 === 6 ? '#f2495c' : '#5794f2', 10 + i * 10, 152 - h, 6, h);
    }
  },

  security(pen, random, variant) {
    pen.rect('#0b1020', 0, 0, W, H);
    pen.rect('#131a2e', 0, 0, W, 10);
    pen.dot('#ef4444', 8, 5, 3);
    text(pen, '#e2e8f0', 16, 4, 50);
    ['#ef4444', '#f59e0b', '#3b82f6'].forEach((color, i) => {
      const x = 4 + i * 56;
      pen.round('#131a2e', x, 14, 52, 24, 2);
      pen.rect(color, x + 4, 18, 22, 10);
      text(pen, '#94a3b8', x + 4, 32, 36);
    });
    // The alert list scrolls: 8 rows of 14 px fill its band (42..154).
    const severity = ['#ef4444', '#f59e0b', '#f59e0b', '#3b82f6', '#3b82f6', '#64748b'];
    for (let i = 0; i < 8; i++) {
      const y = 42 + i * 14;
      pen.rect(i % 2 ? '#0f1629' : '#0b1020', 0, y, 170, 14);
      pen.dot(pick(random, severity), 8, y + 7, 3);
      text(pen, '#e2e8f0', 16, y + 3, 50 + random() * 60);
      text(pen, '#64748b', 16, y + 8, 30 + random() * 40);
      pen.round(pick(random, ['#7f1d1d', '#78350f', '#1e3a8a']), 136, y + 3, 28, 7, 3);
    }
    pen.round('#131a2e', 174, 14, 78, 142, 2);
    for (let i = 0; i < 40; i++)
      pen.dot('#1e293b', 182 + random() * 62, 30 + random() * 70, 3 + random() * 4);
    for (let i = 0; i < 7; i++)
      pen.dot(pick(random, ['#ef4444', '#f59e0b']), 184 + random() * 58, 34 + random() * 62, 1.5);
    if (variant) for (let i = 0; i < 5; i++) text(pen, '#94a3b8', 180, 112 + i * 8, 40 + random() * 26);
    else
      pen.line('#ef4444', 1.5, [
        [180, 150],
        [200, 130],
        [215, 138],
        [230, 116],
        [246, 120]
      ]);
  },

  tests(pen, random, variant) {
    const passing = variant ? 0.92 : 0.85;
    frame(pen, '#ffffff', '#e5e7eb');
    pen.rect('#f3f4f6', 0, 10, W, 16);
    pen.rect('#16a34a', 6, 15, 150 * passing, 6);
    pen.rect('#dc2626', 6 + 150 * passing, 15, 150 * (1 - passing), 6);
    text(pen, '#374151', 164, 16, 60);
    // 16 rows of 7 px fill the band (28..140).
    for (let i = 0; i < 16; i++) {
      const y = 30 + i * 7;
      const failed = random() > passing;
      pen.dot(failed ? '#dc2626' : '#16a34a', 10, y + 1.5, 2);
      text(pen, failed ? '#991b1b' : '#374151', random() < 0.3 ? 24 : 16, y, 40 + random() * 120);
      text(pen, '#9ca3af', 220, y, 20);
    }
    pen.rect('#111827', 0, 142, W, 18);
    text(pen, '#4ade80', 6, 147, 50);
    text(pen, '#f87171', 60, 147, 20);
    text(pen, '#d1d5db', 84, 147, 70);
    text(pen, '#d1d5db', 6, 153, 90);
  },

  notebook(pen, random, variant) {
    frame(pen, '#ffffff', '#f5f5f5');
    pen.rect('#eeeeee', 0, 10, W, 4);
    // Two code-and-plot pairs of 70 px fill the band (14..154).
    for (let pair = 0; pair < 2; pair++) {
      const y = 14 + pair * 70;
      text(pen, '#303f9f', 4, y + 4, 14);
      pen.rect('#f7f7f7', 22, y + 2, 228, 30);
      pen.rect('#e0e0e0', 22, y + 2, 1, 30);
      for (let r = 0; r < 4; r++) {
        let x = r ? 36 : 28;
        for (let w = 0; w < 3; w++) {
          const width = 8 + random() * 26;
          text(
            pen,
            pick(random, ['#008000', '#0000ff', '#ba2121', '#212121', '#aa22ff']),
            x,
            y + 6 + r * 6,
            width
          );
          x += width + 3;
        }
      }
      const top = y + 37;
      text(pen, '#d84315', 4, top + 2, 14);
      pen.rect('#e0e0e0', 40, top + 2, 1, 26);
      pen.rect('#e0e0e0', 40, top + 28, 150, 1);
      const steep = 3 + random();
      const loss: [number, number][] = [];
      for (let i = 0; i <= 20; i++)
        loss.push([40 + (i / 20) * 150, top + 4 + 22 * (1 - Math.exp(-(i / 20) * steep))]);
      pen.line(variant ? '#1f77b4' : '#ff7f0e', 1.5, loss);
      if (variant)
        pen.line(
          '#2ca02c',
          1.5,
          loss.map(([x, ly]) => [x, Math.min(top + 27, ly + 3)] as [number, number])
        );
      lines(pen, random, '#616161', 200, top + 6, 44, 3, 6);
    }
  },

  bi(pen, random, variant) {
    pen.rect('#f4f6f9', 0, 0, W, H);
    pen.rect(variant ? '#1e1b4b' : '#0f172a', 0, 0, 36, H);
    for (let i = 0; i < 6; i++) pen.round(i === 1 ? '#6366f1' : '#334155', 8, 10 + i * 16, 20, 8, 2);
    text(pen, '#0f172a', 44, 6, 60);
    const kpi = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'];
    kpi.forEach((color, i) => {
      const x = 44 + i * 53;
      pen.round('#ffffff', x, 16, 49, 28, 3);
      text(pen, '#94a3b8', x + 4, 20, 24);
      pen.rect('#0f172a', x + 4, 27, 26 + random() * 12, 7);
      pen.rect(color, x + 4, 38, 14, 3);
    });
    pen.round('#ffffff', 44, 48, 130, 106, 3);
    text(pen, '#334155', 50, 53, 40);
    for (let i = 0; i < 10; i++) {
      const h = 20 + random() * 60;
      pen.rect(i % 3 === 2 ? '#a5b4fc' : '#6366f1', 52 + i * 12, 148 - h, 8, h);
    }
    pen.round('#ffffff', 178, 48, 74, 106, 3);
    const shares = [0.34 + random() * 0.08, 0.24 + random() * 0.06, 0.18 + random() * 0.04];
    shares.push(1 - shares.reduce((a, b) => a + b, 0));
    let start = 0;
    shares.forEach((share, i) => {
      const arc: [number, number][] = [];
      for (let s = 0; s <= 12; s++) {
        const a = (start + share * (s / 12)) * Math.PI * 2 - Math.PI / 2;
        arc.push([215 + Math.cos(a) * 20, 90 + Math.sin(a) * 20]);
      }
      pen.line(kpi[i], 9, arc);
      start += share;
    });
    lines(pen, random, '#64748b', 186, 122, 56, 4, 7);
  },

  engine(pen, random, variant) {
    pen.rect('#383838', 0, 0, W, H);
    pen.rect('#2a2a2a', 0, 0, W, 10);
    ['#9e9e9e', '#9e9e9e', '#57a64a'].forEach((color, i) => pen.rect(color, 110 + i * 12, 2, 8, 6));
    pen.rect('#303030', 0, 10, 46, 110);
    lines(pen, random, '#c4c4c4', 6, 16, 34, 13, 8);
    pen.rect(variant ? '#7fb3e6' : '#9ec4e8', 48, 10, 160, 55);
    pen.rect(variant ? '#5f8f4e' : '#8a8a7a', 48, 65, 160, 55);
    for (let i = 0; i < 4; i++) {
      const s = 14 + random() * 14;
      const x = 60 + i * 32 + random() * 10;
      const y = 72 - s * 0.3;
      pen.rect(pick(random, ['#d98c4a', '#c9c9c9', '#4a90d9', '#b35c5c']), x, y, s, s);
      pen.rect('#00000033', x + s, y + 3, 5, s - 3);
    }
    pen.dot('#ffe07a', 190, 22, 6);
    pen.line('#ff5555', 1, [
      [128, 92],
      [128, 80]
    ]);
    pen.line('#55ff55', 1, [
      [128, 92],
      [140, 98]
    ]);
    pen.line('#5577ff', 1, [
      [128, 92],
      [118, 99]
    ]);
    pen.rect('#303030', 210, 10, 46, 110);
    for (let i = 0; i < 9; i++) {
      const y = 16 + i * 11;
      text(pen, '#c4c4c4', 214, y, 14);
      pen.rect('#1e1e1e', 232, y - 1, 20, 6);
    }
    pen.rect('#2a2a2a', 0, 122, W, 38);
    for (let i = 0; i < 9; i++) {
      pen.rect(
        pick(random, ['#4a90d9', '#d98c4a', '#57a64a', '#9e9e9e', '#b35c5c']),
        6 + i * 28,
        128,
        22,
        18
      );
      text(pen, '#c4c4c4', 6 + i * 28, 150, 18);
    }
  },

  chain(pen, random, variant) {
    const accent = variant ? '#a855f7' : '#22d3ee';
    pen.rect('#0f172a', 0, 0, W, H);
    pen.rect('#111c33', 0, 0, W, 12);
    pen.dot(variant ? '#a855f7' : '#f7931a', 8, 6, 4);
    text(pen, '#e2e8f0', 16, 5, 40);
    pen.round('#1e293b', 120, 3, 128, 7, 3);
    for (let i = 0; i < 4; i++) {
      const x = 6 + i * 62;
      pen.round('#1e293b', x, 18, 56, 40, 3);
      pen.rect(accent, x + 4, 22, 20, 5);
      lines(pen, random, '#94a3b8', x + 4, 31, 46, 4, 6);
      if (i < 3) pen.rect('#334155', x + 56, 37, 6, 2);
    }
    pen.rect('#111c33', 0, 64, W, 9);
    [6, 70, 150, 206].forEach((x) => text(pen, '#94a3b8', x, 67, 28));
    for (let r = 0; r < 12; r++) {
      const y = 76 + r * 7;
      text(pen, '#38bdf8', 6, y, 50);
      text(pen, '#e2e8f0', 70, y, 40 + random() * 30);
      text(pen, '#94a3b8', 150, y, 30 + random() * 20);
      text(pen, random() < 0.8 ? '#4ade80' : '#f87171', 206, y, 24);
    }
  },

  enterprise(pen, random, variant) {
    const brand = variant ? '#0a6ed1' : '#0176d3';
    pen.rect('#f3f3f3', 0, 0, W, H);
    pen.rect(brand, 0, 0, W, 12);
    pen.dot('#ffffff', 8, 6, 3);
    for (let i = 0; i < 5; i++) text(pen, '#dbeafe', 20 + i * 30, 5, 22);
    pen.round('#ffffff', 6, 16, 244, 26, 3);
    pen.round(variant ? '#f59e0b' : '#7f56d9', 12, 21, 16, 16, 3);
    pen.rect('#16325c', 34, 22, 90, 6);
    text(pen, '#706e6b', 34, 32, 60);
    pen.round(brand, 200, 22, 44, 9, 3);
    ['#0176d3', '#706e6b', '#706e6b'].forEach((color, i) => text(pen, color, 12 + i * 40, 47, 30));
    pen.rect(brand, 12, 52, 30, 2);
    pen.round('#ffffff', 6, 58, 244, 64, 3);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 2; c++) {
        const x = 14 + c * 120;
        const y = 64 + r * 14;
        text(pen, '#706e6b', x, y, 34);
        text(pen, '#080707', x, y + 5, 40 + random() * 50);
      }
    pen.round('#ffffff', 6, 126, 244, 30, 3);
    text(pen, '#16325c', 12, 130, 60);
    for (let i = 0; i < 2; i++) {
      text(pen, brand, 12, 138 + i * 7, 50);
      text(pen, '#706e6b', 90, 138 + i * 7, 60 + random() * 20);
    }
  },

  design(pen, random, variant) {
    pen.rect('#e5e5e5', 0, 0, W, H);
    pen.rect('#2c2c2c', 0, 0, W, 10);
    for (let i = 0; i < 5; i++) pen.rect(i === 1 ? '#0d99ff' : '#b3b3b3', 6 + i * 10, 3, 6, 4);
    pen.rect('#ffffff', 0, 10, 46, 150);
    lines(pen, random, '#b3b3b3', 6, 16, 16, 2, 6);
    for (let i = 0; i < 12; i++) {
      const y = 30 + i * 9;
      const nested = i % 4 ? 6 : 0;
      if (i === 3) pen.rect('#e5f4ff', 0, y - 2, 46, 8);
      pen.rect(pick(random, ['#b3b3b3', '#9747ff', '#0d99ff']), 6 + nested, y, 4, 4);
      text(pen, '#333333', 14 + nested, y, 16 + random() * 10);
    }
    pen.rect('#ffffff', 210, 10, 46, 150);
    for (let i = 0; i < 8; i++) {
      const y = 16 + i * 12;
      text(pen, '#8c8c8c', 214, y, 12);
      pen.round('#f5f5f5', 228, y - 2, 24, 7, 2);
    }
    ['#9747ff', '#0d99ff', '#f24e1e', '#ffc700', '#0fa958'].forEach((color, i) =>
      pen.round(color, 214 + (i % 3) * 13, 116 + Math.floor(i / 3) * 12, 10, 10, 2)
    );
    const brand = pick(random, ['#9747ff', '#f24e1e', '#0fa958', '#0d99ff']);
    const artboard = (x: number, y: number, w: number, h: number, selected: boolean) => {
      text(pen, '#8c8c8c', x, y - 6, 24);
      pen.round('#ffffff', x, y, w, h, 3);
      pen.rect(brand, x, y, w, h * 0.16);
      text(pen, '#ffffff', x + 4, y + 3, w * 0.3);
      pen.round(
        pick(random, ['#ffd6a5', '#caffbf', '#bdb2ff', '#ffadad']),
        x + 5,
        y + h * 0.22,
        w - 10,
        h * 0.3,
        2
      );
      lines(pen, random, '#c4c4c4', x + 5, y + h * 0.58, w - 10, 3, 5);
      pen.round(brand, x + 5, y + h - 12, w * 0.5, 7, 3);
      if (!selected) return;
      const blue = '#0d99ff';
      pen.rect(blue, x - 2, y - 2, w + 4, 1);
      pen.rect(blue, x - 2, y + h + 1, w + 4, 1);
      pen.rect(blue, x - 2, y - 2, 1, h + 4);
      pen.rect(blue, x + w + 1, y - 2, 1, h + 4);
      for (const [hx, hy] of [
        [x - 3, y - 3],
        [x + w, y - 3],
        [x - 3, y + h],
        [x + w, y + h]
      ])
        pen.rect(blue, hx, hy, 3, 3);
    };
    if (variant) {
      artboard(60, 28, 64, 110, false);
      artboard(136, 28, 64, 110, true);
    } else {
      artboard(56, 30, 100, 70, true);
      artboard(162, 30, 40, 70, false);
      artboard(56, 112, 146, 40, false);
    }
  },

  moodboard(pen, random, variant) {
    const palette = variant
      ? ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51']
      : ['#ffcdb2', '#ffb4a2', '#e5989b', '#b5838d', '#6d6875'];
    pen.rect(variant ? '#1f1f1f' : '#f5f0e8', 0, 0, W, H);
    pen.rect('#2c2c2c', 0, 0, W, 10);
    palette.forEach((color, i) => {
      pen.round(color, 8 + i * 30, 16, 26, 26, 3);
      text(pen, variant ? '#d4d4d4' : '#6b6b6b', 8 + i * 30, 46, 20);
    });
    const tiles: [number, number, number, number][] = [
      [164, 16, 40, 58],
      [208, 16, 42, 28],
      [208, 48, 42, 26],
      [8, 56, 60, 44],
      [72, 56, 46, 44],
      [122, 78, 60, 40],
      [186, 78, 64, 40],
      [8, 104, 110, 48],
      [122, 122, 128, 30]
    ];
    for (const [x, y, w, h] of tiles) {
      pen.round(pick(random, palette), x, y, w, h, 3);
      if (random() < 0.5) pen.dot(pick(random, palette), x + w * 0.6, y + h * 0.45, Math.min(w, h) * 0.25);
    }
    pen.rect(variant ? '#f5f5f5' : '#1f1f1f', 14, 116, 60, 8);
    lines(pen, random, variant ? '#a3a3a3' : '#6b6b6b', 14, 130, 90, 3, 6);
  },

  kanban(pen, random, variant) {
    pen.rect('#f4f5f7', 0, 0, W, H);
    pen.rect(variant ? '#1868db' : '#0052cc', 0, 0, W, 12);
    text(pen, '#ffffff', 6, 5, 30);
    for (let i = 0; i < 4; i++)
      pen.dot(pick(random, ['#ffab00', '#36b37e', '#ff5630', '#6554c0']), 200 + i * 12, 6, 4);
    text(pen, '#172b4d', 6, 17, 60);
    const labels = ['#36b37e', '#ff5630', '#6554c0', '#ffab00', '#00b8d9'];
    for (let c = 0; c < 4; c++) {
      const x = 6 + c * 62;
      pen.round('#ebecf0', x, 24, 58, 132, 3);
      text(pen, '#5e6c84', x + 4, 28, 26);
      const cards = 2 + Math.floor(random() * 3);
      for (let k = 0; k < cards; k++) {
        const y = 36 + k * 30;
        pen.round('#ffffff', x + 3, y, 52, 26, 2);
        pen.rect(pick(random, labels), x + 6, y + 3, 16, 3);
        lines(pen, random, '#172b4d', x + 6, y + 9, 44, 2, 5);
        pen.dot(pick(random, AVATARS), x + 49, y + 21, 3);
        text(pen, '#6b778c', x + 6, y + 20, 14);
      }
    }
  },

  roadmap(pen, random, variant) {
    frame(pen, '#ffffff', '#f3f4f6');
    pen.rect('#f9fafb', 0, 10, 60, 150);
    for (let m = 0; m < 6; m++) {
      const x = 60 + m * 32;
      pen.rect('#e5e7eb', x, 10, 1, 150);
      text(pen, '#6b7280', x + 4, 14, 16);
    }
    const colours = variant
      ? ['#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b']
      : ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
    for (let r = 0; r < 9; r++) {
      const y = 26 + r * 14;
      text(pen, '#374151', 6, y + 3, 30 + random() * 20);
      const start = 62 + random() * 110;
      pen.round(pick(random, colours), start, y, Math.min(20 + random() * 60, 252 - start), 9, 3);
    }
    const today = 110 + random() * 60;
    pen.rect('#ef4444', today, 20, 1.5, 138);
    pen.dot('#ef4444', today + 0.75, 20, 3);
  },

  video(pen, random, variant) {
    pen.rect('#1c1c1c', 0, 0, W, H);
    const columns = variant ? 3 : 2;
    const tiles = columns * 2;
    const w = (W - 8 - (columns - 1) * 4) / columns;
    const h = (138 - 12) / 2;
    const backgrounds = ['#3a4a5c', '#4a3a5c', '#3a5c4a', '#5c4a3a', '#2f3e46', '#52414a'];
    for (let i = 0; i < tiles; i++) {
      const x = 4 + (i % columns) * (w + 4);
      const y = 4 + Math.floor(i / columns) * (h + 4);
      pen.round(backgrounds[i], x, y, w, h, 3);
      const cx = x + w / 2;
      pen.round(
        pick(random, ['#2563eb', '#16a34a', '#9333ea', '#ea580c', '#475569']),
        cx - w * 0.22,
        y + h * 0.62,
        w * 0.44,
        h * 0.38,
        6
      );
      pen.dot(pick(random, SKINS), cx, y + h * 0.45, Math.min(w, h) * 0.17);
      text(pen, '#ffffff', x + 4, y + h - 7, 24);
      if (i === 1) {
        pen.rect('#22c55e', x, y, w, 1.5);
        pen.rect('#22c55e', x, y + h - 1.5, w, 1.5);
      }
    }
    pen.rect('#111111', 0, 142, W, 18);
    for (let i = 0; i < 4; i++) pen.dot(i === 3 ? '#ef4444' : '#3c3c3c', 98 + i * 20, 151, 6);
  },

  pipeline(pen, random, variant) {
    pen.rect('#f6f7fb', 0, 0, W, H);
    pen.rect(variant ? '#ff7a59' : '#0b5cab', 0, 0, W, 12);
    text(pen, '#ffffff', 6, 5, 40);
    ['#93c5fd', '#a5b4fc', '#c4b5fd', '#fcd34d', '#86efac'].forEach((color, s) => {
      const x = 4 + s * 50;
      pen.rect(color, x, 16, 46, 3);
      text(pen, '#374151', x, 22, 28);
      text(pen, '#6b7280', x, 28, 18);
      const deals = 3 - Math.floor(s / 2) + Math.floor(random() * 2);
      for (let d = 0; d < deals; d++) {
        const y = 36 + d * 29;
        pen.round('#ffffff', x, y, 46, 25, 2);
        text(pen, '#111827', x + 3, y + 4, 30 + random() * 10);
        pen.rect('#16a34a', x + 3, y + 11, 10 + random() * 30, 4);
        text(pen, '#9ca3af', x + 3, y + 18, 20);
      }
    });
  },

  tickets(pen, random, variant) {
    frame(pen, '#ffffff', variant ? '#03363d' : '#1f2937');
    pen.rect('#f8f9f9', 0, 10, W, 18);
    ['#d1fae5', '#e0e7ff', '#fef3c7'].forEach((color, i) => pen.round(color, 6 + i * 44, 14, 40, 9, 4));
    const priority = ['#dc2626', '#f59e0b', '#f59e0b', '#16a34a', '#3b82f6'];
    const status = ['#fee2e2', '#dbeafe', '#dcfce7', '#fef3c7'];
    // 8 rows of 14 px fill the band (28..140).
    for (let i = 0; i < 8; i++) {
      const y = 28 + i * 14;
      pen.rect(i % 2 ? '#fafafa' : '#ffffff', 0, y, W, 14);
      pen.dot(pick(random, priority), 9, y + 7, 3);
      text(pen, '#111827', 18, y + 3, 60 + random() * 70);
      text(pen, '#9ca3af', 18, y + 8, 30 + random() * 50);
      pen.round(pick(random, status), 178, y + 3, 34, 8, 4);
      pen.dot(pick(random, AVATARS), 232, y + 7, 4);
    }
    pen.rect('#f3f4f6', 0, 142, W, 18);
    text(pen, '#6b7280', 6, 149, 80);
  },

  calendar(pen, random, variant) {
    frame(pen, '#ffffff', '#f1f3f4');
    for (let h = 0; h < 8; h++) text(pen, '#70757a', 6, 30 + h * 16, 14);
    for (let d = 0; d < 5; d++) {
      const x = 36 + d * 44;
      pen.rect('#dadce0', x, 14, 1, 146);
      text(pen, '#70757a', x + 6, 16, 14);
      if (d === 2) pen.dot('#1a73e8', x + 30, 18, 4);
    }
    for (let h = 0; h < 8; h++) pen.rect('#f1f3f4', 36, 28 + h * 16, 220, 1);
    const colours = variant
      ? ['#7986cb', '#33b679', '#f6bf26', '#e67c73', '#8e24aa']
      : ['#039be5', '#0b8043', '#f4511e', '#8e24aa', '#e67c73'];
    for (let d = 0; d < 5; d++) {
      let y = 28 + Math.floor(random() * 2) * 16;
      while (y < 140) {
        const h = 12 + Math.floor(random() * 3) * 8;
        if (y + h > 156) break;
        pen.round(pick(random, colours), 38 + d * 44, y + 1, 40, h - 2, 2);
        text(pen, '#ffffff', 41 + d * 44, y + 4, 24);
        y += h + Math.floor(random() * 3) * 16;
      }
    }
    pen.rect('#ea4335', 36, 84 + random() * 30, 220, 1.2);
  },

  candidates(pen, random, variant) {
    pen.rect('#f8fafc', 0, 0, W, H);
    pen.rect(variant ? '#16a34a' : '#7c3aed', 0, 0, W, 12);
    text(pen, '#ffffff', 6, 5, 50);
    const hair = ['#2b2220', '#6b4423', '#c8a165', '#1c1c1c', '#a0522d'];
    ['#e0e7ff', '#fef3c7', '#dcfce7', '#fce7f3'].forEach((background, s) => {
      const x = 4 + s * 63;
      pen.round(background, x, 16, 59, 140, 3);
      text(pen, '#475569', x + 4, 20, 30);
      // The funnel narrows toward the offer.
      const count = 4 - s + (s === 3 ? 1 : 0);
      for (let c = 0; c < count; c++) {
        const y = 28 + c * 31;
        pen.round('#ffffff', x + 3, y, 53, 27, 3);
        pen.dot(pick(random, hair), x + 12, y + 9, 6);
        pen.dot(pick(random, SKINS), x + 12, y + 11, 5);
        lines(pen, random, '#0f172a', x + 21, y + 5, 32, 2, 6, 0.5);
        const stars = 2 + Math.floor(random() * 4);
        for (let st = 0; st < 5; st++) pen.dot(st < stars ? '#f59e0b' : '#e2e8f0', x + 9 + st * 7, y + 21, 2);
      }
    });
  },

  spreadsheet(pen, random, variant) {
    const brand = variant ? '#107c41' : '#188038';
    pen.rect('#ffffff', 0, 0, W, H);
    pen.rect(brand, 0, 0, W, 10);
    text(pen, '#ffffff', 6, 4, 40);
    pen.rect('#f8f9fa', 0, 10, W, 10);
    for (let i = 0; i < 10; i++) pen.rect('#5f6368', 6 + i * 12, 13, 7, 4);
    pen.rect('#f8f9fa', 0, 20, W, 8);
    pen.rect('#f8f9fa', 0, 20, 14, 140);
    for (let c = 0; c < 8; c++) {
      pen.rect('#dadce0', 14 + c * 30, 20, 1, 140);
      text(pen, '#5f6368', 26 + c * 30, 22, 6);
    }
    for (let r = 0; r < 19; r++) {
      const y = 28 + r * 7;
      pen.rect('#e8eaed', 14, y, 242, 1);
      text(pen, '#5f6368', 3, y + 2, 8);
      for (let c = 0; c < 5; c++) {
        const width = 6 + random() * 18;
        if (random() < 0.85)
          text(
            pen,
            c === 0 ? '#202124' : '#3c4043',
            c === 0 ? 17 : 14 + (c + 1) * 30 - width - 3,
            y + 2,
            width
          );
      }
    }
    pen.rect('#1a73e8', 44, 48, 30, 1.5);
    pen.rect('#1a73e8', 44, 55, 30, 1.5);
    pen.round('#ffffff', 170, 60, 80, 60, 2);
    pen.rect('#dadce0', 170, 60, 80, 1);
    pen.rect('#dadce0', 170, 119, 80, 1);
    for (let i = 0; i < 6; i++) {
      const h = 10 + random() * 36;
      pen.rect(i % 2 ? '#fbbc04' : '#4285f4', 178 + i * 12, 114 - h, 8, h);
    }
  },

  slides(pen, random, variant) {
    const brand = variant ? '#c43e1c' : '#1a73e8';
    pen.rect('#f1f3f4', 0, 0, W, H);
    pen.rect(variant ? '#c43e1c' : '#f4b400', 0, 0, W, 10);
    text(pen, '#ffffff', 6, 4, 40);
    pen.rect('#ffffff', 0, 10, W, 8);
    for (let i = 0; i < 9; i++) pen.rect('#5f6368', 6 + i * 11, 12, 6, 4);
    for (let i = 0; i < 5; i++) {
      const y = 22 + i * 27;
      pen.rect(i === 1 ? '#1a73e8' : '#dadce0', 5, y - 1, 42, 25);
      pen.rect('#ffffff', 6, y, 40, 23);
      pen.rect(pick(random, ['#1a73e8', '#34a853', '#ea4335', '#fbbc04']), 9, y + 3, 20, 3);
      lines(pen, random, '#bdc1c6', 9, y + 9, 30, 2, 5);
    }
    pen.rect('#ffffff', 56, 24, 192, 108);
    pen.rect(brand, 56, 24, 192, 18);
    pen.rect('#ffffff', 64, 30, 90, 6);
    lines(pen, random, '#5f6368', 66, 52, 70, 5, 9);
    for (let i = 0; i < 5; i++) pen.dot('#5f6368', 62, 53.5 + i * 9, 1.5);
    for (let i = 0; i < 5; i++) {
      const h = 14 + random() * 44;
      pen.rect(i === 3 ? brand : '#9aa0a6', 156 + i * 17, 124 - h, 11, h);
    }
    pen.rect('#ffffff', 56, 136, 192, 20);
    lines(pen, random, '#9aa0a6', 62, 141, 120, 2, 6);
  },

  email(pen, random, variant) {
    const brand = variant ? '#0f6cbd' : '#c5221f';
    pen.rect('#ffffff', 0, 0, W, H);
    pen.rect(brand, 0, 0, W, 10);
    text(pen, '#ffffff', 6, 4, 34);
    pen.round('#ffffff55', 70, 2, 110, 6, 3);
    pen.rect('#f6f8fc', 0, 10, 96, 12);
    pen.round(variant ? '#0f6cbd' : '#c2e7ff', 4, 12, 40, 8, 4);
    // The inbox scrolls: 9 rows of 14 px fill its band (22..148, the list column only).
    for (let i = 0; i < 9; i++) {
      const y = 22 + i * 14;
      const unread = random() < 0.35;
      pen.rect(unread ? '#ffffff' : '#f2f6fc', 0, y, 96, 14);
      pen.rect('#e5e7eb', 0, y + 13, 96, 1);
      if (unread) pen.dot('#1a73e8', 5, y + 7, 2);
      text(pen, unread ? '#111827' : '#4b5563', 10, y + 3, 30 + random() * 20);
      text(pen, '#9ca3af', 76, y + 3, 14);
      text(pen, '#6b7280', 10, y + 8, 40 + random() * 40);
    }
    pen.rect('#e5e7eb', 96, 10, 1, 150);
    pen.rect('#111827', 104, 16, 100, 6);
    pen.dot(pick(random, AVATARS), 110, 34, 5);
    text(pen, '#111827', 120, 30, 50);
    text(pen, '#9ca3af', 120, 36, 70);
    lines(pen, random, '#374151', 104, 48, 140, 8, 7);
    pen.round('#f3f4f6', 104, 110, 100, 30, 3);
    pen.rect(pick(random, ['#bfdbfe', '#fde68a']), 108, 114, 30, 22);
    lines(pen, random, '#6b7280', 142, 116, 56, 3, 6);
    pen.round(brand, 104, 146, 36, 9, 4);
  },

  document(pen, random, variant) {
    pen.rect('#f8f9fa', 0, 0, W, H);
    pen.rect(variant ? '#2b579a' : '#ffffff', 0, 0, W, 12);
    pen.rect(variant ? '#ffffff' : '#4285f4', 6, 3, 8, 6);
    text(pen, variant ? '#ffffff' : '#202124', 18, 5, 40);
    pen.rect('#edf2fa', 0, 12, W, 9);
    for (let i = 0; i < 12; i++) pen.rect('#444746', 6 + i * 11, 15, 6, 4);
    lines(pen, random, '#5f6368', 8, 30, 40, 6, 9);
    pen.rect('#ffffff', 60, 24, 150, 136);
    pen.rect('#dadce0', 60, 24, 150, 1);
    pen.rect('#202124', 72, 36, 90, 7);
    text(pen, '#5f6368', 72, 48, 50);
    let y = 58;
    for (let p = 0; p < 4 && y < 150; p++) {
      if (p === 2) {
        pen.rect('#202124', 72, y, 60, 5);
        y += 10;
      }
      const rows = 2 + Math.floor(random() * 3);
      for (let r = 0; r < rows && y < 152; r++, y += 6)
        text(pen, '#3c4043', 72, y, r === rows - 1 ? 40 + random() * 60 : 124);
      y += 5;
    }
    if (variant || random() < 0.6) {
      pen.round('#fef7e0', 214, 60, 38, 28, 2);
      pen.dot('#f9ab00', 220, 66, 3);
      lines(pen, random, '#5f6368', 218, 73, 30, 2, 5);
    }
  }
};
