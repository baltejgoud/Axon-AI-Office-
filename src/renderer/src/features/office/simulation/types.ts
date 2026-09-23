import type { DistrictId } from '../campus/districts';

/** Floor coordinates in metres. x runs along the back wall, z toward the viewer. */
export interface Vec2 {
  x: number;
  z: number;
}

export type AgentBehaviorState =
  | 'idle'
  | 'walking'
  | 'typing'
  | 'reading'
  | 'thinking'
  | 'talking'
  | 'meeting'
  | 'coffee'
  | 'sitting'
  | 'waiting'
  | 'whiteboard'
  | 'celebrating';

export type HeldItem = 'cup' | 'book' | 'folder' | 'tablet' | 'clipboard';

/** Mirrors the office store's real task status; the simulation never invents one. */
export type TaskStatus = 'idle' | 'working' | 'waiting' | 'completed' | 'error';

export type ZoneId = 'chat' | 'workspaces' | 'knowledge' | 'agents' | 'files' | 'cafe';

export type PoiType =
  | 'desk'
  | 'visit'
  | 'cafe'
  | 'cafe-seat'
  | 'meeting'
  | 'whiteboard'
  | 'lounge'
  | 'bookshelf'
  | 'printer'
  | 'files'
  | 'open-area';

export interface PointOfInterest {
  id: string;
  type: PoiType;
  zoneId: ZoneId;
  /** Where the body ends up: the seat for seated spots, the standing spot otherwise. */
  position: Vec2;
  /** Yaw the agent faces once there. 0 faces +z. */
  facing: number;
  /** Free floor the agent walks to before sitting down; equals position for standing spots. */
  approach: Vec2;
  seated: boolean;
  capacity: number;
  /** Meeting venue this seat belongs to. */
  group?: 'meeting-room' | 'collab-table';
  /** For visit spots: the desk whose occupant is being visited. */
  hostDeskId?: string;
  /** Set on spots that belong to a district neighbourhood; untagged spots are in the Commons. */
  district?: DistrictId;
  department?: string;
}

export type ScreenState = 'off' | 'on' | 'active';

export interface AgentView {
  id: string;
  position: Vec2;
  heading: number;
  behavior: AgentBehaviorState;
  /** 0 standing, 1 seated; eased by the simulation during transitions. */
  sit: number;
  /** Metres per second while walking, 0 otherwise. */
  speed: number;
  heldItem: HeldItem | null;
  /** A point the head and shoulders turn toward (talking partner, meeting speaker). */
  attention: Vec2 | null;
  poiId: string | null;
  /** True while a real Axon task is driving this agent. */
  onTask: boolean;
}

export const yawTowards = (from: Vec2, to: Vec2): number => Math.atan2(to.x - from.x, to.z - from.z);

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
