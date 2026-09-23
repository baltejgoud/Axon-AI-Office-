import './files.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HandHelping,
  Search,
  X
} from 'lucide-react';
import { districtById } from '../campus/districts';
import { OFFICE_AGENTS } from '../data/officeAgents';
import { useOfficeStore } from '../store/officeStore';
import { searchCoworkers } from '../shell/search';
import { AgentPortrait } from '../AgentPortrait';
import { useApp } from '../../../state';
import { useEscape } from '../../../ui/escape';
import type { HandedFile } from './fileContext';

/** Most files handed over at once; the message box holds five. */
const MAX_FILES = 5;
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/**
 * The Files room: a wall of the folders you have opened. Open one, tick the files you need and hand
 * them to anyone in the office; they land in that person's message box, ready for your task.
 */
export function FilesPanel() {
  const [wall, setWall] = useState<string[]>([]);
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; folder?: string } | null>(null);
  const [picking, setPicking] = useState(false);

  const refreshWall = async () => setWall(await window.axon.projectRecent());
  useEffect(() => {
    void refreshWall();
  }, []);

  const show = async (chosen: string | null) => {
    if (!chosen) return;
    setRoot(chosen);
    setFolder('');
    setPicked([]);
    setFiles((await window.axon.projectList()).map((file) => file.replaceAll('\\', '/')));
    await refreshWall();
  };
  const run = async (task: () => Promise<void>, failedFolder?: string) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(err);
      setError({ message, folder: failedFolder });
    } finally {
      setBusy(false);
    }
  };

  const entries = useMemo(
    () => [
      ...new Set(
        files.filter((file) => file.startsWith(folder)).map((file) => file.slice(folder.length).split('/')[0])
      )
    ],
    [files, folder]
  );
  const isDirectory = (path: string) => files.some((file) => file.startsWith(`${path}/`));
  const toggle = (path: string) =>
    setPicked((list) =>
      list.includes(path)
        ? list.filter((item) => item !== path)
        : list.length < MAX_FILES
          ? [...list, path]
          : list
    );

  return (
    <section className="office-files-hub" aria-label="Files room">
      <div className="activity-section-heading">
        <FolderOpen size={15} />
        <h4>Folder wall</h4>
        <span className="activity-session-label">{wall.length ? `${wall.length} folders` : 'Empty'}</span>
      </div>
      <div className="office-folder-wall">
        {wall.map((path) => (
          <div key={path} className={`office-folder-cabinet ${root === path ? 'open' : ''}`}>
            <button
              title={path}
              disabled={busy}
              onClick={() => void run(async () => show(await window.axon.projectOpen(path)), path)}
            >
              <Folder size={18} />
              <span>{folderName(path)}</span>
            </button>
            <button
              className="office-folder-forget"
              aria-label={`Remove ${folderName(path)} from the wall`}
              title="Remove from the wall"
              onClick={() =>
                void run(async () => {
                  await window.axon.projectForget(path);
                  if (root === path) setRoot(null);
                  await refreshWall();
                })
              }
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button
          className="office-folder-cabinet add office-file-open"
          disabled={busy}
          onClick={() => void run(async () => show(await window.axon.projectChoose()))}
        >
          <FolderPlus size={18} />
          <span>{busy ? 'Opening…' : 'Open a folder'}</span>
        </button>
      </div>
      {error && (
        <p className="office-files-error" role="alert">
          {error.message}
          {error.folder && (
            <button
              onClick={() =>
                void run(async () => {
                  await window.axon.projectForget(error.folder!);
                  await refreshWall();
                })
              }
            >
              Remove from wall
            </button>
          )}
        </p>
      )}

      {root && (
        <div className="office-file-browser">
          <p className="office-file-root" title={root}>
            {folderName(root)}
            {folder && ` / ${folder.replace(/\/$/, '')}`}
          </p>
          {folder && (
            <button
              className="office-file-entry"
              onClick={() =>
                setFolder(
                  folder.split('/').slice(0, -2).join('/') + (folder.split('/').length > 2 ? '/' : '')
                )
              }
            >
              <ChevronLeft size={15} />
              Parent folder
            </button>
          )}
          <div className="office-file-list">
            {entries.map((name) => {
              const path = folder + name;
              if (isDirectory(path))
                return (
                  <button key={path} className="office-file-entry" onClick={() => setFolder(`${path}/`)}>
                    <Folder size={15} />
                    <span>{name}</span>
                  </button>
                );
              const chosen = picked.includes(path);
              return (
                <button
                  key={path}
                  className={`office-file-entry ${chosen ? 'picked' : ''}`}
                  role="checkbox"
                  aria-checked={chosen}
                  onClick={() => toggle(path)}
                >
                  <span className="office-file-check">{chosen && <Check size={12} />}</span>
                  <FileText size={15} />
                  <span>{name}</span>
                </button>
              );
            })}
            {!entries.length && <p className="office-files-empty">No readable files here.</p>}
          </div>
          <div className="office-file-actions">
            <span>{picked.length ? `${picked.length} of ${MAX_FILES} picked` : 'Tick up to five files'}</span>
            <div className="office-hand-anchor">
              <button
                className="office-hand-to"
                disabled={!picked.length || busy}
                onClick={() => setPicking(true)}
              >
                <HandHelping size={15} />
                Hand to…
              </button>
              {picking && (
                <HandToPicker
                  onClose={() => setPicking(false)}
                  onChoose={(agentId) =>
                    void run(async () => {
                      const handed: HandedFile[] = [];
                      for (const path of picked)
                        handed.push({ path, content: await window.axon.projectRead(path) });
                      const store = useOfficeStore.getState();
                      store.handFiles(agentId, handed);
                      store.flyToAgent(agentId);
                      setPicked([]);
                      setPicking(false);
                    })
                  }
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Choose who receives the files: search anyone, or pick someone you worked with recently. */
function HandToPicker({ onChoose, onClose }: { onChoose: (agentId: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const conversations = useApp((s) => s.data?.conversations);
  useEscape(onClose);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const recent = useMemo(() => {
    const ids = [...(conversations ?? [])]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => c.agentId)
      .filter((id): id is string => Boolean(id));
    const unique = [...new Set(ids)].slice(0, 6);
    const people = unique
      .map((id) => OFFICE_AGENTS.find((a) => a.id === id))
      .filter(Boolean) as typeof OFFICE_AGENTS;
    return people.length ? people : OFFICE_AGENTS.filter((a) => a.district === 'commons').slice(0, 6);
  }, [conversations]);
  const people = query.trim() ? searchCoworkers(query, OFFICE_AGENTS, 8) : recent;

  return (
    <div className="office-hand-picker" ref={root} role="dialog" aria-label="Hand files to">
      <label className="office-department-search">
        <Search size={15} />
        <input
          autoFocus
          aria-label="Find someone to hand the files to"
          placeholder="Hand to… (name or specialty)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && people[0]) onChoose(people[0].id);
          }}
        />
      </label>
      <div className="office-hand-list">
        {!query.trim() && <div className="office-department-heading">Recent</div>}
        {people.map((agent) => (
          <button key={agent.id} onClick={() => onChoose(agent.id)}>
            <AgentPortrait agent={agent} />
            <span>
              <strong>{agent.name}</strong>
              <small>
                {agent.department} · {districtById(agent.district).short}
              </small>
            </span>
          </button>
        ))}
        {!people.length && <p className="office-files-empty">No one matches “{query}”.</p>}
      </div>
    </div>
  );
}
