import analystImg from '@/assets/agents/research-analyst.jpg';
import designerImg from '@/assets/agents/designer.jpg';
import filesImg from '@/assets/agents/files-agent.jpg';
import opsImg from '@/assets/agents/ops-coordinator.jpg';
import writerImg from '@/assets/agents/writer.png';
import productCoachImg from '@/assets/agents/product-coach.png';
import librarianImg from '@/assets/agents/knowledge-librarian.png';
import marketingImg from '@/assets/agents/marketing-strategist.png';

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'completed' | 'error';

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  department: 'chat' | 'workspaces' | 'knowledge' | 'agents' | 'files' | 'cafe';
  description: string;
  avatar?: string;
  accentColor: string;
  accentSoft: string;
  status: AgentStatus;
  currentTask?: string;
  capabilities: string[];
  systemPrompt: string;
  mapPosition: [number, number]; // normalized image coordinates where the coworker stands
}

export const OFFICE_AGENTS: OfficeAgent[] = [
  {
    id: 'research-analyst',
    name: 'Research Analyst',
    role: 'Research & Insights',
    department: 'agents',
    description: 'Finds insights, analyzes patterns, and summarizes complex information with rigor.',
    avatar: analystImg,
    accentColor: '#2563eb', // Blue
    accentSoft: 'rgba(37, 99, 235, 0.15)',
    status: 'idle',
    capabilities: ['Deep research', 'Competitor analysis', 'Document synthesis', 'Pattern detection'],
    systemPrompt:
      'You are Axon’s Research Analyst. Your focus is deep research, synthesizing disparate information, analyzing market and technical documents, comparing alternatives, and extracting actionable findings with clear citations and structured reasoning.',
    mapPosition: [0.411, 0.464]
  },
  {
    id: 'writer',
    name: 'Writer',
    role: 'Writing & Editorial',
    department: 'agents',
    description: 'Drafts, rewrites, refines tone, and polishes briefs, articles, and documentation.',
    avatar: writerImg,
    accentColor: '#8b5cf6', // Purple
    accentSoft: 'rgba(139, 92, 246, 0.15)',
    status: 'idle',
    capabilities: ['Executive briefs', 'Technical writing', 'Copywriting', 'Tone adaptation'],
    systemPrompt:
      'You are Axon’s Writer. You craft crisp, persuasive, and clear prose. You adapt tone from technical precision to executive brevity, remove fluff, and communicate ideas with elegance.',
    mapPosition: [0.375, 0.557]
  },
  {
    id: 'designer',
    name: 'Designer',
    role: 'Product & UX Design',
    department: 'agents',
    description: 'Shapes user journeys, product visual systems, layouts, and UX architecture.',
    avatar: designerImg,
    accentColor: '#ec4899', // Pink / Violet
    accentSoft: 'rgba(236, 72, 153, 0.15)',
    status: 'idle',
    capabilities: ['UX architecture', 'Design systems', 'Layout strategy', 'User flow design'],
    systemPrompt:
      'You are Axon’s Product & UX Designer. You analyze user flows, critique interface designs, recommend clean layout patterns, and balance visual polish with usability.',
    mapPosition: [0.592, 0.639]
  },
  {
    id: 'product-coach',
    name: 'Product Coach',
    role: 'Product Strategy & Roadmaps',
    department: 'workspaces',
    description: 'Breaks complex visions into actionable PRDs, milestone roadmaps, and requirements.',
    avatar: productCoachImg,
    accentColor: '#f97316', // Orange
    accentSoft: 'rgba(249, 115, 22, 0.15)',
    status: 'idle',
    capabilities: ['PRD creation', 'Sprint planning', 'Tradeoff evaluation', 'Feature prioritization'],
    systemPrompt:
      'You are Axon’s Product Coach. You help founders and teams turn messy ideas into structured requirements, user stories, milestone roadmaps, and crisp decision frameworks.',
    mapPosition: [0.457, 0.189]
  },
  {
    id: 'knowledge-librarian',
    name: 'Knowledge Librarian',
    role: 'Knowledge & Research',
    department: 'knowledge',
    description: 'Organizes references, retrieves relevant passages, and explains domain knowledge.',
    avatar: librarianImg,
    accentColor: '#0d9488', // Teal
    accentSoft: 'rgba(13, 148, 136, 0.15)',
    status: 'idle',
    capabilities: ['Knowledge indexing', 'Citation finding', 'Domain synthesis', 'Semantic retrieval'],
    systemPrompt:
      'You are Axon’s Knowledge Librarian. You organize, search, and extract high-signal knowledge from project documentation, research papers, and uploaded files with pinpoint accuracy.',
    mapPosition: [0.672, 0.292]
  },
  {
    id: 'files-agent',
    name: 'Files Agent',
    role: 'Files & Assets',
    department: 'files',
    description: 'Manages project file context, organizes attachments, and extracts structured data.',
    avatar: filesImg,
    accentColor: '#10b981', // Green
    accentSoft: 'rgba(16, 185, 129, 0.15)',
    status: 'idle',
    capabilities: ['File navigation', 'Attachment context', 'Document audit', 'Format extraction'],
    systemPrompt:
      'You are Axon’s Files Agent. You inspect project structures, verify file contents, assist with file organization, and extract structured takeaways from multi-format attachments.',
    mapPosition: [0.844, 0.357]
  },
  {
    id: 'marketing-strategist',
    name: 'Marketing Strategist',
    role: 'Marketing & Positioning',
    department: 'agents',
    description: 'Designs go-to-market strategies, positioning messaging, and campaign narratives.',
    avatar: marketingImg,
    accentColor: '#eab308', // Yellow
    accentSoft: 'rgba(234, 179, 8, 0.15)',
    status: 'idle',
    capabilities: ['GTM strategy', 'Positioning frameworks', 'Value propositions', 'Campaign design'],
    systemPrompt:
      'You are Axon’s Marketing Strategist. You specialize in positioning, defining target audiences, crafting compelling value propositions, and planning go-to-market rollouts.',
    mapPosition: [0.28, 0.171]
  },
  {
    id: 'ops-coordinator',
    name: 'Ops Coordinator',
    role: 'Operations & Execution',
    department: 'files',
    description: 'Coordinates cross-functional workflows, operational checklists, and timelines.',
    avatar: opsImg,
    accentColor: '#64748b', // Blue-Gray
    accentSoft: 'rgba(100, 116, 139, 0.15)',
    status: 'idle',
    capabilities: ['Workflow tracking', 'Operational checklists', 'Timeline coordination', 'Blocker triage'],
    systemPrompt:
      'You are Axon’s Ops Coordinator. You keep tasks on schedule, break multi-step projects into verifiable checklist items, identify dependencies, and ensure operational excellence.',
    mapPosition: [0.628, 0.525]
  }
];
