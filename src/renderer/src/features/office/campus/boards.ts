import type { Team } from '../tasks';
import { DISTRICTS, districtById } from './districts';
import { slug } from './neighbourhoods';

/** A board that shows a team's task cards (or the day's plan), and the whiteboard it is drawn on. */
export interface TaskBoard {
  team: Team;
  itemId: string;
  /** A team's cards, or the receptionist's list of what is next today. */
  kind: 'team' | 'today';
  /** The header's colour: the district's, or the Commons' for the core team's rooms. */
  color: string;
  title: string;
}

const COMMONS = districtById('commons').color;

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
  { team: 'Planning', itemId: 'meeting-whiteboard', kind: 'team', color: COMMONS, title: 'Planning' },
  { team: 'Lounge', itemId: 'board-lounge', kind: 'team', color: COMMONS, title: 'Lounge' },
  { team: 'Files room', itemId: 'board-files', kind: 'team', color: COMMONS, title: 'Files room' },
  { team: 'Today', itemId: 'board-today', kind: 'today', color: '#e11d48', title: 'Today' }
];
