export interface TierInput {
  id: string;
  x: number;
  z: number;
  /** Selected, on a real task, walking, visiting: must be drawn as a full, animated person. */
  mustBeFull: boolean;
  /** Seated quietly at their own desk, so the instanced crowd figure looks exactly right. */
  canBeCrowd: boolean;
}

/**
 * Who gets a full rig this frame: everyone who must, then the people nearest the centre of the view
 * until `budget` is reached. People already shown count as a little closer, so the set does not
 * flicker as the camera drifts. Required people are never dropped, even past the budget.
 */
export function chooseFullTier(
  people: readonly TierInput[],
  centre: { x: number; z: number },
  budget: number,
  previous: ReadonlySet<string>,
  hysteresis = 1.5
): Set<string> {
  const chosen = new Set<string>();
  const optional: { id: string; score: number }[] = [];
  for (const person of people) {
    if (person.mustBeFull || !person.canBeCrowd) {
      chosen.add(person.id);
      continue;
    }
    const d = Math.hypot(person.x - centre.x, person.z - centre.z);
    optional.push({ id: person.id, score: previous.has(person.id) ? d / hysteresis : d });
  }
  optional.sort((a, b) => a.score - b.score);
  for (const { id } of optional) {
    if (chosen.size >= budget) break;
    chosen.add(id);
  }
  return chosen;
}
