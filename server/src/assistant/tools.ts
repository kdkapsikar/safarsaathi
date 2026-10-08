import { z } from 'zod';
import type { User, UserData } from '../data/index.js';
import type { Proposal } from '../data/userData.js';
import { istDate, journeyDateProblem } from '../schemas/dates.js';
import { formatIstTime } from '../schemas/format.js';
import { ALERT_TYPES, createJourneySchema, type AlertType } from '../schemas/journey.js';
import {
  ProviderError,
  resolveStartDate,
  type ProviderCapabilities,
  type TrainDataProvider,
  type TrainStatus,
} from '../trains/index.js';
import { explainEventKey } from '../alerts/explain.js';
import { computeLeaveTime } from '../alerts/timing.js';
import { searchHelp } from './siteHelp.js';

/**
 * Everything a tool may use. The user comes from the session only: no tool
 * takes a user id as input, so the model can't act as anyone else.
 */
export interface ToolContext {
  user: User | null;
  mine: UserData | null;
  provider: TrainDataProvider;
  now: Date;
}

export interface ProposalView {
  id: string;
  kind: Proposal['kind'];
  summary: string;
  expiresAt: string;
}

export interface ToolOutput {
  /** Sent to the model as the tool result (JSON). */
  result: Record<string, unknown>;
  isError?: boolean;
  /** A write action awaiting the user's confirmation in the UI. */
  proposal?: ProposalView;
}

export interface AssistantTool {
  name: string;
  description: string;
  schema: z.ZodObject;
  /** public: anyone; user: signed-in only. */
  scope: 'public' | 'user';
  /** Hidden unless the data source supplies this. */
  needs?: keyof ProviderCapabilities;
  run(input: never, ctx: ToolContext): Promise<ToolOutput>;
}

const trainNumber = z
  .string()
  .regex(/^\d{5}$/)
  .describe('5-digit train number, e.g. "12951"');
const stationCode = z
  .string()
  .regex(/^[A-Za-z]{1,5}$/)
  .transform((s) => s.toUpperCase())
  .describe('Station code, e.g. "NDLS"');
const date = z.iso.date().describe('YYYY-MM-DD (IST). Omit for today.');

/** Readable timestamp for the model and for offline answers: "2026-10-09 17:05 IST". */
export const istStamp = (iso: string) => `${istDate(new Date(iso))} ${formatIstTime(iso)} IST`;

const unavailable = (what: string): ToolOutput => ({
  result: {
    error: `Live train data is unavailable right now (${what}). Do not guess; tell the user to try again shortly.`,
    unavailable: true,
  },
  isError: true,
});

function compactStatus(s: TrainStatus) {
  const t = (iso: string | null) => (iso ? istStamp(iso) : null);
  return {
    train_number: s.trainNumber,
    train_name: s.trainName,
    run_start_date: s.startDate,
    state: s.state,
    delay_minutes: s.delayMinutes,
    current_station: s.currentStation,
    cancelled: s.cancelled,
    diverted: s.diverted,
    note: s.note,
    as_of: istStamp(s.fetchedAt),
    data_source: s.source === 'simulator' ? 'simulator (simulated, not real data)' : s.source,
    stations: s.stations.map((st) => ({
      code: st.code,
      name: st.name,
      state: st.state,
      scheduled_arrival: t(st.scheduledArrival),
      scheduled_departure: t(st.scheduledDeparture),
      expected_arrival: t(st.expectedArrival),
      expected_departure: t(st.expectedDeparture),
      delay_minutes: st.delayMinutes,
      platform: st.platform,
    })),
  };
}

async function liveStatus(
  ctx: ToolContext,
  train: string,
  day: string | undefined,
  boarding?: string,
): Promise<{ status: TrainStatus | null; startDate: string }> {
  const when = day ?? istDate(ctx.now);
  const startDate = boarding
    ? resolveStartDate(await ctx.provider.getSchedule(train), boarding, when)
    : when;
  return { status: await ctx.provider.getLiveStatus(train, startDate), startDate };
}

function tool<S extends z.ZodObject>(def: {
  name: string;
  description: string;
  schema: S;
  scope: 'public' | 'user';
  needs?: keyof ProviderCapabilities;
  run: (input: z.output<S>, ctx: ToolContext) => Promise<ToolOutput>;
}): AssistantTool {
  return def as unknown as AssistantTool;
}

export const TOOLS: AssistantTool[] = [
  tool({
    name: 'get_live_status',
    description:
      'Live running status of a train: overall state, current delay, last station, and per-station scheduled vs expected times and platforms. Use for any question about whether a train is late, where it is, or when it will reach a station. If the user boards mid-route, pass boarding_station so the right run is found.',
    scope: 'public',
    needs: 'liveStatus',
    schema: z.object({
      train_number: trainNumber,
      date: date.optional(),
      boarding_station: stationCode
        .optional()
        .describe('Station where the passenger boards, if known'),
    }),
    async run(input, ctx) {
      try {
        const { status, startDate } = await liveStatus(
          ctx,
          input.train_number,
          input.date,
          input.boarding_station,
        );
        if (!status) {
          return {
            result: {
              error: `No data for train ${input.train_number} (run starting ${startDate}).`,
              not_found: true,
            },
            isError: true,
          };
        }
        return { result: compactStatus(status) };
      } catch (err) {
        if (err instanceof ProviderError) return unavailable(err.kind);
        throw err;
      }
    },
  }),

  tool({
    name: 'get_schedule',
    description: "A train's timetable: stops in order with scheduled times (IST) and day number.",
    scope: 'public',
    needs: 'schedule',
    schema: z.object({ train_number: trainNumber }),
    async run(input, ctx) {
      try {
        const s = await ctx.provider.getSchedule(input.train_number);
        if (!s)
          return {
            result: { error: `No timetable for train ${input.train_number}.`, not_found: true },
            isError: true,
          };
        return {
          result: {
            train_number: s.trainNumber,
            train_name: s.trainName,
            stops: s.stops.map((x) => ({
              code: x.code,
              name: x.name,
              arrival: x.arrival,
              departure: x.departure,
              day: x.day,
              distance_km: x.distanceKm,
            })),
            times_are: 'HH:MM IST; day 1 = the day the train starts',
          },
        };
      } catch (err) {
        if (err instanceof ProviderError) return unavailable(err.kind);
        throw err;
      }
    },
  }),

  tool({
    name: 'get_platform_info',
    description:
      'The platform for a train at one station, with expected arrival/departure. Platforms are often announced only a few hours ahead; null means not announced yet.',
    scope: 'public',
    needs: 'platforms',
    schema: z.object({
      train_number: trainNumber,
      station_code: stationCode,
      date: date.optional(),
    }),
    async run(input, ctx) {
      try {
        const { status } = await liveStatus(
          ctx,
          input.train_number,
          input.date,
          input.station_code,
        );
        if (!status)
          return {
            result: { error: `No data for train ${input.train_number}.`, not_found: true },
            isError: true,
          };
        const st = status.stations.find((x) => x.code === input.station_code);
        if (!st) {
          return {
            result: {
              error: `Train ${input.train_number} does not stop at ${input.station_code}.`,
              stops: status.stations.map((x) => x.code),
            },
            isError: true,
          };
        }
        return {
          result: {
            train_number: status.trainNumber,
            station: { code: st.code, name: st.name },
            platform: st.platform,
            platform_announced: st.platform !== null,
            expected_arrival: st.expectedArrival ? istStamp(st.expectedArrival) : null,
            expected_departure: st.expectedDeparture ? istStamp(st.expectedDeparture) : null,
            state: st.state,
            cancelled: status.cancelled,
            as_of: istStamp(status.fetchedAt),
            data_source:
              status.source === 'simulator'
                ? 'simulator (simulated, not real data)'
                : status.source,
          },
        };
      } catch (err) {
        if (err instanceof ProviderError) return unavailable(err.kind);
        throw err;
      }
    },
  }),

  tool({
    name: 'trains_between',
    description:
      'Trains running between two stations on a date, with scheduled departure and arrival.',
    scope: 'public',
    needs: 'trainsBetween',
    schema: z.object({ from_station: stationCode, to_station: stationCode, date: date.optional() }),
    async run(input, ctx) {
      if (!ctx.provider.trainsBetween) return unavailable('search not supported');
      try {
        const trains = await ctx.provider.trainsBetween(
          input.from_station,
          input.to_station,
          input.date ?? istDate(ctx.now),
        );
        return {
          result: {
            from: input.from_station,
            to: input.to_station,
            trains: trains.map((t) => ({
              train_number: t.trainNumber,
              train_name: t.trainName,
              departs: istStamp(t.from.departure),
              arrives: istStamp(t.to.arrival),
            })),
          },
        };
      } catch (err) {
        if (err instanceof ProviderError) return unavailable(err.kind);
        throw err;
      }
    },
  }),

  tool({
    name: 'site_help',
    description:
      'How Safar Saathi works: accounts, adding journeys, alert types, quiet hours, data source, privacy.',
    scope: 'public',
    schema: z.object({ topic: z.string().min(1).max(200).describe('What the user wants to know') }),
    async run(input) {
      const topics = searchHelp(input.topic);
      return topics.length
        ? { result: { topics: topics.map((t) => ({ title: t.title, answer: t.body })) } }
        : { result: { topics: [], note: 'No help topic matched.' } };
    },
  }),

  tool({
    name: 'get_leave_time',
    description:
      'When to leave home to catch a train: live expected departure at the boarding station minus travel time to the station and a safety buffer. Use journey_id for a saved journey (uses its saved travel time unless travel_minutes is given), or train_number + station_code + travel_minutes.',
    scope: 'public',
    needs: 'liveStatus',
    schema: z.object({
      journey_id: z.uuid().optional(),
      train_number: trainNumber.optional(),
      station_code: stationCode.optional(),
      date: date.optional(),
      travel_minutes: z
        .number()
        .int()
        .min(0)
        .max(600)
        .optional()
        .describe('Door-to-station travel time'),
      buffer_minutes: z.number().int().min(0).max(180).optional(),
    }),
    async run(input, ctx) {
      let train = input.train_number;
      let station = input.station_code;
      let day = input.date;
      let travel = input.travel_minutes;
      let buffer = input.buffer_minutes ?? 15;
      if (input.journey_id) {
        const j = ctx.mine?.journeys.get(input.journey_id);
        if (!j) return { result: { error: 'No such journey for this user.' }, isError: true };
        train = j.trainNumber;
        station = j.fromStationCode;
        day = j.journeyDate;
        travel ??= j.settings.travelTimeMinutes ?? undefined;
        buffer = input.buffer_minutes ?? j.settings.leaveBufferMinutes;
      }
      if (!train || !station) {
        return {
          result: { error: 'Need a journey_id, or train_number and station_code.' },
          isError: true,
        };
      }
      if (travel === undefined) {
        return {
          result: {
            error:
              'Travel time to the station is unknown. Ask the user how many minutes it takes to get there.',
            needs_travel_time: true,
          },
          isError: true,
        };
      }
      try {
        const { status } = await liveStatus(ctx, train, day, station);
        if (!status)
          return {
            result: { error: `No data for train ${train}.`, not_found: true },
            isError: true,
          };
        const t = computeLeaveTime(status, station, travel, buffer, ctx.now);
        const base = {
          train_number: train,
          station_code: station,
          as_of: istStamp(status.fetchedAt),
        };
        if (t.state !== 'OK') return { result: { ...base, state: t.state } };
        return {
          result: {
            ...base,
            state: 'OK',
            leave_by: istStamp(t.leaveBy),
            minutes_until_leave: t.minutesUntilLeave,
            expected_departure: istStamp(t.expectedDeparture),
            scheduled_departure: istStamp(t.scheduledDeparture),
            delay_minutes: t.delayMinutes,
            travel_minutes: t.travelMinutes,
            buffer_minutes: t.bufferMinutes,
            data_source:
              status.source === 'simulator'
                ? 'simulator (simulated, not real data)'
                : status.source,
          },
        };
      } catch (err) {
        if (err instanceof ProviderError) return unavailable(err.kind);
        throw err;
      }
    },
  }),

  tool({
    name: 'list_my_alerts',
    description:
      "The signed-in user's recent alerts, newest first, each with a plain explanation of why it was sent (thresholds, quiet hours, leave-now maths).",
    scope: 'user',
    schema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
    async run(input, ctx) {
      const mine = ctx.mine!;
      return {
        result: {
          alerts: mine.notifications.list(input.limit ?? 5).map((n) => {
            const j = n.journeyId ? mine.journeys.get(n.journeyId) : null;
            return {
              title: n.title,
              message: n.body,
              sent_at: istStamp(n.createdAt),
              train_number: j?.trainNumber ?? null,
              why: explainEventKey(
                n.eventKey,
                j?.settings ?? {
                  minDelayMinutes: null,
                  quietHoursStart: null,
                  quietHoursEnd: null,
                  travelTimeMinutes: null,
                  leaveBufferMinutes: 15,
                  connectionBufferMinutes: 30,
                },
              ),
            };
          }),
        },
      };
    },
  }),

  tool({
    name: 'list_my_journeys',
    description: "The signed-in user's saved journeys (newest first), with ids for other tools.",
    scope: 'user',
    schema: z.object({}),
    async run(_input, ctx) {
      return {
        result: {
          journeys: ctx.mine!.journeys.list().map((j) => ({
            journey_id: j.id,
            train_number: j.trainNumber,
            from: j.fromStationCode,
            to: j.toStationCode,
            boarding_date: j.journeyDate,
            alerts: j.alertTypes,
            travel_time_minutes: j.settings.travelTimeMinutes,
            connects_to_journey_id: j.settings.connectsToJourneyId,
          })),
        },
      };
    },
  }),

  tool({
    name: 'get_journey_status',
    description: "Live status for one of the user's saved journeys, from their boarding station.",
    scope: 'user',
    needs: 'liveStatus',
    schema: z.object({ journey_id: z.uuid() }),
    async run(input, ctx) {
      const j = ctx.mine!.journeys.get(input.journey_id);
      if (!j) return { result: { error: 'No such journey for this user.' }, isError: true };
      try {
        const { status } = await liveStatus(ctx, j.trainNumber, j.journeyDate, j.fromStationCode);
        if (!status)
          return {
            result: { error: `No live data for train ${j.trainNumber}.`, not_found: true },
            isError: true,
          };
        return {
          result: {
            journey: {
              journey_id: j.id,
              train_number: j.trainNumber,
              from: j.fromStationCode,
              to: j.toStationCode,
              boarding_date: j.journeyDate,
            },
            status: compactStatus(status),
          },
        };
      } catch (err) {
        if (err instanceof ProviderError) return unavailable(err.kind);
        throw err;
      }
    },
  }),

  tool({
    name: 'create_journey',
    description:
      'PROPOSE adding a journey for the user. This does NOT create it: the user sees a card and must click Confirm. Tell them to confirm.',
    scope: 'user',
    schema: z.object({
      train_number: trainNumber,
      from_station: stationCode,
      to_station: stationCode,
      journey_date: date.describe('Date the user boards (YYYY-MM-DD, IST)'),
      alert_types: z
        .array(z.enum(ALERT_TYPES))
        .min(1)
        .optional()
        .describe('Defaults to departure, delay and platform change'),
    }),
    async run(input, ctx) {
      const parsed = createJourneySchema.safeParse({
        trainNumber: input.train_number,
        fromStationCode: input.from_station,
        toStationCode: input.to_station,
        journeyDate: input.journey_date,
        alertTypes:
          input.alert_types ?? (['DEPARTURE', 'DELAY', 'PLATFORM_CHANGE'] satisfies AlertType[]),
      });
      if (!parsed.success) {
        return {
          result: { error: parsed.error.issues.map((i) => i.message).join('; ') },
          isError: true,
        };
      }
      const dateProblem = journeyDateProblem(parsed.data.journeyDate, ctx.now);
      if (dateProblem) return { result: { error: dateProblem }, isError: true };

      const p = parsed.data;
      const summary = `Track train ${p.trainNumber} from ${p.fromStationCode} to ${p.toStationCode} on ${p.journeyDate} (alerts: ${p.alertTypes
        .map((t) => t.toLowerCase().replace('_', ' '))
        .join(', ')})`;
      const proposal = ctx.mine!.proposals.create('CREATE_JOURNEY', p, summary);
      return {
        result: {
          proposal_id: proposal.id,
          status: 'awaiting_user_confirmation',
          summary,
          note: 'Nothing has been created yet. Ask the user to press Confirm on the card.',
        },
        proposal: { id: proposal.id, kind: proposal.kind, summary, expiresAt: proposal.expiresAt },
      };
    },
  }),

  tool({
    name: 'delete_journey',
    description:
      "PROPOSE deleting one of the user's journeys. This does NOT delete it: the user sees a card and must click Confirm.",
    scope: 'user',
    schema: z.object({ journey_id: z.uuid() }),
    async run(input, ctx) {
      const j = ctx.mine!.journeys.get(input.journey_id);
      if (!j) return { result: { error: 'No such journey for this user.' }, isError: true };
      const summary = `Delete the journey on train ${j.trainNumber}, ${j.fromStationCode} to ${j.toStationCode} on ${j.journeyDate}`;
      const proposal = ctx.mine!.proposals.create('DELETE_JOURNEY', { journeyId: j.id }, summary);
      return {
        result: {
          proposal_id: proposal.id,
          status: 'awaiting_user_confirmation',
          summary,
          note: 'Nothing has been deleted yet. Ask the user to press Confirm on the card.',
        },
        proposal: { id: proposal.id, kind: proposal.kind, summary, expiresAt: proposal.expiresAt },
      };
    },
  }),
];

/** The tools this caller may use right now: by sign-in and by what the data source supplies. */
export function availableTools(
  ctx: Pick<ToolContext, 'user' | 'provider'>,
  all = TOOLS,
): AssistantTool[] {
  const caps = ctx.provider.capabilities();
  return all.filter((t) => (t.scope === 'public' || ctx.user) && (!t.needs || caps[t.needs]));
}

/**
 * Runs a tool by name with untrusted (model- or script-supplied) input.
 * Re-checks availability, validates input, and never throws.
 */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutput> {
  const t = availableTools(ctx).find((x) => x.name === name);
  if (!t) return { result: { error: `Tool ${name} is not available.` }, isError: true };
  const parsed = t.schema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      result: {
        error: 'INVALID_INPUT',
        details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      isError: true,
    };
  }
  try {
    return await t.run(parsed.data as never, ctx);
  } catch {
    return {
      result: { error: 'The tool failed unexpectedly. Do not guess the answer.' },
      isError: true,
    };
  }
}

/** JSON Schema for the API's tool definitions. */
export function toolJsonSchema(t: AssistantTool): Record<string, unknown> {
  const { $schema: _drop, ...schema } = z.toJSONSchema(t.schema, { io: 'input' }) as Record<
    string,
    unknown
  >;
  return schema;
}
