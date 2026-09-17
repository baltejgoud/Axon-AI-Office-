import { useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Download,
  FileCode,
  Folder,
  FolderOpen,
  Library,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload
} from 'lucide-react';
import type { Workspace, Agent } from '../../shared/types';
import { useApp, perform } from './state';
import { Chat, ModelSelect } from './Chat';
import { Button, EmptyState, Field, Icon, Modal, PageHeader } from './ui';

/* ---------- Workspaces ---------- */
const freshWorkspace = (): Workspace => ({
  id: crypto.randomUUID(),
  name: '',
  description: '',
  systemPrompt: '',
  instructions: '',
  defaultProviderId: null,
  defaultModelId: null,
  enabledTools: [],
  knowledgeDocIds: [],
  fileAccess: { enabled: false, roots: [] },
  createdAt: Date.now(),
  updatedAt: Date.now()
});

export function Workspaces() {
  const { data, patch } = useApp();
  const [edit, setEdit] = useState<Workspace | null>(null);
  const save = () =>
    void perform(async () => {
      await window.axon.workspaceSave(edit!);
      setEdit(null);
    });
  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Workspaces"
          description="A system prompt, default model and knowledge sources that stay attached to a set of conversations."
          actions={
            <Button variant="primary" icon={Plus} onClick={() => setEdit(freshWorkspace())}>
              New workspace
            </Button>
          }
        />
        <div className="card-grid">
          {data!.workspaces.map((w) => (
            <div className="card" key={w.id}>
              <div className="card-header">
                <span className="icon-tile">
                  <Icon icon={w.builtin ? FileCode : Folder} size="lg" />
                </span>
                {w.builtin && <span className="badge">Built in</span>}
              </div>
              <h3 className="card-title">{w.name}</h3>
              <p className="text-small text-secondary">{w.description || 'No description.'}</p>
              <p className="text-caption" style={{ marginTop: 'var(--space-2)' }}>
                {w.knowledgeDocIds.length} knowledge source{w.knowledgeDocIds.length === 1 ? '' : 's'}
              </p>
              <div className="card-footer">
                <Button
                  variant="primary"
                  size="sm"
                  icon={ArrowUpRight}
                  onClick={() =>
                    patch({
                      page: 'chat',
                      workspaceId: w.id,
                      chatId: null,
                      ...(w.defaultProviderId ? { model: `${w.defaultProviderId}::${w.defaultModelId}` } : {})
                    })
                  }
                >
                  Open
                </Button>
                <Button size="sm" onClick={() => setEdit(w)}>
                  Configure
                </Button>
                {!w.builtin && (
                  <Button
                    variant="danger"
                    size="sm"
                    icon={Trash2}
                    iconOnly
                    aria-label={`Remove ${w.name}`}
                    onClick={() => {
                      if (confirm(`Remove "${w.name}"? Its conversations are kept.`))
                        void perform(() => window.axon.workspaceDelete(w.id));
                    }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {edit && (
        <Modal
          title={edit.name ? 'Configure workspace' : 'New workspace'}
          onClose={() => setEdit(null)}
          onSubmit={save}
          submitLabel="Save workspace"
        >
          <Field label="Name">
            <input
              className="input"
              required
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <input
              className="input"
              value={edit.description || ''}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
          </Field>
          <Field label="Default model" hint="Used for new conversations in this workspace.">
            <ModelSelect
              value={edit.defaultProviderId ? `${edit.defaultProviderId}::${edit.defaultModelId}` : ''}
              onChange={(value) => {
                const [provider, ...model] = value.split('::');
                setEdit({
                  ...edit,
                  defaultProviderId: provider || null,
                  defaultModelId: model.join('::') || null
                });
              }}
            />
          </Field>
          <Field label="System prompt">
            <textarea
              className="textarea"
              rows={4}
              value={edit.systemPrompt}
              onChange={(e) => setEdit({ ...edit, systemPrompt: e.target.value })}
            />
          </Field>
          <Field label="Additional instructions">
            <textarea
              className="textarea"
              rows={2}
              value={edit.instructions || ''}
              onChange={(e) => setEdit({ ...edit, instructions: e.target.value })}
            />
          </Field>
          <div>
            <h3 className="section-title">Knowledge sources</h3>
            {!data!.documents.length && (
              <p className="text-caption">Import documents on the Knowledge page first.</p>
            )}
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              {data!.documents.map((d) => (
                <label className="checkbox" key={d.id}>
                  <input
                    type="checkbox"
                    checked={edit.knowledgeDocIds.includes(d.id)}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        knowledgeDocIds: e.target.checked
                          ? [...edit.knowledgeDocIds, d.id]
                          : edit.knowledgeDocIds.filter((id) => id !== d.id)
                      })
                    }
                  />
                  {d.name}
                </label>
              ))}
            </div>
          </div>
          <p className="text-caption">
            Matching passages are sent to the model with each message. Tools and file access stay off; use the
            Code page for reviewed edits.
          </p>
        </Modal>
      )}
    </div>
  );
}

/* ---------- Agents ---------- */
export function Agents() {
  const { data, model, patch } = useApp();
  const [edit, setEdit] = useState<Agent | null>(null);
  const create = (): Agent => ({
    id: crypto.randomUUID(),
    name: '',
    systemPrompt: '',
    providerId: null,
    modelId: null,
    tools: [],
    workspaceId: null,
    maxSteps: 1,
    schedule: { kind: 'manual' },
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  const save = () =>
    void perform(async () => {
      await window.axon.agentSave(edit!);
      setEdit(null);
    });
  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Agent profiles"
          description="Reusable assistants with their own system prompt and model. Runs are manual — no autonomous tools."
          actions={
            <>
              <Button icon={Upload} onClick={() => void perform(() => window.axon.agentImport())}>
                Import
              </Button>
              <Button variant="primary" icon={Plus} onClick={() => setEdit(create())}>
                New profile
              </Button>
            </>
          }
        />
        {data!.agents.length ? (
          <div className="card-grid">
            {data!.agents.map((a) => (
              <div className="card" key={a.id}>
                <div className="card-header">
                  <span className="icon-tile">
                    <Icon icon={Bot} size="lg" />
                  </span>
                </div>
                <h3 className="card-title">{a.name}</h3>
                <p className="text-small text-secondary">{a.description || 'No description.'}</p>
                <div className="card-footer">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={ArrowUpRight}
                    onClick={() =>
                      void perform(async () => {
                        const [p, ...m] = (a.providerId ? `${a.providerId}::${a.modelId}` : model).split(
                          '::'
                        );
                        const c = await window.axon.chatCreate(p, m.join('::'), a.workspaceId, a.id);
                        patch({ chatId: c.id, workspaceId: c.workspaceId, page: 'chat' });
                      })
                    }
                  >
                    Start chat
                  </Button>
                  <Button size="sm" onClick={() => setEdit(a)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    icon={Download}
                    onClick={() => void perform(() => window.axon.agentExport(a.id))}
                  >
                    Export
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={Trash2}
                    iconOnly
                    aria-label={`Delete ${a.name}`}
                    onClick={() => {
                      if (confirm(`Delete "${a.name}"?`)) void perform(() => window.axon.agentDelete(a.id));
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Bot}
            title="No profiles yet"
            description="A profile is a named system prompt with an optional model and workspace. Create one or import a .json export."
            action={
              <Button variant="primary" icon={Plus} onClick={() => setEdit(create())}>
                New profile
              </Button>
            }
          />
        )}
      </div>

      {edit && (
        <Modal
          title={edit.name ? 'Edit profile' : 'New profile'}
          onClose={() => setEdit(null)}
          onSubmit={save}
          submitLabel="Save profile"
        >
          <Field label="Name">
            <input
              className="input"
              required
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <input
              className="input"
              value={edit.description || ''}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
          </Field>
          <Field label="Model" hint="Leave unset to use the model selected in the chat.">
            <ModelSelect
              value={edit.providerId ? `${edit.providerId}::${edit.modelId}` : ''}
              onChange={(value) => {
                const [p, ...m] = value.split('::');
                setEdit({ ...edit, providerId: p || null, modelId: m.join('::') || null });
              }}
            />
          </Field>
          <Field label="System prompt">
            <textarea
              className="textarea"
              required
              rows={6}
              value={edit.systemPrompt}
              onChange={(e) => setEdit({ ...edit, systemPrompt: e.target.value })}
            />
          </Field>
          <Field label="Workspace">
            <select
              className="select"
              value={edit.workspaceId || ''}
              onChange={(e) => setEdit({ ...edit, workspaceId: e.target.value || null })}
            >
              <option value="">No workspace</option>
              {data!.workspaces.map((w) => (
                <option value={w.id} key={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </Modal>
      )}
    </div>
  );
}

/* ---------- Knowledge ---------- */
export function Knowledge() {
  const data = useApp((s) => s.data)!;
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<{ docName: string; text: string; score: number }[]>([]);
  const importDocs = () => {
    setBusy(true);
    void perform(() => window.axon.knowledgeImport()).finally(() => setBusy(false));
  };
  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Knowledge"
          description="Documents your workspaces can search. Matching passages are sent to the model with your message."
          actions={
            <Button variant="primary" icon={Plus} disabled={busy} onClick={importDocs}>
              {busy ? 'Importing…' : 'Import documents'}
            </Button>
          }
        />
        <p className="text-caption">
          PDF, DOCX, TXT, Markdown, Excel, CSV and text-based code files · 15 MB per file · no OCR. Import
          only files you trust.
        </p>

        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => setHits(await window.axon.knowledgeSearch(query)));
          }}
        >
          <input
            className="input"
            aria-label="Search knowledge"
            placeholder="Search document contents"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button type="submit" icon={Search}>
            Search
          </Button>
        </form>

        {hits.length > 0 && (
          <div className="stack">
            {hits.map((h, i) => (
              <div className="card" key={i}>
                <h3 className="card-title">{h.docName}</h3>
                <p className="knowledge-hit">{h.text}</p>
              </div>
            ))}
          </div>
        )}

        {data.documents.length ? (
          <div className="document-list">
            {data.documents.map((d) => (
              <div className="document-row" key={d.id}>
                <span className="file-badge">{d.kind.toUpperCase()}</span>
                <div>
                  <strong className="text-small">{d.name}</strong>
                  <p className="text-caption">
                    {d.chunkCount} passages · {Math.ceil(d.size / 1024)} KB
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  icon={Trash2}
                  iconOnly
                  aria-label={`Remove ${d.name}`}
                  onClick={() => {
                    if (confirm(`Remove "${d.name}" from knowledge?`))
                      void perform(async () => {
                        await window.axon.knowledgeDelete(d.id);
                        setHits([]);
                      });
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Library}
            title="No documents yet"
            description="Import documents here, then enable them in a workspace's configuration."
            action={
              <Button variant="primary" icon={Plus} disabled={busy} onClick={importDocs}>
                Import documents
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Code ---------- */
export function Code() {
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [filter, setFilter] = useState('');
  const [newPath, setNewPath] = useState('');
  const [share, setShare] = useState(false);
  const [hits, setHits] = useState<{ path: string; line: number; text: string }[]>([]);
  const { data, chatId } = useApp();
  const dirty = content !== saved;

  const lastAssistant = data
    ? [...data.messages]
        .reverse()
        .find(
          (m) => m.role === 'assistant' && m.content && !m.error && (!chatId || m.conversationId === chatId)
        )
    : null;
  const codeBlock = lastAssistant
    ? (lastAssistant.content.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/) || [])[1]
    : null;

  const open = (file: string) => {
    if (dirty && !confirm('Discard unsaved editor changes?')) return;
    void perform(async () => {
      const text = await window.axon.projectRead(file);
      setPath(file);
      setContent(text);
      setSaved(text);
      setShare(false);
    });
  };

  return (
    <div className="code-layout">
      <section className="project-panel">
        <header className="topbar">
          <strong>
            <Icon icon={FolderOpen} />
            Project
          </strong>
          <Button
            size="sm"
            onClick={() => {
              if (dirty && !confirm('Discard unsaved changes?')) return;
              void perform(async () => {
                const next = await window.axon.projectChoose();
                if (next) {
                  setRoot(next);
                  setFiles(await window.axon.projectList());
                  setPath('');
                  setContent('');
                  setSaved('');
                  setShare(false);
                }
              });
            }}
          >
            Open folder
          </Button>
        </header>
        <p className="project-root">
          {root || 'Choose a local folder. Nothing is shared with the model automatically.'}
        </p>

        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => setHits(await window.axon.projectSearch(filter)));
          }}
        >
          <input
            className="input"
            aria-label="Filter or search project"
            placeholder="Filter files or search contents"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setHits([]);
            }}
          />
          <Button type="submit" icon={Search} iconOnly aria-label="Search project contents" />
        </form>

        <div className="file-list">
          {hits.length
            ? hits.map((h, i) => (
                <button key={i} className="file-item" onClick={() => open(h.path)}>
                  {h.path}:{h.line} — {h.text}
                </button>
              ))
            : files
                .filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
                .map((f) => (
                  <button
                    className="file-item"
                    aria-current={f === path ? 'true' : undefined}
                    key={f}
                    onClick={() => open(f)}
                  >
                    {f}
                  </button>
                ))}
        </div>

        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && !confirm('Discard unsaved changes?')) return;
            setPath(newPath);
            setContent('');
            setSaved('');
            setShare(false);
            setNewPath('');
          }}
        >
          <input
            className="input"
            aria-label="New relative file path"
            placeholder="New file, e.g. src/example.ts"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
          />
          <Button type="submit" disabled={!root || !newPath.trim()}>
            Create
          </Button>
        </form>

        <div className="editor-title">
          <strong>
            {path || 'No file selected'}
            {dirty ? ' •' : ''}
          </strong>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Button
              size="sm"
              icon={Download}
              disabled={!path || !codeBlock}
              title="Insert the latest code block from the chat into the editor"
              onClick={() => setContent(codeBlock!)}
            >
              Insert AI code
            </Button>
            <Button
              size="sm"
              icon={RotateCcw}
              disabled={!path || !dirty}
              title="Restore the saved file"
              onClick={() => setContent(saved)}
            >
              Revert
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Save}
              disabled={!path}
              onClick={() =>
                void perform(async () => {
                  await window.axon.projectWrite(path, content);
                  setSaved(content);
                  setFiles(await window.axon.projectList());
                })
              }
            >
              Save
            </Button>
          </div>
        </div>

        <textarea
          className="textarea code-editor"
          aria-label="Project file editor"
          spellCheck={false}
          disabled={!path}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />

        <label className="checkbox">
          <input
            type="checkbox"
            disabled={!path}
            checked={share}
            onChange={(e) => setShare(e.target.checked)}
          />
          Include this file with my next message
        </label>
        <p className="text-caption">Saving asks for confirmation. Nothing runs; edits are reviewed by you.</p>
      </section>

      <div className="code-chat">
        <Chat codeContext={share ? { path, text: content } : { path: '', text: '' }} />
      </div>
    </div>
  );
}
