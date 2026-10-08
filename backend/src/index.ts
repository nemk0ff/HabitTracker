import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { prisma } from './db.js';
import { authRoutes } from './routes/auth.js';
import { habitsRoutes } from './routes/habits.js';
import { entriesRoutes } from './routes/entries.js';
import { reminderRoutes } from './routes/reminders.js';
import { claudeSessionRoutes } from './routes/claudeSession.js';
import { adminRoutes } from './routes/admin.js';
import { nutritionRoutes } from './routes/nutrition.js';
import { meRoutes } from './routes/me.js';
import { startScheduler } from './services/scheduler.js';
import { bot, startBot } from './services/bot.js';
import { initSharedCatalog } from './services/nutrition/foodSearch.js';
import { startAlerts } from './services/alerts.js';
import { startSessionWarningCron } from './services/claudeSessions.js';
import { startWeeklySummaryCron } from './services/nutrition/weeklySummary.js';
import { startDailyPrompts } from './services/nutrition/prompts.js';
import { startCheckinCron } from './services/checkin.js';
const PORT = Number(process.env.PORT) || 3001;

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  credentials: true,
});

app.register(authRoutes, { prefix: '/api' });
app.register(habitsRoutes, { prefix: '/api' });
app.register(entriesRoutes, { prefix: '/api' });
app.register(reminderRoutes, { prefix: '/api' });
app.register(claudeSessionRoutes, { prefix: '/api' });
app.register(adminRoutes, { prefix: '/api' });
app.register(nutritionRoutes, { prefix: '/api' });
app.register(meRoutes, { prefix: '/api' });

app.get('/api/health', async () => ({ status: 'ok' }));

const publicDir = path.join(process.cwd(), 'public');
await app.register(fastifyStatic, {
  root: publicDir,
  prefix: '/',
  wildcard: false,
});

app.setNotFoundHandler((_request, reply) => {
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  reply.sendFile('index.html');
});

const shutdown = async () => {
  await bot.stop();
  await prisma.$disconnect();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await initSharedCatalog();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on http://localhost:${PORT}`);
  startScheduler();
  startBot();
  startAlerts();
  startSessionWarningCron();
  startWeeklySummaryCron();
  startDailyPrompts();
  startCheckinCron();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
