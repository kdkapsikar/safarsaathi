import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const idParams = z.object({ id: z.uuid() });

/** The signed-in user's in-app alert feed (the bell). */
export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request, reply) => {
    if (!request.user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } });
    }
  });

  app.get('/', async (request) => {
    const mine = app.data.forUser(request.user!.id).notifications;
    return { notifications: mine.list(50), unreadCount: mine.unreadCount() };
  });

  app.post('/:id/read', async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const ok =
      params.success && app.data.forUser(request.user!.id).notifications.markRead(params.data.id);
    if (!ok) {
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: 'Notification not found.' } });
    }
    return reply.code(204).send();
  });

  app.post('/read-all', async (request) => {
    const marked = app.data.forUser(request.user!.id).notifications.markAllRead();
    return { marked };
  });
};
