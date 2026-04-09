import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authGuard, JwtPayload } from '../middleware/auth.js';
import { track } from '../services/analytics.js';

export async function entriesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard);

  app.post<{ Params: { id: string }; Body: { date: string; value?: number } }>(
    '/habits/:id/entries',
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const habitId = Number(request.params.id);
      const { date, value } = request.body;

      const habit = await prisma.habit.findFirst({
        where: { id: habitId, userId },
      });
      if (!habit) {
        return reply.status(404).send({ error: 'Habit not found' });
      }

      const entryDate = new Date(date + 'T00:00:00.000Z');
      if (isNaN(entryDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      const entryValue = value ?? 1;

      if (entryValue === 0) {
        await prisma.habitEntry.deleteMany({
          where: { habitId, date: entryDate },
        });
        track({ userId, event: 'entry_unchecked', category: 'miniapp', label: date });
        return { deleted: true, date };
      }

      const entry = await prisma.habitEntry.upsert({
        where: { habitId_date: { habitId, date: entryDate } },
        update: { value: entryValue },
        create: { habitId, date: entryDate, value: entryValue },
      });

      track({
        userId,
        event: 'entry_checked',
        category: 'miniapp',
        label: date,
        metadata: { value: entryValue, habitId },
      });

      return {
        id: entry.id,
        date: entry.date.toISOString().split('T')[0],
        value: entry.value,
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/habits/:id/entries',
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const habitId = Number(request.params.id);

      const habit = await prisma.habit.findFirst({
        where: { id: habitId, userId },
      });
      if (!habit) {
        return reply.status(404).send({ error: 'Habit not found' });
      }

      const where: any = { habitId };
      if (request.query.from || request.query.to) {
        where.date = {};
        if (request.query.from) where.date.gte = new Date(request.query.from + 'T00:00:00.000Z');
        if (request.query.to) where.date.lte = new Date(request.query.to + 'T00:00:00.000Z');
      }

      const entries = await prisma.habitEntry.findMany({
        where,
        orderBy: { date: 'asc' },
      });

      return entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString().split('T')[0],
        value: e.value,
      }));
    },
  );
}
