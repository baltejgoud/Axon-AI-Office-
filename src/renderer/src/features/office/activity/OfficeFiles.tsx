import { useState } from 'react';
import { FolderOpen, Folder, FileText, ChevronLeft } from 'lucide-react';

export interface OfficeFileContext {
  path: string;
  content: string;
}

export function OfficeFiles({ onInclude }: { onInclude: (file: OfficeFileContext) => void }) {
  const [root, setRoot] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [preview, setPreview] = useState<OfficeFileContext | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const entries = [
    ...new Set(
      files.filter((file) => file.startsWith(folder)).map((file) => file.slice(folder.length).split('/')[0])
    )
  ];
  return (
    <section className="office-file-browser" aria-label="Files desk">
      <button
        className="office-file-open"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const chosen = await window.axon.projectChoose();
            if (chosen) {
              setRoot(chosen);
              setFolder('');
              setPreview(null);
              setFiles((await window.axon.projectList()).map((file) => file.replaceAll('\\', '/')));
            }
          } catch (err) {
            setError(String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <FolderOpen size={16} />
        {busy ? 'Opening folder…' : 'Open a project folder'}
      </button>
      {root && (
        <>
          <p className="office-file-root" title={root}>
            {root.split(/[\\/]/).pop()}
            {folder && ` / ${folder}`}
          </p>
          {folder && (
            <button
              className="office-file-entry"
              onClick={() => {
                setFolder(
                  folder.split('/').slice(0, -2).join('/') + (folder.split('/').length > 2 ? '/' : '')
                );
                setPreview(null);
              }}
            >
              <ChevronLeft size={15} />
              Parent folder
            </button>
          )}
          <div className="office-file-list">
            {entries.map((name) => {
              const path = folder + name;
              const directory = files.some((file) => file.startsWith(path + '/'));
              return (
                <button
                  key={path}
                  className="office-file-entry"
                  disabled={busy}
                  onClick={async () => {
                    setError('');
                    setPreview(null);
                    if (directory) {
                      setFolder(path + '/');
                      return;
                    }
                    setBusy(true);
                    try {
                      setPreview({ path, content: await window.axon.projectRead(path) });
                    } catch (err) {
                      setError(String(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {directory ? <Folder size={15} /> : <FileText size={15} />}
                  <span>{name}</span>
                </button>
              );
            })}
            {!entries.length && <p>No files in this folder.</p>}
          </div>
        </>
      )}
      {preview && (
        <div className="office-file-preview">
          <strong>{preview.path}</strong>
          <pre>{preview.content.slice(0, 3000)}</pre>
          <button
            className="office-file-open"
            onClick={() => onInclude({ ...preview, content: preview.content.slice(0, 20000) })}
          >
            Include {preview.content.length > 20000 ? 'first 20,000 characters' : 'file'} in next task
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
