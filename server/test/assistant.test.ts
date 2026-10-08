import { beforeEach, describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { ClaudeAssistant, SYSTEM_PROMPT } from '../src/assistant/claude.js';
import { OfflineAssistant } from '../src/assistant/offline.js';
import { availableTools, runTool, type ToolContext } from '../src/assistant/tools.js';
import type { AssistantEvent, Turn } from '../src/assistant/types.js';
import { createDataAccess, type DataAccess, type User } from '../src/data/index.js';
import { openDatabase } from '../src/db/index.js';
import { MockProvider } from '../src/trains/mock/MockProvider.js';
import { simulateStatus, type ScenarioId } from '../src/trains/mock/scenarios.js';
import { MOCK_TIMETABLES } from '../src/trains/mock/timetables.js';
import { formatIstTime } from '../src/schemas/format.js';
import { istInstant } from '../src/trains/time.js';
import type { TrainDataProvider } from '../src/trains/types.js';

const START = '2026-10-09';
const at = (hhmm: string, day = 1) => istInstant(START, hhmm, day);

let data: DataAccess;
let sim: MockProvider;
let alice: User;
let bob: User;

beforeEach(() => {
  data = createDataAccess(openDatabase(':memory:'));
  sim = new MockProvider();
  alice = data.accounts.createUser({
    name: 'Alice Rao',
    email: 'alice@example.com',
    passwordHash: 'h',
  });
  bob = data.accounts.createUser({ name: 'Bob', email: 'bob@example.com', passwordHash: 'h' });
});

const ctxFor = (
  user: User | null,
  now = at('21:00'),
  provider: TrainDataProvider = sim,
): ToolContext => ({
  user,
  mine: user ? data.forUser(user.id) : null,
  provider,
  now,
});

function turn(message: string, ctx: ToolContext) {
  const events: AssistantEvent[] = [];
  const t: Turn = {
    message,
    history: [],
    ctx,
    emit: (e) => events.push(e),
    signal: new AbortController().signal,
  };
  return { t, events };
}

const offline = new OfflineAssistant();
const ask = async (message: string, ctx: ToolContext) => {
  sim.clock.set(ctx.now);
  const { t, events } = turn(message, ctx);
  const r = await offline.respond(t);
  return { ...r, events };
};

const addJourney = (u: User, train = '12951', from = 'MMCT', to = 'NDLS') =>
  data.forUser(u.id).journeys.create({
    trainNumber: train,
    fromStationCode: from,
    fromStationName: undefined,
    toStationCode: to,
    toStationName: undefined,
    journeyDate: START,
    alertTypes: ['DELAY'],
  });

describe('tool authorization', () => {
  it('visitors get public tools only; signed-in users also get journey tools', () => {
    const names = (u: User | null) =>
      availableTools(ctxFor(u))
        .map((t) => t.name)
        .sort();
    expect(names(null)).toEqual([
      'get_live_status',
      'get_platform_info',
      'get_schedule',
      'site_help',
      'trains_between',
    ]);
    expect(names(alice)).toEqual([
      'create_journey',
      'delete_journey',
      'get_journey_status',
      'get_live_status',
      'get_platform_info',
      'get_schedule',
      'list_my_journeys',
      'site_help',
      'trains_between',
    ]);
  });

  it('hides tools the data source cannot back', () => {
    const limited: TrainDataProvider = {
      name: 'limited',
      capabilities: () => ({
        liveStatus: true,
        schedule: true,
        platforms: false,
        coachPosition: false,
        trainsBetween: false,
      }),
      getLiveStatus: sim.getLiveStatus.bind(sim),
      getSchedule: sim.getSchedule.bind(sim),
    };
    const names = availableTools(ctxFor(null, at('21:00'), limited)).map((t) => t.name);
    expect(names).not.toContain('get_platform_info');
    expect(names).not.toContain('trains_between');
  });

  it.each(['list_my_journeys', 'get_journey_status', 'create_journey', 'delete_journey'])(
    'a visitor cannot call %s even by name',
    async (name) => {
      const out = await runTool(
        name,
        { journey_id: '00000000-0000-4000-8000-000000000000' },
        ctxFor(null),
      );
      expect(out).toMatchObject({
        isError: true,
        result: { error: `Tool ${name} is not available.` },
      });
    },
  );

  it("journey tools only ever see the session user's data, whatever ids are passed", async () => {
    const bobs = addJourney(bob);
    const list = await runTool('list_my_journeys', { user_id: bob.id }, ctxFor(alice));
    expect(list.result['journeys']).toEqual([]);
    expect(
      (await runTool('get_journey_status', { journey_id: bobs.id }, ctxFor(alice))).isError,
    ).toBe(true);
    expect((await runTool('delete_journey', { journey_id: bobs.id }, ctxFor(alice))).isError).toBe(
      true,
    );
    expect(data.forUser(bob.id).journeys.list()).toHaveLength(1);
  });

  it('rejects malformed tool input instead of running', async () => {
    const out = await runTool('get_live_status', { train_number: 'twelve' }, ctxFor(null));
    expect(out).toMatchObject({ isError: true, result: { error: 'INVALID_INPUT' } });
  });
});

describe('write actions are proposals', () => {
  it('create_journey stores a proposal and creates nothing', async () => {
    const out = await runTool(
      'create_journey',
      { train_number: '12301', from_station: 'hwh', to_station: 'NDLS', journey_date: START },
      ctxFor(alice, at('10:00')),
    );
    expect(out.proposal).toMatchObject({ kind: 'CREATE_JOURNEY' });
    expect(out.proposal!.summary).toContain('12301 from HWH to NDLS');
    expect(data.forUser(alice.id).journeys.list()).toEqual([]);
    expect(data.forUser(alice.id).proposals.getPending(out.proposal!.id)).not.toBeNull();
    expect(data.forUser(bob.id).proposals.getPending(out.proposal!.id)).toBeNull();
  });

  it('validates a proposed journey like the form does', async () => {
    const out = await runTool(
      'create_journey',
      { train_number: '12301', from_station: 'NDLS', to_station: 'NDLS', journey_date: START },
      ctxFor(alice, at('10:00')),
    );
    expect(out.isError).toBe(true);
    expect(String(out.result['error'])).toContain('must be different');
  });
});

describe('offline assistant', () => {
  it('answers live status from the tool, with "as of" and a simulated-data note', async () => {
    sim.setScenario('12951', 'GROWING_DELAY');
    const r = await ask('Is 12951 running late?', ctxFor(null));
    expect(r.text).toMatch(/12951 Mumbai Rajdhani is running \d+ h \d+ min late/);
    expect(r.text).toContain('As of 2026-10-09 21:00 IST (simulated data).');
    expect(r.events).toContainEqual({ type: 'tool', name: 'get_live_status', status: 'start' });
  });

  it("uses the signed-in user's boarding station for their train", async () => {
    addJourney(alice, '12951', 'BRC', 'NDLS');
    sim.setScenario('12951', 'ON_TIME');
    const r = await ask('how is 12951 doing', ctxFor(alice, at('20:00')));
    expect(r.text).toContain('Expected at Vadodara Junction at 2026-10-09 21:16 IST');
  });

  it('refuses to guess when the data source is down', async () => {
    sim.health = 'DOWN';
    const r = await ask('Is 12951 late?', ctxFor(null));
    expect(r.text).toBe(
      "I can't reach the live train data right now, so I won't guess. Please try again in a minute.",
    );
    expect(r.text).not.toMatch(/\d+ min/);
  });

  it('says so for a train it has no data for', async () => {
    const r = await ask('Is 11111 running late?', ctxFor(null));
    expect(r.text).toContain("I don't have live data for train 11111");
  });

  it('proposes a journey and asks for confirmation', async () => {
    const r = await ask('Track 12301 from HWH to NDLS tomorrow', ctxFor(alice, at('10:00')));
    expect(r.proposals).toHaveLength(1);
    expect(r.text).toMatch(/Press Confirm/);
    expect(r.events.some((e) => e.type === 'proposal')).toBe(true);
  });

  it('asks visitors to sign in for journey actions', async () => {
    const r = await ask('add 12301 from HWH to NDLS', ctxFor(null));
    expect(r.text).toMatch(/Sign in/);
    expect(r.proposals).toEqual([]);
  });

  it('answers site questions from the help file', async () => {
    const r = await ask('what are quiet hours?', ctxFor(null));
    expect(r.text).toMatch(/quiet hours/i);
  });
});

/**
 * No-hallucination eval: every answer's facts must match what the simulator
 * itself says at that moment, and nothing may be stated without data.
 */
describe('no-hallucination eval (offline assistant vs simulator truth)', () => {
  const truth = (train: string, scenario: ScenarioId, now: Date) =>
    simulateStatus(
      MOCK_TIMETABLES.find((t) => t.trainNumber === train)!,
      START,
      scenario,
      now,
    );

  const cases: {
    q: string;
    train: string;
    scenario: ScenarioId;
    now: Date;
    expect: (s: ReturnType<typeof truth>) => RegExp;
  }[] = [
    {
      q: 'Is 12951 running late?',
      train: '12951',
      scenario: 'GROWING_DELAY',
      now: at('22:00'),
      expect: (s) =>
        new RegExp(`running ${Math.floor(s.delayMinutes / 60)} h ${s.delayMinutes % 60} min late`),
    },
    {
      q: 'where is 12951 now',
      train: '12951',
      scenario: 'ON_TIME',
      now: at('21:10'),
      expect: (s) => new RegExp(`last reported at ${s.currentStation!.name}`),
    },
    {
      q: 'Which platform for 12301 at HWH?',
      train: '12301',
      scenario: 'ON_TIME',
      now: istInstant(START, '15:30'),
      expect: (s) => new RegExp(`platform ${s.stations[0]!.platform} at Howrah Junction`),
    },
    {
      q: 'Which platform for 12301 at HWH?',
      train: '12301',
      scenario: 'ON_TIME',
      now: istInstant(START, '12:00'), // departs 16:50; platforms are announced 3 h ahead
      expect: () => /hasn't been announced yet/,
    },
    {
      q: 'Which platform for 12951 at MMCT?',
      train: '12951',
      scenario: 'ON_TIME',
      now: istInstant(START, '18:00'),
      expect: (s) =>
        new RegExp(
          `already left Mumbai Central \\(MMCT\\) at ${START} 17:00 IST, from platform ${s.stations[0]!.platform}`,
        ),
    },
    {
      q: 'Is 12002 on time?',
      train: '12002',
      scenario: 'CANCELLED',
      now: istInstant(START, '03:00'),
      expect: () => /is cancelled/,
    },
  ];

  it.each(cases)('$q', async (c) => {
    sim.setScenario(c.train, c.scenario);
    const r = await ask(c.q, ctxFor(null, c.now));
    expect(r.text).toMatch(c.expect(truth(c.train, c.scenario, c.now)));
    expect(r.text).toContain(`As of ${START} ${formatIstTime(c.now.toISOString())} IST`);
  });
});

describe('Claude assistant (mocked client)', () => {
  type Created = Record<string, unknown>;

  /** A stand-in for client.beta.messages.stream that replays scripted responses. */
  function fakeClient(responses: Anthropic.Beta.Messages.BetaMessage[]) {
    const requests: Created[] = [];
    const client = {
      beta: {
        messages: {
          stream(params: Created) {
            requests.push(JSON.parse(JSON.stringify(params)));
            const msg = responses.shift()!;
            let onText: ((d: string) => void) | undefined;
            const s = {
              on(event: string, fn: (d: string) => void) {
                if (event === 'text') onText = fn;
                return s;
              },
              async finalMessage() {
                for (const b of msg.content) if (b.type === 'text') onText?.(b.text);
                return msg;
              },
            };
            return s;
          },
        },
      },
    };
    return { client: client as unknown as Anthropic, requests };
  }

  const message = (content: unknown[], stop: string) =>
    ({
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content,
      stop_reason: stop,
      usage: { input_tokens: 100, output_tokens: 20 },
    }) as unknown as Anthropic.Beta.Messages.BetaMessage;

  const config = {
    ANTHROPIC_API_KEY: 'test',
    ASSISTANT_MODEL: 'model-from-env',
    ASSISTANT_EFFORT: 'low' as const,
    ASSISTANT_MAX_TOKENS: 1000,
    ASSISTANT_MAX_TOOL_ROUNDS: 4,
    ASSISTANT_REFUSAL_FALLBACK: true,
  };

  it('routes a status question through get_live_status and streams the answer', async () => {
    sim.setScenario('12951', 'GROWING_DELAY');
    sim.clock.set(at('21:00'));
    const { client, requests } = fakeClient([
      message(
        [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'get_live_status',
            input: { train_number: '12951' },
          },
        ],
        'tool_use',
      ),
      message([{ type: 'text', text: 'It is running late, as of 21:00 IST.' }], 'end_turn'),
    ]);
    const engine = new ClaudeAssistant(config, client);
    const { t, events } = turn('Is 12951 late?', ctxFor(null));
    const r = await engine.respond(t);

    expect(r.text).toBe('It is running late, as of 21:00 IST.');
    expect(r.tokens).toBe(240);
    expect(requests[0]).toMatchObject({
      model: 'model-from-env',
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    expect((requests[0]!['system'] as { text: string }[])[0]!.text).toBe(SYSTEM_PROMPT);
    expect((requests[0]!['tools'] as { name: string }[]).map((x) => x.name)).not.toContain(
      'list_my_journeys',
    );

    const toolResult = (requests[1]!['messages'] as { role: string; content: unknown }[]).at(-1)!
      .content as {
      tool_use_id: string;
      content: string;
    }[];
    expect(toolResult[0]!.tool_use_id).toBe('tu1');
    expect(JSON.parse(toolResult[0]!.content)).toMatchObject({
      train_number: '12951',
      as_of: '2026-10-09 21:00 IST',
    });
    expect(events).toContainEqual({ type: 'tool', name: 'get_live_status', status: 'done' });
  });

  it('passes errors back to the model when the data source is down', async () => {
    sim.health = 'DOWN';
    const { client, requests } = fakeClient([
      message(
        [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'get_live_status',
            input: { train_number: '12951' },
          },
        ],
        'tool_use',
      ),
      message([{ type: 'text', text: "I can't get live data right now." }], 'end_turn'),
    ]);
    await new ClaudeAssistant(config, client).respond(turn('Is 12951 late?', ctxFor(null)).t);
    const result = (
      (requests[1]!['messages'] as { content: unknown }[]).at(-1)!.content as {
        is_error: boolean;
        content: string;
      }[]
    )[0]!;
    expect(result.is_error).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({ unavailable: true });
  });

  it("a model can't reach journey tools for a visitor, even if it tries", async () => {
    const { client, requests } = fakeClient([
      message([{ type: 'tool_use', id: 'tu1', name: 'list_my_journeys', input: {} }], 'tool_use'),
      message([{ type: 'text', text: 'Please sign in.' }], 'end_turn'),
    ]);
    await new ClaudeAssistant(config, client).respond(turn('show my journeys', ctxFor(null)).t);
    const result = (
      (requests[1]!['messages'] as { content: unknown }[]).at(-1)!.content as { content: string }[]
    )[0]!;
    expect(JSON.parse(result.content)).toEqual({
      error: 'Tool list_my_journeys is not available.',
    });
  });

  it('surfaces a proposal from create_journey', async () => {
    const { client } = fakeClient([
      message(
        [
          {
            type: 'tool_use',
            id: 'tu1',
            name: 'create_journey',
            input: {
              train_number: '12301',
              from_station: 'HWH',
              to_station: 'NDLS',
              journey_date: START,
            },
          },
        ],
        'tool_use',
      ),
      message([{ type: 'text', text: 'Press Confirm to save it.' }], 'end_turn'),
    ]);
    const { t, events } = turn('track 12301', ctxFor(alice, at('10:00')));
    const r = await new ClaudeAssistant(config, client).respond(t);
    expect(r.proposals).toHaveLength(1);
    expect(events.find((e) => e.type === 'proposal')).toBeTruthy();
    expect(data.forUser(alice.id).journeys.list()).toEqual([]);
  });

  it('stops on a refusal without running tools', async () => {
    const { client, requests } = fakeClient([message([], 'refusal')]);
    const r = await new ClaudeAssistant(config, client).respond(
      turn('something off-topic', ctxFor(null)).t,
    );
    expect(r.text).toMatch(/can't help with that/);
    expect(requests).toHaveLength(1);
  });

  it('omits the fallback parameters when disabled', async () => {
    const { client, requests } = fakeClient([message([{ type: 'text', text: 'Hi' }], 'end_turn')]);
    await new ClaudeAssistant({ ...config, ASSISTANT_REFUSAL_FALLBACK: false }, client).respond(
      turn('hi', ctxFor(null)).t,
    );
    expect(requests[0]).not.toHaveProperty('fallbacks');
    expect(requests[0]).not.toHaveProperty('betas');
  });
});
