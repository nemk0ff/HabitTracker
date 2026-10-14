import { FastifyInstance } from 'fastify';
import type { HabitEntry } from '@prisma/client';
import { prisma } from '../db.js';
import { authGuard, JwtPayload } from '../middleware/auth.js';
import { track } from '../services/analytics.js';
import { isValidEntryValue, maxEntryValue, setHabitEntry } from '../services/habitStats.js';
import { isHHMM, setSleepEntry } from '../services/sleep.js';

const serializeEntry = (e: HabitEntry) => ({
  id: e.id,
  date: e.date.toISOString().split('T')[0],
  value: e.value,
  skipped: e.skipped,
  startTime: e.startTime,
  endTime: e.endTime,
});

export async function entriesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard);

  /**
   * `{ date, value?, skipped? }`: `skipped: true` stores a day off (value 0, overrides any mark);
   * value > 0 marks the day (clearing a skip); value 0 without `skipped` deletes the entry.
   * Hours habits (sleep) also take `{ date, startTime, endTime }` ('HH:MM' bed / wake, the night belongs to
   * the wake date): value = minutes between them, across midnight. A plain `value` clears stored times.
   */
  app.post<{
    Params: { id: string };
    Body: { date: string; value?: number; skipped?: boolean; startTime?: string; endTime?: string };
  }>('/habits/:id/entries', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const habitId = Number(request.params.id);
    const { date, value, skipped, startTime, endTime } = request.body ?? ({} as any);
    if (skipped !== undefined && typeof skipped !== 'boolean') {
      return reply.status(400).send({ error: 'skipped must be a boolean' });
    }

    const habit = await prisma.habit.findFirst({
      where: { id: habitId, userId },
    });
    if (!habit) {
      return reply.status(404).send({ error: 'Habit not found' });
    }

    const entryDate = new Date(date + 'T00:00:00.000Z');
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(entryDate.getTime())) {
      return reply.status(400).send({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    if (startTime !== undefined || endTime !== undefined) {
      if (habit.measure !== 'hours') {
        return reply.status(400).send({ error: 'startTime/endTime are only for hours habits' });
      }
      if (!isHHMM(startTime) || !isHHMM(endTime)) {
        return reply.status(400).send({ error: 'startTime and endTime must both be HH:MM' });
      }
      const minutes = await setSleepEntry(habit.id, date, { bed: startTime, wake: endTime });
      if (minutes === null) return reply.status(400).send({ error: 'Invalid sleep span' });
      track({
        userId,
        event: 'entry_checked',
        category: 'miniapp',
        label: date,
        metadata: { value: minutes, habitId, startTime, endTime },
      });
      const entry = await prisma.habitEntry.findUniqueOrThrow({ where: { habitId_date: { habitId, date: entryDate } } });
      return serializeEntry(entry);
    }

    const entryValue = skipped ? 0 : (value ?? 1);
    if (!isValidEntryValue(habit, entryValue)) {
      return reply.status(400).send({ error: `value must be an integer 0..${maxEntryValue(habit)}` });
    }

    let entry = await setHabitEntry(habit, entryDate, entryValue, skipped === true);
    if (!entry) {
      track({ userId, event: 'entry_unchecked', category: 'miniapp', label: date });
      return { deleted: true, date };
    }
    if (habit.measure === 'hours' && (entry.startTime !== null || entry.endTime !== null)) {
      // A plain duration (or a skip) replaces the bed/wake record — the old times no longer match.
      entry = await prisma.habitEntry.update({ where: { id: entry.id }, data: { startTime: null, endTime: null } });
    }

    track({
      userId,
      event: entry.skipped ? 'entry_skipped' : 'entry_checked',
      category: 'miniapp',
      label: date,
      metadata: { value: entryValue, habitId },
    });

    return serializeEntry(entry);
  });

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

      return entries.map(serializeEntry);
    },
  );
}
