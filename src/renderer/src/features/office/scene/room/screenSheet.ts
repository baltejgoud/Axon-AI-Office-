import { SCREEN_APPS, SHEET, tileOf } from './screenApps';
import { PAINTERS, paintSeed, type Pen } from './screenPainters';
import { seeded } from './kit';

let sheet: HTMLCanvasElement | null = null;

/** Every app in both variants, painted once onto one canvas (see SHEET for the layout). */
export function screenSheet(): HTMLCanvasElement {
  if (sheet) return sheet;
  const canvas = document.createElement('canvas');
  canvas.width = SHEET.width;
  canvas.height = SHEET.height;
  const g = canvas.getContext('2d')!;
  const pen = canvasPen(g);
  for (const app of SCREEN_APPS)
    for (const variant of [0, 1] as const) {
      const { x, y } = tileOf(app, variant);
      g.save();
      g.beginPath();
      g.rect(x, y, SHEET.tileWidth, SHEET.tileHeight);
      g.clip();
      g.translate(x, y);
      PAINTERS[app](pen, seeded(paintSeed(app, variant)), variant);
      g.restore();
    }
  return (sheet = canvas);
}

function canvasPen(g: CanvasRenderingContext2D): Pen {
  return {
    rect(color, x, y, w, h) {
      g.fillStyle = color;
      g.fillRect(x, y, w, h);
    },
    round(color, x, y, w, h, radius) {
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x, y, w, h, radius);
      g.fill();
    },
    dot(color, x, y, radius) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, radius, 0, Math.PI * 2);
      g.fill();
    },
    line(color, width, points) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
  };
}
