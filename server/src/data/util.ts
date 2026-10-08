// Web Crypto (globalThis.crypto) works in Node 20+ and in browsers, so the
// data layer also runs in the GitHub Pages demo.
export const newId = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

/** Unguessable URL-safe token from `bytes` random bytes. */
export function randomToken(bytes = 24): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
