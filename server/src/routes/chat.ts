import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AssistantService } from '../assistant/service.js';
import type { AssistantEvent } from '../assistant/types.js';
import { journeyDateProblem } from '../schemas/dates.js';
import { createJourneySchema } from '../schemas/journey.js';
import type { Clock } from '../trains/time.js';
import { validationError } from './errors.js';

const chatBody = z.object({
  message: z.string().trim().min(1, 'Type a message').max(2000),
  sessionId: z.uuid().optional(),
  /** Visitors only; ignored for signed-in users (their history is on the server). */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(30)
    .optional(),
});
const idParams = z.object({ id: z.uuid() });

export const chatRoutes: FastifyPluginAsync<{ assistant: AssistantService; clock: Clock }> = async (
  app,
  { assistant, clock },
) => {
  app.get('/info', async (request) => ({
    mode: assistant.mode,
    signedIn: request.user !== null,
  }));

  /** POST /api/chat: the reply streams back as Server-Sent Events. */
  app.post('/', async (request, reply) => {
    const parsed = chatBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const rejection = assistant.admit(request.user, request.ip);
    if (rejection) return reply.code(429).send({ error: rejection });

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const emit = (e: AssistantEvent) => {
      if (!res.writableEnded) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };

    try {
      await assistant.chat({
        message: parsed.data.message,
        user: request.user,
        ip: request.ip,
        sessionId: parsed.data.sessionId,
        history: request.user ? undefined : parsed.data.history,
        emit,
        signal: controller.signal,
      });
    } catch (err) {
      request.log.error({ err }, 'Assistant turn failed');
    } finally {
      res.end();
    }
  });

  // Everything below is for signed-in users only.
  const requireUser = async (
    request: { user: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    if (!request.user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } });
    }
  };

  /** The user's latest conversation, to restore the chat panel. */
  app.get('/history', { preHandler: requireUser }, async (request) => {
    const chat = app.data.forUser(request.user!.id).chat;
    const latest = chat.listSessions()[0];
    if (!latest) return { sessionId: null, messages: [] };
    const messages = (chat.getMessages(latest.id) ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, ...(m.content as object) }));
    return { sessionId: latest.id, messages };
  });

  /**
   * Runs a proposed write. The payload was stored server-side when the
   * assistant proposed it, and is re-validated now; only its owner can confirm.
   */
  app.post('/proposals/:id/confirm', { preHandler: requireUser }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const mine = app.data.forUser(request.user!.id);
    const proposal = params.success ? mine.proposals.getPending(params.data.id) : null;
    if (!proposal) {
      return reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: 'That suggestion has expired or was already handled.',
        },
      });
    }

    if (proposal.kind === 'CREATE_JOURNEY') {
      const input = createJourneySchema.safeParse(proposal.payload);
      const dateProblem = input.success
        ? journeyDateProblem(input.data.journeyDate, clock.now())
        : null;
      if (!input.success || dateProblem) {
        mine.proposals.resolve(proposal.id, 'CANCELLED');
        return reply.code(400).send({
          error: { code: 'VALIDATION', message: dateProblem ?? 'This journey is no longer valid.' },
        });
      }
      if (!mine.proposals.resolve(proposal.id, 'CONFIRMED'))
        return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Already handled.' } });
      const journey = mine.journeys.create(input.data);
      return { result: 'created', journey };
    }

    const { journeyId } = proposal.payload as { journeyId: string };
    if (!mine.proposals.resolve(proposal.id, 'CONFIRMED'))
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Already handled.' } });
    const deleted = mine.journeys.delete(journeyId);
    return { result: deleted ? 'deleted' : 'already_gone', journeyId };
  });

  app.post('/proposals/:id/cancel', { preHandler: requireUser }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const ok =
      params.success &&
      app.data.forUser(request.user!.id).proposals.resolve(params.data.id, 'CANCELLED');
    if (!ok)
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Nothing to cancel.' } });
    return reply.code(204).send();
  });
};
