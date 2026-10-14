/**
 * Weekly nutrition summary. All numbers are computed here; Claude only turns
 * them into a short message (with a plain template fallback when no API key).
 */
import cron from 'node-cron';
import { prisma } from '../../db.js';
import { sendToUser } from '../messaging.js';
import { ownerWhere } from '../../utils/owner.js';
import { forEachSafe } from '../../utils/safe.js';
import { CLAUDE_MODEL, claudeAvailable, getClaude, responseText } from '../claude.js';
import { computePlan } from './model.js';

const DAY_MS = 86_400_000;

function addDays(s: string, n: number): string {
  return new Date(new Date(s + 'T00:00:00.000Z').getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Moscow calendar date — diary days are local dates. */
function todayMsk(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

export interface WeekFacts {
  period: string;
  daysLogged: number;
  avgKcal: number | null;
  avgProtein: number | null;
  targetKcal: number | null;
  targetProtein: number | null;
  model: string;
  tdee: number | null;
  trendKg: number | null;
  trendChangeWeekKg: number | null;
  goal: string | null;
  trainings: number | null;
  sleepAvgH: number | null;
  insights: string[];
}

export async function buildWeekFacts(userId: number, date: string): Promise<WeekFacts> {
  const from = addDays(date, -6);
  const [plan, days, goal] = await Promise.all([
    computePlan(userId, date),
    prisma.foodLogEntry.groupBy({
      by: ['date'],
      where: { userId, date: { gte: new Date(from + 'T00:00:00.000Z'), lte: new Date(date + 'T00:00:00.000Z') } },
      _sum: { kcal: true, protein: true },
    }),
    prisma.nutritionGoal.findUnique({ where: { userId } }),
  ]);
  const logged = days.filter((d) => (d._sum.kcal ?? 0) > 0);
  const avg = (f: (d: (typeof logged)[number]) => number) =>
    logged.length ? Math.round(logged.reduce((s, d) => s + f(d), 0) / logged.length) : null;

  const trendWeekAgo = plan.trend.find((p) => p.date === addDays(date, -7))?.trendKg ?? null;
  const trainings = goal?.trainingHabitId
    ? await prisma.habitEntry.count({
        where: {
          habitId: goal.trainingHabitId,
          value: { gt: 0 },
          date: { gte: new Date(from + 'T00:00:00.000Z'), lte: new Date(date + 'T00:00:00.000Z') },
        },
      })
    : null;

  return {
    period: `${from} — ${date}`,
    daysLogged: logged.length,
    avgKcal: avg((d) => d._sum.kcal ?? 0),
    avgProtein: avg((d) => d._sum.protein ?? 0),
    targetKcal: plan.baseKcal,
    targetProtein: plan.proteinTarget,
    model: plan.mode === 'adaptive' ? 'адаптивный (по весу и дневнику)' : plan.mode === 'goal' ? 'по заданной цели' : 'цель не задана',
    tdee: plan.tdee,
    trendKg: plan.trendKg,
    trendChangeWeekKg:
      plan.trendKg !== null && trendWeekAgo !== null ? Math.round((plan.trendKg - trendWeekAgo) * 100) / 100 : null,
    goal:
      goal?.targetWeightKg && goal.targetDate
        ? `${goal.targetWeightKg} кг к ${goal.targetDate.toISOString().slice(0, 10)}`
        : null,
    trainings,
    sleepAvgH: plan.sleepAvg7H,
    insights: plan.insights.map((i) => i.text),
  };
}

function templateSummary(f: WeekFacts): string {
  const lines = [
    `📊 Неделя ${f.period}`,
    `🍽 Дневник: ${f.daysLogged}/7 дней, в среднем ${f.avgKcal ?? '—'} ккал (норма ${f.targetKcal ?? '—'}), белок ${f.avgProtein ?? '—'} г (норма ${f.targetProtein ?? '—'})`,
    `⚖️ Тренд веса: ${f.trendKg ?? '—'} кг${f.trendChangeWeekKg !== null ? ` (${f.trendChangeWeekKg >= 0 ? '+' : ''}${f.trendChangeWeekKg} за неделю)` : ''}`,
  ];
  if (f.trainings !== null) lines.push(`💪 Тренировок: ${f.trainings}`);
  if (f.sleepAvgH !== null) lines.push(`😴 Сон в среднем: ${f.sleepAvgH} ч`);
  for (const i of f.insights) lines.push(`• ${i}`);
  return lines.join('\n');
}

const SUMMARY_PROMPT = `Ты помогаешь пользователю вести дневник питания под цель по весу. Напиши короткую еженедельную сводку для Telegram по фактам ниже.

Формат: обычный текст без markdown и HTML, 6–10 строк, можно эмодзи в начале строк. Сначала 2–3 строки цифр (питание, вес, тренировки, сон), затем 2–3 конкретные рекомендации на следующую неделю. Используй только цифры из фактов, ничего не выдумывай. Тон — дружелюбный и деловой, без морализаторства.`;

export async function weeklySummaryText(userId: number, date = todayMsk()): Promise<string> {
  const facts = await buildWeekFacts(userId, date);
  if (!claudeAvailable() || facts.daysLogged === 0) return templateSummary(facts);
  try {
    const response = await getClaude().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: SUMMARY_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
    });
    const text = response.stop_reason === 'refusal' ? '' : responseText(response.content).trim();
    return text || templateSummary(facts);
  } catch (e) {
    console.error('[weekly] Claude error:', e);
    return templateSummary(facts);
  }
}

/** Sundays 15:00 UTC (18:00 MSK) — to the owner, if they have a goal. */
export function startWeeklySummaryCron(): void {
  cron.schedule(
    '0 15 * * 0',
    async () => {
      // An unhandled rejection here would crash the process on Node 20.
      try {
        const goals = await prisma.nutritionGoal.findMany({ where: { user: ownerWhere() }, include: { user: true } });
        await forEachSafe(
          goals.filter((g) => g.user.canMessage !== false),
          '[weekly] summary',
          (g) => `user ${g.userId}`,
          async (g) => {
            await sendToUser(g.user, await weeklySummaryText(g.userId), undefined, { purpose: 'weekly_summary' });
          },
        );
      } catch (e) {
        console.error('[weekly] cron failed:', e);
      }
    },
    { timezone: 'UTC' },
  );
}
