import type { Team } from '../tasks';
import { DISTRICTS, districtById } from './districts';
import { slug } from './neighbourhoods';

/** A board that shows a team's task cards, and the whiteboard it is drawn on. */
export interface TaskBoard {
  team: Team;
  itemId: string;
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
      color: district.color,
      title: name
    }))
  ),
  { team: 'Library', itemId: 'board-library', color: COMMONS, title: 'Library' },
  { team: 'Planning', itemId: 'meeting-whiteboard', color: COMMONS, title: 'Planning' },
  { team: 'Lounge', itemId: 'board-lounge', color: COMMONS, title: 'Lounge' },
  { team: 'Files room', itemId: 'board-files', color: COMMONS, title: 'Files room' }
];
