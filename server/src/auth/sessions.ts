import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config.js';
import type { DataAccess, User } from '../data/index.js';

export const SESSION_COOKIE = 'ss_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionTokenHash: string | null;
  }
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export interface SessionOptions {
  data: DataAccess;
  config: Pick<Config, 'SESSION_TTL_DAYS' | 'COOKIE_SECURE'>;
}

/** Resolves `request.user` from the session cookie on every request. */
export const sessionPlugin = fp<SessionOptions>(async (app, { data }) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionTokenHash', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const tokenHash = hashToken(token);
    const user = data.accounts.userForSession(tokenHash);
    if (user) {
      request.user = user;
      request.sessionTokenHash = tokenHash;
    }
  });
});

export function startSession(
  reply: FastifyReply,
  request: FastifyRequest,
  { data, config }: SessionOptions,
  userId: string,
): void {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  data.accounts.createSession({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    userAgent: request.headers['user-agent'],
  });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
  });
}

export function endSession(
  reply: FastifyReply,
  request: FastifyRequest,
  { data, config }: SessionOptions,
): void {
  if (request.sessionTokenHash) data.accounts.deleteSession(request.sessionTokenHash);
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
  });
}
