import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { istDate } from '../schemas/dates.js';
import type { AlertEngine, RunSummary } from '../alerts/engine.js';
import type { MockProvider, ResilientProvider } from '../trains/index.js';
import { SCENARIO_IDS, SCENARIOS } from '../trains/mock/scenarios.js';

const scenarioBody = z.object({
  trainNumber: z.string().regex(/^\d{5}$/),
  scenario: z.enum(SCENARIO_IDS as [string, ...string[]]),
});
const clockBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('advance'), minutes: z.number().int().min(-10_080).max(10_080) }),
  z.object({ action: z.literal('reset') }),
  z.object({
    action: z.literal('beforeDeparture'),
    trainNumber: z.string().regex(/^\d{5}$/),
    startDate: z.iso.date().optional(),
    minutes: z.number().int().min(0).max(1440),
  }),
]);
const healthBody = z.object({ health: z.enum(['HEALTHY', 'SLOW', 'DOWN']) });

/**
 * Dev-only controls for the MockProvider. Registered only when the simulator is
 * the data source and ENABLE_SIMULATOR allows it (never by default in production).
 * Every change drops cached train data so the next read reflects it.
 */
export const simulatorRoutes: FastifyPluginAsync<{
  simulator: MockProvider;
  provider: ResilientProvider;
  alerts: AlertEngine;
}> = async (app, { simulator, provider, alerts }) => {
  const bad = (message: string) => ({ error: { code: 'VALIDATION', message } });

  /** After every simulator change, check alerts straight away rather than waiting for cron. */
  const changed = async () => {
    provider.invalidate();
    return snapshot(await alerts.runOnce({ force: true }));
  };

  const snapshot = (alertRun: RunSummary | null = alerts.lastRun) => ({
    alertRun,
    now: simulator.clock.now().toISOString(),
    offsetMinutes: simulator.clock.offsetMinutes,
    health: simulator.health,
    scenarios: SCENARIO_IDS.map((id) => ({ id, ...SCENARIOS[id] })),
    trains: simulator.trains().map((t) => ({
      trainNumber: t.trainNumber,
      trainName: t.trainName,
      from: t.stops[0]!.code,
      to: t.stops[t.stops.length - 1]!.code,
      scenario: simulator.scenarioFor(t.trainNumber),
    })),
    stats: provider.stats(),
  });

  app.get('/', async () => snapshot());

  app.post('/scenario', async (request, reply) => {
    const body = scenarioBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(bad('Unknown train or scenario.'));
    const ok = simulator.setScenario(body.data.trainNumber, body.data.scenario as never);
    if (!ok)
      return reply.code(404).send(bad(`The simulator has no train ${body.data.trainNumber}.`));
    return changed();
  });

  app.post('/clock', async (request, reply) => {
    const body = clockBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(bad('Invalid clock action.'));
    const b = body.data;
    if (b.action === 'advance') simulator.clock.advance(b.minutes);
    else if (b.action === 'reset') simulator.clock.reset();
    else {
      const at = simulator.beforeDeparture(b.trainNumber, b.startDate ?? istDate(), b.minutes);
      if (!at) return reply.code(404).send(bad(`The simulator has no train ${b.trainNumber}.`));
      simulator.clock.set(at);
    }
    return changed();
  });

  app.post('/run-alerts', async () => snapshot(await alerts.runOnce({ force: true })));

  app.post('/health', async (request, reply) => {
    const body = healthBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(bad('Invalid health.'));
    simulator.health = body.data.health;
    return changed();
  });
};
