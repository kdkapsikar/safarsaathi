import type { FastifyPluginAsync } from 'fastify';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../auth/passwords.js';
import { endSession, startSession, type SessionOptions } from '../auth/sessions.js';
import type { Config } from '../config.js';
import { EmailTakenError } from '../data/index.js';
import { loginSchema, registerSchema } from '../schemas/auth.js';
import { validationError } from './errors.js';

export interface AuthRouteOptions extends SessionOptions {
  config: SessionOptions['config'] &
    Pick<Config, 'AUTH_RATE_LIMIT_MAX' | 'AUTH_RATE_LIMIT_WINDOW_MS'>;
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, opts) => {
  const rateLimit = {
    max: opts.config.AUTH_RATE_LIMIT_MAX,
    timeWindow: opts.config.AUTH_RATE_LIMIT_WINDOW_MS,
  };

  app.post('/register', { config: { rateLimit } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const { name, email, password } = parsed.data;

    try {
      const user = opts.data.accounts.createUser({
        name,
        email,
        passwordHash: await hashPassword(password),
      });
      startSession(reply, request, opts, user.id);
      return reply.code(201).send({ user });
    } catch (err) {
      if (err instanceof EmailTakenError) {
        return reply.code(409).send({
          error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' },
        });
      }
      throw err;
    }
  });

  app.post('/login', { config: { rateLimit } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationError(parsed.error));
    const { email, password } = parsed.data;

    const account = opts.data.accounts.findUserForLogin(email);
    const ok = account
      ? await verifyPassword(account.passwordHash, password)
      : await verifyAgainstDummy(password);
    if (!account || !ok) {
      return reply
        .code(401)
        .send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
    }

    opts.data.accounts.deleteExpiredSessions();
    startSession(reply, request, opts, account.id);
    const { passwordHash: _omit, ...user } = account;
    return { user };
  });

  app.post('/logout', async (request, reply) => {
    endSession(reply, request, opts);
    return reply.code(204).send();
  });

  app.get('/me', async (request, reply) => {
    if (!request.user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } });
    }
    return { user: request.user };
  });
};
