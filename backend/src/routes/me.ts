import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authGuard, JwtPayload } from '../middleware/auth.js';
import { track } from '../services/analytics.js';
import { isValidTzOffset } from '../utils/safe.js';
import { sendPhotoToUser, sendToUser } from '../services/messaging.js';
import { inviteLink } from '../services/referral.js';

/** Local 'HH:MM', 00:00–23:59. */
const CHECKIN_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** POST /me/write-access sends a real message — at most one per user per this window. */
const WRITE_ACCESS_THROTTLE_MS = 60_000;
const lastWriteAccessSend = new Map<number, number>();

/** Share card: decoded PNG cap, and the route's own body limit (base64 is 4/3 of that, plus JSON). */
const SHARE_MAX_PNG_BYTES = 1.5 * 1024 * 1024;
const SHARE_BODY_LIMIT = 2.5 * 1024 * 1024;
const SHARE_CAPTION_MAX = 200;
const SHARE_THROTTLE_MS = 20_000;
const lastShareSend = new Map<number, number>();
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

const ACHIEVEMENT_KEY_MAX = 40;

interface MeBody {
  checkinTime?: string | null;
  morningCheckinTime?: string | null;
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
    const { checkinTime, morningCheckinTime, onboarded, tzOffset } = body;

    if (checkinTime !== undefined && checkinTime !== null && !(typeof checkinTime === 'string' && CHECKIN_RE.test(checkinTime))) {
      return reply.status(400).send({ error: 'Invalid checkinTime. Use HH:MM (00:00–23:59) or null' });
    }
    if (
      morningCheckinTime !== undefined &&
      morningCheckinTime !== null &&
      !(typeof morningCheckinTime === 'string' && CHECKIN_RE.test(morningCheckinTime))
    ) {
      return reply.status(400).send({ error: 'Invalid morningCheckinTime. Use HH:MM (00:00–23:59) or null' });
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
        ...(morningCheckinTime !== undefined ? { morningCheckinTime } : {}),
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

    if (morningCheckinTime !== undefined) {
      track({ userId, event: 'morning_checkin_time_set', category: 'miniapp', label: morningCheckinTime ?? 'off' });
    }

    return { ok: true };
  });

  /** «Пригласить друга»: the user's invite link and how many people registered through it. */
  app.get('/me/invite', async (request) => {
    const { userId } = (request as any).user as JwtPayload;
    const [link, invitedCount] = await Promise.all([inviteLink(userId), prisma.user.count({ where: { referrerId: userId } })]);
    return { link, invitedCount };
  });

  /** The client detected an achievement; logged once per user + key (repeats are a no-op). */
  app.post<{ Body: { key?: unknown } }>('/me/achievement', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const key = typeof request.body?.key === 'string' ? request.body.key.trim() : '';
    if (!key || key.length > ACHIEVEMENT_KEY_MAX) {
      return reply.status(400).send({ error: `key must be a non-empty string of at most ${ACHIEVEMENT_KEY_MAX} characters` });
    }
    const seen = await prisma.analyticsEvent.findFirst({
      where: { userId, event: 'achievement_unlocked', label: key },
      select: { id: true },
    });
    if (seen) return { ok: true, new: false };
    // Awaited (not fire-and-forget track()) so a quick repeat sees it.
    await prisma.analyticsEvent.create({ data: { userId, event: 'achievement_unlocked', category: 'miniapp', label: key } });
    return { ok: true, new: true };
  });

  /**
   * «Поделиться прогрессом»: the Mini App renders a PNG card on canvas, the bot sends it to the user's chat
   * (caption + invite link) so they can forward it. `{ok:false, reason:'unreachable'}` = the bot can't write to them.
   */
  app.post<{ Body: { image?: unknown; caption?: unknown } }>(
    '/share/card',
    { bodyLimit: SHARE_BODY_LIMIT },
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const { image, caption } = request.body ?? {};
      if (typeof image !== 'string' || !image.startsWith(PNG_DATA_URL_PREFIX)) {
        return reply.status(400).send({ error: 'image must be a data:image/png;base64 URL' });
      }
      if (caption !== undefined && caption !== null && (typeof caption !== 'string' || caption.length > SHARE_CAPTION_MAX)) {
        return reply.status(400).send({ error: `caption must be a string of at most ${SHARE_CAPTION_MAX} characters` });
      }
      const png = Buffer.from(image.slice(PNG_DATA_URL_PREFIX.length), 'base64');
      if (png.length > SHARE_MAX_PNG_BYTES) return reply.status(413).send({ error: 'image is larger than 1.5 MB' });
      if (png.length < PNG_MAGIC.length || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
        return reply.status(400).send({ error: 'image is not a PNG' });
      }

      const now = Date.now();
      const last = lastShareSend.get(userId);
      if (last !== undefined && now - last < SHARE_THROTTLE_MS) {
        return reply.status(429).send({ ok: false, reason: 'throttled', error: 'Подожди немного перед следующей отправкой' });
      }
      lastShareSend.set(userId, now);
      for (const [id, at] of lastShareSend) if (now - at >= SHARE_THROTTLE_MS) lastShareSend.delete(id);

      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, telegramId: true, canMessage: true } });
      if (!user) {
        lastShareSend.delete(userId);
        return reply.status(404).send({ error: 'User not found' });
      }

      const text = typeof caption === 'string' ? caption.trim() : '';
      try {
        const fullCaption = `${text ? `${text}\n\n` : ''}Присоединяйся: ${await inviteLink(userId)}`;
        // The user asked for it right now, so try even if an earlier send hit 403.
        const sent = await sendPhotoToUser(user, png, { caption: fullCaption }, { purpose: 'share_card', force: true });
        if (!sent) {
          lastShareSend.delete(userId); // nothing was sent: let them retry right after granting write access
          return { ok: false, reason: 'unreachable' };
        }
      } catch (e) {
        lastShareSend.delete(userId); // a transient failure shouldn't block a retry
        request.log.error(e, 'share card send failed');
        return reply.status(502).send({ ok: false, reason: 'error', error: 'Не получилось отправить картинку' });
      }
      track({ userId, event: 'share_card_sent', category: 'miniapp', metadata: { bytes: png.length } });
      return { ok: true };
    },
  );

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
