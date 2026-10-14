import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { validateInitData } from '../utils/telegram.js';
import { signToken } from '../middleware/auth.js';
import { track } from '../services/analytics.js';
import { isValidTzOffset } from '../utils/safe.js';
import { DEV_TELEGRAM_ID, devLoginEnabled, isOwnerTelegramId } from '../utils/owner.js';

const BOT_TOKEN = process.env.BOT_TOKEN || '';

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { initData: string; tzOffset?: number } }>('/auth', async (request, reply) => {
    const { initData, tzOffset } = request.body ?? ({} as { initData: string; tzOffset?: number });
    if (!initData) {
      return reply.status(400).send({ error: 'initData is required' });
    }

    const devMode = devLoginEnabled() && initData === 'dev-mode';
    const telegramUser = devMode
      ? { id: DEV_TELEGRAM_ID, first_name: 'Dev', last_name: 'User', username: 'devuser', allows_write_to_pm: undefined }
      : validateInitData(initData, BOT_TOKEN);

    if (!telegramUser) {
      return reply.status(401).send({ error: 'Invalid initData' });
    }

    // A personal app: only the owner gets in. No user row, no tracking for anyone else.
    if (!isOwnerTelegramId(telegramUser.id)) {
      return reply.status(403).send({ error: 'Это личное приложение' });
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

    const user = await prisma.user.upsert({
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
      },
    });

    track({ userId: user.id, event: existing ? 'app_open' : 'user_registered', category: 'miniapp' });

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
        checkinTime: user.checkinTime,
        morningCheckinTime: user.morningCheckinTime,
        canMessage: user.canMessage,
        // Kept for older clients: the owner has every module.
        features: { nutrition: true, agentLog: true },
      },
    };
  });
}
