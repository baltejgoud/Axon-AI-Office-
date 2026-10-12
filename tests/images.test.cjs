// Pictures you attach: what they are (by their bytes, not their name) and which way is up.
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { nativeImage: {} };
  return original.call(this, name, ...args);
};
require.extensions['.ts'] = (module, file) => module._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText, file
);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { imageMime, jpegOrientation, orient } = require('../src/main/images.ts');

const bytes = (...parts) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

/** A JPEG whose EXIF says how to turn it, behind a JFIF segment as cameras write them. */
function jpegWithOrientation(orientation, order = 'MM') {
  const u16 = (n) => (order === 'MM' ? [n >> 8, n & 255] : [n & 255, n >> 8]);
  const u32 = (n) => (order === 'MM' ? [0, 0, n >> 8, n & 255] : [n & 255, n >> 8, 0, 0]);
  const tiff = bytes(order, u16(42), u32(8), u16(1), u16(0x0112), u16(3), u32(1), u16(orientation), [0, 0], u32(0));
  const exif = bytes('Exif\0\0', tiff);
  const jfif = bytes('JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0]);
  return bytes([0xff, 0xd8], [0xff, 0xe0, 0, jfif.length + 2], jfif, [0xff, 0xe1, 0, exif.length + 2], exif, [0xff, 0xda, 0, 2, 0xff, 0xd9]);
}

test('a picture is known by its bytes', () => {
  assert.equal(imageMime(bytes([0x89], 'PNG\r\n\x1a\n', [0, 0, 0, 13])), 'image/png');
  assert.equal(imageMime(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16])), 'image/jpeg');
  assert.equal(imageMime(bytes('GIF89a', [1, 0, 1, 0])), 'image/gif');
  assert.equal(imageMime(bytes('RIFF', [26, 0, 0, 0], 'WEBPVP8L')), 'image/webp');
  assert.equal(imageMime(bytes('RIFF', [26, 0, 0, 0], 'WAVEfmt ')), null);
  assert.equal(imageMime(bytes('# Notes\nplain text')), null);
  assert.equal(imageMime(bytes([0x89, 0x50])), null);
});

test('a photo\'s EXIF orientation is read in either byte order', () => {
  assert.equal(jpegOrientation(jpegWithOrientation(6)), 6);
  assert.equal(jpegOrientation(jpegWithOrientation(8, 'II')), 8);
  assert.equal(jpegOrientation(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9])), 1);
});

test('a damaged EXIF block reads as upright instead of failing', () => {
  const cut = jpegWithOrientation(6).subarray(0, 40);
  assert.equal(jpegOrientation(cut), 1);
  assert.equal(jpegOrientation(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff], 'Exif\0\0MM')), 1);
});

test('a bitmap is turned upright for each orientation', () => {
  // 3 wide by 2 high; pixel n is four bytes of n.
  const bitmap = Buffer.from([0, 1, 2, 3, 4, 5].flatMap((n) => [n, n, n, n]));
  const pixels = ({ bitmap: out, width, height }) => ({ width, height, order: [...out].filter((_, i) => i % 4 === 0) });
  assert.deepEqual(pixels(orient(bitmap, 3, 2, 1)), { width: 3, height: 2, order: [0, 1, 2, 3, 4, 5] });
  assert.deepEqual(pixels(orient(bitmap, 3, 2, 3)), { width: 3, height: 2, order: [5, 4, 3, 2, 1, 0] });
  assert.deepEqual(pixels(orient(bitmap, 3, 2, 6)), { width: 2, height: 3, order: [3, 0, 4, 1, 5, 2] });
  assert.deepEqual(pixels(orient(bitmap, 3, 2, 8)), { width: 2, height: 3, order: [2, 5, 1, 4, 0, 3] });
  assert.deepEqual(pixels(orient(bitmap, 3, 2, 2)), { width: 3, height: 2, order: [2, 1, 0, 5, 4, 3] });
  assert.deepEqual(pixels(orient(bitmap, 3, 2, 5)), { width: 2, height: 3, order: [0, 3, 1, 4, 2, 5] });
});

const { unsupportedPicture, pictureExtension } = require('../src/main/images.ts');

test('pictures models do not take are known by name or by the brand an iPhone writes', () => {
  assert.equal(unsupportedPicture('IMG_0001.HEIC', bytes('anything')), true);
  assert.equal(unsupportedPicture('scan.tif', bytes('anything')), true);
  assert.equal(unsupportedPicture('photo', bytes([0, 0, 0, 24], 'ftypheic', [0, 0, 0, 0])), true);
  assert.equal(unsupportedPicture('photo', bytes([0, 0, 0, 24], 'ftypavif', [0, 0, 0, 0])), true);
  // An MP4 video is not a picture, and neither is a plain text file.
  assert.equal(unsupportedPicture('clip', bytes([0, 0, 0, 24], 'ftypmp42', [0, 0, 0, 0])), false);
  assert.equal(unsupportedPicture('notes.txt', bytes('# Notes')), false);
  assert.equal(unsupportedPicture('tiny', bytes([1, 2, 3])), false);
});

test('a picture is kept under the extension of what it is', () => {
  assert.deepEqual(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/other'].map(pictureExtension), ['png', 'jpg', 'gif', 'webp', 'png']);
});
