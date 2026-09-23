import { SPECIALIST_ROLES } from './coworkerCatalog';
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

export const OFFICE_AGENTS: OfficeAgent[] = [
  {
    id: 'research-analyst',
    district: 'commons',
    department: 'Library',
    name: 'Research Analyst',
    role: 'Research & Insights',
    description: 'Finds insights, analyzes patterns, and summarizes complex information with rigor.',
    accentColor: '#2563eb', // Blue
    accentSoft: 'rgba(37, 99, 235, 0.15)',
    status: 'idle',
    capabilities: ['Deep research', 'Competitor analysis', 'Document synthesis', 'Pattern detection'],
    systemPrompt:
      'You are Axon’s Research Analyst. Your focus is deep research, synthesizing disparate information, analyzing market and technical documents, comparing alternatives, and extracting actionable findings with clear citations and structured reasoning.'
  },
  {
    id: 'writer',
    district: 'commons',
    department: 'Library',
    name: 'Writer',
    role: 'Writing & Editorial',
    description: 'Drafts, rewrites, refines tone, and polishes briefs, articles, and documentation.',
    accentColor: '#8b5cf6', // Purple
    accentSoft: 'rgba(139, 92, 246, 0.15)',
    status: 'idle',
    capabilities: ['Executive briefs', 'Technical writing', 'Copywriting', 'Tone adaptation'],
    systemPrompt:
      'You are Axon’s Writer. You craft crisp, persuasive, and clear prose. You adapt tone from technical precision to executive brevity, remove fluff, and communicate ideas with elegance.'
  },
  {
    id: 'designer',
    district: 'commons',
    department: 'Planning',
    name: 'Designer',
    role: 'Product & UX Design',
    description: 'Shapes user journeys, product visual systems, layouts, and UX architecture.',
    accentColor: '#ec4899', // Pink / Violet
    accentSoft: 'rgba(236, 72, 153, 0.15)',
    status: 'idle',
    capabilities: ['UX architecture', 'Design systems', 'Layout strategy', 'User flow design'],
    systemPrompt:
      'You are Axon’s Product & UX Designer. You analyze user flows, critique interface designs, recommend clean layout patterns, and balance visual polish with usability.'
  },
  {
    id: 'product-coach',
    district: 'commons',
    department: 'Planning',
    name: 'Product Coach',
    role: 'Product Strategy & Roadmaps',
    description: 'Breaks complex visions into actionable PRDs, milestone roadmaps, and requirements.',
    accentColor: '#f97316', // Orange
    accentSoft: 'rgba(249, 115, 22, 0.15)',
    status: 'idle',
    capabilities: ['PRD creation', 'Sprint planning', 'Tradeoff evaluation', 'Feature prioritization'],
    systemPrompt:
      'You are Axon’s Product Coach. You help founders and teams turn messy ideas into structured requirements, user stories, milestone roadmaps, and crisp decision frameworks.'
  },
  {
    id: 'knowledge-librarian',
    district: 'commons',
    department: 'Library',
    name: 'Knowledge Librarian',
    role: 'Knowledge & Research',
    description: 'Organizes references, retrieves relevant passages, and explains domain knowledge.',
    accentColor: '#0d9488', // Teal
    accentSoft: 'rgba(13, 148, 136, 0.15)',
    status: 'idle',
    capabilities: ['Knowledge indexing', 'Citation finding', 'Domain synthesis', 'Semantic retrieval'],
    systemPrompt:
      'You are Axon’s Knowledge Librarian. You organize, search, and extract high-signal knowledge from project documentation, research papers, and uploaded files with pinpoint accuracy.'
  },
  {
    id: 'files-agent',
    district: 'commons',
    department: 'Files room',
    name: 'Files Agent',
    role: 'Files & Assets',
    description: 'Manages project file context, organizes attachments, and extracts structured data.',
    accentColor: '#10b981', // Green
    accentSoft: 'rgba(16, 185, 129, 0.15)',
    status: 'idle',
    capabilities: ['File navigation', 'Attachment context', 'Document audit', 'Format extraction'],
    systemPrompt:
      'You are Axon’s Files Agent. You inspect project structures, verify file contents, assist with file organization, and extract structured takeaways from multi-format attachments.'
  },
  {
    id: 'marketing-strategist',
    district: 'commons',
    department: 'Lounge',
    name: 'Marketing Strategist',
    role: 'Marketing & Positioning',
    description: 'Designs go-to-market strategies, positioning messaging, and campaign narratives.',
    accentColor: '#eab308', // Yellow
    accentSoft: 'rgba(234, 179, 8, 0.15)',
    status: 'idle',
    capabilities: ['GTM strategy', 'Positioning frameworks', 'Value propositions', 'Campaign design'],
    systemPrompt:
      'You are Axon’s Marketing Strategist. You specialize in positioning, defining target audiences, crafting compelling value propositions, and planning go-to-market rollouts.'
  },
  {
    id: 'ops-coordinator',
    district: 'commons',
    department: 'Reception',
    name: 'Ops Coordinator',
    role: 'Operations & Execution',
    description: 'Coordinates cross-functional workflows, operational checklists, and timelines.',
    accentColor: '#64748b', // Blue-Gray
    accentSoft: 'rgba(100, 116, 139, 0.15)',
    status: 'idle',
    capabilities: ['Workflow tracking', 'Operational checklists', 'Timeline coordination', 'Blocker triage'],
    systemPrompt:
      'You are Axon’s Ops Coordinator. You keep tasks on schedule, break multi-step projects into verifiable checklist items, identify dependencies, and ensure operational excellence.'
  }
];

OFFICE_AGENTS.push(
  ...SPECIALIST_ROLES.map((role): OfficeAgent => {
    const district = districtById(districtOf(role.group));
    return {
      id: role.id,
      name: role.name,
      role: role.group,
        district: district.id,
      department: role.group,
      roleIds: role.id === 'business-analyst' ? [] : [role.id],
      description: role.profile.split('\n')[0].replace('Owns: ', ''),
      accentColor: district.color,
      accentSoft: `${district.color}18`,
      status: 'idle',
      capabilities: [role.group, 'Dedicated conversation', 'File context'],
      systemPrompt: `You are Axon's ${role.name}. ${role.profile}\nBe explicit about what you have actually done versus recommendations. Use available tools when needed; do not claim access to files or services you do not have.`
    };
  })
);
