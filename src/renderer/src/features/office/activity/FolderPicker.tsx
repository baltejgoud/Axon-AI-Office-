import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../../state';
import { IconCaretDown, IconCheck, IconFolder, IconFolderPlus } from '../../../ui';
import { baseName } from '../workspace/work';

const samePath = (a: string, b: string) =>
  a.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase() === b.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();

/**
 * The folder a coworker works in, right in the message box: the open folder, and a list of the ones
 * you have opened before (the Files room's wall) to switch to, plus a way to choose a new one.
 */
export function FolderPicker({ folder, disabled = false }: { folder: string | null; disabled?: boolean }) {
  const patch = useApp((s) => s.patch);
  const [open, setOpen] = useState(false);
  const [wall, setWall] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [place, setPlace] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    let live = true;
    window.axon
      .projectRecent()
      .then((list) => live && setWall(list))
      .catch(() => live && setWall([]));
    return () => {
      live = false;
    };
  }, [open]);

  // Sits above the button (the composer is at the bottom of the window), inside the window.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const measure = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 16);
      setPlace({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - rect.top + 8,
        width
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!popover.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  /** Runs a folder change, then reloads so the chip and the coworker's tools follow it. */
  const change = async (task: () => Promise<string | null>) => {
    setBusy(true);
    try {
      const chosen = await task();
      if (chosen) await useApp.getState().refresh();
      close(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : 'Could not change the folder.';
      patch({ error: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`composer-folder ${folder ? 'is-set' : 'is-none'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={folder ? `They can read and change files in ${folder}. Click to change the folder.` : 'Choose a folder for them to work in'}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        <IconFolder size={12} />
        <span>{folder ? baseName(folder) : 'Open a project'}</span>
        <IconCaretDown size={10} />
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={popover}
            role="menu"
            aria-label="Working folder"
            className="model-picker-pop folder-picker-pop"
            style={{ left: place.left, bottom: place.bottom, width: place.width }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          >
            <div className="model-picker-list">
              <div className="model-picker-group" role="presentation">
                <span>Your folders</span>
              </div>
              {wall.map((path) => {
                const current = folder !== null && samePath(path, folder);
                return (
                  <button
                    key={path}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    className="model-picker-option folder-picker-option"
                    title={path}
                    disabled={busy}
                    onClick={() => (current ? close() : void change(() => window.axon.projectOpen(path)))}
                  >
                    <IconFolder size={14} />
                    <span className="model-picker-option-name">{baseName(path)}</span>
                    {current && <IconCheck size={13} />}
                  </button>
                );
              })}
              {!wall.length && <div className="model-picker-empty">No folders opened yet.</div>}
            </div>
            <button
              type="button"
              role="menuitem"
              className="model-picker-manage"
              disabled={busy}
              onClick={() => void change(() => window.axon.projectChoose())}
            >
              <IconFolderPlus size={14} />
              {busy ? 'Opening…' : 'Open another folder…'}
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
