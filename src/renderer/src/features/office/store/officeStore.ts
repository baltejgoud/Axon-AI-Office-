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

export type Overlay = 'settings' | 'knowledge' | 'company';

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
   * Legacy share value for the floating sheet: its height is 1 - workSplit. Starts at 40% height
   * and remembers resizing across tabs and coworkers without changing the canvas size.
   */
  workSplit: number;
  setWorkSplit: (share: number) => void;
  /** The sheet's top edge is being dragged. */
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
  /** A suggestion was picked in an empty chat: its text for that coworker's message box, until the box takes it. */
  composeRequest: { agentId: string; text: string } | null;
  compose: (agentId: string, text: string) => void;
  clearCompose: () => void;
  /** Messages sent while a conversation's run was going, by conversation, until the run reads them. */
  queued: Record<string, string[]>;
  setQueued: (conversationId: string, messages: string[]) => void;

  // ---------------------------------------------------------------- office-first overlays
  /** Level 2: the selected coworker's small card, pinned over them in the office. */
  navigationRequest: { department?: string; overview?: boolean; at: number } | null;
  navigateOffice: (target: { department?: string; overview?: boolean }) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  activityHistoryOpen: boolean;
  setActivityHistoryOpen: (open: boolean) => void;
  plannerOpen: boolean;
  setPlannerOpen: (open: boolean) => void;
  workFullscreen: boolean;
  setWorkFullscreen: (fullscreen: boolean) => void;
  coworkerCard: boolean;
  /** Level 3: the conversation drawer (the coworker's panel) slid in over the office. */
  conversationOpen: boolean;
  /** The coworker strip at the bottom is folded down to its caption. */
  dockCollapsed: boolean;
  /** Only the office and the top bar: every other card steps aside. */
  focusMode: boolean;
  closeCoworkerCard: () => void;
  /** Opens the drawer for the selected coworker, on `tab` if given. */
  openConversation: (tab?: PanelTab) => void;
  closeConversation: () => void;
  setDockCollapsed: (collapsed: boolean) => void;
  setFocusMode: (focus: boolean) => void;
}

const DOCK_KEY = 'axon.office.dock';
const readDockCollapsed = () => {
  try {
    return localStorage.getItem(DOCK_KEY) === 'collapsed';
  } catch {
    return false;
  }
};

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
  // A board's task list shows in the drawer; closing the list leaves the drawer to the coworker.
  openTeamBoard: (team) =>
    set(team ? { teamBoard: team, conversationOpen: true, coworkerCard: false } : { teamBoard: null }),
  briefing: null,
  setBriefing: (briefing) => set({ briefing }),
  panelTab: 'chat',
  setPanelTab: (tab) => set({ panelTab: tab }),
  // A notification, the tray, a run or the waiting pill points at a thread: straight to the drawer.
  focusOn: (target) => {
    get().flyToAgent(target.agentId);
    if (target.conversationId) get().setAgentConversation(target.agentId, target.conversationId);
    set({ conversationOpen: true, coworkerCard: false, ...(target.planner && { panelTab: 'planner' }) });
  },
  navigationRequest: null,
  navigateOffice: (target) => set({ navigationRequest: { ...target, at: Date.now() } }),
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  activityHistoryOpen: false,
  setActivityHistoryOpen: (open) => set({ activityHistoryOpen: open, ...(open && { coworkerCard: false }) }),
  plannerOpen: false,
  setPlannerOpen: (open) =>
    set({ plannerOpen: open, ...(open && { activityHistoryOpen: false, coworkerCard: false }) }),
  workFullscreen: false,
  setWorkFullscreen: (fullscreen) =>
    set({ workFullscreen: fullscreen, ...(fullscreen && { activityHistoryOpen: false }) }),
  coworkerCard: false,
  conversationOpen: false,
  dockCollapsed: readDockCollapsed(),
  focusMode: false,
  closeCoworkerCard: () => set({ coworkerCard: false }),
  openConversation: (tab) =>
    set({ conversationOpen: true, coworkerCard: false, teamBoard: null, ...(tab && { panelTab: tab }) }),
  closeConversation: () => set({ conversationOpen: false, teamBoard: null }),
  setDockCollapsed: (collapsed) => {
    try {
      localStorage.setItem(DOCK_KEY, collapsed ? 'collapsed' : 'open');
    } catch {
      // Blocked storage: the choice lasts for this session.
    }
    set({ dockCollapsed: collapsed });
  },
  setFocusMode: (focus) => set({ focusMode: focus, ...(focus && { activityHistoryOpen: false }) }),
  workSplit: DEFAULT_WORK_SPLIT,
  setWorkSplit: (share) => set({ workSplit: clampWorkSplit(share) }),
  resizingWork: false,
  setResizingWork: (resizing) => set({ resizingWork: resizing }),
  workChoice: {},
  setWorkChoice: (conversationId, open, run) =>
    set({ workChoice: { ...get().workChoice, [conversationId]: { open, run } } }),
  workFocus: null,
  focusWork: (conversationId, stepId) => set({ workFocus: { conversationId, stepId, at: Date.now() } }),
  composeRequest: null,
  compose: (agentId, text) => set({ composeRequest: { agentId, text } }),
  clearCompose: () => set({ composeRequest: null }),
  queued: {},
  setQueued: (conversationId, messages) => set({ queued: { ...get().queued, [conversationId]: messages } }),

  // Picking someone shows their card; with the drawer already open, the drawer follows them instead.
  selectAgent: (id: string) => {
    const agent = OFFICE_AGENTS.find((a) => a.id === id);
    if (!agent) return;
    set({
      selectedAgentId: id,
      activityHistoryOpen: false,
      focusDepartment: get().focusDepartment === agent.department ? get().focusDepartment : null,
      teamBoard: null,
      coworkerCard: !get().conversationOpen,
      ...(id !== get().selectedAgentId && { panelTab: defaultTab(id) })
    });
  },

  setAgentStatus: (agentId: string, status: AgentStatus) => {
    const current = get().agentRuntime[agentId];
    if (!current || current.status === status) return;
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

  openOverlay: (overlay, settingsSection) =>
    set({
      overlay,
      settingsSection: settingsSection ?? null,
      ...(overlay && { coworkerCard: false, commandPaletteOpen: false })
    }),

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
      activityHistoryOpen: false,
      focusDepartment:
        get().focusDepartment === OFFICE_AGENTS.find((a) => a.id === agentId)?.department
          ? get().focusDepartment
          : null,
      flyTo: { agentId, at: Date.now() },
      teamBoard: null,
      coworkerCard: !get().conversationOpen,
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
