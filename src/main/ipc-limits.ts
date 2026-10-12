import { MAX_UPLOAD_BYTES, asBytes } from '../shared/attach';

/** What one call from the window may carry, as JSON. */
export const IPC_PAYLOAD_LIMIT = 2_200_000;

/**
 * Whether a call from the window is too big to take. Calls are counted as JSON, except a pasted or
 * dropped file: its bytes would count eight times over as JSON, so they are counted as bytes and may
 * be up to 20 MB (and that is the only call that may be).
 */
export function ipcPayloadTooLarge(method: string, args: readonly unknown[]): boolean {
  if (method !== 'attachData') return JSON.stringify(args).length > IPC_PAYLOAD_LIMIT;
  const [name, bytes] = args;
  const data = asBytes(bytes);
  return args.length !== 2 || typeof name !== 'string' || name.length > 2000 || !data || data.byteLength > MAX_UPLOAD_BYTES;
}
