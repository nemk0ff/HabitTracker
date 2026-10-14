import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { subDays } from 'date-fns';
import { useNavStore } from '../../stores/navStore';
import { Heatmap } from '../../components/Heatmap';
import { StatCard } from '../../components/StatCard';
import { WeightChart } from '../../components/nutrition/WeightChart';
import { useBackButton, useMainButton } from '../../hooks/useTelegramButtons';
import { fetchPlan, fetchStats } from '../../api/nutrition';
import { InsightsCard } from '../../components/nutrition/InsightsCard';
import { toDateString } from '../../utils/dates';
import {
  NUTRITION_COLOR,
  computeForecast,
  fallbackProtein,
  fmt,
  goalLevel,
  isOnTarget,
  sumMacros,
  targetStreak,
} from '../../utils/nutrition';
import type { DayTotals, NutritionStats, Plan } from '../../types';

function average(days: DayTotals[]) {
  if (days.length === 0) return null;
  const s = sumMacros(days);
  return { kcal: s.kcal / days.length, protein: s.protein / days.length, fat: s.fat / days.length, carbs: s.carbs / days.length };
}

export function FoodStatsPage() {
  const navigate = useNavStore((s) => s.navigate);
  const [stats, setStats] = useState<NutritionStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const today = toDateString(new Date());

  useBackButton(useNavStore((s) => s.back));
  useMainButton(null, () => {});

  useEffect(() => {
    fetchStats(toDateString(subDays(new Date(), 400)), today)
      .then(setStats)
      .catch((e) => setError(e.message));
    fetchPlan(today).then(setPlan).catch(() => setPlan(null));
  }, [today]);

  if (error) return <div className="scrollable flex items-center justify-center text-tg-hint">{error}</div>;
  if (!stats) return <div className="scrollable flex items-center justify-center text-tg-hint">Загрузка...</div>;

  const goalKcal = stats.goal?.kcal ?? null;
  const proteinTarget = plan?.proteinTarget ?? fallbackProtein(stats.goal);
  // Averages over logged days only — an unlogged day isn't a zero-calorie day.
  const since = (n: number) => toDateString(subDays(new Date(), n - 1));
  const last7 = stats.days.filter((d) => d.date >= since(7) && d.kcal > 0);
  const last30 = stats.days.filter((d) => d.date >= since(30) && d.kcal > 0);
  const avg7 = average(last7);
  const avg30 = average(last30);
  const onTarget30 = goalKcal ? last30.filter((d) => isOnTarget(d.kcal, goalKcal)).length : null;
  const streak = goalKcal ? targetStreak(stats.days, goalKcal, today) : null;
  // Forecast runs on the smoothed trend, not on raw 0.5 kg-step weigh-ins.
  const f = computeForecast(stats.goal, stats.trend.map((p) => ({ date: p.date, weightKg: p.trendKg })), today);

  const heat = stats.days.map((d, i) => ({ id: i, date: d.date, value: goalLevel(d.kcal, goalKcal) }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24 flex flex-col gap-4">
        <h1 className="text-xl font-bold text-tg-text">Статистика питания</h1>

        <div className="flex gap-2">
          <StatCard label="ср. ккал, 7 дн" value={avg7 ? fmt(avg7.kcal) : '—'} color={NUTRITION_COLOR} />
          <StatCard label="ср. ккал, 30 дн" value={avg30 ? fmt(avg30.kcal) : '—'} />
        </div>
        <div className="flex gap-2">
          <StatCard label="в цели за 30 дн" value={onTarget30 !== null ? onTarget30 : '—'} />
          <StatCard label="дней подряд в цели" value={streak !== null ? streak : '—'} color={NUTRITION_COLOR} />
        </div>

        {avg7 && (
          <div className="bg-tg-section rounded-2xl p-4 text-sm">
            <div className="text-tg-hint text-xs mb-2">Среднее БЖУ за 7 дней</div>
            <div className="flex justify-between text-tg-text">
              <span>Б {fmt(avg7.protein)}{proteinTarget ? ` / ${proteinTarget}` : ''} г</span>
              <span>Ж {fmt(avg7.fat)}{stats.goal?.fat ? ` / ${stats.goal.fat}` : ''} г</span>
              <span>У {fmt(avg7.carbs)}{stats.goal?.carbs ? ` / ${stats.goal.carbs}` : ''} г</span>
            </div>
          </div>
        )}

        {/* Model */}
        {plan && plan.mode !== 'none' && (
          <div className="bg-tg-section rounded-2xl p-4 text-sm text-tg-text flex flex-col gap-1">
            <div className="text-xs text-tg-hint mb-1">Модель</div>
            {plan.mode === 'adaptive' ? (
              <>
                <div>Твой реальный расход: ~{fmt(plan.tdee ?? 0)} ккал/день ({plan.completeDays} полных дней)</div>
                <div>
                  {(plan.dailyDelta ?? 0) >= 0 ? 'Профицит' : 'Дефицит'} под цель: {fmt(Math.abs(plan.dailyDelta ?? 0))} ккал →
                  норма ~{fmt(plan.baseKcal ?? 0)} ккал
                </div>
              </>
            ) : (
              <div>Пока норма по цели: {fmt(plan.baseKcal ?? 0)} ккал. Реальный расход посчитаю по дневнику и весам</div>
            )}
            {plan.trainingsPerWeek !== null && (
              <div>
                Тренировок: {fmt(plan.trainingsPerWeek, 1)}/нед · в дни тренировок +{plan.trainingBonus} ккал
              </div>
            )}
          </div>
        )}
        {plan && plan.insights.length > 0 && <InsightsCard insights={plan.insights} />}

        {/* Calendar */}
        <div className="bg-tg-section rounded-2xl p-4">
          <Heatmap entries={heat} color={NUTRITION_COLOR} onSelect={(date) => navigate('food-day', { foodDate: date })} />
          <p className="text-xs text-tg-hint text-center mt-3">
            {goalKcal ? 'Ярче — ближе к цели (90–110%). Нажми на день, чтобы открыть его' : 'Нажми на день, чтобы открыть его'}
          </p>
        </div>

        {/* Weight */}
        <div className="bg-tg-section rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-base font-semibold text-tg-text">Вес</span>
            <button onClick={() => navigate('food-goal')} className="text-sm font-medium" style={{ color: NUTRITION_COLOR }}>
              Записать
            </button>
          </div>
          <WeightChart weights={stats.weights} trend={stats.trend} goal={stats.goal} projectedKg={f.projectedKg} />
          <ForecastSummary f={f} />
        </div>
      </div>
    </motion.div>
  );
}

function ForecastSummary({ f }: { f: ReturnType<typeof computeForecast> }) {
  const lines: string[] = [];
  if (f.changedKg !== null && f.goalChangeKg !== null) {
    const sign = (n: number) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n), 1);
    lines.push(`Прогресс: ${sign(f.changedKg)} из ${sign(f.goalChangeKg)} кг`);
  }
  if (f.daysLeft !== null) lines.push(`До цели ${f.daysLeft} дн.`);
  if (f.trendKgPerWeek !== null) {
    lines.push(
      `Темп: ${fmt(f.trendKgPerWeek, 2)} кг/нед` +
        (f.requiredKgPerWeek !== null ? `, нужно ${fmt(f.requiredKgPerWeek, 2)} кг/нед` : ''),
    );
  } else if (f.requiredKgPerWeek !== null) {
    lines.push(`Нужный темп: ${fmt(f.requiredKgPerWeek, 2)} кг/нед. Для расчёта фактического темпа нужны записи веса минимум за неделю`);
  }
  if (f.projectedKg !== null) lines.push(`При текущем темпе к дате цели: ${fmt(f.projectedKg, 1)} кг`);

  let verdict: { text: string; good: boolean } | null = null;
  if (f.kcalAdjustment !== null) {
    const adj = Math.round(f.kcalAdjustment / 50) * 50;
    verdict =
      Math.abs(adj) < 100
        ? { text: 'Идёшь в темпе 👍', good: true }
        : adj > 0
          ? { text: `Отстаёшь: добавь ~${fmt(adj)} ккал в день`, good: false }
          : { text: `Опережаешь: можно на ~${fmt(-adj)} ккал в день меньше`, good: true };
  }

  if (lines.length === 0 && !verdict) {
    return <p className="text-xs text-tg-hint mt-2">Поставь целевой вес и дату в «Цель и вес» — появится прогноз</p>;
  }

  return (
    <div className="mt-3 flex flex-col gap-1 text-sm text-tg-text">
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
      {verdict && (
        <div className="mt-1 font-semibold" style={{ color: verdict.good ? '#4CAF50' : NUTRITION_COLOR }}>
          {verdict.text}
        </div>
      )}
    </div>
  );
}
