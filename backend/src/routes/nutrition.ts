import { FastifyInstance } from 'fastify';
import type { FoodLogEntry, NutritionGoal } from '@prisma/client';
import { prisma } from '../db.js';
import { nutritionGuard } from '../middleware/featureGuard.js';
import { track } from '../services/analytics.js';
import { favoriteIds, searchFoods, recentFoods, serializeFood, visibleTo } from '../services/nutrition/foodSearch.js';
import { normalizeSearch, round1, scaleMacros, sumMacros } from '../services/nutrition/nutritionMath.js';
import { getJob, jobView, startTextLog, undoJob, MEALS as AGENT_MEALS, type Meal as AgentMeal } from '../services/nutrition/textLog.js';
import { hasAgentLogAccess } from '../utils/features.js';
import { computePlan, weightTrend } from '../services/nutrition/model.js';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
type Meal = (typeof MEALS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Same convention as HabitEntry: the client's local day stored as UTC midnight. */
function parseDay(s: unknown): Date | null {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return null;
  const d = new Date(s + 'T00:00:00.000Z');
  return isNaN(d.getTime()) ? null : d;
}

function dayString(d: Date): string {
  return d.toISOString().split('T')[0];
}

function isMeal(m: unknown): m is Meal {
  return typeof m === 'string' && (MEALS as readonly string[]).includes(m);
}

function isNonNegNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

function serializeEntry(e: FoodLogEntry) {
  return {
    id: e.id,
    date: dayString(e.date),
    meal: e.meal,
    foodId: e.foodId,
    name: e.name,
    grams: e.grams,
    kcal: e.kcal,
    protein: e.protein,
    fat: e.fat,
    carbs: e.carbs,
    source: e.source,
  };
}

function serializeGoal(g: NutritionGoal | null) {
  if (!g) return null;
  return {
    kcal: g.kcal,
    protein: g.protein,
    fat: g.fat,
    carbs: g.carbs,
    startWeightKg: g.startWeightKg,
    targetWeightKg: g.targetWeightKg,
    targetDate: g.targetDate ? dayString(g.targetDate) : null,
    trainingHabitId: g.trainingHabitId,
    sleepHabitId: g.sleepHabitId,
  };
}

interface FoodBody {
  name?: string;
  brand?: string | null;
  sourceUrl?: string | null;
  kcal?: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  servings?: { label: string; grams: number }[];
}

/** Validates a "my product" payload (macros per 100 g). Returns an error message or null. */
function validateFood(body: FoodBody, partial: boolean): string | null {
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return 'name is required';
    if (body.name.trim().length > 80) return 'name must be 80 characters or less';
  }
  for (const k of ['kcal', 'protein', 'fat', 'carbs'] as const) {
    if (!partial || body[k] !== undefined) {
      if (!isNonNegNumber(body[k])) return `${k} must be a non-negative number`;
    }
  }
  if (body.servings !== undefined) {
    if (
      !Array.isArray(body.servings) ||
      body.servings.some((s) => typeof s?.label !== 'string' || !isNonNegNumber(s?.grams) || s.grams === 0)
    ) {
      return 'servings must be [{label, grams}]';
    }
  }
  return null;
}

export async function nutritionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', nutritionGuard);

  // ─── Food catalog ───────────────────────────────────────────────────────────

  app.get<{ Querystring: { q?: string } }>('/nutrition/foods/search', async (request) => {
    const userId = (request as any).user.userId;
    return searchFoods(userId, request.query.q ?? '');
  });

  app.get('/nutrition/foods/recent', async (request) => {
    const userId = (request as any).user.userId;
    return recentFoods(userId);
  });

  app.get('/nutrition/foods/mine', async (request) => {
    const userId = (request as any).user.userId;
    const [foods, favs] = await Promise.all([
      prisma.food.findMany({ where: { ownerId: userId }, orderBy: { name: 'asc' } }),
      favoriteIds(userId),
    ]);
    return foods.map((f) => serializeFood(f, favs));
  });

  app.post<{ Body: FoodBody }>('/nutrition/foods', async (request, reply) => {
    const userId = (request as any).user.userId;
    const body = request.body ?? {};
    const err = validateFood(body, false);
    if (err) return reply.status(400).send({ error: err });

    const name = body.name!.trim();
    const brand = body.brand?.trim() || null;
    const food = await prisma.food.create({
      data: {
        ownerId: userId,
        name,
        brand,
        searchName: normalizeSearch(`${name} ${brand ?? ''}`),
        source: 'custom',
        sourceUrl: body.sourceUrl?.trim() || null,
        kcal: body.kcal!,
        protein: body.protein!,
        fat: body.fat!,
        carbs: body.carbs!,
        servings: body.servings?.length ? JSON.stringify(body.servings) : null,
      },
    });
    track({ userId, event: 'food_custom_created', category: 'miniapp', label: name });
    return serializeFood(food, await favoriteIds(userId));
  });

  app.patch<{ Params: { id: string }; Body: FoodBody }>('/nutrition/foods/:id', async (request, reply) => {
    const userId = (request as any).user.userId;
    const id = Number(request.params.id);
    const existing = await prisma.food.findFirst({ where: { id, ownerId: userId } });
    if (!existing) return reply.status(404).send({ error: 'Food not found' });

    const body = request.body ?? {};
    const err = validateFood(body, true);
    if (err) return reply.status(400).send({ error: err });

    const name = body.name?.trim() ?? existing.name;
    const brand = body.brand !== undefined ? body.brand?.trim() || null : existing.brand;
    const food = await prisma.food.update({
      where: { id },
      data: {
        name,
        brand,
        searchName: normalizeSearch(`${name} ${brand ?? ''}`),
        ...(body.sourceUrl !== undefined && { sourceUrl: body.sourceUrl?.trim() || null }),
        ...(body.kcal !== undefined && { kcal: body.kcal }),
        ...(body.protein !== undefined && { protein: body.protein }),
        ...(body.fat !== undefined && { fat: body.fat }),
        ...(body.carbs !== undefined && { carbs: body.carbs }),
        ...(body.servings !== undefined && {
          servings: body.servings.length ? JSON.stringify(body.servings) : null,
        }),
      },
    });
    return serializeFood(food, await favoriteIds(userId));
  });

  // ─── Favorites ("Что доесть") ──────────────────────────────────────────────

  app.get('/nutrition/favorites', async (request) => {
    const userId = (request as any).user.userId;
    const rows = await prisma.favoriteFood.findMany({
      where: { userId },
      include: { food: true },
      orderBy: { createdAt: 'asc' },
    });
    const favs = new Set(rows.map((r) => r.foodId));
    return rows.map((r) => serializeFood(r.food, favs));
  });

  app.put<{ Params: { foodId: string } }>('/nutrition/favorites/:foodId', async (request, reply) => {
    const userId = (request as any).user.userId;
    const foodId = Number(request.params.foodId);
    const food = await prisma.food.findFirst({ where: { id: foodId, ...visibleTo(userId) } });
    if (!food) return reply.status(404).send({ error: 'Food not found' });
    await prisma.favoriteFood.upsert({
      where: { userId_foodId: { userId, foodId } },
      update: {},
      create: { userId, foodId },
    });
    track({ userId, event: 'food_favorited', category: 'miniapp', label: food.name });
    return { success: true };
  });

  app.delete<{ Params: { foodId: string } }>('/nutrition/favorites/:foodId', async (request) => {
    const userId = (request as any).user.userId;
    await prisma.favoriteFood.deleteMany({ where: { userId, foodId: Number(request.params.foodId) } });
    return { success: true };
  });

  app.delete<{ Params: { id: string } }>('/nutrition/foods/:id', async (request, reply) => {
    const userId = (request as any).user.userId;
    const id = Number(request.params.id);
    const existing = await prisma.food.findFirst({ where: { id, ownerId: userId } });
    if (!existing) return reply.status(404).send({ error: 'Food not found' });
    // Log entries keep their snapshot; foodId becomes null (onDelete: SetNull).
    await prisma.food.delete({ where: { id } });
    return { success: true };
  });

  // ─── Diary ──────────────────────────────────────────────────────────────────

  app.get<{ Querystring: { date?: string } }>('/nutrition/log', async (request, reply) => {
    const userId = (request as any).user.userId;
    const date = parseDay(request.query.date);
    if (!date) return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });

    const [entries, goal] = await Promise.all([
      prisma.foodLogEntry.findMany({ where: { userId, date }, orderBy: { createdAt: 'asc' } }),
      prisma.nutritionGoal.findUnique({ where: { userId } }),
    ]);
    return {
      date: dayString(date),
      entries: entries.map(serializeEntry),
      totals: sumMacros(entries),
      goal: serializeGoal(goal),
    };
  });

  /**
   * Add one entry. Either `foodId` (macros computed from the catalog) or a
   * ready-made `name` + macros for the whole portion (quick add / parsed items).
   */
  app.post<{
    Body: {
      date?: string;
      meal?: string;
      grams?: number;
      foodId?: number;
      name?: string;
      kcal?: number;
      protein?: number;
      fat?: number;
      carbs?: number;
      source?: string;
    };
  }>('/nutrition/log', async (request, reply) => {
    const userId = (request as any).user.userId;
    const b = request.body ?? {};
    const date = parseDay(b.date);
    if (!date) return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });
    if (!isMeal(b.meal)) return reply.status(400).send({ error: `meal must be one of ${MEALS.join(', ')}` });
    if (!isNonNegNumber(b.grams) || b.grams === 0 || b.grams > 5000) {
      return reply.status(400).send({ error: 'grams must be between 0 and 5000' });
    }

    let data;
    if (b.foodId !== undefined) {
      const food = await prisma.food.findFirst({ where: { id: b.foodId, ...visibleTo(userId) } });
      if (!food) return reply.status(404).send({ error: 'Food not found' });
      data = { foodId: food.id, name: food.name, ...scaleMacros(food, b.grams) };
      await prisma.food.update({ where: { id: food.id }, data: { usageCount: { increment: 1 } } });
    } else {
      if (typeof b.name !== 'string' || !b.name.trim()) {
        return reply.status(400).send({ error: 'foodId or name is required' });
      }
      if (![b.kcal, b.protein, b.fat, b.carbs].every(isNonNegNumber)) {
        return reply.status(400).send({ error: 'kcal, protein, fat, carbs are required without foodId' });
      }
      data = {
        foodId: null,
        name: b.name.trim().slice(0, 120),
        kcal: round1(b.kcal!),
        protein: round1(b.protein!),
        fat: round1(b.fat!),
        carbs: round1(b.carbs!),
      };
    }

    const entry = await prisma.foodLogEntry.create({
      data: {
        userId,
        date,
        meal: b.meal,
        grams: b.grams,
        source: b.source === 'llm' ? 'llm' : 'manual',
        ...data,
      },
    });
    track({ userId, event: 'food_logged', category: 'miniapp', label: entry.name });
    return serializeEntry(entry);
  });

  /** Change grams (macros rescaled from the entry's own snapshot) and/or move to another meal. */
  app.patch<{ Params: { id: string }; Body: { grams?: number; meal?: string } }>(
    '/nutrition/log/:id',
    async (request, reply) => {
      const userId = (request as any).user.userId;
      const id = Number(request.params.id);
      const entry = await prisma.foodLogEntry.findFirst({ where: { id, userId } });
      if (!entry) return reply.status(404).send({ error: 'Entry not found' });

      const { grams, meal } = request.body ?? {};
      if (meal !== undefined && !isMeal(meal)) return reply.status(400).send({ error: 'invalid meal' });
      if (grams !== undefined && (!isNonNegNumber(grams) || grams === 0 || grams > 5000)) {
        return reply.status(400).send({ error: 'grams must be between 0 and 5000' });
      }

      const k = grams !== undefined ? grams / entry.grams : 1;
      const updated = await prisma.foodLogEntry.update({
        where: { id },
        data: {
          ...(meal !== undefined && { meal }),
          ...(grams !== undefined && {
            grams,
            kcal: round1(entry.kcal * k),
            protein: round1(entry.protein * k),
            fat: round1(entry.fat * k),
            carbs: round1(entry.carbs * k),
          }),
        },
      });
      return serializeEntry(updated);
    },
  );

  app.delete<{ Params: { id: string } }>('/nutrition/log/:id', async (request, reply) => {
    const userId = (request as any).user.userId;
    const id = Number(request.params.id);
    const entry = await prisma.foodLogEntry.findFirst({ where: { id, userId } });
    if (!entry) return reply.status(404).send({ error: 'Entry not found' });
    await prisma.foodLogEntry.delete({ where: { id } });
    track({ userId, event: 'food_deleted', category: 'miniapp', label: entry.name });
    return { success: true };
  });

  /** Copy a whole day (or one meal) onto another day — "как вчера". */
  app.post<{ Body: { fromDate?: string; toDate?: string; meal?: string } }>(
    '/nutrition/log/copy',
    async (request, reply) => {
      const userId = (request as any).user.userId;
      const { fromDate, toDate, meal } = request.body ?? {};
      const from = parseDay(fromDate);
      const to = parseDay(toDate);
      if (!from || !to) return reply.status(400).send({ error: 'fromDate/toDate must be YYYY-MM-DD' });
      if (meal !== undefined && !isMeal(meal)) return reply.status(400).send({ error: 'invalid meal' });

      const source = await prisma.foodLogEntry.findMany({
        where: { userId, date: from, ...(meal && { meal }) },
        orderBy: { createdAt: 'asc' },
      });
      const created = [];
      for (const e of source) {
        created.push(
          await prisma.foodLogEntry.create({
            data: {
              userId,
              date: to,
              meal: e.meal,
              foodId: e.foodId,
              name: e.name,
              grams: e.grams,
              kcal: e.kcal,
              protein: e.protein,
              fat: e.fat,
              carbs: e.carbs,
              source: e.source,
            },
          }),
        );
      }
      return created.map(serializeEntry);
    },
  );

  // ─── Text logging via the developer's Hermes agent ─────────────────────────
  // Agent calls take minutes, so POST starts a background job and the client polls GET.

  app.post<{ Body: { text?: string; date?: string; meal?: string } }>('/nutrition/text-log', async (request, reply) => {
    const { userId, telegramId } = (request as any).user;
    if (!hasAgentLogAccess(telegramId)) return reply.status(403).send({ error: 'Доступно только владельцу агента' });
    const text = request.body?.text?.trim();
    if (!text) return reply.status(400).send({ error: 'text is required' });
    if (text.length > 2000) return reply.status(400).send({ error: 'Слишком длинный текст' });
    const date = request.body?.date !== undefined ? parseDay(request.body.date) : undefined;
    if (date === null) return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });
    const meal = request.body?.meal;
    if (meal !== undefined && !(AGENT_MEALS as readonly string[]).includes(meal)) {
      return reply.status(400).send({ error: 'invalid meal' });
    }
    const job = startTextLog(userId, text, { date: date ? dayString(date) : undefined, meal: meal as AgentMeal | undefined });
    return reply.status(202).send(jobView(job));
  });

  app.get<{ Params: { id: string } }>('/nutrition/text-log/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const job = getJob(userId, request.params.id);
    if (!job) return reply.status(404).send({ error: 'Задача не найдена (сервер мог перезапуститься)' });
    return jobView(job);
  });

  app.post<{ Params: { id: string } }>('/nutrition/text-log/:id/undo', async (request, reply) => {
    const { userId } = (request as any).user;
    if (!(await undoJob(userId, request.params.id))) return reply.status(409).send({ error: 'Нечего отменять' });
    return { success: true };
  });

  // ─── Stats, goal, weight ────────────────────────────────────────────────────

  app.get<{ Querystring: { from?: string; to?: string } }>('/nutrition/stats', async (request, reply) => {
    const userId = (request as any).user.userId;
    const from = parseDay(request.query.from);
    const to = parseDay(request.query.to);
    if (!from || !to) return reply.status(400).send({ error: 'from/to must be YYYY-MM-DD' });

    const [days, weights, goal] = await Promise.all([
      prisma.foodLogEntry.groupBy({
        by: ['date'],
        where: { userId, date: { gte: from, lte: to } },
        _sum: { kcal: true, protein: true, fat: true, carbs: true },
        orderBy: { date: 'asc' },
      }),
      // All weights (not only the range) — the forecast needs the full trend.
      prisma.weightEntry.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
      prisma.nutritionGoal.findUnique({ where: { userId } }),
    ]);

    const weightPoints = weights.map((w) => ({ date: dayString(w.date), weightKg: w.weightKg }));
    return {
      trend: weightTrend(weightPoints, dayString(to)).map((p) => ({ date: p.date, trendKg: p.trendKg })),
      days: days.map((d) => ({
        date: dayString(d.date),
        kcal: round1(d._sum.kcal ?? 0),
        protein: round1(d._sum.protein ?? 0),
        fat: round1(d._sum.fat ?? 0),
        carbs: round1(d._sum.carbs ?? 0),
      })),
      weights: weightPoints,
      goal: serializeGoal(goal),
    };
  });

  /** Today's target from the adaptive model + insights (see services/nutrition/model.ts). */
  app.get<{ Querystring: { date?: string } }>('/nutrition/plan', async (request, reply) => {
    const userId = (request as any).user.userId;
    const date = parseDay(request.query.date);
    if (!date) return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });
    const { trend, ...plan } = await computePlan(userId, dayString(date));
    return plan;
  });

  app.get('/nutrition/goal', async (request) => {
    const userId = (request as any).user.userId;
    return serializeGoal(await prisma.nutritionGoal.findUnique({ where: { userId } }));
  });

  app.put<{
    Body: {
      kcal?: number;
      protein?: number | null;
      fat?: number | null;
      carbs?: number | null;
      startWeightKg?: number | null;
      targetWeightKg?: number | null;
      targetDate?: string | null;
      trainingHabitId?: number | null;
      sleepHabitId?: number | null;
    };
  }>('/nutrition/goal', async (request, reply) => {
    const userId = (request as any).user.userId;
    const b = request.body ?? {};
    if (!isNonNegNumber(b.kcal) || b.kcal < 500 || b.kcal > 10000) {
      return reply.status(400).send({ error: 'kcal must be between 500 and 10000' });
    }
    const optNum = (v: unknown) => (isNonNegNumber(v) ? v : null);
    let targetDate: Date | null = null;
    if (b.targetDate) {
      targetDate = parseDay(b.targetDate);
      if (!targetDate) return reply.status(400).send({ error: 'targetDate must be YYYY-MM-DD' });
    }
    // Linked habits must be the user's own; sleep must be an hours habit.
    const ownHabit = async (id: number | null | undefined, measure?: string) => {
      if (id == null) return null;
      const h = await prisma.habit.findFirst({ where: { id, userId } });
      return h && (measure === undefined || h.measure === measure) ? h.id : undefined;
    };
    const trainingHabitId = await ownHabit(b.trainingHabitId);
    const sleepHabitId = await ownHabit(b.sleepHabitId, 'hours');
    if (trainingHabitId === undefined) return reply.status(400).send({ error: 'invalid trainingHabitId' });
    if (sleepHabitId === undefined) return reply.status(400).send({ error: 'sleepHabitId must be your hours habit' });
    const data = {
      trainingHabitId,
      sleepHabitId,
      kcal: Math.round(b.kcal),
      protein: optNum(b.protein) !== null ? Math.round(b.protein!) : null,
      fat: optNum(b.fat) !== null ? Math.round(b.fat!) : null,
      carbs: optNum(b.carbs) !== null ? Math.round(b.carbs!) : null,
      startWeightKg: optNum(b.startWeightKg),
      targetWeightKg: optNum(b.targetWeightKg),
      targetDate,
    };
    const goal = await prisma.nutritionGoal.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    track({ userId, event: 'goal_set', category: 'miniapp', metadata: { kcal: data.kcal } });
    return serializeGoal(goal);
  });

  app.put<{ Body: { date?: string; weightKg?: number } }>('/nutrition/weight', async (request, reply) => {
    const userId = (request as any).user.userId;
    const date = parseDay(request.body?.date);
    const weightKg = request.body?.weightKg;
    if (!date) return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });
    if (!isNonNegNumber(weightKg) || weightKg < 20 || weightKg > 400) {
      return reply.status(400).send({ error: 'weightKg must be between 20 and 400' });
    }
    const w = await prisma.weightEntry.upsert({
      where: { userId_date: { userId, date } },
      update: { weightKg: round1(weightKg) },
      create: { userId, date, weightKg: round1(weightKg) },
    });
    track({ userId, event: 'weight_logged', category: 'miniapp' });
    return { date: dayString(w.date), weightKg: w.weightKg };
  });

  app.delete<{ Params: { date: string } }>('/nutrition/weight/:date', async (request, reply) => {
    const userId = (request as any).user.userId;
    const date = parseDay(request.params.date);
    if (!date) return reply.status(400).send({ error: 'date must be YYYY-MM-DD' });
    await prisma.weightEntry.deleteMany({ where: { userId, date } });
    return { success: true };
  });
}
