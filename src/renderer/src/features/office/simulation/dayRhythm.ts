import type { AmbientActivity } from './agentProfiles';

export type DayPhase =
  | 'early'
  | 'arrival'
  | 'standups'
  | 'morning-break'
  | 'focus'
  | 'lunch'
  | 'afternoon-break'
  | 'wind-down'
  | 'evening';

/** How the office behaves at one time of day. */
export interface Rhythm {
  phase: DayPhase;
  /** Multipliers on each ambient activity's usual weight; unlisted ones stay as they are. */
  weights: Partial<Record<AmbientActivity, number>>;
  /** Weight of going for lunch, against the usual weights (which sum to about 100). */
  lunch: number;
  /** Scales how many people may be away from their desks at once. */
  away: number;
  /** Seconds between a department's team gathering at its board; null for none. */
  standupEvery: number | null;
  /** Share of desks with lunch on them while their owner is there. */
  deskLunch: number;
}

const PLAIN: Rhythm = { phase: 'focus', weights: {}, lunch: 0, away: 1, standupEvery: null, deskLunch: 0 };

/** Now and then through the working day, a team huddles at its board. */
const HUDDLE_EVERY = 420;

/**
 * The shape of a working day, from how offices actually run: coffee on arrival, short standups at
 * team boards around 9:30, a mid-morning break, lunch from 12:00 (most at their desk, some in the
 * café), an afternoon dip and snack break at 15:00, and a looser end of the day.
 */
const DAY: readonly [until: number, rhythm: Omit<Rhythm, 'deskLunch' | 'lunch'> & Partial<Rhythm>][] = [
  [8.5, { phase: 'early', weights: { coffee: 0.6, play: 0.3, gaming: 0.3 }, away: 0.6, standupEvery: null }],
  [9.5, { phase: 'arrival', weights: { coffee: 2.5, visit: 1.2 }, away: 1, standupEvery: HUDDLE_EVERY }],
  // Teams on their feet at their boards count as away: room for a couple of them at once.
  [
    10.25,
    { phase: 'standups', weights: { coffee: 0.8, play: 0.4, gaming: 0.4 }, away: 1.4, standupEvery: 45 }
  ],
  [
    10.75,
    { phase: 'morning-break', weights: { coffee: 2, lounge: 1.5, idle: 1.3 }, away: 1.25, standupEvery: null }
  ],
  [
    12,
    { phase: 'focus', weights: { coffee: 0.8, play: 0.6, gaming: 0.6 }, away: 1, standupEvery: HUDDLE_EVERY }
  ],
  [
    13.5,
    {
      phase: 'lunch',
      weights: { coffee: 0.3, lounge: 1.3, play: 1.2, whiteboard: 0.4 },
      lunch: 40,
      away: 1.5,
      standupEvery: null,
      deskLunch: 0.45
    }
  ],
  [15, { phase: 'focus', weights: { visit: 1.2, coffee: 0.9 }, away: 1, standupEvery: HUDDLE_EVERY }],
  [
    15.5,
    {
      phase: 'afternoon-break',
      weights: { coffee: 2.2, idle: 1.5, play: 1.5, gaming: 1.5 },
      away: 1.25,
      standupEvery: null
    }
  ],
  [17.5, { phase: 'focus', weights: { coffee: 0.9 }, away: 1, standupEvery: HUDDLE_EVERY }],
  [
    18.5,
    {
      phase: 'wind-down',
      weights: { lounge: 1.5, play: 1.8, gaming: 1.8, visit: 1.3, coffee: 0.6 },
      away: 1.1,
      standupEvery: null
    }
  ],
  [
    24,
    { phase: 'evening', weights: { coffee: 0.5, play: 1.2, whiteboard: 0.5 }, away: 0.6, standupEvery: null }
  ]
];

/** The rhythm at a local hour (0–24, fractional), or a plain working rhythm when there is no clock. */
export function rhythmAt(hour: number | null): Rhythm {
  if (hour === null) return PLAIN;
  const h = ((hour % 24) + 24) % 24;
  const [, rhythm] = DAY.find(([until]) => h < until) ?? DAY[DAY.length - 1];
  return { lunch: 0, deskLunch: 0, ...rhythm };
}
