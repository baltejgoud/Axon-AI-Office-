import { useState } from 'react';
import { assign, servesRun } from '../../../../../shared/connectors';
import { useApp, perform } from '../../../state';
import { ConnectorMark } from '../../../settings/ConnectorsSection';
import { useEscape } from '../../../ui/escape';
import { useOfficeStore } from '../store/officeStore';
import { IconPlug } from '../../../ui';

/** Marks shown in the header before the rest are counted. */
const SHOWN = 3;

/** A coworker's connectors: their icons, and a popover to switch each connected one for them. */
export function ConnectorRow({ agent }: { agent: { id: string; name: string; department: string } }) {
  const servers = useApp((s) => s.data?.mcpServers ?? []);
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false), open);
  const run = { coworkerId: agent.id, department: agent.department };
  const mine = servers.filter((s) => s.enabled && servesRun(s.coworkers, run));
  return (
    <div className="activity-connectors">
      <button
        type="button"
        className="activity-connectors-row"
        aria-expanded={open}
        aria-label={`${agent.name}'s connectors`}
        title={mine.length ? `Connectors: ${mine.map((s) => s.name).join(', ')}` : 'No connectors yet'}
        onClick={() => setOpen(!open)}
      >
        {mine.length ? (
          <>
            {mine.slice(0, SHOWN).map((s) => (
              <ConnectorMark key={s.id} name={s.name} catalogId={s.catalogId} size={12} />
            ))}
            {mine.length > SHOWN && <span className="activity-connectors-more">+{mine.length - SHOWN}</span>}
          </>
        ) : (
          <IconPlug size={15} />
        )}
      </button>
      {open && (
        <div className="activity-connectors-popover" role="dialog" aria-label={`${agent.name}'s connectors`}>
          {servers.length ? (
            servers.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={servesRun(s.coworkers, run)}
                  onChange={(e) =>
                    void perform(() =>
                      window.axon.mcpServerSave({
                        ...s,
                        coworkers: assign(
                          s.coworkers ?? [],
                          { id: agent.id, department: agent.department },
                          e.target.checked
                        )
                      })
                    )
                  }
                />
                <ConnectorMark name={s.name} catalogId={s.catalogId} size={11} />
                {s.name}
              </label>
            ))
          ) : (
            <p>Nothing connected yet.</p>
          )}
          <button
            type="button"
            className="activity-connectors-browse"
            onClick={() => {
              setOpen(false);
              useOfficeStore.getState().openOverlay('settings', 'tools');
            }}
          >
            Browse connectors
          </button>
        </div>
      )}
    </div>
  );
}
