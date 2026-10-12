/** What can go with one message, for the window and for main to agree on. */

/** Files that go with one message. */
export const MAX_ATTACHMENTS = 5;
/** The largest file pasted or dropped into the chat box; a picture bigger than models take is shrunk after. */
export const MAX_UPLOAD_BYTES = 20_000_000;

/** A file that is ready to go with your next message; pictures come with a small `data:` preview. */
export interface AttachedFile {
  id: string;
  name: string;
  thumbnail?: string;
}

const PICTURE_EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * The name a pasted screenshot gets, from the time it was pasted: "Pasted image 14-32.png".
 * The clipboard names every one "image.png"; two pasted together are told apart by a number.
 */
export function pastedName(mime: string, at: Date, number = 1): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const extension = PICTURE_EXTENSION[mime.toLowerCase()] ?? 'png';
  return `Pasted image ${pad(at.getHours())}-${pad(at.getMinutes())}${number > 1 ? ` (${number})` : ''}.${extension}`;
}

/** The clipboard's own placeholder name for a picture (or none at all), as opposed to a real file's name. */
export const isClipboardName = (name: string) => !name || /^image\.(png|jpe?g|gif|webp)$/i.test(name);

/** The bytes in what an IPC call carried: a typed array or a plain buffer; null for anything else. */
export function asBytes(value: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return new Uint8Array(value as ArrayBuffer);
  return null;
}
