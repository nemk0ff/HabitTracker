import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { validateInitData } from '../utils/telegram.js';
import { signToken } from '../middleware/auth.js';
import { track } from '../services/analytics.js';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const IS_DEV = process.env.NODE_ENV !== 'production';

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { initData: string } }>('/auth', async (request, reply) => {
    const { initData } = request.body;
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

    const user = await prisma.user.upsert({
      where: { telegramId: BigInt(telegramUser.id) },
      update: {
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name ?? null,
        username: telegramUser.username ?? null,
      },
      create: {
        telegramId: BigInt(telegramUser.id),
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name ?? null,
        username: telegramUser.username ?? null,
      },
    });

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
      },
    };
  });
}
