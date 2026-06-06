import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from './auth.js';

const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID || '';

/**
 * Restricts a route to the admin (developer). Verifies the JWT like authGuard,
 * then requires the token's telegramId to match DEVELOPER_CHAT_ID.
 */
export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  if (!DEVELOPER_CHAT_ID) {
    return reply.status(503).send({ error: 'DEVELOPER_CHAT_ID not configured' });
  }

  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return reply.status(401).send({ error: 'Invalid token' });
  }

  if (payload.telegramId.toString() !== DEVELOPER_CHAT_ID) {
    return reply.status(403).send({ error: 'Forbidden' });
  }

  (request as any).user = payload;
}
