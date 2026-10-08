import type { FastifyPluginAsync } from 'fastify';

export interface HealthResponse {
  status: 'ok';
  service: 'safar-saathi-api';
  time: string;
  uptimeSeconds: number;
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'safar-saathi-api',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  }));
};
