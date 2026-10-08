import type { AlertType, CreateJourneyInput } from '@safar-saathi/server/schemas';

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Journey {
  id: string;
  trainNumber: string;
  fromStationCode: string;
  fromStationName: string | null;
  toStationCode: string;
  toStationName: string | null;
  journeyDate: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  alertTypes: AlertType[];
  createdAt: string;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  time: string;
  uptimeSeconds: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ApiError(0, 'NETWORK', "Can't reach Safar Saathi. Check your connection.");
  }

  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as
    (T & { error?: { code: string; message: string; fields?: Record<string, string> } }) | null;

  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'HTTP_ERROR',
      e?.message ?? `Request failed (HTTP ${res.status})`,
      e?.fields,
    );
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/api/health', { signal }),

  me: () => request<{ user: User }>('/api/auth/me'),
  register: (body: { name: string; email: string; password: string }) =>
    request<{ user: User }>('/api/auth/register', json(body)),
  login: (body: { email: string; password: string }) =>
    request<{ user: User }>('/api/auth/login', json(body)),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),

  listJourneys: () => request<{ journeys: Journey[] }>('/api/journeys'),
  createJourney: (body: CreateJourneyInput) =>
    request<{ journey: Journey }>('/api/journeys', json(body)),
  deleteJourney: (id: string) => request<void>(`/api/journeys/${id}`, { method: 'DELETE' }),
};
