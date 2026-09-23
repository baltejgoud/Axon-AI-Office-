export interface OfficeZone {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  mapPosition: [number, number]; // normalized image coordinates at the zone center
  primaryAgentId?: string;
}

export const OFFICE_ZONES: OfficeZone[] = [
  {
    id: 'chat',
    name: 'Chat',
    subtitle: 'Talk, ask, think.',
    color: '#3b82f6',
    mapPosition: [0.26, 0.08],
    primaryAgentId: 'marketing-strategist'
  },
  {
    id: 'workspaces',
    name: 'Workspaces',
    subtitle: 'Plan. Build. Collaborate.',
    color: '#8b5cf6',
    mapPosition: [0.47, 0.09],
    primaryAgentId: 'product-coach'
  },
  {
    id: 'cafe',
    name: 'Café & Lounge',
    subtitle: 'Take a break, recharge.',
    color: '#f59e0b',
    mapPosition: [0.80, 0.57]
  },
  {
    id: 'knowledge',
    name: 'Knowledge',
    subtitle: 'Find. Learn. Apply.',
    color: '#0d9488',
    mapPosition: [0.68, 0.18],
    primaryAgentId: 'knowledge-librarian'
  },
  {
    id: 'agents',
    name: 'Agents',
    subtitle: 'Your specialized AI team.',
    color: '#2563eb',
    mapPosition: [0.47, 0.37],
    primaryAgentId: 'research-analyst'
  },
  {
    id: 'files',
    name: 'Files',
    subtitle: 'Organize. Process. Share.',
    color: '#10b981',
    mapPosition: [0.86, 0.245],
    primaryAgentId: 'files-agent'
  }
];
