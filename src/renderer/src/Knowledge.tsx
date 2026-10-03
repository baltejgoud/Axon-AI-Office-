import { useState } from 'react';
import { useApp, perform } from './state';
import { Button, EmptyState, IconBook, IconFolderPlus, IconPlus, IconSearch, IconTrash } from './ui';
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
  const importFolder = () => {
    setBusy(true);
    void perform(async () => {
      const result = await window.axon.knowledgeImportFolder();
      if (!result) return;
      await useApp.getState().refresh();
      await syncOfficeLibrary();
      const skipped = result.skipped ? `, ${result.skipped} skipped` : '';
      useApp.getState().pushToast(
        `Imported ${result.imported} document${result.imported === 1 ? '' : 's'}${skipped}${result.truncated ? ' (folder capped at 500 files)' : ''}`
      );
    }).finally(() => setBusy(false));
  };
  return (
    <div className="knowledge-library stack">
      <div className="knowledge-library-intro">
        <p>
          The Knowledge Librarian and Research Analyst search these documents and cite the passages
          they use. PDF, DOCX, TXT, Markdown, Excel, CSV and text-based code files · 15 MB per file · no OCR.
          Import a whole folder to add everything inside it, sub-folders included. Import only files you trust.
        </p>
        <Button variant="primary" icon={IconPlus} disabled={busy} onClick={importDocs}>
          {busy ? 'Importing…' : 'Import documents'}
        </Button>
        <Button icon={IconFolderPlus} disabled={busy} onClick={importFolder}>
          Import a whole folder
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
        <Button type="submit" icon={IconSearch}>
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
                icon={IconTrash}
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
          icon={IconBook}
          title="The shelves are empty"
          description="Import documents above and the Library's coworkers can search them for you."
        />
      )}
    </div>
  );
}
