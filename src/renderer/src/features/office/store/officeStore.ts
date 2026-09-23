import { create } from 'zustand';
import { OFFICE_AGENTS, agentsForWing, type AgentStatus } from '../data/officeAgents';

export interface AgentActivity {
  id: string;
  agentId: string;
  timestamp: number;
  type: 'task_assigned' | 'started' | 'streaming' | 'message' | 'file' | 'knowledge' | 'completed' | 'error';
  title: string;
  detail?: string;
}

export interface AgentRuntime {
  status: AgentStatus;
  currentTask?: string;
  conversationId?: string;
  lastResponse?: string;
  activities: AgentActivity[];
}

interface OfficeStoreState {
  activeWing: string;
  setWing: (wing: string) => void;
  selectedAgentId: string;
  focusedZoneId: string | null;
  agentRuntime: Record<string, AgentRuntime>;
  is3dEnabled: boolean;

  selectAgent: (id: string) => void;
  focusZone: (zoneId: string | null) => void;
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  setAgentTask: (agentId: string, task: string) => void;
  setAgentConversation: (agentId: string, conversationId: string) => void;
  setLastResponse: (agentId: string, text: string) => void;
  pushActivity: (agentId: string, activity: Omit<AgentActivity, 'id' | 'timestamp' | 'agentId'>) => void;
  toggle3d: () => void;
}

const initialRuntime: Record<string, AgentRuntime> = {};
for (const agent of OFFICE_AGENTS) {
  initialRuntime[agent.id] = {
    status: 'idle',
    activities: []
  };
}

export const useOfficeStore = create<OfficeStoreState>((set, get) => ({
  activeWing: 'Headquarters',
  setWing: (wing) => {
    const agents = agentsForWing(wing);
    const selected = agents.some((a) => a.id === get().selectedAgentId)
      ? get().selectedAgentId
      : (agents.find((a) => a.wing)?.id ?? agents[0].id);
    set({ activeWing: wing, selectedAgentId: selected, focusedZoneId: null });
  },
  selectedAgentId: 'frontend-developer',
  focusedZoneId: 'agents',
  agentRuntime: initialRuntime,
  is3dEnabled: true,

  selectAgent: (id: string) => {
    const agent = OFFICE_AGENTS.find((a) => a.id === id);
    if (!agent) return;
    set({
      activeWing: agentsForWing(get().activeWing).some((a) => a.id === id)
        ? get().activeWing
        : (agent.wing ?? 'Headquarters'),
      selectedAgentId: id,
      focusedZoneId: agent.department
    });
  },

  focusZone: (zoneId: string | null) => set({ focusedZoneId: zoneId }),

  setAgentStatus: (agentId: string, status: AgentStatus) => {
    const current = get().agentRuntime[agentId];
    if (!current) return;
    set({
      agentRuntime: {
        ...get().agentRuntime,
        [agentId]: { ...current, status }
      }
    });
  },

  setAgentTask: (agentId: string, task: string) => {
    const current = get().agentRuntime[agentId];
    if (!current) return;
    set({
      agentRuntime: {
        ...get().agentRuntime,
        [agentId]: { ...current, currentTask: task }
      }
    });
  },

  setAgentConversation: (agentId: string, conversationId: string) => {
    const current = get().agentRuntime[agentId];
    if (!current) return;
    set({
      agentRuntime: {
        ...get().agentRuntime,
        [agentId]: { ...current, conversationId }
      }
    });
  },

  setLastResponse: (agentId: string, text: string) => {
    const current = get().agentRuntime[agentId];
    if (!current) return;
    set({
      agentRuntime: {
        ...get().agentRuntime,
        [agentId]: { ...current, lastResponse: text }
      }
    });
  },

  pushActivity: (agentId: string, activity) => {
    const current = get().agentRuntime[agentId];
    if (!current) return;
    const newEntry: AgentActivity = {
      ...activity,
      id: crypto.randomUUID(),
      agentId,
      timestamp: Date.now()
    };
    set({
      agentRuntime: {
        ...get().agentRuntime,
        [agentId]: {
          ...current,
          activities: [newEntry, ...current.activities].slice(0, 30)
        }
      }
    });
  },

  toggle3d: () => set({ is3dEnabled: !get().is3dEnabled })
}));
