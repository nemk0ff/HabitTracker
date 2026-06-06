import { FastifyInstance } from 'fastify';
import { sharedSecretGuard } from '../middleware/sharedSecretGuard.js';
import { registerSessionStart } from '../services/claudeSessions.js';

export async function claudeSessionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', sharedSecretGuard);

  app.post('/claude/session-start', async (_request, reply) => {
    await registerSessionStart();
    return reply.send({ ok: true });
  });
}
