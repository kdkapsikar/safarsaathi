import fp from 'fastify-plugin';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions, alongside SameSite=Lax and JSON-only bodies.
 * Rejects state-changing requests that a browser marks as cross-site, or whose
 * Origin isn't one of ours. Non-browser clients send neither header and carry no
 * victim's cookies, so they pass.
 */
export const originCheck = fp<{ allowedOrigins: string[] }>(async (app, { allowedOrigins }) => {
  const allowed = new Set(allowedOrigins);

  app.addHook('onRequest', async (request, reply) => {
    if (SAFE_METHODS.has(request.method)) return;

    const site = request.headers['sec-fetch-site'];
    const origin = request.headers.origin;
    const crossSite = site === 'cross-site';
    const foreignOrigin = origin !== undefined && !allowed.has(origin);

    if (crossSite || foreignOrigin) {
      return reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Cross-site request blocked.' } });
    }
  });
});
