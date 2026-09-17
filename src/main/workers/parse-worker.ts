import type { KnowledgeChunk, KnowledgeDoc } from '../../shared/types';
import { extract, ingest } from '../knowledge';

// Runs inside an Electron utilityProcess: untrusted parser input (PDF/DOCX/XLSX)
// is decoded here, never in the main process. A crash or timeout here cannot
// take the application down; the pool recycles the worker.
const port = (process as unknown as { parentPort: Electron.ParentPort }).parentPort;
port.on('message', async (event: Electron.MessageEvent) => {
  const message = event.data as { id: string; op: 'extract' | 'ingest'; path: string };
  try {
    if (message.op === 'ingest') {
      const result = await ingest(message.path);
      port.postMessage({ id: message.id, doc: result.doc, chunks: result.chunks });
    } else {
      port.postMessage({ id: message.id, text: await extract(message.path) });
    }
  } catch (error) {
    port.postMessage({ id: message.id, error: error instanceof Error ? error.message : 'Document parsing failed.' });
  }
});
