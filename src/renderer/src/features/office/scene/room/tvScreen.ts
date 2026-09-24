import * as THREE from 'three';

/**
 * The lounge TV's picture: a little kart race while someone is playing, a calm screensaver
 * otherwise. Drawn on a canvas, and only redrawn while the TV is on screen.
 */

const WIDTH = 320;
const HEIGHT = 180;

/** Whether a new frame is due: 20 a second for the game, 4 for the screensaver. */
export function tvFrameDue(sinceLast: number, playing: boolean): boolean {
  return sinceLast >= (playing ? 1 / 20 : 1 / 4);
}

const KARTS = [
  { body: '#e24b4b', helmet: '#f6c945', lane: -0.35, speed: 1.3, phase: 0 },
  { body: '#3b82f6', helmet: '#f3ece2', lane: 0.3, speed: 1.1, phase: 2 }
] as const;

function drawGame(g: CanvasRenderingContext2D, t: number): void {
  const horizon = 70;
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#5fb3f0');
  sky.addColorStop(1, '#cfeafc');
  g.fillStyle = sky;
  g.fillRect(0, 0, WIDTH, horizon);
  // Hills drifting past, two layers.
  for (const [color, speed, height] of [
    ['#7cc576', 6, 26],
    ['#4f9a4a', 14, 16]
  ] as const) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, horizon);
    for (let x = 0; x <= WIDTH; x += 8)
      g.lineTo(x, horizon - height * (0.6 + 0.4 * Math.sin((x + t * speed) / 37)));
    g.lineTo(WIDTH, horizon);
    g.fill();
  }
  g.fillStyle = '#6fbf5f';
  g.fillRect(0, horizon, WIDTH, HEIGHT - horizon);
  // The road in perspective, curving gently, with kerbs and a dashed centre line.
  const curve = Math.sin(t * 0.4) * 40;
  const at = (depth: number) => {
    const y = horizon + (HEIGHT - horizon) * depth;
    const half = 12 + 150 * depth;
    const centre = WIDTH / 2 + curve * (1 - depth) * (1 - depth);
    return { y, half, centre };
  };
  for (let i = 0; i < 40; i++) {
    const a = at(i / 40);
    const b = at((i + 1) / 40);
    const stripe = Math.floor(i / 2 + t * 12) % 2 === 0;
    g.fillStyle = stripe ? '#e24b4b' : '#f3ece2';
    g.beginPath();
    g.moveTo(a.centre - a.half * 1.12, a.y);
    g.lineTo(a.centre + a.half * 1.12, a.y);
    g.lineTo(b.centre + b.half * 1.12, b.y + 1);
    g.lineTo(b.centre - b.half * 1.12, b.y + 1);
    g.fill();
    g.fillStyle = '#6b7079';
    g.beginPath();
    g.moveTo(a.centre - a.half, a.y);
    g.lineTo(a.centre + a.half, a.y);
    g.lineTo(b.centre + b.half, b.y + 1);
    g.lineTo(b.centre - b.half, b.y + 1);
    g.fill();
    if (stripe) {
      g.fillStyle = '#f3ece2';
      g.fillRect(a.centre - 1 - a.half * 0.02, a.y, 2 + a.half * 0.04, b.y - a.y + 1);
    }
  }
  // Two karts weaving, the leader changing now and then.
  for (const kart of KARTS) {
    const depth = 0.62 + 0.14 * Math.sin(t * 0.7 * kart.speed + kart.phase);
    const road = at(depth);
    const x = road.centre + road.half * (kart.lane + 0.25 * Math.sin(t * 1.3 + kart.phase));
    const size = 10 + 26 * depth;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x - size * 0.55, road.y + size * 0.28, size * 1.1, size * 0.12);
    g.fillStyle = '#1f2328';
    g.fillRect(x - size * 0.55, road.y + size * 0.05, size * 0.22, size * 0.26);
    g.fillRect(x + size * 0.33, road.y + size * 0.05, size * 0.22, size * 0.26);
    g.fillStyle = kart.body;
    g.beginPath();
    g.roundRect(x - size * 0.42, road.y - size * 0.1, size * 0.84, size * 0.34, size * 0.1);
    g.fill();
    g.fillStyle = kart.helmet;
    g.beginPath();
    g.arc(x, road.y - size * 0.22, size * 0.2, 0, Math.PI * 2);
    g.fill();
  }
  // The heads-up display: lap counter and position.
  g.fillStyle = 'rgba(20,24,30,0.55)';
  g.fillRect(8, 8, 74, 22);
  g.fillRect(WIDTH - 52, 8, 44, 22);
  g.fillStyle = '#ffffff';
  g.font = 'bold 14px sans-serif';
  g.fillText(`LAP ${1 + (Math.floor(t / 20) % 3)}/3`, 14, 24);
  g.fillText(Math.sin(t * 0.3) > 0 ? '1st' : '2nd', WIDTH - 44, 24);
}

function drawSaver(g: CanvasRenderingContext2D, t: number): void {
  const sky = g.createLinearGradient(0, 0, WIDTH, HEIGHT);
  sky.addColorStop(0, '#1d2a4a');
  sky.addColorStop(1, '#43306a');
  g.fillStyle = sky;
  g.fillRect(0, 0, WIDTH, HEIGHT);
  for (let i = 0; i < 5; i++) {
    const x = WIDTH * (0.5 + 0.4 * Math.sin(t * 0.07 + i * 1.7));
    const y = HEIGHT * (0.5 + 0.35 * Math.cos(t * 0.05 + i * 2.3));
    const glow = g.createRadialGradient(x, y, 0, x, y, 60);
    glow.addColorStop(0, i % 2 ? 'rgba(125,211,252,0.35)' : 'rgba(236,72,153,0.3)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(x - 60, y - 60, 120, 120);
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  const cx = WIDTH / 2 + Math.sin(t * 0.2) * 30;
  const cy = HEIGHT / 2 + Math.cos(t * 0.15) * 14;
  g.moveTo(cx - 10, cy - 13);
  g.lineTo(cx + 14, cy);
  g.lineTo(cx - 10, cy + 13);
  g.fill();
}

export class TvScreen {
  readonly material: THREE.MeshBasicMaterial;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastDrawn = -Infinity;
  private drawnPlaying: boolean | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.context = this.canvas.getContext('2d')!;
    drawSaver(this.context, 0);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture });
  }

  /** Redraws when a frame is due, the picture changed, and only while the TV is on screen. */
  update(elapsed: number, playing: boolean, visible: boolean): void {
    if (!visible) return;
    if (playing === this.drawnPlaying && !tvFrameDue(elapsed - this.lastDrawn, playing)) return;
    this.lastDrawn = elapsed;
    this.drawnPlaying = playing;
    if (playing) drawGame(this.context, elapsed);
    else drawSaver(this.context, elapsed);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
