import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authGuard, JwtPayload } from '../middleware/auth.js';

const VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME_RE = /^\d{2}:\d{2}$/;

export async function reminderRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard);

  app.get<{ Params: { id: string } }>(
    '/habits/:id/reminder',
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const habitId = Number(request.params.id);

      const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } });
      if (!habit) return reply.status(404).send({ error: 'Habit not found' });

      const reminder = await prisma.reminder.findUnique({ where: { habitId } });
      if (!reminder) return null;

      return {
        id: reminder.id,
        habitId: reminder.habitId,
        enabled: reminder.enabled,
        days: JSON.parse(reminder.days),
        time: reminder.time,
        snooze: reminder.snooze,
      };
    },
  );

  app.put<{
    Params: { id: string };
    Body: { enabled: boolean; days: string[]; time: string; snooze: boolean };
  }>(
    '/habits/:id/reminder',
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const habitId = Number(request.params.id);

      const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } });
      if (!habit) return reply.status(404).send({ error: 'Habit not found' });

      const { enabled, days, time, snooze } = request.body;

      if (!Array.isArray(days) || !days.every((d) => VALID_DAYS.includes(d))) {
        return reply.status(400).send({ error: 'Invalid days' });
      }
      if (!TIME_RE.test(time)) {
        return reply.status(400).send({ error: 'Invalid time format. Use HH:MM' });
      }

      const reminder = await prisma.reminder.upsert({
        where: { habitId },
        update: {
          enabled,
          days: JSON.stringify(days),
          time,
          snooze: !!snooze,
          lastMessageId: null,
          lastSentAt: null,
        },
        create: {
          habitId,
          enabled,
          days: JSON.stringify(days),
          time,
          snooze: !!snooze,
        },
      });

      return {
        id: reminder.id,
        habitId: reminder.habitId,
        enabled: reminder.enabled,
        days: JSON.parse(reminder.days),
        time: reminder.time,
        snooze: reminder.snooze,
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/habits/:id/reminder',
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const habitId = Number(request.params.id);

      const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } });
      if (!habit) return reply.status(404).send({ error: 'Habit not found' });

      await prisma.reminder.deleteMany({ where: { habitId } });
      return { success: true };
    },
  );
}
