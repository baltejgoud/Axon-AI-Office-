import { DISTRICTS } from '../campus/districts';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { TASK_BOARDS } from '../campus/boards';
import { FURNITURE } from '../simulation/layout';
import type { Vec2 } from '../simulation/types';

export const SPATIAL_LABELS = DISTRICTS.flatMap((district) => [
  {
    id: `district:${district.id}`,
    kind: 'district' as const,
    target: district.id,
    title: district.name,
    color: district.color,
    people: OFFICE_AGENTS.filter((a) => a.district === district.id).length,
    point: { ...district.sign, y: 2.6 }
  },
  ...district.departments.flatMap((department) => {
    const board = TASK_BOARDS.find((b) => b.team === department);
    const item = FURNITURE.find((f) => f.id === board?.itemId);
    return item
      ? [
          {
            id: `department:${department}`,
            kind: 'department' as const,
            target: department,
            title: department,
            color: district.color,
            people: OFFICE_AGENTS.filter((a) => a.department === department).length,
            point: { x: item.x, y: 2.4, z: item.z }
          }
        ]
      : [];
  })
]);
export function visibleSpatialLabels(
  kind: 'district' | 'department',
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null,
  target: Vec2
) {
  return SPATIAL_LABELS.filter(
    (label) =>
      label.kind === kind &&
      (!bounds ||
        (label.point.x >= bounds.minX &&
          label.point.x <= bounds.maxX &&
          label.point.z >= bounds.minZ &&
          label.point.z <= bounds.maxZ))
  )
    .sort(
      (a, b) =>
        Math.hypot(a.point.x - target.x, a.point.z - target.z) -
        Math.hypot(b.point.x - target.x, b.point.z - target.z)
    )
    .slice(0, kind === 'district' ? 9 : 10);
}
