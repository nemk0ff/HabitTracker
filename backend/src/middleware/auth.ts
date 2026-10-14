import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { isOwnerTelegramId } from '../utils/owner.js';

// No silent fallback in production: a known default secret would let anyone forge the owner's token.
const JWT_SECRET = process.env.JWT_SECRET || (process.env.DEV_LOGIN === '1' ? 'dev-secret' : '');
if (JWT_SECRET.length < 32 && process.env.DEV_LOGIN !== '1') {
  throw new Error('JWT_SECRET must be set (32+ chars)');
}

export interface JwtPayload {
  userId: number;
  telegramId: number;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return reply.status(401).send({ error: 'Invalid token' });
  }

  // A personal app: tokens issued to anyone but the owner (before it was closed) no longer work.
  if (!isOwnerTelegramId(payload.telegramId)) {
    return reply.status(403).send({ error: 'Это личное приложение' });
  }

  (request as any).user = payload;
}
