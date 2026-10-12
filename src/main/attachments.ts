import { existsSync, rmSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Attachment, RequestImage } from '../shared/types';
import { MAX_UPLOAD_BYTES, asBytes, type AttachedFile } from '../shared/attach';
import { imageMime, pictureExtension, prepareImage, unsupportedPicture } from './images';

/** The most pictures one request carries: the latest. Each costs about 1,600 tokens, and its bytes are in memory only while the request is built. */
export const MAX_PICTURES_SENT = 10;
/** Files waiting for a message at once; the oldest is let go beyond this. */
const MAX_WAITING = 50;
/** The largest file chosen in the file dialog. */
const MAX_PICKED_BYTES = 30_000_000;
/** The most text one document may hold. */
const MAX_TEXT_BYTES = 5_000_000;
/** How much of a document goes in the message itself; the rest is read on request. */
const PREVIEW_CHARS = 1200;

/** What a file is called on screen: its last path part, without control or direction-changing characters, kept short. */
export function displayName(name: unknown): string {
  const last = (typeof name === 'string' ? name : '').split(/[\\/]/).pop() ?? '';
  const clean = last.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean || /^\.+$/.test(clean)) return 'Attachment';
  if (clean.length <= 120) return clean;
  const extension = extname(clean).slice(0, 12);
  return clean.slice(0, 120 - extension.length) + extension;
}

/** The name a copy is kept under: made here from its id, never the sender's. Only a short plain extension, which tells parsers the kind, survives. */
export function storedName(id: string, name: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error('Not a valid attachment id.');
  const extension = extname(displayName(name)).toLowerCase();
  return `${id}${/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ''}`;
}

/** A file waiting for a message: a document's start (its whole text is kept for read_attachment), or a picture ready to send. */
export type Waiting = { name: string; text: string } | { name: string; picture: Attachment };
export const isPicture = (file: Waiting): file is { name: string; picture: Attachment } => 'picture' in file;

export interface Reading {
  id(): string;
  /** A document's text, read by the parser from the file at this path. */
  extract(path: string): Promise<string>;
  /** Keeps a document's whole text for read_attachment. */
  keepText(id: string, text: string): void;
}

/**
 * What you attach before sending. A document waits as its start (the rest is read on request); a
 * picture waits as a prepared file in the `waiting` folder, so no picture sits in memory, and moves
 * beside the conversation's other pictures when its message is sent. Only an id leaves for the window.
 */
export class Attachments {
  private readonly waiting = new Map<string, Waiting>();

  constructor(readonly dir: string, private readonly reading: Reading) {
    // Nothing waiting survives a restart, so its files are of no use.
    rmSync(this.waitingDir, { recursive: true, force: true });
  }

  private get waitingDir(): string {
    return join(this.dir, 'waiting');
  }
  /** Where a picture stays once sent; only its name is trusted, so this is always inside the folder. */
  private fileOf(picture: Attachment): string {
    return join(this.dir, basename(picture.path));
  }

  get(id: string): Waiting | undefined {
    return this.waiting.get(id);
  }

  /** A file chosen in the file dialog. */
  async fromPath(path: string): Promise<AttachedFile> {
    const name = displayName(basename(path));
    if ((await stat(path)).size > MAX_PICKED_BYTES) throw new Error(`${name} is too large to attach (over 30 MB).`);
    // Pictures are known by their first bytes, never by their name; a document is read by its parser, where it is.
    const head = await readHead(path);
    if (imageMime(head) || unsupportedPicture(name, head)) return this.addPicture(name, await readFile(path));
    return this.addDocument(name, path, false);
  }

  /** A file pasted or dropped into the chat box: its bytes and the name it had. */
  async fromBytes(name: unknown, value: unknown): Promise<AttachedFile> {
    const bytes = asBytes(value);
    if (typeof name !== 'string' || !bytes) throw new Error('That file could not be attached.');
    const label = displayName(name);
    if (!bytes.byteLength) throw new Error(`${label} is empty.`);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`${label} is too large to attach (over 20 MB).`);
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (imageMime(buffer) || unsupportedPicture(label, buffer)) return this.addPicture(label, buffer);
    // A parser reads a file: this copy is named by us, never by the sender, and is gone once read.
    const copy = join(this.waitingDir, storedName(`${this.reading.id()}-upload`, label));
    await mkdir(this.waitingDir, { recursive: true });
    await writeFile(copy, buffer);
    return this.addDocument(label, copy, true);
  }

  private async addPicture(name: string, bytes: Buffer): Promise<AttachedFile> {
    const mime = imageMime(bytes);
    if (!mime) throw new Error(`${name}: pictures must be PNG, JPEG, GIF or WebP. Save it as one of those and attach it again.`);
    let image: ReturnType<typeof prepareImage>;
    try {
      image = prepareImage(bytes, mime);
    } catch (error) {
      throw new Error(`${name}: ${error instanceof Error ? error.message : 'That picture could not be read.'}`);
    }
    const id = this.reading.id(), file = `${id}.${pictureExtension(image.mime)}`;
    await mkdir(this.waitingDir, { recursive: true });
    await writeFile(join(this.waitingDir, file), image.bytes);
    const picture: Attachment = { id, name, mime: image.mime, size: image.bytes.length, path: join(this.dir, file), kind: 'image', ...(image.thumbnail ? { thumbnail: image.thumbnail } : {}) };
    this.remember(id, { name, picture });
    return { id, name, ...(image.thumbnail ? { thumbnail: image.thumbnail } : {}) };
  }

  private async addDocument(name: string, path: string, temporary: boolean): Promise<AttachedFile> {
    let content: string;
    try {
      content = await this.reading.extract(path);
    } catch (error) {
      throw new Error(`${name}: ${explain(name, error)}`);
    } finally {
      if (temporary) await rm(path, { force: true });
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES)
      throw new Error(`${name}: Attachment exceeds the 5 MB ingestion limit. Split the document before attaching it.`);
    const id = this.reading.id();
    this.reading.keepText(id, content);
    this.remember(id, { name, text: content.slice(0, PREVIEW_CHARS) });
    return { id, name };
  }

  private remember(id: string, file: Waiting): void {
    if (this.waiting.size >= MAX_WAITING) {
      const [oldest, gone] = this.waiting.entries().next().value!;
      this.waiting.delete(oldest);
      if (isPicture(gone)) void rm(join(this.waitingDir, basename(this.fileOf(gone.picture))), { force: true });
    }
    this.waiting.set(id, file);
  }

  /** Moves the pictures of a message you are sending beside the conversation's other pictures; each goes with one message. */
  async keep(pictures: readonly Attachment[]): Promise<Attachment[]> {
    if (!pictures.length) return [];
    await mkdir(this.dir, { recursive: true });
    for (const picture of pictures) {
      const to = this.fileOf(picture);
      await rename(join(this.waitingDir, basename(to)), to).catch(() => {
        if (!existsSync(to)) throw new Error(`${picture.name} is no longer available. Attach it again.`);
      });
      this.waiting.delete(picture.id);
    }
    return [...pictures];
  }

  /**
   * The pictures a request carries, read from disk now and held only while it is built: the latest
   * few. A model that can't see pictures is given only their names, so none are read for it.
   */
  async load(attachments: readonly Attachment[], sees: boolean): Promise<Map<string, RequestImage>> {
    const loaded = new Map<string, RequestImage>();
    const pictures = attachments.filter(a => a.kind === 'image');
    for (const a of sees ? pictures.slice(-MAX_PICTURES_SENT) : pictures) {
      if (!sees) { loaded.set(a.id, { name: a.name, mime: a.mime, base64: '' }); continue; }
      // A picture whose file is gone is left out.
      const bytes = await this.read(a).catch(() => undefined);
      if (bytes) loaded.set(a.id, { name: a.name, mime: a.mime, base64: bytes.toString('base64') });
    }
    return loaded;
  }

  private async read(picture: Attachment): Promise<Buffer> {
    const sent = this.fileOf(picture);
    return readFile(sent).catch(() => readFile(join(this.waitingDir, basename(sent))));
  }

  /** Deletes pictures that were sent, with the conversation that held them. */
  async remove(pictures: readonly Attachment[]): Promise<void> {
    await Promise.all(pictures.map(picture => rm(this.fileOf(picture), { force: true })));
  }
}

/** The first bytes of a file, enough to tell a picture. */
async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(16), { bytesRead } = await handle.read(head, 0, 16, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Why a document could not be read, in words that fit what you attached. */
function explain(name: string, error: unknown): string {
  const message = error instanceof Error ? error.message : 'It could not be read.';
  if (/^Unsupported binary document/.test(message) && !/\.xls$/i.test(name))
    return "I can't read that kind of file. Pictures (PNG, JPEG, GIF, WebP), PDF, Word (.docx), Excel (.xlsx) and plain text files work.";
  return message;
}
