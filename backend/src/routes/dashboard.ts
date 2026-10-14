/**
 * Dashboard + quarter goals (plans/14-10-2026-iteration-C.md). Everything is computed in
 * services/dashboard.ts; this file only validates input and scopes by the owner.
 */
import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { authGuard, JwtPayload } from '../middleware/auth.js';
import { localClock } from '../services/checkin.js';
import {
  GOAL_METRICS,
  buildDashboard,
  goalStartValue,
  goalWithProgress,
  listGoals,
  type QuarterGoalMetric,
} from '../services/dashboard.js';

const TITLE_MAX = 60;
const MAX_DEADLINE_DAYS = 730;

function isStrictDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00.000Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Target range per metric; null when valid, else the error message. */
function targetError(metric: QuarterGoalMetric, target: unknown): string | null {
  if (!isNum(target)) return 'target must be a number';
  if (metric === 'weight') return target >= 30 && target <= 200 ? null : 'weight target must be 30–200 kg';
  if (metric === 'sleep_share') return target >= 1 && target <= 100 ? null : 'sleep_share target must be 1–100 (%)';
  return Number.isInteger(target) && target >= 1 && target <= 1000 ? null : 'target must be an integer 1–1000';
}

const daysFrom = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000);

async function todayOf(userId: number, date?: string): Promise<string | null> {
  if (date !== undefined) return isStrictDay(date) ? date : null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tzOffset: true } });
  return localClock(new Date(), user?.tzOffset ?? null).date;
}

interface GoalBody {
  title?: unknown;
  metric?: unknown;
  target?: unknown;
  param?: unknown;
  deadline?: unknown;
  archived?: unknown;
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authGuard);

  app.get<{ Querystring: { weeks?: string; date?: string } }>('/dashboard', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const weeks = request.query.weeks === undefined ? 4 : Number(request.query.weeks);
    if (weeks !== 4 && weeks !== 12) return reply.status(400).send({ error: 'weeks must be 4 or 12' });
    const today = await todayOf(userId, request.query.date);
    if (!today) return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });
    return buildDashboard(userId, weeks, today);
  });

  app.get<{ Querystring: { archived?: string; date?: string } }>('/goals', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const today = await todayOf(userId, request.query.date);
    if (!today) return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });
    return listGoals(userId, today, { includeArchived: request.query.archived === '1' });
  });

  app.post<{ Body: GoalBody }>('/goals', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const b = request.body;
    if (!b || typeof b !== 'object') return reply.status(400).send({ error: 'Body is required' });
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title || title.length > TITLE_MAX) return reply.status(400).send({ error: `title must be 1–${TITLE_MAX} chars` });
    if (!GOAL_METRICS.includes(b.metric as QuarterGoalMetric)) {
      return reply.status(400).send({ error: `metric must be one of ${GOAL_METRICS.join(', ')}` });
    }
    const metric = b.metric as QuarterGoalMetric;
    const tErr = targetError(metric, b.target);
    if (tErr) return reply.status(400).send({ error: tErr });

    let param: number | null = null;
    if (metric === 'sleep_share') {
      if (!isNum(b.param) || b.param < 3 || b.param > 12) return reply.status(400).send({ error: 'sleep_share needs param = hours (3–12)' });
      param = Math.round(b.param * 2) / 2;
    } else if (metric === 'habit_count') {
      if (!isNum(b.param) || !Number.isInteger(b.param)) return reply.status(400).send({ error: 'habit_count needs param = habitId' });
      const habit = await prisma.habit.findFirst({ where: { id: b.param, userId }, select: { id: true } });
      if (!habit) return reply.status(400).send({ error: 'habit not found' });
      param = habit.id;
    } else if (b.param != null) {
      return reply.status(400).send({ error: `param is not used for ${metric}` });
    }

    const today = await todayOf(userId);
    if (!isStrictDay(b.deadline) || b.deadline <= today! || daysFrom(today!, b.deadline) > MAX_DEADLINE_DAYS) {
      return reply.status(400).send({ error: `deadline must be a YYYY-MM-DD after today, within ${MAX_DEADLINE_DAYS} days` });
    }

    const row = await prisma.quarterGoal.create({
      data: {
        userId,
        title,
        metric,
        target: b.target as number,
        param,
        deadline: b.deadline,
        startDate: today!,
        startValue: await goalStartValue(userId, metric, param, today!),
      },
    });
    return reply.status(201).send(await goalWithProgress(userId, row, today!));
  });

  app.patch<{ Params: { id: string }; Body: GoalBody }>('/goals/:id', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const id = Number(request.params.id);
    const b = request.body;
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'Invalid id' });
    if (!b || typeof b !== 'object') return reply.status(400).send({ error: 'Body is required' });
    const goal = await prisma.quarterGoal.findFirst({ where: { id, userId } });
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });

    const data: { title?: string; target?: number; deadline?: string; archived?: boolean } = {};
    if (b.title !== undefined) {
      const title = typeof b.title === 'string' ? b.title.trim() : '';
      if (!title || title.length > TITLE_MAX) return reply.status(400).send({ error: `title must be 1–${TITLE_MAX} chars` });
      data.title = title;
    }
    if (b.target !== undefined) {
      const tErr = targetError(goal.metric as QuarterGoalMetric, b.target);
      if (tErr) return reply.status(400).send({ error: tErr });
      data.target = b.target as number;
    }
    if (b.deadline !== undefined) {
      if (!isStrictDay(b.deadline) || b.deadline <= goal.startDate || daysFrom(goal.startDate, b.deadline) > MAX_DEADLINE_DAYS) {
        return reply.status(400).send({ error: `deadline must be a YYYY-MM-DD after the start, within ${MAX_DEADLINE_DAYS} days` });
      }
      data.deadline = b.deadline;
    }
    if (b.archived !== undefined) {
      if (typeof b.archived !== 'boolean') return reply.status(400).send({ error: 'archived must be a boolean' });
      data.archived = b.archived;
    }

    const row = await prisma.quarterGoal.update({ where: { id }, data });
    return goalWithProgress(userId, row, (await todayOf(userId))!);
  });

  app.delete<{ Params: { id: string } }>('/goals/:id', async (request, reply) => {
    const { userId } = (request as any).user as JwtPayload;
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.status(400).send({ error: 'Invalid id' });
    const { count } = await prisma.quarterGoal.deleteMany({ where: { id, userId } });
    if (!count) return reply.status(404).send({ error: 'Goal not found' });
    return { success: true };
  });
}
