import { create } from 'zustand';
import { OFFICE_AGENTS, type AgentStatus } from '../data/officeAgents';

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
  /** The user asked for a new conversation; the next task starts one. */
  fresh?: boolean;
  activities: AgentActivity[];
}

export type Overlay = 'settings' | 'knowledge';

interface OfficeStoreState {
  /** A department picked from "Go to department…"; the team strip shows it until another choice. */
  focusDepartment: string | null;
  setFocusDepartment: (department: string | null) => void;
  selectedAgentId: string;
  agentRuntime: Record<string, AgentRuntime>;
  is3dEnabled: boolean;
  overlay: Overlay | null;

  selectAgent: (id: string) => void;
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  setAgentTask: (agentId: string, task: string) => void;
  setAgentConversation: (agentId: string, conversationId: string) => void;
  setLastResponse: (agentId: string, text: string) => void;
  pushActivity: (agentId: string, activity: Omit<AgentActivity, 'id' | 'timestamp' | 'agentId'>) => void;
  toggle3d: () => void;
  openOverlay: (overlay: Overlay | null) => void;
  startFresh: (agentId: string) => void;
}

const initialRuntime: Record<string, AgentRuntime> = {};
for (const agent of OFFICE_AGENTS) {
  initialRuntime[agent.id] = {
    status: 'idle',
    activities: []
  };
}

export const useOfficeStore = create<OfficeStoreState>((set, get) => ({
  focusDepartment: null,
  setFocusDepartment: (department) => set({ focusDepartment: department }),
  selectedAgentId: 'frontend-developer',
  agentRuntime: initialRuntime,
  is3dEnabled: true,
  overlay: null,

  selectAgent: (id: string) => {
    const agent = OFFICE_AGENTS.find((a) => a.id === id);
    if (!agent) return;
    set({ selectedAgentId: id });
  },

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
        [agentId]: { ...current, conversationId, fresh: false }
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

  toggle3d: () => set({ is3dEnabled: !get().is3dEnabled }),

  openOverlay: (overlay) => set({ overlay }),

  startFresh: (agentId: string) => {
    const current = get().agentRuntime[agentId];
    if (!current) return;
    set({
      agentRuntime: {
        ...get().agentRuntime,
        [agentId]: {
          ...current,
          conversationId: undefined,
          fresh: true,
          currentTask: undefined,
          lastResponse: undefined,
          status: 'idle'
        }
      }
    });
  }
}));
