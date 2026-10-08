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

export type StopState = 'UPCOMING' | 'ARRIVED' | 'DEPARTED' | 'SKIPPED';

export interface StationStatus {
  code: string;
  name: string;
  scheduledArrival: string | null;
  scheduledDeparture: string | null;
  expectedArrival: string | null;
  expectedDeparture: string | null;
  delayMinutes: number;
  platform: string | null;
  state: StopState;
}

export interface TrainStatus {
  trainNumber: string;
  trainName: string;
  startDate: string;
  state: 'NOT_STARTED' | 'RUNNING' | 'ARRIVED' | 'CANCELLED';
  currentStation: { code: string; name: string } | null;
  delayMinutes: number;
  cancelled: boolean;
  diverted: boolean;
  note: string | null;
  stations: StationStatus[];
  fetchedAt: string;
  source: string;
}

export type SourceHealth = 'HEALTHY' | 'SLOW' | 'DOWN';

export interface AppNotification {
  id: string;
  journeyId: string | null;
  eventKey: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface AlertRunSummary {
  ranAt: string;
  journeysConsidered: number;
  trainRuns: number;
  statusFetches: number;
  events: number;
  notificationsSent: number;
  duplicatesSkipped: number;
  quietHoursSkipped: number;
  errors: string[];
}

export interface SimulatorState {
  alertRun: AlertRunSummary | null;
  now: string;
  offsetMinutes: number;
  health: SourceHealth;
  scenarios: { id: string; label: string; description: string }[];
  trains: { trainNumber: string; trainName: string; from: string; to: string; scenario: string }[];
  stats: {
    upstreamCalls: number;
    cacheHits: number;
    coalesced: number;
    staleServed: number;
    failures: number;
    breaker: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  };
}

export type ClockAction =
  | { action: 'advance'; minutes: number }
  | { action: 'reset' }
  | { action: 'beforeDeparture'; trainNumber: string; startDate?: string; minutes: number };

export interface ProposalView {
  id: string;
  kind: 'CREATE_JOURNEY' | 'DELETE_JOURNEY';
  summary: string;
  expiresAt: string;
}

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'start' | 'done' | 'error' }
  | { type: 'proposal'; proposal: ProposalView }
  | { type: 'notice'; message: string }
  | { type: 'done'; sessionId: string | null; mode: 'claude' | 'offline' }
  | { type: 'error'; message: string };

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
  proposals?: ProposalView[];
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

/**
 * True in the GitHub Pages build (`vite build --mode pages`), where the API
 * runs inside the browser. VITE_DEMO=true also turns it on, e.g. for a local dev demo.
 */
export const DEMO_MODE = import.meta.env.MODE === 'pages' || import.meta.env.VITE_DEMO === 'true';

/** fetch, or in demo builds the in-browser backend (loaded only there). */
const transport = (input: string, init?: RequestInit): Promise<Response> =>
  DEMO_MODE ? import('../demo/backend').then((m) => m.demoFetch(input, init)) : fetch(input, init);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await transport(path, {
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

  /** With `boardingStation`, `date` is the boarding date and the server finds the right run. */
  trainStatus: (
    trainNumber: string,
    date: string,
    signal?: AbortSignal,
    boardingStation?: string,
  ) =>
    request<{ status: TrainStatus }>(
      `/api/trains/${trainNumber}/status?date=${encodeURIComponent(date)}` +
        (boardingStation ? `&boardingStation=${encodeURIComponent(boardingStation)}` : ''),
      { signal },
    ),

  notifications: (signal?: AbortSignal) =>
    request<{ notifications: AppNotification[]; unreadCount: number }>('/api/notifications', {
      signal,
    }),
  markNotificationRead: (id: string) =>
    request<void>(`/api/notifications/${id}/read`, { method: 'POST' }),
  markAllNotificationsRead: () =>
    request<{ marked: number }>('/api/notifications/read-all', { method: 'POST' }),
  runAlerts: () => request<SimulatorState>('/api/simulator/run-alerts', { method: 'POST' }),

  chatInfo: () => request<{ mode: 'claude' | 'offline'; signedIn: boolean }>('/api/chat/info'),
  chatHistory: () =>
    request<{ sessionId: string | null; messages: ChatHistoryMessage[] }>('/api/chat/history'),
  confirmProposal: (id: string) =>
    request<{ result: string }>(`/api/chat/proposals/${id}/confirm`, { method: 'POST' }),
  cancelProposal: (id: string) =>
    request<void>(`/api/chat/proposals/${id}/cancel`, { method: 'POST' }),

  simulator: () => request<SimulatorState>('/api/simulator'),
  setScenario: (trainNumber: string, scenario: string) =>
    request<SimulatorState>('/api/simulator/scenario', json({ trainNumber, scenario })),
  moveClock: (action: ClockAction) => request<SimulatorState>('/api/simulator/clock', json(action)),
  setSourceHealth: (health: SourceHealth) =>
    request<SimulatorState>('/api/simulator/health', json({ health })),
};

/** Fired after any simulator change so live views refresh straight away. */
export const SIMULATOR_CHANGED = 'safar:simulator-changed';
export const notifySimulatorChanged = () => window.dispatchEvent(new Event(SIMULATOR_CHANGED));

/** Fired when journeys change outside the dashboard form (e.g. confirmed in the assistant). */
export const JOURNEYS_CHANGED = 'safar:journeys-changed';
export const notifyJourneysChanged = () => window.dispatchEvent(new Event(JOURNEYS_CHANGED));

/**
 * Sends a chat message and calls `onEvent` for each server-sent event as it
 * arrives. Rejects with ApiError for non-streaming errors (400, 429).
 */
export async function streamChat(
  body: {
    message: string;
    sessionId?: string;
    history?: { role: 'user' | 'assistant'; text: string }[];
  },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await transport('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, 'NETWORK', "Can't reach Safar Saathi. Check your connection.");
  }
  if (!res.ok || !res.body) {
    const e = (
      (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null
    )?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'HTTP_ERROR',
      e?.message ?? `Request failed (HTTP ${res.status})`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let cut: number;
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = block.split('\n').find((l) => l.startsWith('data: '));
      if (data) onEvent(JSON.parse(data.slice(6)) as ChatEvent);
    }
    if (done) break;
  }
}
