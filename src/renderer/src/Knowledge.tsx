import { useState } from 'react';
import { Library, Plus, Search, Trash2 } from 'lucide-react';
import { useApp, perform } from './state';
import { Button, EmptyState } from './ui';
import { syncOfficeLibrary } from './features/office/library';

/** The office library: documents the Library's coworkers can search. Shown in an overlay. */
export function Knowledge() {
  const data = useApp((s) => s.data)!;
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<{ docName: string; text: string; score: number }[]>([]);
  const importDocs = () => {
    setBusy(true);
    void perform(async () => {
      await window.axon.knowledgeImport();
      await useApp.getState().refresh();
      await syncOfficeLibrary();
    }, 'Documents imported').finally(() => setBusy(false));
  };
  return (
    <div className="knowledge-library stack">
      <div className="knowledge-library-intro">
        <p>
          The Knowledge Librarian, Research Analyst and Writer search these documents and cite the passages
          they use. PDF, DOCX, TXT, Markdown, Excel, CSV and text-based code files · 15 MB per file · no OCR.
          Import only files you trust.
        </p>
        <Button variant="primary" icon={Plus} disabled={busy} onClick={importDocs}>
          {busy ? 'Importing…' : 'Import documents'}
        </Button>
      </div>

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
                  if (confirm(`Remove "${d.name}" from the library?`))
                    void perform(async () => {
                      await window.axon.knowledgeDelete(d.id);
                      setHits([]);
                      await useApp.getState().refresh();
                      await syncOfficeLibrary();
                    }, 'Document removed');
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Library}
          title="The shelves are empty"
          description="Import documents and the Library's coworkers can search them for you."
          action={
            <Button variant="primary" icon={Plus} disabled={busy} onClick={importDocs}>
              Import documents
            </Button>
          }
        />
      )}
    </div>
  );
}
