import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { istDate } from '../schemas/dates.js';
import { ProviderError, resolveStartDate, type TrainServices } from '../trains/index.js';

const trainParams = z.object({ trainNumber: z.string().regex(/^\d{5}$/) });
const statusQuery = z.object({
  date: z.iso.date().optional(),
  /** If given, `date` is the passenger's boarding date at this station, not the train's start date. */
  boardingStation: z
    .string()
    .regex(/^[A-Za-z]{1,5}$/)
    .transform((s) => s.toUpperCase())
    .optional(),
});

export function providerUnavailable(reply: FastifyReply, err: ProviderError) {
  return reply.code(503).send({
    error: {
      code: 'TRAIN_DATA_UNAVAILABLE',
      message:
        err.kind === 'CIRCUIT_OPEN'
          ? 'Live train data is temporarily unavailable. Please try again in a minute.'
          : 'Live train data could not be fetched right now.',
    },
  });
}

/** Public train data (no sign-in needed): the same data the assistant will use. */
export const trainRoutes: FastifyPluginAsync<{ trains: TrainServices }> = async (
  app,
  { trains },
) => {
  const rateLimit = { max: 120, timeWindow: 60_000 };
  const { provider } = trains;

  const notFound = (reply: FastifyReply, trainNumber: string) =>
    reply.code(404).send({
      error: { code: 'TRAIN_NOT_FOUND', message: `No data for train ${trainNumber}.` },
    });

  app.get('/capabilities', async () => ({
    source: provider.name,
    capabilities: provider.capabilities(),
  }));

  app.get('/:trainNumber/status', { config: { rateLimit } }, async (request, reply) => {
    const params = trainParams.safeParse(request.params);
    const query = statusQuery.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({
        error: { code: 'VALIDATION', message: 'Use a 5-digit train number and YYYY-MM-DD date.' },
      });
    }
    const { trainNumber } = params.data;
    try {
      const date = query.data.date ?? istDate();
      const startDate = query.data.boardingStation
        ? resolveStartDate(
            await provider.getSchedule(trainNumber),
            query.data.boardingStation,
            date,
          )
        : date;
      const status = await provider.getLiveStatus(trainNumber, startDate);
      return status ? { status } : notFound(reply, trainNumber);
    } catch (err) {
      if (err instanceof ProviderError) return providerUnavailable(reply, err);
      throw err;
    }
  });

  app.get('/:trainNumber/schedule', { config: { rateLimit } }, async (request, reply) => {
    const params = trainParams.safeParse(request.params);
    if (!params.success) {
      return reply
        .code(400)
        .send({ error: { code: 'VALIDATION', message: 'Use a 5-digit train number.' } });
    }
    try {
      const schedule = await provider.getSchedule(params.data.trainNumber);
      return schedule ? { schedule } : notFound(reply, params.data.trainNumber);
    } catch (err) {
      if (err instanceof ProviderError) return providerUnavailable(reply, err);
      throw err;
    }
  });
};
