/**
 * GitHub Pages demo: the API, running inside the browser.
 *
 * Pages can only serve static files, so in demo builds (`vite build --mode pages`) the web
 * app's requests to /api/... are answered here instead of by the Node server.
 * This reuses the server's own modules: the data-access layer and migrations
 * (on SQLite-in-WebAssembly), the simulator, the resilience layer, the alert
 * engine and the offline Saathi. Data lives in this browser only. Auth here is
 * for demonstration, not security: anyone with the browser can read it.
 */
import {
  createDataAccess,
  DuplicateRecipientError,
  EmailTakenError,
  type User,
} from '@safar-saathi/server/data/index';
import { createEngineStore } from '@safar-saathi/server/data/engineStore';
import { DEMO_ACCOUNT, demoJourneys } from '@safar-saathi/server/db/demoAccount';
import { AlertEngine } from '@safar-saathi/server/alerts/engine';
import { DryRunEmailChannel, InAppChannel } from '@safar-saathi/server/alerts/channels';
import { OfflineAssistant } from '@safar-saathi/server/assistant/offline';
import { setHelpSource } from '@safar-saathi/server/assistant/siteHelp';
import type { AssistantEvent } from '@safar-saathi/server/assistant/types';
import { MockProvider } from '@safar-saathi/server/trains/mock/MockProvider';
import {
  SCENARIO_IDS,
  SCENARIOS,
  type ScenarioId,
} from '@safar-saathi/server/trains/mock/scenarios';
import { ResilientProvider } from '@safar-saathi/server/trains/resilient';
import { ProviderError, resolveStartDate } from '@safar-saathi/server/trains/index';
import { validationError } from '@safar-saathi/server/routes/errors';
import {
  addRecipientSchema,
  createJourneySchema,
  istDate,
  journeyDateProblem,
  journeySettingsSchema,
  loginSchema,
  registerSchema,
} from '@safar-saathi/server/schemas';
import helpMarkdown from '../../../docs/site-help.md?raw';
import { clearSavedDb, openBrowserDb, type BrowserDb } from './sqlite';

setHelpSource(() => helpMarkdown);

const SESSION_KEY = 'safar-saathi-demo-session';
const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const error = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status);
const noContent = () => new Response(null, { status: 204 });

const silentLog = {
  info: () => {},
  warn: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  error: (...args: unknown[]) => console.error('[demo]', ...args),
  child: () => silentLog,
  level: 'info',
  silent: () => {},
} as never;

async function hashPassword(password: string, salt: string = crypto.randomUUID()): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`)),
  );
  return `demo-sha256$${salt}$${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [, salt] = stored.split('$');
  return salt !== undefined && (await hashPassword(password, salt)) === stored;
}

function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function writeSession(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(SESSION_KEY, userId);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: signed in for this page only */
  }
}

async function createBackend() {
  const db: BrowserDb = await openBrowserDb();
  const data = createDataAccess(db as never);
  const sim = new MockProvider();
  const provider = new ResilientProvider(sim, { retries: 1, timeoutMs: 4000 });
  const store = createEngineStore(db as never);
  const alerts = new AlertEngine({
    store,
    provider,
    clock: sim.clock,
    inApp: new InAppChannel(store),
    email: new DryRunEmailChannel(silentLog),
    log: silentLog,
    appUrl: `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`,
  });
  const offline = new OfflineAssistant();
  let sessionUserId = readSession();

  // The demo account always exists, with the username and password from DEMO_ACCOUNT.
  const demo = data.accounts.findUserForLogin(DEMO_ACCOUNT.email);
  if (!demo) {
    const user = data.accounts.createUser({
      name: DEMO_ACCOUNT.name,
      email: DEMO_ACCOUNT.email,
      passwordHash: await hashPassword(DEMO_ACCOUNT.password),
    });
    for (const j of demoJourneys(new Date())) data.forUser(user.id).journeys.create(j);
  } else if (!(await verifyPassword(demo.passwordHash, DEMO_ACCOUNT.password))) {
    // DEMO_ACCOUNT changed since this browser last visited.
    data.accounts.setPassword(demo.id, await hashPassword(DEMO_ACCOUNT.password));
  }

  const currentUser = (): User | null => {
    const user = sessionUserId ? data.accounts.getUser(sessionUserId) : null;
    if (!user && sessionUserId) {
      sessionUserId = null;
      writeSession(null);
    }
    return user;
  };
  const signIn = (user: User) => {
    sessionUserId = user.id;
    writeSession(user.id);
  };

  const runAlerts = () => alerts.runOnce({ force: true }).catch(() => null);
  // Like the server's cron: check alerts every minute while the page is open.
  setInterval(() => void alerts.runOnce().catch(() => null), 60_000);
  setTimeout(() => void runAlerts(), 1000);

  const simulatorSnapshot = () => ({
    alertRun: alerts.lastRun,
    now: sim.clock.now().toISOString(),
    offsetMinutes: sim.clock.offsetMinutes,
    health: sim.health,
    scenarios: SCENARIO_IDS.map((id) => ({ id, ...SCENARIOS[id] })),
    trains: sim.trains().map((t) => ({
      trainNumber: t.trainNumber,
      trainName: t.trainName,
      from: t.stops[0]!.code,
      to: t.stops[t.stops.length - 1]!.code,
      scenario: sim.scenarioFor(t.trainNumber),
    })),
    stats: provider.stats(),
  });
  const simulatorChanged = async () => {
    provider.invalidate();
    await runAlerts();
    return json(simulatorSnapshot());
  };

  function chatStream(
    message: string,
    user: User | null,
    sessionId: string | undefined,
    history: { role: 'user' | 'assistant'; text: string }[],
  ) {
    const mine = user ? data.forUser(user.id) : null;
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (e: AssistantEvent) =>
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        let sid: string | null = null;
        let past = history;
        if (mine) {
          const existing = sessionId ? mine.chat.getMessages(sessionId) : null;
          sid = existing ? sessionId! : mine.chat.createSession(message.slice(0, 80)).id;
          past = (existing ?? []).flatMap((m) =>
            m.role === 'user' || m.role === 'assistant'
              ? [{ role: m.role, text: (m.content as { text?: string }).text ?? '' }]
              : [],
          );
          mine.chat.appendMessage(sid, { role: 'user', content: { text: message } });
        }
        try {
          const result = await offline.respond({
            message,
            history: past.slice(-16),
            ctx: { user, mine, provider, now: sim.clock.now() },
            emit,
            signal: new AbortController().signal,
          });
          if (mine && sid)
            mine.chat.appendMessage(sid, {
              role: 'assistant',
              content: { text: result.text, proposals: result.proposals },
            });
          emit({ type: 'done', sessionId: sid, mode: 'offline' });
        } catch {
          emit({ type: 'error', message: "Sorry, I couldn't answer just now." });
        }
        controller.close();
      },
    });
  }

  async function handle(method: string, url: URL, body: unknown): Promise<Response> {
    const path = url.pathname.replace(/^.*?\/api\//, '/api/');
    const user = currentUser();
    const mine = user ? data.forUser(user.id) : null;
    const needUser = () => error(401, 'UNAUTHENTICATED', 'Please sign in.');
    let m: RegExpMatchArray | null;

    // Health and auth
    if (path === '/api/health')
      return json({
        status: 'ok',
        service: 'safar-saathi-demo',
        time: new Date().toISOString(),
        uptimeSeconds: 0,
      });
    if (path === '/api/auth/me') return user ? json({ user }) : needUser();
    if (path === '/api/auth/logout' && method === 'POST') {
      sessionUserId = null;
      writeSession(null);
      return noContent();
    }
    if (path === '/api/auth/login' && method === 'POST') {
      const parsed = loginSchema.safeParse(body);
      if (!parsed.success) return json(validationError(parsed.error), 400);
      const account = data.accounts.findUserForLogin(parsed.data.email);
      if (!account || !(await verifyPassword(account.passwordHash, parsed.data.password))) {
        return error(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      }
      const { passwordHash: _omit, ...u } = account;
      signIn(u);
      return json({ user: u });
    }
    if (path === '/api/auth/register' && method === 'POST') {
      const parsed = registerSchema.safeParse(body);
      if (!parsed.success) return json(validationError(parsed.error), 400);
      try {
        const u = data.accounts.createUser({
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash: await hashPassword(parsed.data.password),
        });
        signIn(u);
        return json({ user: u }, 201);
      } catch (err) {
        if (err instanceof EmailTakenError)
          return error(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
        throw err;
      }
    }

    // Journeys
    if (path === '/api/journeys') {
      if (!mine) return needUser();
      if (method === 'GET') return json({ journeys: mine.journeys.list() });
      const parsed = createJourneySchema.safeParse(body);
      if (!parsed.success) return json(validationError(parsed.error), 400);
      const problem = journeyDateProblem(parsed.data.journeyDate);
      if (problem)
        return json(
          {
            error: {
              code: 'VALIDATION',
              message: 'Please check the highlighted fields.',
              fields: { journeyDate: problem },
            },
          },
          400,
        );
      const journey = mine.journeys.create(parsed.data);
      void runAlerts();
      return json({ journey }, 201);
    }
    if ((m = path.match(/^\/api\/journeys\/([\w-]+)$/)) && method === 'DELETE') {
      if (!mine) return needUser();
      return mine.journeys.delete(m[1]!)
        ? noContent()
        : error(404, 'NOT_FOUND', 'Journey not found.');
    }

    // Journey settings, recipients, invite link
    if ((m = path.match(/^\/api\/journeys\/([\w-]+)\/settings$/)) && method === 'PUT') {
      if (!mine) return needUser();
      const parsed = journeySettingsSchema.safeParse(body);
      if (!parsed.success) return json(validationError(parsed.error), 400);
      const result = mine.journeys.updateSettings(m[1]!, parsed.data);
      if (result === 'NOT_FOUND') return error(404, 'NOT_FOUND', 'Journey not found.');
      if (result === 'BAD_CONNECTION') {
        return json(
          {
            error: {
              code: 'VALIDATION',
              message: 'Please check the highlighted fields.',
              fields: { connectsToJourneyId: 'Choose another of your journeys' },
            },
          },
          400,
        );
      }
      void runAlerts();
      return json({ journey: result });
    }
    if ((m = path.match(/^\/api\/journeys\/([\w-]+)\/recipients$/))) {
      if (!mine) return needUser();
      if (method === 'GET') {
        const list = mine.recipients.listForJourney(m[1]!);
        return list ? json({ recipients: list }) : error(404, 'NOT_FOUND', 'Journey not found.');
      }
      const parsed = addRecipientSchema.safeParse(body);
      if (!parsed.success) return json(validationError(parsed.error), 400);
      try {
        const recipient = mine.recipients.add(m[1]!, parsed.data);
        return recipient ? json({ recipient }, 201) : error(404, 'NOT_FOUND', 'Journey not found.');
      } catch (err) {
        if (err instanceof DuplicateRecipientError) {
          return json(
            { error: { code: 'DUPLICATE', message: err.message, fields: { email: err.message } } },
            409,
          );
        }
        throw err;
      }
    }
    if (
      (m = path.match(/^\/api\/journeys\/([\w-]+)\/recipients\/([\w-]+)$/)) &&
      method === 'DELETE'
    ) {
      if (!mine) return needUser();
      const ok =
        mine.recipients.listForJourney(m[1]!)?.some((r) => r.id === m![2]) &&
        mine.recipients.remove(m[2]!);
      return ok ? noContent() : error(404, 'NOT_FOUND', 'Recipient not found.');
    }
    if ((m = path.match(/^\/api\/journeys\/([\w-]+)\/invite$/))) {
      if (!mine) return needUser();
      const result = mine.journeys.setInvite(m[1]!, method === 'POST');
      if (!result) return error(404, 'NOT_FOUND', 'Journey not found.');
      return method === 'POST' ? json(result) : noContent();
    }

    // Public links (no sign-in)
    const gone = () =>
      error(404, 'NOT_FOUND', 'This link is no longer valid. Ask the traveller for a new one.');
    if ((m = path.match(/^\/api\/invites\/([\w-]+)$/))) {
      if (method === 'GET') {
        const invite = data.publicLinks.inviteInfo(m[1]!);
        return invite ? json({ invite }) : gone();
      }
      const parsed = addRecipientSchema.safeParse(body);
      if (!parsed.success) return json(validationError(parsed.error), 400);
      try {
        return data.publicLinks.join(m[1]!, parsed.data) ? json({ joined: true }, 201) : gone();
      } catch (err) {
        if (err instanceof DuplicateRecipientError)
          return error(409, 'DUPLICATE', "You're already getting alerts for this journey.");
        throw err;
      }
    }
    if ((m = path.match(/^\/api\/opt-out\/([\w-]+)$/))) {
      if (method === 'GET') {
        const optOut = data.publicLinks.optOutInfo(m[1]!);
        return optOut ? json({ optOut }) : gone();
      }
      return data.publicLinks.optOut(m[1]!) ? json({ optedOut: true }) : gone();
    }

    // Train data
    if (path === '/api/trains/capabilities')
      return json({ source: provider.name, capabilities: provider.capabilities() });
    if ((m = path.match(/^\/api\/trains\/(\d{5})\/(status|schedule)$/))) {
      const train = m[1]!;
      try {
        if (m[2] === 'schedule') {
          const schedule = await provider.getSchedule(train);
          return schedule
            ? json({ schedule })
            : error(404, 'TRAIN_NOT_FOUND', `No data for train ${train}.`);
        }
        const date = url.searchParams.get('date') ?? istDate();
        const boarding = url.searchParams.get('boardingStation')?.toUpperCase();
        const start = boarding
          ? resolveStartDate(await provider.getSchedule(train), boarding, date)
          : date;
        const status = await provider.getLiveStatus(train, start);
        return status
          ? json({ status })
          : error(404, 'TRAIN_NOT_FOUND', `No data for train ${train}.`);
      } catch (err) {
        if (err instanceof ProviderError)
          return error(
            503,
            'TRAIN_DATA_UNAVAILABLE',
            'Live train data could not be fetched right now.',
          );
        throw err;
      }
    }

    // Notifications
    if (path === '/api/notifications') {
      if (!mine) return needUser();
      return json({
        notifications: mine.notifications.list(50),
        unreadCount: mine.notifications.unreadCount(),
      });
    }
    if (path === '/api/notifications/read-all') {
      if (!mine) return needUser();
      return json({ marked: mine.notifications.markAllRead() });
    }
    if ((m = path.match(/^\/api\/notifications\/([\w-]+)\/read$/))) {
      if (!mine) return needUser();
      return mine.notifications.markRead(m[1]!)
        ? noContent()
        : error(404, 'NOT_FOUND', 'Notification not found.');
    }

    // Simulator
    if (path === '/api/simulator') return json(simulatorSnapshot());
    if (path === '/api/simulator/run-alerts') {
      await runAlerts();
      return json(simulatorSnapshot());
    }
    if (path === '/api/simulator/scenario') {
      const b = body as { trainNumber: string; scenario: ScenarioId };
      if (!SCENARIO_IDS.includes(b.scenario) || !sim.setScenario(b.trainNumber, b.scenario))
        return error(400, 'VALIDATION', 'Unknown train or scenario.');
      return simulatorChanged();
    }
    if (path === '/api/simulator/clock') {
      const b = body as {
        action: string;
        minutes?: number;
        trainNumber?: string;
        startDate?: string;
      };
      if (b.action === 'advance') sim.clock.advance(b.minutes ?? 0);
      else if (b.action === 'reset') sim.clock.reset();
      else if (b.action === 'beforeDeparture') {
        const t = sim.beforeDeparture(
          b.trainNumber ?? '',
          b.startDate ?? istDate(),
          b.minutes ?? 60,
        );
        if (!t) return error(404, 'VALIDATION', 'Unknown train.');
        sim.clock.set(t);
      }
      return simulatorChanged();
    }
    if (path === '/api/simulator/health') {
      sim.health = (body as { health: typeof sim.health }).health;
      return simulatorChanged();
    }

    // Saathi
    if (path === '/api/chat/info') return json({ mode: 'offline', signedIn: user !== null });
    if (path === '/api/chat/history') {
      if (!mine) return needUser();
      const latest = mine.chat.listSessions()[0];
      if (!latest) return json({ sessionId: null, messages: [] });
      const messages = (mine.chat.getMessages(latest.id) ?? [])
        .filter((x) => x.role === 'user' || x.role === 'assistant')
        .map((x) => ({ role: x.role, ...(x.content as object) }));
      return json({ sessionId: latest.id, messages });
    }
    if (path === '/api/chat' && method === 'POST') {
      const b = body as {
        message?: string;
        sessionId?: string;
        history?: { role: 'user' | 'assistant'; text: string }[];
      };
      const message = (b.message ?? '').trim();
      if (!message || message.length > 2000) return error(400, 'VALIDATION', 'Type a message.');
      return new Response(chatStream(message, user, b.sessionId, user ? [] : (b.history ?? [])), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    if ((m = path.match(/^\/api\/chat\/proposals\/([\w-]+)\/(confirm|cancel)$/))) {
      if (!mine) return needUser();
      const id = m[1]!;
      if (m[2] === 'cancel')
        return mine.proposals.resolve(id, 'CANCELLED')
          ? noContent()
          : error(404, 'NOT_FOUND', 'Nothing to cancel.');
      const proposal = mine.proposals.getPending(id);
      if (!proposal)
        return error(404, 'NOT_FOUND', 'That suggestion has expired or was already handled.');
      if (proposal.kind === 'CREATE_JOURNEY') {
        const input = createJourneySchema.safeParse(proposal.payload);
        if (!input.success || journeyDateProblem(input.data.journeyDate, sim.clock.now())) {
          mine.proposals.resolve(id, 'CANCELLED');
          return error(400, 'VALIDATION', 'This journey is no longer valid.');
        }
        mine.proposals.resolve(id, 'CONFIRMED');
        const journey = mine.journeys.create(input.data);
        void runAlerts();
        return json({ result: 'created', journey });
      }
      mine.proposals.resolve(id, 'CONFIRMED');
      const deleted = mine.journeys.delete((proposal.payload as { journeyId: string }).journeyId);
      return json({ result: deleted ? 'deleted' : 'already_gone' });
    }

    return error(404, 'NOT_FOUND', 'Not found.');
  }

  return { handle, db };
}

let backend: ReturnType<typeof createBackend> | null = null;

/** A drop-in for fetch() that answers /api/... in the browser. */
export async function demoFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  backend ??= createBackend();
  const { handle } = await backend;
  const url = new URL(String(input), window.location.origin);
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  try {
    return await handle((init.method ?? 'GET').toUpperCase(), url, body);
  } catch (err) {
    console.error('[demo]', err);
    return error(500, 'INTERNAL', 'Something went wrong in the demo.');
  }
}

/** Wipes this browser's demo data and starts over. */
export function resetDemo(): void {
  clearSavedDb();
  writeSession(null);
  window.location.reload();
}
