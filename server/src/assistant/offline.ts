import { istDate } from '../schemas/dates.js';
import { formatDelay } from '../schemas/format.js';
import {
  availableTools,
  runTool,
  type ProposalView,
  type ToolContext,
  type ToolOutput,
} from './tools.js';
import type { AssistantEngine, Turn, TurnResult } from './types.js';

/**
 * The assistant without an API key: keyword/intent matching that calls the
 * SAME tools as the Claude engine and words its answers only from their
 * results. It can't hold a real conversation, but it never makes facts up.
 */
export class OfflineAssistant implements AssistantEngine {
  readonly mode = 'offline' as const;

  async respond(turn: Turn): Promise<TurnResult> {
    const proposals: ProposalView[] = [];
    const call = async (name: string, input: Record<string, unknown>): Promise<ToolOutput> => {
      turn.emit({ type: 'tool', name, status: 'start' });
      const out = await runTool(name, input, turn.ctx);
      turn.emit({ type: 'tool', name, status: out.isError ? 'error' : 'done' });
      if (out.proposal) {
        proposals.push(out.proposal);
        turn.emit({ type: 'proposal', proposal: out.proposal });
      }
      return out;
    };

    const text = await answer(turn.message, turn.ctx, call);
    for (const chunk of text.match(/\S+\s*/g) ?? [text]) turn.emit({ type: 'text', delta: chunk });
    return { text, proposals, tokens: 0 };
  }
}

type Call = (name: string, input: Record<string, unknown>) => Promise<ToolOutput>;

interface Parsed {
  lower: string;
  train: string | undefined;
  codes: string[];
  date: string;
}

const STOP_WORDS = new Set([
  'IS',
  'MY',
  'THE',
  'AT',
  'TO',
  'ON',
  'IN',
  'OF',
  'FOR',
  'AND',
  'OK',
  'PF',
  'I',
  'A',
  'AM',
  'PM',
  'IST',
  'PNR',
]);

function parse(message: string, now: Date): Parsed {
  const lower = message.toLowerCase();
  const explicit = message.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  const date =
    explicit ??
    (/\btomorrow\b/.test(lower)
      ? istDate(now, 1)
      : /\byesterday\b/.test(lower)
        ? istDate(now, -1)
        : istDate(now));
  const codes = [...message.matchAll(/\b([A-Z]{2,5})\b/g)]
    .map((m) => m[1]!)
    .filter((c) => !STOP_WORDS.has(c));
  return { lower, train: message.match(/\b(\d{5})\b/)?.[1], codes, date };
}

const has = (lower: string, ...words: string[]) =>
  words.some((w) => new RegExp(`\\b${w}\\b`).test(lower));

const HELP =
  'I can check live running status, delays, platforms and timetables. Try "Is 12951 running late?", "Which platform for 12301 at HWH?" or "Show the timetable of 12002".';

async function answer(message: string, ctx: ToolContext, call: Call): Promise<string> {
  const p = parse(message, ctx.now);
  const tools = new Set(availableTools(ctx).map((t) => t.name));
  const signedIn = ctx.user !== null;

  if (/^\s*(hi|hello|hey|namaste|namaskar)\b/.test(p.lower) && !p.train) {
    return `Namaste${ctx.user ? `, ${ctx.user.name.split(' ')[0]}` : ''}! ${HELP}`;
  }

  // The user's own journeys.
  if (
    has(p.lower, 'my journeys', 'my trains', 'my trips', 'my journey') &&
    !has(p.lower, 'delete', 'remove')
  ) {
    if (!signedIn) return 'Sign in and I can list your journeys and check them for you.';
    const out = await call('list_my_journeys', {});
    const js = out.result['journeys'] as {
      train_number: string;
      from: string;
      to: string;
      boarding_date: string;
    }[];
    if (!js.length)
      return "You haven't added any journeys yet. Tell me the train number, stations and date and I'll set one up.";
    return `You have ${js.length} journey${js.length > 1 ? 's' : ''}: ${js
      .map((j) => `${j.train_number} ${j.from} → ${j.to} on ${j.boarding_date}`)
      .join('; ')}.`;
  }

  // Delete a journey (as a proposal).
  if (has(p.lower, 'delete', 'remove', 'stop tracking')) {
    if (!signedIn) return 'Sign in first, then I can help you remove a journey.';
    const list = (await call('list_my_journeys', {})).result['journeys'] as {
      journey_id: string;
      train_number: string;
    }[];
    const match = list.filter((j) => !p.train || j.train_number === p.train);
    if (match.length !== 1) {
      return match.length
        ? 'You have more than one journey on that train. Please delete the one you mean from the dashboard.'
        : `I couldn't find a journey${p.train ? ` on train ${p.train}` : ''} to remove. Tell me the train number.`;
    }
    const out = await call('delete_journey', { journey_id: match[0]!.journey_id });
    return out.isError
      ? String(out.result['error'])
      : `${out.result['summary']}? Press Confirm on the card to delete it.`;
  }

  // Create a journey (as a proposal).
  if (has(p.lower, 'add', 'track', 'create', 'save', 'watch', 'remind')) {
    if (!signedIn)
      return 'Sign in (or create a free account) and I can set up alerts for your journey.';
    const [from, to] = p.codes;
    if (!p.train || !from || !to) {
      return 'To add a journey I need the 5-digit train number and your from and to station codes, e.g. "Track 12951 from MMCT to NDLS tomorrow".';
    }
    const out = await call('create_journey', {
      train_number: p.train,
      from_station: from,
      to_station: to,
      journey_date: p.date,
    });
    return out.isError
      ? `I couldn't set that up: ${out.result['error']}`
      : `${out.result['summary']}. Press Confirm on the card to save it.`;
  }

  // Why did an alert arrive?
  if (
    /\bwhy\b/.test(p.lower) &&
    has(p.lower, 'alert', 'alerts', 'notification', 'notified', 'message', 'get', 'got')
  ) {
    if (!signedIn) return 'Sign in and I can explain the alerts you received.';
    const out = await call('list_my_alerts', { limit: 10 });
    const alerts = out.result['alerts'] as {
      title: string;
      why: string;
      sent_at: string;
      train_number: string | null;
    }[];
    const pick = alerts.find((a) => !p.train || a.train_number === p.train);
    return pick
      ? `"${pick.title}" (sent ${pick.sent_at}): ${pick.why}`
      : "You haven't received any alerts yet.";
  }

  // When to leave home.
  if (has(p.lower, 'leave', 'when should i go', 'start from home')) {
    const minutes = Number(p.lower.match(/(\d{1,3})\s*(?:min|mins|minutes)\b/)?.[1] ?? NaN);
    const travel = Number.isNaN(minutes) ? undefined : minutes;
    let input: Record<string, unknown> | null = null;
    if (signedIn) {
      const js = (await call('list_my_journeys', {})).result['journeys'] as {
        journey_id: string;
        train_number: string;
        boarding_date: string;
      }[];
      const j =
        js.find((x) => x.train_number === p.train) ??
        (!p.train
          ? [...js]
              .filter((x) => x.boarding_date >= istDate(ctx.now, -1))
              .sort((a, b) => a.boarding_date.localeCompare(b.boarding_date))[0]
          : undefined);
      if (j)
        input = {
          journey_id: j.journey_id,
          ...(travel !== undefined ? { travel_minutes: travel } : {}),
        };
    }
    if (!input && p.train && p.codes[0] && travel !== undefined) {
      input = {
        train_number: p.train,
        station_code: p.codes[0],
        date: p.date,
        travel_minutes: travel,
      };
    }
    if (!input) {
      return 'Tell me your train, boarding station and how long it takes you to get there, e.g. "When should I leave for 12951 at MMCT? It takes 40 minutes."';
    }
    const out = await call('get_leave_time', input);
    if (out.isError) {
      if (out.result['needs_travel_time'])
        return "How many minutes does it take you to get to the station? You can also save it in the journey's settings.";
      return out.result['not_found']
        ? "I don't have live data for that train."
        : unavailableText(out);
    }
    const r = out.result;
    const sim = String(r['data_source'] ?? '').startsWith('simulator') ? ' (simulated data)' : '';
    if (r['state'] !== 'OK') {
      return r['state'] === 'DEPARTED'
        ? `${r['train_number']} has already left ${r['station_code']}. As of ${r['as_of']}${sim}.`
        : r['state'] === 'CANCELLED'
          ? `${r['train_number']} is cancelled, so there's no need to leave. As of ${r['as_of']}${sim}.`
          : `I can't work out a leave time for ${r['train_number']} at ${r['station_code']}.`;
    }
    const until = r['minutes_until_leave'] as number;
    const when = until <= 0 ? 'Leave now' : `Leave by ${r['leave_by']}`;
    const delay =
      (r['delay_minutes'] as number) > 0
        ? ` (${formatDelay(r['delay_minutes'] as number)}; scheduled ${r['scheduled_departure']})`
        : '';
    return `${when}. ${r['train_number']} is expected to depart ${r['station_code']} at ${r['expected_departure']}${delay}; that allows ${r['travel_minutes']} min to get there plus ${r['buffer_minutes']} min to spare. As of ${r['as_of']}${sim}.`;
  }

  // Trains between two stations.
  if (
    !p.train &&
    p.codes.length >= 2 &&
    (has(p.lower, 'between', 'from', 'trains') || p.lower.includes(' to '))
  ) {
    if (!tools.has('trains_between'))
      return "I can't search trains between stations with the current data source.";
    const out = await call('trains_between', {
      from_station: p.codes[0],
      to_station: p.codes[1],
      date: p.date,
    });
    if (out.isError) return unavailableText(out);
    const ts = out.result['trains'] as {
      train_number: string;
      train_name: string;
      departs: string;
      arrives: string;
    }[];
    return ts.length
      ? `Trains from ${p.codes[0]} to ${p.codes[1]}: ${ts.map((t) => `${t.train_number} ${t.train_name} (dep ${t.departs}, arr ${t.arrives})`).join('; ')}.`
      : `I don't know of any trains from ${p.codes[0]} to ${p.codes[1]} on ${p.date}.`;
  }

  if (p.train) {
    // Timetable.
    if (has(p.lower, 'schedule', 'timetable', 'stops', 'route', 'halts')) {
      const out = await call('get_schedule', { train_number: p.train });
      if (out.isError)
        return out.result['not_found']
          ? `I don't have a timetable for train ${p.train}.`
          : unavailableText(out);
      const stops = out.result['stops'] as {
        code: string;
        arrival: string | null;
        departure: string | null;
        day: number;
      }[];
      return `${p.train} ${out.result['train_name']} stops at: ${stops
        .map((s) => `${s.code} ${s.departure ?? s.arrival}${s.day > 1 ? ` (day ${s.day})` : ''}`)
        .join(', ')}. Times are scheduled, IST.`;
    }

    // Platform.
    if (has(p.lower, 'platform', 'pf')) {
      const station = p.codes[0] ?? (await boardingFor(p.train, ctx, call));
      if (!station) return `Which station? For example: "Which platform for ${p.train} at NDLS?"`;
      if (!tools.has('get_platform_info'))
        return "The current data source doesn't supply platform numbers, so I can't tell you that.";
      const out = await call('get_platform_info', {
        train_number: p.train,
        station_code: station,
        date: p.date,
      });
      if (out.isError)
        return out.result['not_found']
          ? `I don't have data for train ${p.train}.`
          : String(out.result['error']).startsWith('Live')
            ? unavailableText(out)
            : String(out.result['error']);
      const st = out.result['station'] as { code: string; name: string };
      const when = out.result['expected_departure'] ?? out.result['expected_arrival'];
      if (out.result['state'] === 'DEPARTED') {
        return `${p.train} has already left ${st.name} (${st.code}) at ${out.result['expected_departure']}${
          out.result['platform'] ? `, from platform ${out.result['platform']}` : ''
        }. As of ${out.result['as_of']}${simulatedNote(out)}.`;
      }
      return out.result['platform']
        ? `${p.train} is expected on platform ${out.result['platform']} at ${st.name} (${st.code})${when ? `, at ${when}` : ''}. As of ${out.result['as_of']}${simulatedNote(out)}.`
        : `The platform for ${p.train} at ${st.name} hasn't been announced yet${when ? ` (expected ${when})` : ''}. As of ${out.result['as_of']}${simulatedNote(out)}.`;
    }

    // Default for a train number: live status.
    const boarding = p.codes[0] ?? (await boardingFor(p.train, ctx, call));
    const out = await call('get_live_status', {
      train_number: p.train,
      date: p.date,
      ...(boarding ? { boarding_station: boarding } : {}),
    });
    if (out.isError) {
      return out.result['not_found']
        ? `I don't have live data for train ${p.train} on that date, so I can't say how it's running.`
        : unavailableText(out);
    }
    return describeStatus(out.result as unknown as CompactStatus, boarding);
  }

  // Questions about the site.
  const help = await call('site_help', { topic: message });
  const topics = help.result['topics'] as { title: string; answer: string }[];
  return topics.length ? topics[0]!.answer : `I'm not sure about that one. ${HELP}`;
}

interface CompactStatus {
  train_number: string;
  train_name: string;
  run_start_date: string;
  state: string;
  delay_minutes: number;
  current_station: { code: string; name: string } | null;
  cancelled: boolean;
  note: string | null;
  as_of: string;
  data_source: string;
  stations: {
    code: string;
    name: string;
    state: string;
    expected_departure: string | null;
    expected_arrival: string | null;
    scheduled_departure: string | null;
    scheduled_arrival: string | null;
    platform: string | null;
  }[];
}

async function boardingFor(
  train: string,
  ctx: ToolContext,
  call: Call,
): Promise<string | undefined> {
  if (!ctx.user) return undefined;
  const js = (await call('list_my_journeys', {})).result['journeys'] as {
    train_number: string;
    from: string;
  }[];
  return js.find((j) => j.train_number === train)?.from;
}

const simulatedNote = (out: ToolOutput) =>
  String(out.result['data_source'] ?? '').startsWith('simulator') ? ' (simulated data)' : '';

function unavailableText(out: ToolOutput): string {
  return out.result['unavailable']
    ? "I can't reach the live train data right now, so I won't guess. Please try again in a minute."
    : `Sorry, I couldn't get that: ${out.result['error']}`;
}

function describeStatus(s: CompactStatus, boarding: string | undefined): string {
  const simulated = s.data_source.startsWith('simulator') ? ' (simulated data)' : '';
  const head = `${s.train_number} ${s.train_name}`;
  if (s.cancelled)
    return `${head} (run starting ${s.run_start_date}) is cancelled. ${s.note ?? ''} As of ${s.as_of}${simulated}.`.replace(
      /\s+/g,
      ' ',
    );

  const parts: string[] = [];
  if (s.state === 'NOT_STARTED')
    parts.push(
      `${head} hasn't started yet${s.delay_minutes > 0 ? ` and is expected ${formatDelay(s.delay_minutes)}` : ' and is on schedule'}.`,
    );
  else if (s.state === 'ARRIVED')
    parts.push(
      `${head} has reached its destination${s.delay_minutes > 0 ? `, ${formatDelay(s.delay_minutes)}` : ' on time'}.`,
    );
  else
    parts.push(
      `${head} is running ${s.delay_minutes > 0 ? formatDelay(s.delay_minutes) : 'on time'}${s.current_station ? `; last reported at ${s.current_station.name}` : ''}.`,
    );

  const st = boarding ? s.stations.find((x) => x.code === boarding) : undefined;
  if (st && s.state !== 'ARRIVED') {
    if (st.state === 'DEPARTED') parts.push(`It left ${st.name} at ${st.expected_departure}.`);
    else if (st.state === 'SKIPPED') parts.push(`It will not stop at ${st.name}.`);
    else {
      const exp = st.expected_departure ?? st.expected_arrival;
      const sch = st.scheduled_departure ?? st.scheduled_arrival;
      if (exp)
        parts.push(
          `Expected at ${st.name} at ${exp}${sch && sch !== exp ? ` (scheduled ${sch})` : ''}${st.platform ? `, platform ${st.platform}` : ''}.`,
        );
    }
  }
  if (s.note) parts.push(s.note);
  parts.push(`As of ${s.as_of}${simulated}.`);
  return parts.join(' ');
}
