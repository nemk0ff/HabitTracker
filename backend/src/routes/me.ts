import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authGuard, JwtPayload } from '../middleware/auth.js';
import { track } from '../services/analytics.js';
import { isValidTzOffset } from '../utils/safe.js';

/** Local 'HH:MM', 00:00–23:59. */
const CHECKIN_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

interface MeBody {
  checkinTime?: string | null;
  onboarded?: boolean;
  tzOffset?: number;
}

export async function meRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard);

  /** Partial update of the user's own settings. `onboarded: false` is a no-op (onboarding is one-way). */
  app.put<{ Body: MeBody }>('/me', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const body = request.body;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: 'Body is required' });
    }
    const { checkinTime, onboarded, tzOffset } = body;

    if (checkinTime !== undefined && checkinTime !== null && !(typeof checkinTime === 'string' && CHECKIN_RE.test(checkinTime))) {
      return reply.status(400).send({ error: 'Invalid checkinTime. Use HH:MM (00:00–23:59) or null' });
    }
    if (onboarded !== undefined && typeof onboarded !== 'boolean') {
      return reply.status(400).send({ error: 'Invalid onboarded' });
    }
    if (tzOffset !== undefined && !isValidTzOffset(tzOffset)) {
      return reply.status(400).send({ error: 'Invalid tzOffset. Integer minutes in −840..840' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { onboardedAt: true } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const firstOnboarding = onboarded === true && user.onboardedAt === null;
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(checkinTime !== undefined ? { checkinTime } : {}),
        ...(tzOffset !== undefined ? { tzOffset } : {}),
        ...(firstOnboarding ? { onboardedAt: new Date() } : {}),
      },
    });

    if (firstOnboarding) {
      track({ userId, event: 'onboarding_completed', category: 'miniapp', metadata: { checkinTime: checkinTime ?? null } });
    }
    if (checkinTime !== undefined) {
      track({ userId, event: 'checkin_time_set', category: 'miniapp', label: checkinTime ?? 'off' });
    }

    return { ok: true };
  });
}
