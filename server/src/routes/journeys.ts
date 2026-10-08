import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DuplicateRecipientError } from '../data/index.js';
import {
  addRecipientSchema,
  createJourneySchema,
  journeyDateProblem,
  journeySettingsSchema,
} from '../schemas/index.js';
import { validationError } from './errors.js';

const idParams = z.object({ id: z.uuid() });
const recipientParams = z.object({ id: z.uuid(), recipientId: z.uuid() });
const notFound = { error: { code: 'NOT_FOUND', message: 'Journey not found.' } };

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

  /** Smart rules, "leave now" travel time and connection for one journey. */
  app.put('/:id/settings', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send(notFound);
    const parsed = journeySettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const result = app.data
      .forUser(request.user!.id)
      .journeys.updateSettings(params.data.id, parsed.data);
    if (result === 'NOT_FOUND') return reply.code(404).send(notFound);
    if (result === 'BAD_CONNECTION') {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION',
          message: 'Please check the highlighted fields.',
          fields: { connectsToJourneyId: 'Choose another of your journeys' },
        },
      });
    }
    return { journey: result };
  });

  app.get('/:id/recipients', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const list = params.success
      ? app.data.forUser(request.user!.id).recipients.listForJourney(params.data.id)
      : null;
    return list ? { recipients: list } : reply.code(404).send(notFound);
  });

  app.post('/:id/recipients', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send(notFound);
    const parsed = addRecipientSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    try {
      const recipient = app.data
        .forUser(request.user!.id)
        .recipients.add(params.data.id, parsed.data);
      return recipient ? reply.code(201).send({ recipient }) : reply.code(404).send(notFound);
    } catch (err) {
      if (err instanceof DuplicateRecipientError) {
        return reply.code(409).send({
          error: { code: 'DUPLICATE', message: err.message, fields: { email: err.message } },
        });
      }
      throw err;
    }
  });

  app.delete('/:id/recipients/:recipientId', async (request, reply) => {
    const params = recipientParams.safeParse(request.params);
    const mine = app.data.forUser(request.user!.id);
    const ok =
      params.success &&
      mine.recipients
        .listForJourney(params.data.id)
        ?.some((r) => r.id === params.data.recipientId) &&
      mine.recipients.remove(params.data.recipientId);
    return ok
      ? reply.code(204).send()
      : reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Recipient not found.' } });
  });

  /** Turns on (or renews) the invite link; DELETE turns it off. */
  app.post('/:id/invite', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const result = params.success
      ? app.data.forUser(request.user!.id).journeys.setInvite(params.data.id, true)
      : null;
    return result ?? reply.code(404).send(notFound);
  });

  app.delete('/:id/invite', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const result = params.success
      ? app.data.forUser(request.user!.id).journeys.setInvite(params.data.id, false)
      : null;
    return result ? reply.code(204).send() : reply.code(404).send(notFound);
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
