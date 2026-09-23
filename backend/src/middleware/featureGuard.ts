import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './auth.js';
import { hasNutritionAccess } from '../utils/features.js';

/** Like authGuard, plus 403 unless the user is allowed into the nutrition module. */
export async function nutritionGuard(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (!hasNutritionAccess(payload.telegramId)) {
    return reply.status(403).send({ error: 'Nutrition module is not available yet' });
  }

  (request as any).user = payload;
}
