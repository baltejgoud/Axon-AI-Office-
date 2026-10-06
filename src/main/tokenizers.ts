import { Buffer } from 'node:buffer';
import { encodingForModel, getEncoding, type Tiktoken, type TiktokenModel } from 'js-tiktoken';
import type { ModelSpec } from '../shared/types';
const cache = new Map<string, Tiktoken>();
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
      const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
      // Treat special-token-looking user text literally.
      return (encoder ? encoder.encode(text, [], []).length : Buffer.byteLength(text, 'utf8')) + 8;
    } };
}
