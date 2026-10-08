import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { validateInitData } from '../utils/telegram.js';
import { signToken } from '../middleware/auth.js';
import { track } from '../services/analytics.js';
import { hasAgentLogAccess, hasNutritionAccess } from '../utils/features.js';
import { isValidTzOffset } from '../utils/safe.js';

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

    let user = await prisma.user.upsert({
      where: { telegramId: BigInt(telegramUser.id) },
      update: {
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name ?? null,
        username: telegramUser.username ?? null,
        ...tz,
      },
      create: {
        telegramId: BigInt(telegramUser.id),
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name ?? null,
        username: telegramUser.username ?? null,
        ...tz,
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
        features: {
          nutrition: hasNutritionAccess(telegramUser.id),
          agentLog: hasAgentLogAccess(telegramUser.id),
        },
      },
    };
  });
}
