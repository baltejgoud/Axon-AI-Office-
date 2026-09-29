import { create } from 'zustand';
import { OFFICE_AGENTS, type AgentStatus } from '../data/officeAgents';
import type { HandedFile } from '../activity/fileContext';
import type { FocusTarget, TaskItem } from '../../../../../shared/types';
import type { Briefing } from '../../../../../shared/planner';
import { statusesFromTasks, type Team } from '../tasks';
import { DEFAULT_WORK_SPLIT, clampWorkSplit } from '../workspace/work';

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

/** What the coworker's panel shows under their name: the conversation, or one of their tools. */
export type PanelTab = 'chat' | 'planner' | 'files' | 'updates';
/** The Files Agent opens on the folder wall; everyone else on the conversation. */
export const defaultTab = (agentId: string): PanelTab => (agentId === 'files-agent' ? 'files' : 'chat');

interface OfficeStoreState {
  /** A department picked from "Go to department…"; the team strip shows it until another choice. */
  focusDepartment: string | null;
  setFocusDepartment: (department: string | null) => void;
  selectedAgentId: string;
  agentRuntime: Record<string, AgentRuntime>;
  is3dEnabled: boolean;
  overlay: Overlay | null;
  /** The Settings section to open at, when something asked for one (the avatar opens Accounts). */
  settingsSection: string | null;

  selectAgent: (id: string) => void;
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  /** Everyone with a task record looks the way their newest work record says. */
  syncTaskStatuses: (tasks: readonly TaskItem[]) => void;
  setAgentTask: (agentId: string, task: string) => void;
  setAgentConversation: (agentId: string, conversationId: string) => void;
  setLastResponse: (agentId: string, text: string) => void;
  pushActivity: (agentId: string, activity: Omit<AgentActivity, 'id' | 'timestamp' | 'agentId'>) => void;
  toggle3d: () => void;
  openOverlay: (overlay: Overlay | null, settingsSection?: string) => void;
  /** Files handed to each coworker from the Files room, waiting in their message box. */
  pendingFiles: Record<string, HandedFile[]>;
  handFiles: (agentId: string, files: HandedFile[]) => void;
  removeFile: (agentId: string, path: string) => void;
  clearFiles: (agentId: string) => void;
  /** A team's task list open in the side panel, from its board. */
  teamBoard: Team | null;
  openTeamBoard: (team: Team | null) => void;
  /** Ask the office to select someone and glide the camera to them. */
  flyTo: { agentId: string; at: number } | null;
  flyToAgent: (agentId: string) => void;
  startFresh: (agentId: string) => void;
  /** The morning briefing, at the top of the receptionist's thread until dismissed. */
  briefing: Briefing | null;
  setBriefing: (briefing: Briefing | null) => void;
  /** The panel's tab. Picking someone else goes back to their first tab. */
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  /** Goes where a notification, the tray or the Today board points: someone, their thread, the planner. */
  focusOn: (target: FocusTarget) => void;
  /**
   * The office's share of the left side while a work surface is open below it. Starts at 60/40 and
   * keeps whatever the user drags it to, for this session, across tabs and coworkers.
   */
  workSplit: number;
  setWorkSplit: (share: number) => void;
  /** The divider is being dragged: the office draws more cheaply until it is let go. */
  resizingWork: boolean;
  setResizingWork: (resizing: boolean) => void;
  /**
   * The user opened or closed a conversation's work surface during one of its runs (a run is keyed
   * by when it started). The choice holds for that run; the next run opens by itself again.
   */
  workChoice: Record<string, { open: boolean; run: string }>;
  setWorkChoice: (conversationId: string, open: boolean, run: string) => void;
  /** Something asked the work surface to show one step: a file or command in the side panel. */
  workFocus: { conversationId: string; stepId: string; at: number } | null;
  focusWork: (conversationId: string, stepId: string) => void;
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
  settingsSection: null,
  pendingFiles: {},
  flyTo: null,
  teamBoard: null,
  openTeamBoard: (team) => set({ teamBoard: team }),
  briefing: null,
  setBriefing: (briefing) => set({ briefing }),
  panelTab: 'chat',
  setPanelTab: (tab) => set({ panelTab: tab }),
  focusOn: (target) => {
    get().flyToAgent(target.agentId);
    if (target.conversationId) get().setAgentConversation(target.agentId, target.conversationId);
    if (target.planner) set({ panelTab: 'planner' });
  },
  workSplit: DEFAULT_WORK_SPLIT,
  setWorkSplit: (share) => set({ workSplit: clampWorkSplit(share) }),
  resizingWork: false,
  setResizingWork: (resizing) => set({ resizingWork: resizing }),
  workChoice: {},
  setWorkChoice: (conversationId, open, run) =>
    set({ workChoice: { ...get().workChoice, [conversationId]: { open, run } } }),
  workFocus: null,
  focusWork: (conversationId, stepId) => set({ workFocus: { conversationId, stepId, at: Date.now() } }),

  selectAgent: (id: string) => {
    const agent = OFFICE_AGENTS.find((a) => a.id === id);
    if (!agent) return;
    set({
      selectedAgentId: id,
      teamBoard: null,
      ...(id !== get().selectedAgentId && { panelTab: defaultTab(id) })
    });
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

  syncTaskStatuses: (tasks) => {
    const runtime = { ...get().agentRuntime };
    let changed = false;
    for (const [id, status] of Object.entries(statusesFromTasks(tasks))) {
      const current = runtime[id];
      if (!current || current.status === status) continue;
      runtime[id] = { ...current, status };
      changed = true;
    }
    if (changed) set({ agentRuntime: runtime });
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

  openOverlay: (overlay, settingsSection) => set({ overlay, settingsSection: settingsSection ?? null }),

  handFiles: (agentId, files) => {
    const current = get().pendingFiles[agentId] ?? [];
    const merged = [...current.filter((file) => !files.some((next) => next.path === file.path)), ...files];
    set({ pendingFiles: { ...get().pendingFiles, [agentId]: merged.slice(-5) } });
  },
  removeFile: (agentId, path) =>
    set({
      pendingFiles: {
        ...get().pendingFiles,
        [agentId]: (get().pendingFiles[agentId] ?? []).filter((file) => file.path !== path)
      }
    }),
  clearFiles: (agentId) => set({ pendingFiles: { ...get().pendingFiles, [agentId]: [] } }),
  flyToAgent: (agentId) =>
    set({
      selectedAgentId: agentId,
      flyTo: { agentId, at: Date.now() },
      teamBoard: null,
      ...(agentId !== get().selectedAgentId && { panelTab: defaultTab(agentId) })
    }),

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
