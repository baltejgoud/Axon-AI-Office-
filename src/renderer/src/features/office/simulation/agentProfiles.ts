import type { HeldItem } from './types';

export type AmbientActivity =
  | 'desk'
  | 'coffee'
  | 'lounge'
  | 'whiteboard'
  | 'bookshelf'
  | 'printer'
  | 'cabinet'
  | 'visit'
  | 'idle'
  | 'gaming'
  | 'play';

/** Where someone is when the office first opens, so the room is already alive. */
export type InitialScene =
  | { kind: 'desk' }
  | { kind: 'coffee'; poiId: string }
  | { kind: 'whiteboard'; poiId: string }
  | { kind: 'bookshelf'; poiId: string }
  | { kind: 'lounge'; poiId: string }
  | { kind: 'walking-home'; fromPoiId: string };

export interface AgentProfile {
  id: string;
  /**
   * Chance of each next activity when a desk session ends. "desk" means keep working.
   * Every away activity is followed by a return to the home desk.
   */
  weights: Partial<Record<AmbientActivity, number>>;
  /** Relative chance of being pulled into an ambient meeting. */
  meetingAffinity: number;
  /** Carried to meetings and desk visits. */
  prop: HeldItem | null;
  /** Walking-speed multiplier, so two people on the same route drift apart. */
  pace: number;
  initial: InitialScene;
}

export const AGENT_PROFILES: Readonly<Record<string, AgentProfile>> = {
  // The front desk is rarely empty.
  receptionist: {
    id: 'receptionist',
    weights: { desk: 70, coffee: 8, idle: 8, lounge: 6, visit: 8 },
    meetingAffinity: 0.3,
    prop: 'tablet',
    pace: 1,
    initial: { kind: 'desk' }
  },
  'research-analyst': {
    id: 'research-analyst',
    weights: { desk: 60, coffee: 12, lounge: 8, bookshelf: 8, idle: 5, visit: 4, gaming: 4 },
    meetingAffinity: 1,
    prop: 'tablet',
    pace: 1,
    initial: { kind: 'desk' }
  },
  writer: {
    id: 'writer',
    weights: { desk: 58, coffee: 14, lounge: 10, bookshelf: 6, idle: 7, visit: 5, gaming: 5 },
    meetingAffinity: 0.8,
    prop: 'tablet',
    pace: 0.94,
    initial: { kind: 'coffee', poiId: 'cafe-counter-1' }
  },
  designer: {
    id: 'designer',
    weights: { desk: 56, whiteboard: 16, coffee: 10, lounge: 6, idle: 5, visit: 7, gaming: 5 },
    meetingAffinity: 1,
    prop: 'tablet',
    pace: 1.05,
    initial: { kind: 'whiteboard', poiId: 'collab-wb-1' }
  },
  'product-coach': {
    id: 'product-coach',
    weights: { desk: 55, whiteboard: 14, coffee: 9, visit: 12, idle: 5, lounge: 5, gaming: 3 },
    meetingAffinity: 1.6,
    prop: 'tablet',
    pace: 1.02,
    initial: { kind: 'desk' }
  },
  'knowledge-librarian': {
    id: 'knowledge-librarian',
    weights: { desk: 55, bookshelf: 22, coffee: 8, lounge: 8, idle: 3, visit: 4 },
    meetingAffinity: 0.7,
    prop: 'book',
    pace: 0.92,
    initial: { kind: 'bookshelf', poiId: 'shelf-1' }
  },
  'files-agent': {
    id: 'files-agent',
    weights: { desk: 55, printer: 18, cabinet: 10, coffee: 9, idle: 4, visit: 4, gaming: 4 },
    meetingAffinity: 0.6,
    prop: 'folder',
    pace: 1,
    initial: { kind: 'desk' }
  },
  'marketing-strategist': {
    id: 'marketing-strategist',
    weights: { desk: 55, lounge: 12, coffee: 11, whiteboard: 9, visit: 8, idle: 5, gaming: 5 },
    meetingAffinity: 1.1,
    prop: 'clipboard',
    pace: 1.06,
    initial: { kind: 'lounge', poiId: 'lounge-sofa-2' }
  },
  'ops-coordinator': {
    id: 'ops-coordinator',
    weights: { desk: 46, visit: 22, coffee: 10, printer: 8, idle: 8, whiteboard: 6 },
    meetingAffinity: 1.3,
    prop: 'clipboard',
    pace: 1.08,
    initial: { kind: 'walking-home', fromPoiId: 'collab-e' }
  }
};

/** Seconds spent on each activity once there. Long enough to read as intent, not jitter. */
export const ACTIVITY_DURATIONS: Readonly<Record<AmbientActivity, [number, number]>> = {
  desk: [30, 120],
  coffee: [15, 45],
  lounge: [20, 60],
  whiteboard: [15, 40],
  bookshelf: [10, 30],
  printer: [8, 18],
  cabinet: [10, 20],
  visit: [10, 25],
  idle: [10, 20],
  gaming: [40, 90],
  play: [30, 70]
};

export const MEETING_DURATION: [number, number] = [30, 90];

const SPECIALIST_PROPS: (HeldItem | null)[] = ['tablet', 'clipboard', null, 'book', 'tablet', null];

/**
 * Everyone in the districts: mostly at their desk, with short trips to their department's
 * whiteboard, a colleague's desk or (near the Commons) the café. Meetings stay with the core team.
 */
export function specialistProfile(id: string): AgentProfile {
  let hash = 0;
  for (const letter of id) hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0;
  return {
    id,
    weights: { desk: 70, coffee: 6, whiteboard: 8, visit: 8, idle: 4, lounge: 4, gaming: 2, play: 4 },
    meetingAffinity: 0,
    prop: SPECIALIST_PROPS[hash % SPECIALIST_PROPS.length],
    pace: 0.92 + (hash % 17) / 100,
    initial: { kind: 'desk' }
  };
}
