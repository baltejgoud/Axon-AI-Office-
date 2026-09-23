/** How the office is lit at a given time of day. Colours are hex strings; intensities are three.js units. */
export interface Lighting {
  sky: string;
  ground: string;
  hemisphere: number;
  sunColor: string;
  sun: number;
  fill: number;
  /** Glow of desk lamps, floor lamps and pendants (0 off … 1 fully on). */
  lamps: number;
  /** Tint of the window panes. */
  windows: string;
  /** Soft backdrop behind the campus. */
  backdrop: string;
}

interface Key extends Lighting {
  hour: number;
}

/** A bright, gentle day; a golden late afternoon; a calm evening with the lamps on. Never dark. */
const KEYS: Key[] = [
  {
    hour: 0,
    sky: '#ebe4ec',
    ground: '#cbb59a',
    hemisphere: 1.6,
    sunColor: '#ffdcb8',
    sun: 1.3,
    fill: 0.45,
    lamps: 1,
    windows: '#5f78b0',
    backdrop: '#eee9ef'
  },
  {
    hour: 6,
    sky: '#f0ecf2',
    ground: '#cdb89c',
    hemisphere: 1.65,
    sunColor: '#ffd9b0',
    sun: 1.7,
    fill: 0.5,
    lamps: 0.6,
    windows: '#bcd0ea',
    backdrop: '#eef1f8'
  },
  {
    hour: 9,
    sky: '#ffffff',
    ground: '#d8c6ab',
    hemisphere: 1.9,
    sunColor: '#fff3df',
    sun: 2.4,
    fill: 0.55,
    lamps: 0.15,
    windows: '#d3e6f1',
    backdrop: '#f3f6fb'
  },
  {
    hour: 16,
    sky: '#ffffff',
    ground: '#d8c6ab',
    hemisphere: 1.9,
    sunColor: '#fff3df',
    sun: 2.4,
    fill: 0.55,
    lamps: 0.15,
    windows: '#d3e6f1',
    backdrop: '#f3f6fb'
  },
  {
    hour: 18.5,
    sky: '#ffeede',
    ground: '#d6b894',
    hemisphere: 1.7,
    sunColor: '#ffc27d',
    sun: 2.1,
    fill: 0.5,
    lamps: 0.55,
    windows: '#f4c996',
    backdrop: '#f8efe6'
  },
  {
    hour: 20.5,
    sky: '#f1e6e6',
    ground: '#cfb89b',
    hemisphere: 1.65,
    sunColor: '#ffd0a0',
    sun: 1.5,
    fill: 0.45,
    lamps: 1,
    windows: '#6f86bb',
    backdrop: '#f2ebee'
  },
  {
    hour: 24,
    sky: '#ebe4ec',
    ground: '#cbb59a',
    hemisphere: 1.6,
    sunColor: '#ffdcb8',
    sun: 1.3,
    fill: 0.45,
    lamps: 1,
    windows: '#5f78b0',
    backdrop: '#eee9ef'
  }
];

const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, t: number) => {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};

/** Lighting at `hour` (0–24, fractional), blended smoothly between the keyframes. */
export function lightingAt(hour: number): Lighting {
  const h = ((hour % 24) + 24) % 24;
  const next = KEYS.findIndex((key) => key.hour > h);
  const a = KEYS[next - 1];
  const b = KEYS[next];
  const raw = (h - a.hour) / (b.hour - a.hour);
  const t = raw * raw * (3 - 2 * raw);
  const num = (x: number, y: number) => x + (y - x) * t;
  return {
    sky: mix(a.sky, b.sky, t),
    ground: mix(a.ground, b.ground, t),
    hemisphere: num(a.hemisphere, b.hemisphere),
    sunColor: mix(a.sunColor, b.sunColor, t),
    sun: num(a.sun, b.sun),
    fill: num(a.fill, b.fill),
    lamps: num(a.lamps, b.lamps),
    windows: mix(a.windows, b.windows, t),
    backdrop: mix(a.backdrop, b.backdrop, t)
  };
}

/** Lighting used when "follow time of day" is off: the office's midday look. */
export const MIDDAY: Lighting = lightingAt(12);

const STORAGE_KEY = 'axon.office.timeOfDay';

/** Whether the office follows the clock (a per-device preference; on unless switched off). */
export function followsTimeOfDay(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setFollowsTimeOfDay(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    window.dispatchEvent(new Event('axon-office-lighting'));
  } catch {
    // Storage is unavailable: the choice lasts until the office reloads.
  }
}
