import { nativeImage, type NativeImage } from 'electron';

/** The longest edge sent: bigger pictures cost more and models shrink them to about this anyway. */
export const MAX_EDGE = 1568;
/** About 5 MB once base64-encoded, the strictest provider's limit for one picture. */
export const MAX_IMAGE_BYTES = 3_750_000;
/** The longest edge of the preview kept with your message. */
const THUMBNAIL_EDGE = 120;

/** The picture types every provider takes, known by their first bytes, never by the file's name. */
export function imageMime(bytes: Uint8Array): string | null {
  const starts = (offset: number, sig: string | number[]) =>
    bytes.length >= offset + sig.length && [...(typeof sig === 'string' ? Buffer.from(sig, 'latin1') : sig)].every((b, i) => bytes[offset + i] === b);
  if (starts(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(0, 'GIF87a') || starts(0, 'GIF89a')) return 'image/gif';
  if (starts(0, 'RIFF') && starts(8, 'WEBP')) return 'image/webp';
  return null;
}

/** The file extension a picture of this type is kept under. */
export const pictureExtension = (mime: string): string => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' })[mime] ?? 'png';

/**
 * Pictures of kinds models don't take (HEIC from an iPhone, AVIF, BMP, TIFF): known by their name or,
 * for HEIC and AVIF, by the brand after the box size. They aren't documents either, so they get their own explanation.
 */
export function unsupportedPicture(name: string, bytes: Uint8Array): boolean {
  if (/\.(heic|heif|avif|bmp|tiff?)$/i.test(name)) return true;
  const brand = bytes.length >= 12 && Buffer.from(bytes.subarray(4, 8)).toString('latin1') === 'ftyp' ? Buffer.from(bytes.subarray(8, 12)).toString('latin1') : '';
  return /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis)$/.test(brand);
}

/** A JPEG's EXIF orientation (1 to 8); 1, upright, when it has none or the block is damaged. */
export function jpegOrientation(bytes: Uint8Array): number {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 2;
  while (at + 4 <= data.length && data[at] === 0xff) {
    const marker = data[at + 1], length = data.readUInt16BE(at + 2);
    if (marker === 0xda || marker === 0xd9) break; // The image data starts: no EXIF came before it.
    if (marker === 0xe1 && data.toString('latin1', at + 4, at + 10) === 'Exif\0\0') {
      const tiff = at + 10, end = Math.min(data.length, at + 2 + length);
      if (tiff + 8 > end) return 1;
      const little = data.toString('latin1', tiff, tiff + 2) === 'II';
      const u16 = (i: number) => (i + 2 <= end ? (little ? data.readUInt16LE(i) : data.readUInt16BE(i)) : -1);
      const ifd = tiff + (little ? data.readUInt32LE(tiff + 4) : data.readUInt32BE(tiff + 4));
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (u16(entry) !== 0x0112) continue;
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
      return 1;
    }
    at += 2 + length;
  }
  return 1;
}

/** Per EXIF orientation: where the pixel shown at (x, y) is stored, in a stored image w wide and h high. */
const SOURCE: Record<number, (x: number, y: number, w: number, h: number) => [number, number]> = {
  2: (x, y, w) => [w - 1 - x, y],
  3: (x, y, w, h) => [w - 1 - x, h - 1 - y],
  4: (x, y, _w, h) => [x, h - 1 - y],
  5: (x, y) => [y, x],
  6: (x, y, _w, h) => [y, h - 1 - x],
  7: (x, y, w, h) => [w - 1 - y, h - 1 - x],
  8: (x, y, w) => [w - 1 - y, x]
};

/**
 * A 4-byte-per-pixel bitmap turned upright for an EXIF orientation: 2 to 4 mirror or flip it, 5 to 8
 * also swap its width and height.
 */
export function orient(bitmap: Buffer, width: number, height: number, orientation: number): { bitmap: Buffer; width: number; height: number } {
  const source = SOURCE[orientation];
  if (!source) return { bitmap, width, height };
  const w = orientation >= 5 ? height : width, h = orientation >= 5 ? width : height;
  const out = Buffer.alloc(bitmap.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [sx, sy] = source(x, y, width, height);
      const from = (sy * width + sx) * 4;
      bitmap.copy(out, (y * w + x) * 4, from, from + 4);
    }
  return { bitmap: out, width: w, height: h };
}

export interface PreparedImage {
  mime: string;
  bytes: Buffer;
  thumbnail?: string;
}

const megabytes = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;

/**
 * A picture ready to send: PNG and JPEG are turned upright (EXIF) and shrunk to MAX_EDGE, and get a
 * preview; GIF and WebP, which Electron can't decode, go as they are when small enough.
 */
export function prepareImage(bytes: Buffer, mime: string): PreparedImage {
  if (mime !== 'image/png' && mime !== 'image/jpeg') {
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`That picture is ${megabytes(bytes.length)}; pictures must be under ${megabytes(MAX_IMAGE_BYTES)}. Save it as PNG or JPEG to have it shrunk.`);
    return { mime, bytes };
  }
  let image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('That picture could not be read. It may be damaged.');
  const turn = mime === 'image/jpeg' ? jpegOrientation(bytes) : 1;
  const { width, height } = image.getSize();
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  // Already right: sent byte for byte.
  if (scale === 1 && turn === 1 && bytes.length <= MAX_IMAGE_BYTES) return { mime, bytes, thumbnail: thumbnailOf(image, mime) };
  if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' });
  if (turn !== 1) {
    const size = image.getSize();
    const upright = orient(image.toBitmap(), size.width, size.height, turn);
    image = nativeImage.createFromBitmap(upright.bitmap, { width: upright.width, height: upright.height });
  }
  let out = { mime, bytes: mime === 'image/png' ? image.toPNG() : image.toJPEG(85) };
  // A photo saved as PNG can stay too big even when shrunk.
  if (out.bytes.length > MAX_IMAGE_BYTES) out = { mime: 'image/jpeg', bytes: image.toJPEG(85) };
  if (out.bytes.length > MAX_IMAGE_BYTES) throw new Error(`That picture is still ${megabytes(out.bytes.length)} after shrinking; pictures must be under ${megabytes(MAX_IMAGE_BYTES)}.`);
  return { ...out, thumbnail: thumbnailOf(image, out.mime) };
}

function thumbnailOf(image: NativeImage, mime: string): string {
  const { width, height } = image.getSize();
  const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(width, height));
  const small = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }) : image;
  // Photos as JPEG keep the preview small; PNG keeps a screenshot's transparency.
  return mime === 'image/jpeg' ? `data:image/jpeg;base64,${small.toJPEG(70).toString('base64')}` : small.toDataURL();
}
