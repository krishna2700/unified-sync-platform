/**
 * Provider adapters must be stateless across calls (the sync engine may call `fetchFull`/
 * `fetchIncremental` for the same run from a fresh process after a restart). Any continuation
 * state a provider needs mid-run (a raw pagination cursor plus a running watermark, for example)
 * is therefore encoded into the opaque `pageToken` string itself rather than kept in adapter
 * instance fields.
 */
export function encodePageToken<T>(data: T): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function decodePageToken<T>(token: string | null): T | null {
  if (!token) return null;
  return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as T;
}
