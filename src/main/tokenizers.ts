import { Buffer } from 'node:buffer';
import { encodingForModel, getEncoding, type Tiktoken, type TiktokenModel } from 'js-tiktoken';
import type { ModelSpec } from '../shared/types';
const cache = new Map<string, Tiktoken>();

/** What one picture costs a request: about the 1,600 tokens a large one takes. Pictures count by number, never by their bytes. */
export const PICTURE_TOKENS = 1600;

/** A value as the text that gets counted, with the pictures in its messages taken out and counted apart. */
export function countable(value: unknown): { text: string; pictures: number } {
  if (typeof value === 'string') return { text: value, pictures: 0 };
  let pictures = 0;
  const text = JSON.stringify(value, (key, item) => {
    if (key === 'images' && Array.isArray(item) && item.every(image => image && typeof image.base64 === 'string')) {
      pictures += item.length;
      return undefined;
    }
    return item;
  }) ?? '';
  return { text, pictures };
}

export function tokenCounter(model?: ModelSpec, modelId = '') {
  const id = model?.id ?? modelId;
  let encoder: Tiktoken | undefined;
  if (model?.tokenizer !== 'bytes') {
    encoder = cache.get(model?.tokenizer ?? id);
    if (!encoder) try {
      encoder = model?.tokenizer ? getEncoding(model.tokenizer) : encodingForModel(id as TiktokenModel);
      cache.set(model?.tokenizer ?? id, encoder);
    } catch { /* Unknown provider models retain the conservative upper estimate. */ }
  }
  return { basis: encoder ? 'model-tokenizer' as const : 'byte-upper-bound' as const,
    count: (value: unknown) => {
      const { text, pictures } = countable(value);
      // Treat special-token-looking user text literally.
      return (encoder ? encoder.encode(text, [], []).length : Buffer.byteLength(text, 'utf8')) + 8 + pictures * PICTURE_TOKENS;
    } };
}
