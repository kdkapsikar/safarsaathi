import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createJourneySchema, journeyDateProblem } from '../schemas/index.js';
import { validationError } from './errors.js';

const idParams = z.object({ id: z.uuid() });

export const journeyRoutes: FastifyPluginAsync = async (app) => {
  // Every route here needs a signed-in user. Data access goes through
  // app.data.forUser(), bound to the session's user id, never to request input.
  app.addHook('preHandler', async (request, reply) => {
    if (!request.user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } });
    }
  });

  app.get('/', async (request) => {
    const data = app.data.forUser(request.user!.id);
    return { journeys: data.journeys.list() };
  });

  app.post('/', async (request, reply) => {
    const parsed = createJourneySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));

    const dateProblem = journeyDateProblem(parsed.data.journeyDate);
    if (dateProblem) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION',
          message: 'Please check the highlighted fields.',
          fields: { journeyDate: dateProblem },
        },
      });
    }

    const journey = app.data.forUser(request.user!.id).journeys.create(parsed.data);
    return reply.code(201).send({ journey });
  });

  app.delete('/:id', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const deleted =
      params.success && app.data.forUser(request.user!.id).journeys.delete(params.data.id);
    if (!deleted) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Journey not found.' } });
    }
    return reply.code(204).send();
  });
};
