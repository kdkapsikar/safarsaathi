import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DuplicateRecipientError } from '../data/index.js';
import { addRecipientSchema } from '../schemas/index.js';
import { validationError } from './errors.js';

const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });
const gone = {
  error: {
    code: 'NOT_FOUND',
    message: 'This link is no longer valid. Ask the traveller for a new one.',
  },
};

/**
 * No sign-in: invite links (family or a driver add themselves to a journey)
 * and opt-out links (a recipient stops alerts). Token-gated, rate-limited.
 */
export const publicLinkRoutes: FastifyPluginAsync = async (app) => {
  const rateLimit = { max: 20, timeWindow: 60_000 };
  const links = app.data.publicLinks;

  app.get('/invites/:token', { config: { rateLimit } }, async (request, reply) => {
    const p = tokenParams.safeParse(request.params);
    const info = p.success ? links.inviteInfo(p.data.token) : null;
    return info ? { invite: info } : reply.code(404).send(gone);
  });

  app.post('/invites/:token', { config: { rateLimit } }, async (request, reply) => {
    const p = tokenParams.safeParse(request.params);
    if (!p.success) return reply.code(404).send(gone);
    const parsed = addRecipientSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    try {
      const joined = links.join(p.data.token, parsed.data);
      return joined ? reply.code(201).send({ joined: true }) : reply.code(404).send(gone);
    } catch (err) {
      if (err instanceof DuplicateRecipientError) {
        return reply.code(409).send({
          error: {
            code: 'DUPLICATE',
            message: "You're already getting alerts for this journey.",
          },
        });
      }
      throw err;
    }
  });

  app.get('/opt-out/:token', { config: { rateLimit } }, async (request, reply) => {
    const p = tokenParams.safeParse(request.params);
    const info = p.success ? links.optOutInfo(p.data.token) : null;
    return info ? { optOut: info } : reply.code(404).send(gone);
  });

  app.post('/opt-out/:token', { config: { rateLimit } }, async (request, reply) => {
    const p = tokenParams.safeParse(request.params);
    const ok = p.success && links.optOut(p.data.token);
    return ok ? { optedOut: true } : reply.code(404).send(gone);
  });
};
