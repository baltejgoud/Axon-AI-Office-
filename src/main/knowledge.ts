import { readFile, stat } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import type { KnowledgeChunk, KnowledgeDoc } from '../shared/types';

export async function extract(path: string): Promise<string> {
  if ((await stat(path)).size > 15_000_000) throw new Error('Documents must be smaller than 15 MB.');
  const buffer = await readFile(path), ext = extname(path).toLowerCase();
  let text: string;
  if (ext === '.pdf') {
    const pdf = require('pdf-parse/lib/pdf-parse.js') as (buffer: Buffer) => Promise<{ text: string }>;
    text = (await pdf(buffer)).text;
  } else if (ext === '.docx') text = (await mammoth.extractRawText({ buffer })).value;
  else if (ext === '.xlsx') {
    const book = new ExcelJS.Workbook();
    // Defensive copy: guarantees exceljs never retains a view over our file buffer.
    // Documented structural bridge: exceljs's bundled typings pin the legacy loose
    // `Buffer` type and reject the concrete `Buffer<ArrayBuffer>` required by
    // current @types/node. This is the only intentional type bridge in the codebase.
    const snapshot = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(snapshot).set(buffer);
    await book.xlsx.load(Buffer.from(snapshot) as unknown as Parameters<typeof book.xlsx.load>[0]);
    const parts: string[] = [];
    book.eachSheet(sheet => {
      parts.push(`Sheet: ${sheet.name}`);
      sheet.eachRow(row => {
        const cells = (row.values as unknown[]).slice(1).map(cell => {
          if (cell === null || cell === undefined) return '';
          if (typeof cell === 'object' && 'text' in (cell as object)) return String((cell as { text: string }).text);
          if (typeof cell === 'object' && 'result' in (cell as object)) return String((cell as { result: unknown }).result);
          return String(cell);
        });
        parts.push(cells.join('\t'));
      });
    });
    text = parts.join('\n');
  } else {
    text = buffer.toString('utf8');
    if (text.includes('\0')) throw new Error('Unsupported binary document. Legacy .xls files must be saved as .xlsx.');
  }
  if (!text.trim()) throw new Error('No text found. Scanned documents need external OCR.');
  if (text.length > 2_000_000) throw new Error('Extracted text exceeds the 2 MB limit.');
  return text;
}
export async function ingest(path: string): Promise<{ doc: KnowledgeDoc; chunks: KnowledgeChunk[] }> {
  const text = await extract(path), id = randomUUID(), name = basename(path);
  const chunks: KnowledgeChunk[] = [];
  for (let offset = 0; offset < text.length; offset += 1200) {
    const chunk = text.slice(offset, offset + 1600);
    chunks.push({ id: randomUUID(), docId: id, docName: name, index: chunks.length, text: chunk, tokens: Math.ceil(chunk.length / 4) });
  }
  return { doc: { id, name, kind: extname(path).slice(1), size: (await stat(path)).size, chunkCount: chunks.length, createdAt: Date.now(), workspaceIds: [] }, chunks };
}
const tokenize = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || [];
/** BM25 lexical retrieval. Returns only matching chunks, with source labels. */
export function search(chunks: KnowledgeChunk[], query: string): (KnowledgeChunk & { score: number })[] {
  const terms = [...new Set(tokenize(query))].slice(0, 40);
  if (!terms.length || !chunks.length) return [];
  const docs = chunks.map(chunk => ({ chunk, words: tokenize(chunk.text) }));
  const average = docs.reduce((sum, d) => sum + d.words.length, 0) / docs.length || 1;
  const frequencies = new Map(terms.map(term => [term, docs.filter(d => d.words.includes(term)).length]));
  return docs.map(({ chunk, words }) => {
    let score = 0;
    for (const term of terms) {
      const tf = words.filter(w => w === term).length, df = frequencies.get(term)!;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * words.length / average));
    }
    return { ...chunk, score };
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
}

