import { vi } from 'vitest';

type Handler = (body: unknown) => { status: number; body?: unknown };

/** Stubs global fetch with handlers keyed by "METHOD /path". Unmatched requests 404. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const handler = routes[key];
    const res = handler
      ? handler(body)
      : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found.' } } };
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

export const unauthenticated = () => ({
  status: 401,
  body: { error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } },
});
