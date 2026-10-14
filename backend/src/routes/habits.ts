import { FastifyInstance } from 'fastify';
import type { Habit, HabitEntry } from '@prisma/client';
import { prisma } from '../db.js';
import { authGuard, JwtPayload } from '../middleware/auth.js';
import { track } from '../services/analytics.js';

/** Non-level habit kinds. The measure is fixed at creation — entries of an existing habit aren't converted. */
export const HABIT_MEASURES = ['hours', 'count'];
export const TIMES_OF_DAY = ['morning', 'day', 'evening'];
/** Same-name POSTs within this window return the existing habit (double-tap on «Создать»). */
const DUPLICATE_WINDOW_MS = 10_000;

type HabitRow = Habit & { entries?: HabitEntry[] };

/** API shape of a habit (matches frontend `Habit`); `entries` is [] when not loaded. */
export function serializeHabit(h: HabitRow) {
  return {
    id: h.id,
    name: h.name,
    color: h.color,
    icon: h.icon,
    binary: h.binary,
    measure: h.measure,
    weeklyTarget: h.weeklyTarget,
    timeOfDay: h.timeOfDay,
    dailyTarget: h.dailyTarget,
    sortOrder: h.sortOrder,
    archived: h.archived,
    challengeDays: h.challengeDays,
    challengeStart: h.challengeStart,
    createdAt: h.createdAt.toISOString(),
    entries: (h.entries ?? []).map((e) => ({
      id: e.id,
      date: e.date.toISOString().split('T')[0],
      value: e.value,
      skipped: e.skipped,
      startTime: e.startTime,
      endTime: e.endTime,
    })),
  };
}

const entriesSince = () => ({
  where: { date: { gte: new Date(Date.now() - 18 * 7 * 86_400_000) } },
  orderBy: { date: 'asc' as const },
});

type Parsed<T> = { ok: true; value: T } | { ok: false };

/** null = every day; otherwise N times a week. 7 is the same as daily, so it's stored as null. */
function parseWeeklyTarget(v: unknown): Parsed<number | null> {
  if (v === null || v === 7) return { ok: true, value: null };
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6) return { ok: true, value: v };
  return { ok: false };
}

function parseTimeOfDay(v: unknown): Parsed<string | null> {
  if (v === null) return { ok: true, value: null };
  if (typeof v === 'string' && TIMES_OF_DAY.includes(v)) return { ok: true, value: v };
  return { ok: false };
}

function parseDailyTarget(v: unknown): Parsed<number> {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 99) return { ok: true, value: v };
  return { ok: false };
}

const CHALLENGE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Max challenge length: GET /habits loads 18 weeks of entries, so the client can't count a longer one. */
const CHALLENGE_MAX_DAYS = 120;
const YEAR_MS = 366 * 86_400_000;

/**
 * `challengeDays` 3..120 needs a real local `challengeStart` (YYYY-MM-DD, within ±1 year of now);
 * `challengeDays: null` clears both. Returns undefined when the body doesn't touch the challenge.
 */
function parseChallenge(days: unknown, start: unknown): Parsed<{ challengeDays: number | null; challengeStart: string | null }> | undefined {
  if (days === undefined) return undefined;
  if (days === null) return { ok: true, value: { challengeDays: null, challengeStart: null } };
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 3 || days > CHALLENGE_MAX_DAYS) return { ok: false };
  if (typeof start !== 'string' || !CHALLENGE_DATE_RE.test(start)) return { ok: false };
  const at = new Date(start + 'T00:00:00Z');
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== start) return { ok: false }; // rejects 2026-02-30
  if (Math.abs(at.getTime() - Date.now()) > YEAR_MS) return { ok: false };
  return { ok: true, value: { challengeDays: days, challengeStart: start } };
}

const CHALLENGE_ERROR = `challengeDays must be null or an integer 3-${CHALLENGE_MAX_DAYS} with a real challengeStart YYYY-MM-DD within a year of today`;

const TIME_OF_DAY_ERROR = `timeOfDay must be null or one of ${TIMES_OF_DAY.join(', ')}`;
const DAILY_TARGET_ERROR = 'dailyTarget must be an integer 1-99 for count habits';

export async function habitsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard);

  /** All habits incl. archived (the client filters), in manual order. */
  app.get('/habits', async (request) => {
    const { userId } = (request as any).user as JwtPayload;

    const habits = await prisma.habit.findMany({
      where: { userId },
      include: { entries: entriesSince() },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    return habits.map(serializeHabit);
  });

  app.post<{
    Body: {
      name: string;
      color?: string;
      icon?: string;
      binary?: boolean;
      measure?: string | null;
      weeklyTarget?: number | null;
      timeOfDay?: string | null;
      dailyTarget?: number | null;
      challengeDays?: number | null;
      challengeStart?: string | null;
    };
  }>(
    '/habits',
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const { name, color, icon, binary, measure } = request.body;
      if (measure != null && !HABIT_MEASURES.includes(measure)) {
        return reply.status(400).send({ error: `measure must be one of ${HABIT_MEASURES.join(', ')}` });
      }
      const weekly = parseWeeklyTarget(request.body.weeklyTarget ?? null);
      if (!weekly.ok) return reply.status(400).send({ error: 'weeklyTarget must be null or 1-7' });
      const timeOfDay = parseTimeOfDay(request.body.timeOfDay ?? null);
      if (!timeOfDay.ok) return reply.status(400).send({ error: TIME_OF_DAY_ERROR });
      let dailyTarget: number | null = null;
      if (measure === 'count') {
        const parsed = parseDailyTarget(request.body.dailyTarget);
        if (!parsed.ok) return reply.status(400).send({ error: DAILY_TARGET_ERROR });
        dailyTarget = parsed.value;
      }
      const challenge = parseChallenge(request.body.challengeDays, request.body.challengeStart);
      if (challenge && !challenge.ok) return reply.status(400).send({ error: CHALLENGE_ERROR });

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (!trimmedName) {
        return reply.status(400).send({ error: 'Name is required' });
      }
      if (trimmedName.length > 30) {
        return reply.status(400).send({ error: 'Name must be 30 characters or fewer' });
      }

      // Double-tap guard. SQLite has no case-insensitive equals for Cyrillic, so compare in JS.
      const recent = await prisma.habit.findMany({
        where: { userId, archived: false, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) } },
        include: { entries: entriesSince() },
      });
      const duplicate = recent.find(
        (h) =>
          h.name.trim().toLowerCase() === trimmedName.toLowerCase() &&
          (h.measure ?? null) === (measure ?? null) &&
          (measure !== 'count' || h.dailyTarget === dailyTarget),
      );
      if (duplicate) return serializeHabit(duplicate);

      const { _max } = await prisma.habit.aggregate({ where: { userId }, _max: { sortOrder: true } });

      const habit = await prisma.habit.create({
        data: {
          userId,
          name: trimmedName,
          color: color || '#4CAF50',
          icon: icon || null,
          binary: measure ? false : (binary ?? false),
          measure: measure ?? null,
          weeklyTarget: weekly.value,
          timeOfDay: timeOfDay.value,
          dailyTarget,
          ...(challenge?.ok && challenge.value),
          sortOrder: (_max.sortOrder ?? -1) + 1,
        },
      });

      if (habit.challengeDays) {
        track({ userId, event: 'challenge_started', category: 'miniapp', label: habit.name, metadata: { days: habit.challengeDays, habitId: habit.id } });
      }

      track({
        userId,
        event: 'habit_created',
        category: 'miniapp',
        label: habit.name,
        metadata: { color: habit.color, binary: habit.binary, measure: habit.measure, timeOfDay: habit.timeOfDay },
      });

      return serializeHabit(habit);
    },
  );

  /** Manual order: sortOrder = index in `ids`. Every id must be the user's own habit. */
  app.put<{ Body: { ids?: unknown } }>('/habits/order', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const ids = request.body?.ids;
    if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id)) || new Set(ids).size !== ids.length) {
      return reply.status(400).send({ error: 'ids must be an array of unique habit ids' });
    }
    const habitIds = ids as number[];
    const owned = await prisma.habit.count({ where: { userId, id: { in: habitIds } } });
    if (owned !== habitIds.length) return reply.status(400).send({ error: 'Unknown habit id' });

    await prisma.$transaction(
      habitIds.map((id, index) => prisma.habit.update({ where: { id }, data: { sortOrder: index } })),
    );
    return { success: true };
  });

  app.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      color?: string;
      icon?: string;
      binary?: boolean;
      weeklyTarget?: number | null;
      timeOfDay?: string | null;
      dailyTarget?: number | null;
      archived?: boolean;
      challengeDays?: number | null;
      challengeStart?: string | null;
    };
  }>(
    '/habits/:id',
    async (request, reply) => {
      const { userId } = (request as any).user as JwtPayload;
      const habitId = Number(request.params.id);

      const existing = await prisma.habit.findFirst({
        where: { id: habitId, userId },
      });
      if (!existing) {
        return reply.status(404).send({ error: 'Habit not found' });
      }

      const { name, color, icon, binary, archived } = request.body;
      const trimmedName = name?.trim();
      if (trimmedName !== undefined && trimmedName.length > 30) {
        return reply.status(400).send({ error: 'Name must be 30 characters or fewer' });
      }
      const weekly = request.body.weeklyTarget === undefined ? null : parseWeeklyTarget(request.body.weeklyTarget);
      if (weekly && !weekly.ok) return reply.status(400).send({ error: 'weeklyTarget must be null or 1-7' });
      const timeOfDay = request.body.timeOfDay === undefined ? null : parseTimeOfDay(request.body.timeOfDay);
      if (timeOfDay && !timeOfDay.ok) return reply.status(400).send({ error: TIME_OF_DAY_ERROR });
      // dailyTarget only means something for count habits; other kinds ignore it.
      const dailyTarget =
        request.body.dailyTarget === undefined || existing.measure !== 'count'
          ? null
          : parseDailyTarget(request.body.dailyTarget);
      if (dailyTarget && !dailyTarget.ok) return reply.status(400).send({ error: DAILY_TARGET_ERROR });
      const challenge = parseChallenge(request.body.challengeDays, request.body.challengeStart);
      if (challenge && !challenge.ok) return reply.status(400).send({ error: CHALLENGE_ERROR });
      if (archived !== undefined && typeof archived !== 'boolean') {
        return reply.status(400).send({ error: 'archived must be a boolean' });
      }

      const archiving = archived === true && !existing.archived;
      const restoring = archived === false && existing.archived;
      // A restored habit goes to the end of the list; its reminder stays off until re-enabled.
      const restoredOrder = restoring
        ? ((await prisma.habit.aggregate({ where: { userId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1
        : null;
      if (archiving) {
        await prisma.reminder.updateMany({ where: { habitId }, data: { enabled: false } });
      }

      const habit = await prisma.habit.update({
        where: { id: habitId },
        data: {
          ...(restoredOrder !== null && { sortOrder: restoredOrder }),
          ...(trimmedName !== undefined && { name: trimmedName }),
          ...(color !== undefined && { color }),
          ...(icon !== undefined && { icon }),
          ...(binary !== undefined && { binary }),
          ...(weekly?.ok && { weeklyTarget: weekly.value }),
          ...(timeOfDay?.ok && { timeOfDay: timeOfDay.value }),
          ...(dailyTarget?.ok && { dailyTarget: dailyTarget.value }),
          ...(archived !== undefined && { archived }),
          ...(challenge?.ok && challenge.value),
        },
        include: { entries: entriesSince() },
      });

      if (archived !== undefined && archived !== existing.archived) {
        track({ userId, event: archived ? 'habit_archived' : 'habit_restored', category: 'miniapp', label: habit.name });
      }
      const c = challenge?.ok ? challenge.value : null;
      if (c?.challengeDays && (!existing.challengeDays || c.challengeStart !== existing.challengeStart)) {
        track({ userId, event: 'challenge_started', category: 'miniapp', label: habit.name, metadata: { days: c.challengeDays, habitId } });
      }
      track({ userId, event: 'habit_edited', category: 'miniapp', label: habit.name });

      return serializeHabit(habit);
    },
  );

  app.delete<{ Params: { id: string } }>('/habits/:id', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const habitId = Number(request.params.id);

    const existing = await prisma.habit.findFirst({
      where: { id: habitId, userId },
    });
    if (!existing) {
      return reply.status(404).send({ error: 'Habit not found' });
    }

    track({ userId, event: 'habit_deleted', category: 'miniapp', label: existing.name });
    await prisma.habit.delete({ where: { id: habitId } });

    return { success: true };
  });
}
