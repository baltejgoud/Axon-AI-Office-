import type { Role } from '../shared/types';
import rolesJson from '../roles/roles.json';

const all = rolesJson as Role[];
const byId = new Map(all.map((r) => [r.id, r]));

export function roles(): Role[] {
  return all;
}
export function hasRole(id: string): boolean {
  return byId.has(id);
}
export function roleProfiles(ids: string[]): Role[] {
  return ids.flatMap((id) => byId.get(id) ?? []);
}
