import { useState } from 'react';
import { useApp } from '../../../state';
import { useOfficeStore } from '../store/officeStore';
import { statusText, errorText, OwnAppDialog } from '../../../settings/ConnectorsSection';
import { CONNECTORS } from '../../../../../shared/connectors';

const SERVICES = [
  {
    id: 'exa',
    title: 'Exa · Lead research',
    description:
      'Find prospective companies and read their public websites. Public research does not guarantee a verified email address.'
  },
  {
    id: 'composio',
    title: 'Composio · Gmail actions',
    description:
      'Connect the gateway, then authorize Gmail to read, draft and send email through its available tools. Gateway sign-in alone does not connect your mailbox.'
  },
  {
    id: 'hubspot',
    title: 'HubSpot · Lead tracking',
    description:
      'Search and update your existing contacts, companies and deals. Requires your HubSpot MCP auth app and account sign-in.'
  }
];
const TEAM = [
  'chief-of-staff',
  'ops-coordinator',
  'research-analyst',
  'marketing-strategist',
  'group:Growth & Outreach',
  'group:Sales Management'
];

export function CompanyServices() {
  const data = useApp((s) => s.data);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editHubSpot, setEditHubSpot] = useState(false);
  const settings = () => useOfficeStore.getState().openOverlay('settings', 'tools');
  const connect = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      const saved = useApp.getState().data?.mcpServers.find((s) => s.catalogId === id);
      if (saved) {
        if (!saved.enabled) await window.axon.mcpServerSave({ ...saved, enabled: true });
        await window.axon.connectorReconnect(saved.id);
      }
      else await window.axon.connectorAdd(id);
      await useApp.getState().refresh();
      const server = useApp.getState().data?.mcpServers.find((s) => s.catalogId === id);
      if (server?.status === 'connected') {
        await window.axon.mcpServerSave({
          ...server,
          coworkers: [...new Set([...(server.coworkers ?? []), ...TEAM])]
        });
        await useApp.getState().refresh();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const authorizeMail = () => {
    const office = useOfficeStore.getState();
    office.openOverlay(null);
    office.focusOn({ agentId: 'ops-coordinator' });
    office.compose(
      'ops-coordinator',
      'Use Composio connection-management tools to start connecting my Gmail account for Sanket. Present the browser authorization link and confirm the connection status afterward. Only set up the connection; do not read or send mail, create contacts, or perform outreach.'
    );
  };
  return (
    <section className="company-services" aria-label="Company service connections">
      <h3>Connect research, email & CRM</h3>
      <p>
        These connections serve the Chief of Staff, Ops Coordinator, Research Analyst and marketing team.
        Changes and sending use Axon's existing approval cards.
      </p>
      <div className="company-service-grid">
        {SERVICES.map((service) => {
          const server = data?.mcpServers.find((s) => s.catalogId === service.id);
          const ownAppMissing =
            service.id === 'hubspot' && !server && !data?.connectorApps.includes('hubspot');
          return (
            <article key={service.id}>
              <strong>{service.title}</strong>
              <p>{service.description}</p>
              <small>{server ? statusText(server) : 'Not connected'}</small>
              <button
                disabled={busy !== null}
                onClick={() => (ownAppMissing ? setEditHubSpot(true) : void connect(service.id))}
              >
                {busy === service.id
                  ? 'Connecting…'
                  : ownAppMissing
                    ? 'Set up HubSpot app'
                    : server?.status === 'connected'
                      ? 'Reconnect & enable for team'
                      : `Connect ${service.id === 'composio' ? 'Composio' : service.id === 'exa' ? 'Exa' : 'HubSpot'}`}
              </button>
              {service.id === 'hubspot' && !ownAppMissing && (
                <button disabled={busy !== null} onClick={() => setEditHubSpot(true)}>
                  Edit HubSpot app credentials
                </button>
              )}
              {service.id === 'composio' && server?.status === 'connected' && (
                <button disabled={busy !== null} onClick={authorizeMail}>
                  Set up Gmail with Ops Coordinator
                </button>
              )}
            </article>
          );
        })}
      </div>
      {busy && <button onClick={() => void window.axon.connectorSignInCancel()}>Cancel sign-in</button>}
      {error && (
        <p role="alert" className="company-error">
          {error}
        </p>
      )}
      <button onClick={settings}>Manage all connectors</button>
      {editHubSpot && (
        <OwnAppDialog
          entry={CONNECTORS.find((entry) => entry.id === 'hubspot')!}
          onClose={() => setEditHubSpot(false)}
          onSaved={() => {
            setEditHubSpot(false);
            void connect('hubspot');
          }}
        />
      )}
    </section>
  );
}
