import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { perform, useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { useEscape } from '../../../ui/escape';
import {
  AxonLogo,
  Button,
  IconCheck,
  IconClose,
  IconFolderOpen,
  IconShieldAlert,
  IconSparkle,
  Kbd
} from '../../../ui';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { AgentPortrait } from '../AgentPortrait';
import { RECEPTIONIST_ID } from '../../../../../shared/coworkers';
import './welcome.css';

/** First tasks that need no folder and show what a coworker does: written into the message box for you to send. */
export const FIRST_TASKS = [
  {
    agentId: RECEPTIONIST_ID,
    label: 'Plan my day',
    prompt: 'Help me plan today. Ask me what is on my plate, then put the tasks in my planner with times.'
  },
  {
    agentId: 'research-analyst',
    label: 'Research a question',
    prompt:
      'Compare three popular project management tools for a team of five: price, strengths and weaknesses, in a short table with your recommendation.'
  },
  {
    agentId: 'marketing-strategist',
    label: 'Draft a launch email',
    prompt: 'Draft a short launch email for a new product. Ask me two questions about the product first.'
  }
] as const;

/**
 * Whether this is someone's first start: no model connected, nothing asked yet, and the guide not
 * finished before. Anyone further along can still open it from Ctrl+K.
 */
export function firstStart(
  data: {
    settings: { welcomeDone?: boolean };
    conversations: unknown[];
    providers: { enabled: boolean; models: unknown[] }[];
  } | null
): boolean {
  return (
    !!data &&
    !data.settings.welcomeDone &&
    data.conversations.length === 0 &&
    !data.providers.some((p) => p.enabled && p.models.length > 0)
  );
}

/**
 * The welcome guide: three steps to a first result (a model, optionally a folder, a first task), each
 * ticked off as it's done, and what approvals are before the first one appears. It opens on a first
 * start and from Ctrl+K ("Show the welcome guide"); closing it in any way counts as done.
 */
export function WelcomeGuide() {
  const open = useOfficeStore((s) => s.welcomeOpen);
  const overlay = useOfficeStore((s) => s.overlay);
  // Settings opened from a step goes over the guide; the guide is back when Settings closes.
  return open && !overlay ? <Guide /> : null;
}

function Guide() {
  const data = useApp((s) => s.data);
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const modelReady = !!data?.providers.some((p) => p.enabled && p.models.length > 0);
  const folder = data?.projectRoot ?? null;
  const finish = () => {
    useOfficeStore.getState().setWelcomeOpen(false);
    const settings = useApp.getState().data?.settings;
    if (settings && !settings.welcomeDone)
      void perform(() => window.axon.settingsSave({ ...settings, welcomeDone: true }));
  };
  useEscape(finish);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('.welcome-step:not(.done) button, button')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const office = useOfficeStore.getState();
  const start = (task: (typeof FIRST_TASKS)[number]) => {
    finish();
    office.focusOn({ agentId: task.agentId });
    office.setPanelTab('chat');
    office.startFresh(task.agentId);
    office.compose(task.agentId, task.prompt);
  };
  const folderName = folder?.split(/[\\/]/).filter(Boolean).at(-1);

  return createPortal(
    <div
      className="overlay-backdrop welcome-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && finish()}
    >
      <div ref={root} className="welcome-guide" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="welcome-head">
          <span className="welcome-logo">
            <AxonLogo size={26} />
          </span>
          <div>
            <h2 id={titleId}>Welcome to Axon</h2>
            <p>An office of AI coworkers. Three steps to your first result.</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={IconClose}
            iconOnly
            aria-label="Close the welcome guide"
            onClick={finish}
          />
        </header>

        <ol className="welcome-steps">
          <li className={`welcome-step${modelReady ? ' done' : ''}`}>
            <span className="welcome-check" aria-hidden="true">
              {modelReady ? <IconCheck size={14} /> : '1'}
            </span>
            <div>
              <strong>Connect a model</strong>
              <p>
                {modelReady
                  ? 'Connected. Your coworkers can think and write.'
                  : 'Coworkers think with a model you bring: sign in with ChatGPT, or add a Claude Console or other API key.'}
              </p>
            </div>
            {!modelReady && (
              <Button
                variant="primary"
                size="sm"
                icon={IconSparkle}
                onClick={() => office.openOverlay('settings', 'accounts')}
              >
                Connect a model
              </Button>
            )}
          </li>
          <li className={`welcome-step${folder ? ' done' : ''}`}>
            <span className="welcome-check" aria-hidden="true">
              {folder ? <IconCheck size={14} /> : '2'}
            </span>
            <div>
              <strong>
                Choose a project folder <span className="welcome-optional">optional</span>
              </strong>
              <p>
                {folder
                  ? `Working in ${folderName}. Coworkers read and save files only inside it.`
                  : 'Coworkers read and save files only inside the folder you choose. Skip this for research and writing.'}
              </p>
            </div>
            {!folder && (
              <Button
                size="sm"
                icon={IconFolderOpen}
                onClick={() => void perform(() => window.axon.projectChoose())}
              >
                Choose folder…
              </Button>
            )}
          </li>
          <li className="welcome-step">
            <span className="welcome-check" aria-hidden="true">
              3
            </span>
            <div>
              <strong>Give someone a first task</strong>
              <p>
                {modelReady
                  ? 'Pick one: it goes into their message box for you to read, change and send.'
                  : 'Once a model is connected, pick one of these to try.'}
              </p>
              <div className="welcome-tasks" role="group" aria-label="First tasks">
                {FIRST_TASKS.map((task) => {
                  const agent = OFFICE_AGENTS.find((a) => a.id === task.agentId);
                  if (!agent) return null;
                  return (
                    <button
                      key={task.label}
                      type="button"
                      className="welcome-task"
                      disabled={!modelReady}
                      title={task.prompt}
                      onClick={() => start(task)}
                    >
                      <AgentPortrait agent={agent} className="welcome-task-portrait" />
                      <span>
                        <strong>{task.label}</strong>
                        <small>{agent.name}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </li>
        </ol>

        <aside className="welcome-note">
          <IconShieldAlert size={16} />
          <p>
            <strong>Nothing changes without you.</strong> Before a coworker saves a file or runs a command, a
            “Needs your OK” card asks first, and waits until you answer. Saved changes can be undone
            afterwards.
          </p>
        </aside>

        <footer className="welcome-foot">
          <span>
            <Kbd keys="Mod+K" /> finds anyone, any past conversation, or any action.
          </span>
          <Button variant="ghost" onClick={finish}>
            {modelReady ? 'Done' : 'Skip for now'}
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
