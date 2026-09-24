import { COWORKERS, type Coworker } from '../../../../../shared/coworkers';
import { districtById, districtOf, type DistrictId } from '../campus/districts';

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'completed' | 'error';

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  accentColor: string;
  accentSoft: string;
  status: AgentStatus;
  currentTask?: string;
  capabilities: string[];
  systemPrompt: string;
  /** Where they sit: the Commons for the core team, otherwise their department's district. */
  district: DistrictId;
  /** Catalog department for specialists; the hub room for the core team. */
  department: string;
  roleIds?: string[];
}

/** The core team's own colours; specialists wear their district's. */
const CORE_ACCENTS: Readonly<Record<string, [color: string, soft: string]>> = {
  receptionist: ['#e11d48', 'rgba(225, 29, 72, 0.15)'],
  'research-analyst': ['#2563eb', 'rgba(37, 99, 235, 0.15)'],
  writer: ['#8b5cf6', 'rgba(139, 92, 246, 0.15)'],
  designer: ['#ec4899', 'rgba(236, 72, 153, 0.15)'],
  'product-coach': ['#f97316', 'rgba(249, 115, 22, 0.15)'],
  'knowledge-librarian': ['#0d9488', 'rgba(13, 148, 136, 0.15)'],
  'files-agent': ['#10b981', 'rgba(16, 185, 129, 0.15)'],
  'marketing-strategist': ['#eab308', 'rgba(234, 179, 8, 0.15)'],
  'ops-coordinator': ['#64748b', 'rgba(100, 116, 139, 0.15)']
};

function officeAgent(coworker: Coworker): OfficeAgent {
  const { core, roleIds, ...text } = coworker;
  if (core) {
    const [accentColor, accentSoft] = CORE_ACCENTS[coworker.id];
    return { ...text, district: 'commons', accentColor, accentSoft, status: 'idle' };
  }
  const district = districtById(districtOf(coworker.department));
  return {
    ...text,
    district: district.id,
    accentColor: district.color,
    accentSoft: `${district.color}18`,
    status: 'idle',
    roleIds
  };
}

/** Everyone in the office, core team first, as the scene and the side panel show them. */
export const OFFICE_AGENTS: OfficeAgent[] = COWORKERS.map(officeAgent);
