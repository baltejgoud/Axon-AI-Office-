import { useState, useRef, useMemo, useEffect } from 'react';
import {
  ArrowLeftRight,
  ArrowUpRight,
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  FileCode,
  Folder,
  FolderOpen,
  Library,
  Plus,
  Puzzle,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload
} from 'lucide-react';
import hljs from 'highlight.js';
import type { Workspace, Agent, Selection } from '../../shared/types';
import { useApp, perform } from './state';
import { Chat, ModelSelect } from './Chat';
import { Button, EmptyState, Field, Icon, Modal, PageHeader } from './ui';
import { RolePicker, SkillPicker, SelectionChips } from './ui/CatalogPicker';
import { DiffViewer } from './ui/DiffViewer';

/** "Roles" and "Skills" rows for a modal. Holds no state of its own; the parent owns the selection. */
function SelectionFields({ value, onChange }: { value: Selection; onChange: (next: Selection) => void }) {
  const [picker, setPicker] = useState<'skills' | 'roles' | null>(null);
  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <div className="row">
        <Button size="sm" icon={Bot} onClick={() => setPicker('roles')}>
          Roles · {value.roleIds.length}
        </Button>
        <Button size="sm" icon={Puzzle} onClick={() => setPicker('skills')}>
          Skills · {value.skillIds.length}
        </Button>
      </div>
      <SelectionChips
        selection={value}
        onRemove={(kind, id) =>
          onChange(
            kind === 'skill'
              ? { ...value, skillIds: value.skillIds.filter((x) => x !== id) }
              : { ...value, roleIds: value.roleIds.filter((x) => x !== id) }
          )
        }
      />
      {picker === 'skills' && (
        <SkillPicker
          selected={value.skillIds}
          onClose={() => setPicker(null)}
          onApply={(ids) => {
            onChange({ ...value, skillIds: ids });
            setPicker(null);
          }}
        />
      )}
      {picker === 'roles' && (
        <RolePicker
          selected={value.roleIds}
          onClose={() => setPicker(null)}
          onApply={(ids) => {
            onChange({ ...value, roleIds: ids });
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

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
  skillIds: [],
  roleIds: [],
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
    }, 'Workspace saved');
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
                        void perform(() => window.axon.workspaceDelete(w.id), 'Workspace deleted');
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
            <h3 className="section-title">Roles and skills</h3>
            <p className="text-caption" style={{ marginBottom: 'var(--space-2)' }}>
              Applied to every conversation in this workspace.
            </p>
            <SelectionFields
              value={{ skillIds: edit.skillIds, roleIds: edit.roleIds }}
              onChange={(s) => setEdit({ ...edit, ...s })}
            />
          </div>
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
    skillIds: [],
    roleIds: [],
    maxSteps: 10,
    schedule: { kind: 'manual' },
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  const save = () =>
    void perform(async () => {
      await window.axon.agentSave(edit!);
      setEdit(null);
    }, 'Agent profile saved');
  return (
    <div className="page">
      <div className="page-inner">
        <PageHeader
          title="Agent profiles"
          description="Autonomous assistants and reusable agents with their own system prompt, tools, steps, and background schedules."
          actions={
            <>
              <Button icon={Upload} onClick={() => void perform(() => window.axon.agentImport(), 'Profile imported')}>
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
                  {a.schedule?.kind === 'interval' && (
                    <span className="badge badge-accent">Every {a.schedule.intervalMinutes}m</span>
                  )}
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
                    onClick={() => void perform(() => window.axon.agentExport(a.id), 'Profile exported')}
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
                      if (confirm(`Delete "${a.name}"?`))
                        void perform(() => window.axon.agentDelete(a.id), 'Profile deleted');
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
          <Field
            label="Max tool execution steps"
            hint="Maximum autonomous tool loop turns per user message (1 - 30)."
          >
            <input
              className="input"
              type="number"
              min={1}
              max={30}
              value={edit.maxSteps ?? 10}
              onChange={(e) =>
                setEdit({ ...edit, maxSteps: Math.max(1, Math.min(30, Number(e.target.value) || 10)) })
              }
            />
          </Field>
          <Field label="Execution schedule">
            <select
              className="select"
              value={edit.schedule?.kind || 'manual'}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  schedule: {
                    ...edit.schedule,
                    kind: e.target.value as 'manual' | 'interval',
                    intervalMinutes: edit.schedule?.intervalMinutes || 15
                  }
                })
              }
            >
              <option value="manual">Manual trigger only</option>
              <option value="interval">Periodic interval (background)</option>
            </select>
          </Field>
          {edit.schedule?.kind === 'interval' && (
            <>
              <Field label="Interval (minutes)" hint="How often this agent automatically runs.">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={1440}
                  value={edit.schedule.intervalMinutes || 15}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      schedule: {
                        ...edit.schedule,
                        intervalMinutes: Math.max(1, Number(e.target.value) || 15)
                      }
                    })
                  }
                />
              </Field>
              <Field label="Scheduled prompt" hint="Prompt supplied to the agent on each run.">
                <input
                  className="input"
                  placeholder="Check git status and report any failing tests or dirty changes."
                  value={edit.schedule.input || ''}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      schedule: {
                        ...edit.schedule,
                        input: e.target.value
                      }
                    })
                  }
                />
              </Field>
            </>
          )}
          <div>
            <h3 className="section-title">Roles and skills</h3>
            <p className="text-caption" style={{ marginBottom: 'var(--space-2)' }}>
              Copied onto each conversation started from this profile.
            </p>
            <SelectionFields
              value={{ skillIds: edit.skillIds, roleIds: edit.roleIds }}
              onChange={(s) => setEdit({ ...edit, ...s })}
            />
          </div>
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
    void perform(() => window.axon.knowledgeImport(), 'Documents imported').finally(() => setBusy(false));
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
                      }, 'Document removed');
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

interface FileTreeNodeData {
  name: string;
  path: string;
  isDir: boolean;
  children: FileTreeNodeData[];
}

function buildFileTree(files: string[]): FileTreeNodeData[] {
  const root: FileTreeNodeData = { name: '', path: '', isDir: true, children: [] };
  for (const f of files) {
    const parts = f.split('/');
    let curr = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isDir = i < parts.length - 1;
      const subPath = parts.slice(0, i + 1).join('/');
      let child = curr.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: subPath, isDir, children: [] };
        curr.children.push(child);
      }
      curr = child;
    }
  }
  function sortNodes(nodes: FileTreeNodeData[]): FileTreeNodeData[] {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.isDir) sortNodes(n.children);
    }
    return nodes;
  }
  return sortNodes(root.children);
}

function FileTreeNodeItem({
  node,
  depth,
  activePath,
  collapsed,
  onToggle,
  onOpen
}: {
  node: FileTreeNodeData;
  depth: number;
  activePath: string;
  collapsed: Set<string>;
  onToggle: (dirPath: string) => void;
  onOpen: (filePath: string) => void;
}) {
  const isCollapsed = collapsed.has(node.path);

  if (node.isDir) {
    return (
      <div className="file-tree-branch">
        <button
          className="file-item file-item-dir"
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          onClick={() => onToggle(node.path)}
        >
          <Icon icon={isCollapsed ? ChevronRight : ChevronDown} size="sm" />
          <Icon icon={isCollapsed ? Folder : FolderOpen} size="sm" />
          <span>{node.name}</span>
        </button>
        {!isCollapsed && (
          <div className="file-tree-sub">
            {node.children.map((child) => (
              <FileTreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                collapsed={collapsed}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className="file-item"
      aria-current={node.path === activePath ? 'true' : undefined}
      style={{ paddingLeft: `${depth * 14 + 18}px` }}
      onClick={() => onOpen(node.path)}
    >
      <Icon icon={FileCode} size="sm" />
      <span>{node.name}</span>
    </button>
  );
}

function getCodeLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    sh: 'bash',
    bash: 'bash',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml'
  };
  return langMap[ext] || 'plaintext';
}

function CodeEditorView({
  filePath,
  content,
  disabled,
  onChange
}: {
  filePath: string;
  content: string;
  disabled: boolean;
  onChange: (val: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lang = useMemo(() => getCodeLanguage(filePath), [filePath]);
  const lines = useMemo(() => content.split('\n'), [content]);

  const highlighted = useMemo(() => {
    if (!content) return '';
    try {
      if (hljs.getLanguage(lang)) {
        return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(content).value;
    } catch {
      return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [content, lang]);

  const handleScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  return (
    <div className="code-editor-viewport">
      <div className="code-editor-gutter" ref={gutterRef}>
        {lines.map((_, i) => (
          <div key={i} className="line-num">
            {i + 1}
          </div>
        ))}
      </div>
      <div className="code-editor-pane">
        <pre className="code-editor-pre" ref={preRef} aria-hidden="true">
          <code
            className={`hljs language-${lang}`}
            dangerouslySetInnerHTML={{ __html: (highlighted || (disabled ? 'No file selected' : '')) + '\n' }}
          />
        </pre>
        <textarea
          ref={textareaRef}
          className="code-editor-textarea"
          aria-label="Project file editor"
          spellCheck={false}
          disabled={disabled}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          wrap="off"
        />
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
  const [showFiles, setShowFiles] = useState(true);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const { data, chatId } = useApp();
  const dirty = content !== saved;
  const [showDiff, setShowDiff] = useState(false);

  const toggleDir = (dirPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  };

  const fileTree = useMemo(() => {
    const filtered = filter.trim()
      ? files.filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
      : files;
    return buildFileTree(filtered);
  }, [files, filter]);

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

  const saveFile = () =>
    void perform(async () => {
      await window.axon.projectWrite(path, content);
      setSaved(content);
      setFiles(await window.axon.projectList());
      setShowDiff(false);
    }, 'File saved');

  // Ctrl/Cmd+S saves the open file, matching every other editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return;
      event.preventDefault();
      if (path && dirty) saveFile();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [path, content, dirty]);

  return (
    <div className="code-layout">
      <section className="project-panel">
        <header className="topbar">
          <strong>
            <Icon icon={FolderOpen} />
            Project
          </strong>
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            {root && (
              <Button size="sm" variant="ghost" onClick={() => setShowFiles((v) => !v)}>
                {showFiles ? 'Hide files' : `Files (${files.length})`}
              </Button>
            )}
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
          </div>
        </header>
        <p className="project-root">
          {root || 'Choose a local folder. Nothing is shared with the model automatically.'}
        </p>

        {showFiles && (
          <>
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
              {hits.length ? (
                hits.map((h, i) => (
                  <button key={i} className="file-item" onClick={() => open(h.path)}>
                    {h.path}:{h.line} — {h.text}
                  </button>
                ))
              ) : fileTree.length > 0 ? (
                fileTree.map((node) => (
                  <FileTreeNodeItem
                    key={node.path}
                    node={node}
                    depth={0}
                    activePath={path}
                    collapsed={collapsedDirs}
                    onToggle={toggleDir}
                    onOpen={open}
                  />
                ))
              ) : (
                <p className="text-caption" style={{ padding: 'var(--space-2)' }}>
                  {root ? (filter ? 'No matching files.' : 'Empty directory.') : 'No folder opened.'}
                </p>
              )}
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
          </>
        )}

        <div className="editor-title">
          <strong>
            <span className="editor-path">{path || 'No file selected'}</span>
            {dirty && <span className="dirty-dot" title="Unsaved changes — Ctrl+S to save" />}
          </strong>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            {dirty && (
              <Button
                size="sm"
                variant={showDiff ? 'primary' : 'ghost'}
                icon={ArrowLeftRight}
                title="Toggle visual diff review"
                onClick={() => setShowDiff((v) => !v)}
              >
                {showDiff ? 'Editor' : 'Diff'}
              </Button>
            )}
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
              title="Save the open file (Ctrl+S)"
              onClick={saveFile}
            >
              Save
            </Button>
          </div>
        </div>

        {showDiff && dirty ? (
          <div style={{ height: '350px', margin: 'var(--space-2) 0' }}>
            <DiffViewer
              oldText={saved}
              newText={content}
              fileName={path}
              onAccept={saveFile}
              onReject={() => {
                setContent(saved);
                setShowDiff(false);
              }}
            />
          </div>
        ) : (
          <CodeEditorView
            filePath={path}
            content={content}
            disabled={!path}
            onChange={setContent}
          />
        )}

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
