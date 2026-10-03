/** The office's meeting rooms, where a team meets and then works together until its tasks are done. */
export type MeetingRoomId = 'boardroom' | 'room-1' | 'room-2' | 'room-3' | 'room-4';

export interface RoomInfo {
  id: MeetingRoomId;
  name: string;
  /** Its chairs, the lead's included. */
  seats: number;
}

/** The boardroom first: twelve and the lead at the head; six in each of the others. */
export const ROOMS: readonly RoomInfo[] = [
  { id: 'boardroom', name: 'Boardroom', seats: 13 },
  { id: 'room-1', name: 'Room 1', seats: 6 },
  { id: 'room-2', name: 'Room 2', seats: 6 },
  { id: 'room-3', name: 'Room 3', seats: 6 },
  { id: 'room-4', name: 'Room 4', seats: 6 }
];

export const roomName = (id: MeetingRoomId): string => ROOMS.find((room) => room.id === id)?.name ?? id;
/** A room as said in a sentence: "in the boardroom", "in Room 3". */
export const theRoom = (id: MeetingRoomId): string => (id === 'boardroom' ? 'the boardroom' : roomName(id));

/** A team's room; teams from before there were rooms met in the boardroom. */
export const roomOf = (team: { room?: MeetingRoomId }): MeetingRoomId => team.room ?? 'boardroom';

/** The room someone named ("Room 3", "room-3", "the boardroom", "3"), or null. */
export function roomNamed(text: string): MeetingRoomId | null {
  const plain = text.toLowerCase();
  if (plain.includes('board')) return 'boardroom';
  const digit = /\b([1-4])\b/.exec(plain.replace(/[^a-z0-9]+/g, ' '))?.[1];
  return digit ? (`room-${digit}` as MeetingRoomId) : null;
}

/**
 * Where a team of `people` (the lead included) meets and works: the room asked for when it fits and
 * no other team is in it, else the smallest free room that fits, else the fitting room with the
 * fewest teams in it. `busy` holds the room of every other open team.
 */
export function pickRoom(people: number, busy: readonly MeetingRoomId[], wanted?: MeetingRoomId | null): MeetingRoomId {
  const fits = ROOMS.filter((room) => room.seats >= people);
  const teamsIn = (id: MeetingRoomId) => busy.filter((b) => b === id).length;
  if (wanted && fits.some((room) => room.id === wanted) && !teamsIn(wanted)) return wanted;
  const smallestFirst = [...fits].sort((a, b) => a.seats - b.seats);
  const free = smallestFirst.find((room) => !teamsIn(room.id));
  if (free) return free.id;
  return smallestFirst.sort((a, b) => teamsIn(a.id) - teamsIn(b.id))[0]?.id ?? 'boardroom';
}
