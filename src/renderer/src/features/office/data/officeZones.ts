export interface OfficeZone {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  primaryAgentId?: string;
}

export const OFFICE_ZONES: OfficeZone[] = [
  {
    id: 'chat',
    name: 'Lounge',
    subtitle: 'Talk, ask, think.',
    color: '#3b82f6',
    primaryAgentId: 'marketing-strategist'
  },
  {
    id: 'workspaces',
    name: 'Planning',
    subtitle: 'Plan. Build. Collaborate.',
    color: '#8b5cf6',
    primaryAgentId: 'product-coach'
  },
  {
    id: 'cafe',
    name: 'Café & Lounge',
    subtitle: 'Take a break, recharge.',
    color: '#f59e0b'
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    subtitle: 'Find. Learn. Apply.',
    color: '#0d9488',
    primaryAgentId: 'knowledge-librarian'
  },
  {
    id: 'agents',
    name: 'Specialists',
    subtitle: 'Your specialized AI team.',
    color: '#2563eb',
    primaryAgentId: 'frontend-developer'
  },
  {
    id: 'files',
    name: 'Files',
    subtitle: 'Organize. Process. Share.',
    color: '#10b981',
    primaryAgentId: 'files-agent'
  }
];
