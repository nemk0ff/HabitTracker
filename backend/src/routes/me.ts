import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authGuard, JwtPayload } from '../middleware/auth.js';
import { track } from '../services/analytics.js';
import { isValidTzOffset } from '../utils/safe.js';
import { sendToUser } from '../services/messaging.js';
import { MORNING_OFF } from '../services/checkin.js';

/** Local 'HH:MM', 00:00–23:59. */
const CHECKIN_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** POST /me/write-access sends a real message — at most one per user per this window. */
const WRITE_ACCESS_THROTTLE_MS = 60_000;
const lastWriteAccessSend = new Map<number, number>();

interface MeBody {
  checkinTime?: string | null;
  morningCheckinTime?: string | null;
  tzOffset?: number;
}

export async function meRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard);

  /** Partial update of the user's own settings. */
  app.put<{ Body: MeBody }>('/me', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const body = request.body;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: 'Body is required' });
    }
    const { checkinTime, morningCheckinTime, tzOffset } = body;

    if (checkinTime !== undefined && checkinTime !== null && !(typeof checkinTime === 'string' && CHECKIN_RE.test(checkinTime))) {
      return reply.status(400).send({ error: 'Invalid checkinTime. Use HH:MM (00:00–23:59) or null' });
    }
    // Morning: HH:MM, null = default 09:00, 'off' = disabled (see services/checkin.ts morningTimeOf).
    if (
      morningCheckinTime !== undefined &&
      morningCheckinTime !== null &&
      morningCheckinTime !== MORNING_OFF &&
      !(typeof morningCheckinTime === 'string' && CHECKIN_RE.test(morningCheckinTime))
    ) {
      return reply.status(400).send({ error: `Invalid morningCheckinTime. Use HH:MM (00:00–23:59), null (default 09:00) or '${MORNING_OFF}'` });
    }
    if (tzOffset !== undefined && !isValidTzOffset(tzOffset)) {
      return reply.status(400).send({ error: 'Invalid tzOffset. Integer minutes in −840..840' });
    }

    const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) return reply.status(404).send({ error: 'User not found' });

    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(checkinTime !== undefined ? { checkinTime } : {}),
        ...(morningCheckinTime !== undefined ? { morningCheckinTime } : {}),
        ...(tzOffset !== undefined ? { tzOffset } : {}),
      },
    });

    if (checkinTime !== undefined) {
      track({ userId, event: 'checkin_time_set', category: 'miniapp', label: checkinTime ?? 'off' });
    }

    if (morningCheckinTime !== undefined) {
      track({ userId, event: 'morning_checkin_time_set', category: 'miniapp', label: morningCheckinTime ?? 'default' });
    }

    return { ok: true };
  });

  /**
   * Called after the user granted write access in the Mini App (`requestWriteAccess`). Sends a short
   * confirmation, which also verifies the channel. Always 200: `{ canMessage }` says whether it went through.
   */
  app.post('/me/write-access', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, telegramId: true, canMessage: true, checkinTime: true },
    });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const now = Date.now();
    const last = lastWriteAccessSend.get(userId);
    if (last !== undefined && now - last < WRITE_ACCESS_THROTTLE_MS) return { canMessage: user.canMessage === true };
    lastWriteAccessSend.set(userId, now);
    for (const [id, at] of lastWriteAccessSend) if (now - at >= WRITE_ACCESS_THROTTLE_MS) lastWriteAccessSend.delete(id);

    const text = user.checkinTime
      ? `Готово! Буду писать сюда: вечерняя сводка в ${user.checkinTime}`
      : 'Готово! Теперь бот может присылать напоминания';
    try {
      const sent = await sendToUser(user, text, undefined, { purpose: 'write_access', force: true });
      if (sent) {
        track({ userId, event: 'write_access_granted', category: 'miniapp' });
        return { canMessage: true };
      }
      track({ userId, event: 'write_access_failed', category: 'miniapp', label: '403' });
    } catch (e) {
      request.log.error(e, 'write-access confirmation failed');
      track({ userId, event: 'write_access_failed', category: 'miniapp', label: 'error' });
    }
    return { canMessage: false };
  });
}
