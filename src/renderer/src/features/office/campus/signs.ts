import { OFFICE_AGENTS } from '../data/officeAgents';
import { HOME_DESKS, poiById } from '../simulation/layout';
import { DISTRICTS, districtById } from './districts';
import { MEETING_ROOMS, type MeetingRoomId } from './commons';
import { plural } from '../../../format';

/**
 * Every sign in the office, as data: a pylon at the front of each district, a nameplate on each
 * executive's door and each meeting room's name on its glass. Nothing hangs overhead; departments
 * are named on their task boards. The scene
 * draws the signs; this module decides where they go, what they say and how big they are at each zoom.
 */

export type SignKind = 'district' | 'nameplate' | 'room';
export type SignTier = 'far' | 'middle' | 'near';

export interface SignSpec {
  /** 'district:engineering' or 'nameplate:desk-exec-0'. */
  id: string;
  kind: SignKind;
  /** District id or desk id: what clicking the sign opens. */
  target: string;
  title: string;
  subtitle?: string;
  color: string;
  /** Bottom centre of the panel, in metres. */
  x: number;
  y: number;
  z: number;
  /** Panel size at scale 1. */
  width: number;
  height: number;
  /** Font size of the title at scale 1, in metres; the zoom scale keeps it readable. */
  letter: number;
  /** Turns to face the camera, so its text reads level; nameplates stay flat on their glass. */
  faceCamera: boolean;
  /** How far it may grow as the camera pulls back. */
  maxScale: number;
}

/** Vertical foreshortening of an upright panel under the camera's 0.7 rad pitch. */
const FORESHORTEN = Math.cos(0.7);
/** Smallest on-screen font size, in pixels, each kind keeps as the camera pulls back. */
const MIN_PIXELS: Record<SignKind, number> = { district: 16, nameplate: 0, room: 11 };

/** "Chief Executive Officer (CEO)" → "CEO"; a name without an abbreviation stays whole. */
export function titleAbbreviation(roleName: string): string {
  return /\(([^()]+)\)\s*$/.exec(roleName)?.[1] ?? roleName;
}

/** True size close up; from further away, big enough for the title to stay readable. */
export function signScale(sign: SignSpec, metresPerPixel: number): number {
  const minPx = MIN_PIXELS[sign.kind];
  if (!minPx) return 1;
  const needed = (minPx * metresPerPixel) / (sign.letter * FORESHORTEN);
  return Math.min(sign.maxScale, Math.max(1, needed));
}

/** District signs lead from afar and step back (faintly) once you are inside a district; nameplates only show close up. */
export function signOpacity(kind: SignKind, tier: SignTier): number {
  switch (kind) {
    case 'district':
      return tier === 'near' ? 0.25 : 1;
    case 'nameplate':
      return tier === 'near' ? 1 : 0;
    case 'room':
      return tier === 'far' ? 0 : 1;
  }
}

const headcount = OFFICE_AGENTS.reduce<Record<string, number>>((counts, agent) => {
  counts[agent.district] = (counts[agent.district] ?? 0) + 1;
  return counts;
}, {});

const districtSigns: SignSpec[] = DISTRICTS.map((district) => ({
  id: `district:${district.id}`,
  kind: 'district',
  target: district.id,
  title: district.short,
  subtitle: plural(headcount[district.id] ?? 0, 'person', 'people'),
  color: district.color,
  x: district.sign.x,
  y: 2.6,
  z: district.sign.z,
  width: 2.4,
  height: 0.8,
  letter: 0.36,
  faceCamera: true,
  maxScale: 9
}));

/** Each executive's title on the glass beside their office door (the door is 4.85 m in front of the chair). */
const nameplates: SignSpec[] = OFFICE_AGENTS.filter((agent) => agent.district === 'leadership').map(
  (agent) => {
    const desk = HOME_DESKS[agent.id];
    const seat = poiById(desk).position;
    return {
      id: `nameplate:${desk}`,
      kind: 'nameplate',
      target: desk,
      title: titleAbbreviation(agent.name),
      color: districtById('leadership').color,
      x: seat.x + 1.15,
      y: 1.42,
      z: seat.z + 4.85 + 0.03,
      width: 0.5,
      height: 0.16,
      letter: 0.08,
      faceCamera: false,
      maxScale: 1
    };
  }
);

/**
 * Where each meeting room's name goes: on its front glass beside the door, facing the viewer. The
 * boardroom's door is in its side wall, which the camera sees edge-on, so its sign sticks out from
 * that wall above head height, like a blade sign over a shop door.
 */
const ROOM_PLATES: Readonly<Record<MeetingRoomId, { x: number; y: number; z: number }>> = {
  boardroom: { x: -6.7, y: 2.05, z: -0.95 },
  'room-1': { x: -6.2, y: 1.75, z: -5.97 },
  'room-2': { x: 0.3, y: 1.75, z: -5.97 },
  'room-3': { x: -14.4, y: 1.75, z: 8.83 },
  'room-4': { x: -8.4, y: 1.75, z: 8.83 }
};

const roomSigns: SignSpec[] = MEETING_ROOMS.map((room) => ({
  id: `room:${room.id}`,
  kind: 'room',
  target: room.id,
  title: room.name,
  subtitle: room.id === 'boardroom' ? '12 seats' : '6 seats',
  color: districtById('commons').color,
  ...ROOM_PLATES[room.id],
  width: 0.9,
  height: 0.34,
  letter: 0.13,
  faceCamera: false,
  maxScale: 2.5
}));

export const SIGNS: readonly SignSpec[] = [...districtSigns, ...nameplates, ...roomSigns];
