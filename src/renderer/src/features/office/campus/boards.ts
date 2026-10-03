import type { Team } from '../tasks';
import { MEETING_ROOMS, type MeetingRoomId } from './commons';
import { DISTRICTS, districtById } from './districts';
import { slug } from './neighbourhoods';

/** A board that shows a team's task cards (or the day's plan), and the whiteboard it is drawn on. */
export interface TaskBoard {
  team: Team;
  itemId: string;
  /** A team's cards, the receptionist's list of what is next today, or the open team in a meeting room. */
  kind: 'team' | 'today' | 'meeting';
  /** The header's colour: the district's, or the Commons' for the core team's rooms. */
  color: string;
  title: string;
  /**
   * The meeting room it hangs in: while a team is in that room the board shows that team (a 'team'
   * board goes back to its own cards when the room is free).
   */
  room?: MeetingRoomId;
}

const COMMONS = districtById('commons').color;
const MEETING = '#8b5cf6';

/** Every department's own board, and a board in each of the core team's rooms. */
export const TASK_BOARDS: readonly TaskBoard[] = [
  ...DISTRICTS.flatMap((district) =>
    district.departments.map((name) => ({
      team: name,
      itemId: `wb-${slug(name)}`,
      kind: 'team' as const,
      color: district.color,
      title: name
    }))
  ),
  { team: 'Library', itemId: 'board-library', kind: 'team', color: COMMONS, title: 'Library' },
  { team: 'Planning', itemId: 'meeting-whiteboard', kind: 'team', color: COMMONS, title: 'Planning', room: 'room-1' },
  { team: 'Lounge', itemId: 'board-lounge', kind: 'team', color: COMMONS, title: 'Lounge' },
  { team: 'Files room', itemId: 'board-files', kind: 'team', color: COMMONS, title: 'Files room' },
  { team: 'Today', itemId: 'board-today', kind: 'today', color: '#e11d48', title: 'Today' },
  ...MEETING_ROOMS.filter((room) => room.id !== 'room-1').map((room) => ({
    team: room.name,
    itemId: room.boardItemId,
    kind: 'meeting' as const,
    color: MEETING,
    title: room.name,
    room: room.id
  }))
];

/** The meeting room's colour, for a board while a team is in it. */
export const MEETING_COLOR = MEETING;
