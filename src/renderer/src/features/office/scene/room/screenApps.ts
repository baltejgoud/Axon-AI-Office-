import type { AgentStatus } from '../../data/officeAgents';
import { hashString } from '../../simulation/random';
import type { ScreenFlavor } from './materials';

/**
 * What every desk screen shows: the app its owner works in, from their department and job title
 * (docs/superpowers/specs/2026-09-25-office-role-screens-design.md). Pure rules and layout; the
 * pictures are in screenPainters.ts and the drawing in screens.ts.
 */

export const SCREEN_APPS = [
  'editor',
  'terminal',
  'browser-devtools',
  'browser',
  'sql',
  'simulator',
  'monitoring',
  'security',
  'tests',
  'notebook',
  'bi',
  'engine',
  'chain',
  'enterprise',
  'design',
  'moodboard',
  'kanban',
  'roadmap',
  'video',
  'pipeline',
  'tickets',
  'calendar',
  'candidates',
  'spreadsheet',
  'slides',
  'email',
  'document'
] as const;

export type ScreenApp = (typeof SCREEN_APPS)[number];

export interface ScreenPair {
  main: ScreenApp;
  /** The second screen's app, or null for someone who only ever has one screen. */
  second: ScreenApp | null;
}

export interface DeskScreenApps extends ScreenPair {
  /** Which of the app's two pictures: neighbours with the same job do not show the same screen. */
  variant: 0 | 1;
}

/** What the screens need to know about a desk's owner. */
export interface ScreenOwner {
  id: string;
  /** The job title ("Database Administrator (DBA)"); a specialist's `role` is only their department. */
  name: string;
  department: string;
}

const DEPARTMENT_APPS: Readonly<Record<string, ScreenPair>> = {
  'Web & Frontend': { main: 'editor', second: 'browser-devtools' },
  'Backend & APIs': { main: 'editor', second: 'terminal' },
  'Architecture & General Engineering': { main: 'editor', second: 'document' },
  Mobile: { main: 'editor', second: 'simulator' },
  'Cloud & Infrastructure': { main: 'terminal', second: 'monitoring' },
  Security: { main: 'security', second: 'terminal' },
  'QA & Release': { main: 'tests', second: 'kanban' },
  'AI, ML & Data': { main: 'notebook', second: 'bi' },
  'Emerging Tech': { main: 'editor', second: 'terminal' },
  'Platforms & Enterprise': { main: 'enterprise', second: 'editor' },
  Design: { main: 'design', second: 'moodboard' },
  'Product Management': { main: 'kanban', second: 'roadmap' },
  'Project Management': { main: 'kanban', second: 'roadmap' },
  'Engineering Management': { main: 'kanban', second: 'video' },
  'Sales Management': { main: 'pipeline', second: 'email' },
  'Customer Success': { main: 'tickets', second: 'email' },
  'Marketing Management': { main: 'calendar', second: 'bi' },
  'HR & People': { main: 'candidates', second: 'calendar' },
  'Strategy & Innovation': { main: 'slides', second: 'spreadsheet' },
  'Operations Management': { main: 'spreadsheet', second: 'email' },
  'General Management': { main: 'slides', second: 'email' },
  'Executive Leadership': { main: 'slides', second: 'video' }
};

/** The core team in the Commons, by id. */
const CORE_APPS: Readonly<Record<string, ScreenPair>> = {
  receptionist: { main: 'calendar', second: null },
  'research-analyst': { main: 'document', second: 'browser' },
  writer: { main: 'document', second: 'browser' },
  'knowledge-librarian': { main: 'document', second: 'browser' },
  designer: { main: 'design', second: 'moodboard' },
  'product-coach': { main: 'kanban', second: 'roadmap' },
  'ops-coordinator': { main: 'spreadsheet', second: 'email' },
  'files-agent': { main: 'document', second: 'email' },
  'marketing-strategist': { main: 'calendar', second: 'bi' }
};

const DATABASE = /\b(database|dba)\b/i;
const CHAIN = /\b(blockchain|web3|smart contract|crypto|defi)\b/i;
const IMMERSIVE = /\b(game|gameplay|ar|vr|xr|3d|metaverse|graphics)\b/i;

/** Whether the table covers this person: a core-team id or a known department. */
export function knownScreenOwner(owner: ScreenOwner): boolean {
  return owner.id in CORE_APPS || owner.department in DEPARTMENT_APPS;
}

export function screenAppsFor(owner: ScreenOwner): DeskScreenApps {
  return { ...pairFor(owner), variant: (hashString(`screen:${owner.id}`) & 1) as 0 | 1 };
}

function pairFor({ id, name, department }: ScreenOwner): ScreenPair {
  const core = CORE_APPS[id];
  if (core) return core;
  if (department === 'Backend & APIs' && DATABASE.test(name)) return { main: 'sql', second: 'terminal' };
  if (department === 'Emerging Tech') {
    if (CHAIN.test(name)) return { main: 'chain', second: 'editor' };
    if (IMMERSIVE.test(name)) return { main: 'engine', second: 'editor' };
  }
  return DEPARTMENT_APPS[department] ?? { main: 'document', second: 'email' };
}

const FLAVOR_APP: Readonly<Record<ScreenFlavor, ScreenApp>> = {
  code: 'editor',
  data: 'bi',
  design: 'design',
  document: 'document'
};

/** A desk nobody owns (a spare or visitor desk) shows its district's old flavour, as an app. */
export function spareDeskApps(flavor: ScreenFlavor, deskId: string): DeskScreenApps {
  return { main: FLAVOR_APP[flavor], second: null, variant: (hashString(`screen:${deskId}`) & 1) as 0 | 1 };
}

const LIGHT_HARDWARE: ReadonlySet<ScreenApp> = new Set(['design', 'moodboard']);
const DARK_APPS: ReadonlySet<ScreenApp> = new Set([
  'editor',
  'terminal',
  'sql',
  'simulator',
  'monitoring',
  'security',
  'notebook',
  'engine',
  'chain'
]);

/** Hardware to match the main app: light casings for designers, dark keyboards for dark apps. */
export function hardwareFlavor(app: ScreenApp): ScreenFlavor {
  if (LIGHT_HARDWARE.has(app)) return 'design';
  if (DARK_APPS.has(app)) return 'code';
  return app === 'bi' ? 'data' : 'document';
}

/** The screen sheet: one tile per app and variant, each a whole visible screen in pixels. */
export const SHEET = { tileWidth: 256, tileHeight: 160, columns: 8, width: 2048, height: 1120 } as const;

/** Where an app's picture is on the sheet: the tile's top-left corner, in sheet pixels. */
export function tileOf(app: ScreenApp, variant: 0 | 1): { x: number; y: number } {
  const index = SCREEN_APPS.indexOf(app) * 2 + variant;
  return {
    x: (index % SHEET.columns) * SHEET.tileWidth,
    y: Math.floor(index / SHEET.columns) * SHEET.tileHeight
  };
}

/**
 * A part of the screen whose content scrolls (a code pane, a log, a ticket list), in tile pixels
 * with y down, and its speed in pixels per second. The painter draws that part so it repeats every
 * (bottom - top) pixels, so the wrap is seamless.
 */
export interface ScrollBand {
  left: number;
  top: number;
  right: number;
  bottom: number;
  speed: number;
}

export const SCROLL: Partial<Record<ScreenApp, ScrollBand>> = {
  editor: { left: 60, top: 21, right: 232, bottom: 147, speed: 5 },
  terminal: { left: 0, top: 14, right: 256, bottom: 154, speed: 9 },
  tests: { left: 0, top: 28, right: 256, bottom: 140, speed: 4 },
  tickets: { left: 0, top: 28, right: 256, bottom: 140, speed: 3 },
  email: { left: 0, top: 22, right: 96, bottom: 148, speed: 2 },
  security: { left: 0, top: 42, right: 170, bottom: 154, speed: 3 },
  notebook: { left: 0, top: 14, right: 256, bottom: 154, speed: 3 }
};

/** Where a typing cursor blinks while the owner works on a real task, in tile pixels. */
export const CURSOR: Partial<Record<ScreenApp, { x: number; y: number; light: boolean }>> = {
  editor: { x: 150, y: 95, light: true },
  terminal: { x: 70, y: 150, light: true },
  sql: { x: 118, y: 33, light: true },
  notebook: { x: 120, y: 26, light: false },
  document: { x: 150, y: 71, light: false }
};

/** Seconds a finished task's green strip stays on its owner's screens. */
export const DONE_FOR = 20;

/** The status strip under a screen: 0 none, 1 working, 2 waiting for the user, 3 done, 4 error. */
export function stripCode(status: AgentStatus | undefined, secondsSinceChange: number): 0 | 1 | 2 | 3 | 4 {
  switch (status) {
    case 'working':
      return 1;
    case 'waiting':
      return 2;
    case 'completed':
      return secondsSinceChange < DONE_FOR ? 3 : 0;
    case 'error':
      return 4;
    default:
      return 0;
  }
}
