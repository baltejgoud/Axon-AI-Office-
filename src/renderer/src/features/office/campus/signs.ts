import { OFFICE_AGENTS } from '../data/officeAgents';
import { DEPARTMENT_BOUNDS, DEPARTMENT_ANCHORS, HOME_DESKS, poiById } from '../simulation/layout';
import type { ZoneId } from '../simulation/types';
import { COMMONS_ROOM_NAMES, ROOM_SIGN_POINTS } from './commons';
import { DISTRICTS, districtById } from './districts';

/**
 * Every sign in the office, as data: a pylon at the front of each district, a hanging sign over each
 * department in the shared districts, one over each Commons room, and a nameplate on each
 * executive's door. The scene draws them; this module decides where they go, what they say and
 * how big they are at each zoom.
 */

export type SignKind = 'district' | 'department' | 'room' | 'nameplate';
export type SignTier = 'far' | 'middle' | 'near';

export interface SignSpec {
  /** 'district:engineering', 'department:Backend & APIs', 'room:knowledge', 'nameplate:desk-exec-0'. */
  id: string;
  kind: SignKind;
  /** District id, department name, Commons zone or desk id: what clicking the sign opens. */
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
  /** Hangs on two cables and leans toward the camera. */
  hanging: boolean;
  /** Turns to face the camera, so its text reads level; nameplates stay flat on their glass. */
  faceCamera: boolean;
  /** How far it may grow as the camera pulls back. */
  maxScale: number;
}

/** Vertical foreshortening of an upright panel under the camera's 0.7 rad pitch. */
const FORESHORTEN = Math.cos(0.7);
/** Smallest on-screen font size, in pixels, each kind keeps as the camera pulls back. */
const MIN_PIXELS: Record<SignKind, number> = { district: 16, department: 12, room: 12, nameplate: 0 };

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

/**
 * District signs lead from afar and step back (faintly) once you are inside a district;
 * department and room signs take over in between; nameplates only show close up.
 */
export function signOpacity(kind: SignKind, tier: SignTier): number {
  switch (kind) {
    case 'district':
      return tier === 'near' ? 0.25 : 1;
    case 'department':
    case 'room':
      return tier === 'far' ? 0 : 1;
    case 'nameplate':
      return tier === 'near' ? 1 : 0;
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
  subtitle: `${headcount[district.id] ?? 0} people`,
  color: district.color,
  x: district.sign.x,
  y: 2.6,
  z: district.sign.z,
  width: 2.4,
  height: 0.8,
  letter: 0.36,
  hanging: false,
  faceCamera: true,
  maxScale: 9
}));

const departmentSigns: SignSpec[] = DISTRICTS.filter((district) => district.departments.length > 1).flatMap(
  (district) =>
    district.departments.map((name): SignSpec => {
      const bounds = DEPARTMENT_BOUNDS[name];
      const width = 2.8;
      return {
        id: `department:${name}`,
        kind: 'department',
        target: name,
        title: name,
        color: district.color,
        x: DEPARTMENT_ANCHORS[name].x,
        // High enough to clear the team's task board below it.
        y: 3.05,
        z: bounds.minZ + 1.1,
        width,
        height: 0.44,
        letter: 0.2,
        hanging: true,
        faceCamera: true,
        maxScale: (bounds.maxX - bounds.minX) / width
      };
    })
);

const roomSigns: SignSpec[] = (Object.keys(ROOM_SIGN_POINTS) as Exclude<ZoneId, 'agents'>[]).map((zone) => {
  const point = ROOM_SIGN_POINTS[zone];
  return {
    id: `room:${zone}`,
    kind: 'room',
    target: zone,
    title: COMMONS_ROOM_NAMES[zone],
    color: districtById('commons').color,
    x: point.x,
    y: point.y,
    z: point.z,
    width: 1.6,
    height: 0.34,
    letter: 0.18,
    hanging: true,
    faceCamera: true,
    maxScale: 3
  };
});

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
      hanging: false,
      faceCamera: false,
      maxScale: 1
    };
  }
);

export const SIGNS: readonly SignSpec[] = [...districtSigns, ...departmentSigns, ...roomSigns, ...nameplates];
