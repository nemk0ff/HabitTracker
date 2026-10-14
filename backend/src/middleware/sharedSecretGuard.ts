import { timingSafeEqual } from 'node:crypto';
import { FastifyRequest, FastifyReply } from 'fastify';

export async function sharedSecretGuard(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.KEEP_ALIVE_SECRET;
  if (!expected) {
    return reply.status(503).send({ error: 'KEEP_ALIVE_SECRET not configured' });
  }

  const header = request.headers.authorization;
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}
