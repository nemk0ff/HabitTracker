import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { initDataStartParam, validateInitData } from '../utils/telegram.js';
import { signToken } from '../middleware/auth.js';
import { track } from '../services/analytics.js';
import { hasAgentLogAccess, hasNutritionAccess } from '../utils/features.js';
import { isValidTzOffset } from '../utils/safe.js';
import { resolveReferrer } from '../services/referral.js';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const IS_DEV = process.env.NODE_ENV !== 'production';
const DEVELOPER_CHAT_ID = process.env.DEVELOPER_CHAT_ID || '';

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { initData: string; tzOffset?: number } }>('/auth', async (request, reply) => {
    const { initData, tzOffset } = request.body ?? ({} as { initData: string; tzOffset?: number });
    if (!initData) {
      return reply.status(400).send({ error: 'initData is required' });
    }

    let telegramUser;

    if (IS_DEV && initData === 'dev-mode') {
      telegramUser = { id: 999999, first_name: 'Dev', last_name: 'User', username: 'devuser' };
    } else {
      telegramUser = validateInitData(initData, BOT_TOKEN);
    }

    if (!telegramUser) {
      return reply.status(401).send({ error: 'Invalid initData' });
    }

    const existing = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramUser.id) },
    });

    // Optional, ignored when malformed — auth must never fail because of it.
    const tz = isValidTzOffset(tzOffset) ? { tzOffset } : {};
    // Only ever sent as true, so its absence says nothing — never downgrade canMessage from it. And it only
    // upgrades an unknown channel: a known-closed one (403 — e.g. the bot was blocked) stays closed until
    // /start or a successful send proves otherwise.
    const writeAccess =
      telegramUser.allows_write_to_pm === true && (existing?.canMessage ?? null) === null ? { canMessage: true } : {};

    // «Пригласить друга»: only a first registration is attributed (initData is validated above, dev-mode has none).
    const referrerId = existing || initData === 'dev-mode' ? null : await resolveReferrer(initDataStartParam(initData), null);

    let user = await prisma.user.upsert({
      where: { telegramId: BigInt(telegramUser.id) },
      update: {
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name ?? null,
        username: telegramUser.username ?? null,
        ...tz,
        ...writeAccess,
      },
      create: {
        telegramId: BigInt(telegramUser.id),
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name ?? null,
        username: telegramUser.username ?? null,
        ...tz,
        ...writeAccess,
        ...(referrerId !== null && { referrerId }),
      },
    });

    // Users who set up habits before onboarding existed count as onboarded.
    if (!user.onboardedAt && (await prisma.habit.count({ where: { userId: user.id } })) > 0) {
      user = await prisma.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() } });
    }

    track({
      userId: user.id,
      event: existing ? 'app_open' : 'user_registered',
      category: 'miniapp',
      ...(!existing && { metadata: { referrerId: user.referrerId } }),
    });

    const token = signToken({
      userId: user.id,
      telegramId: telegramUser.id,
    });

    return {
      token,
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        isAdmin: DEVELOPER_CHAT_ID !== '' && telegramUser.id.toString() === DEVELOPER_CHAT_ID,
        onboarded: user.onboardedAt !== null,
        checkinTime: user.checkinTime,
        morningCheckinTime: user.morningCheckinTime,
        canMessage: user.canMessage,
        features: {
          nutrition: hasNutritionAccess(telegramUser.id),
          agentLog: hasAgentLogAccess(telegramUser.id),
        },
      },
    };
  });
}
