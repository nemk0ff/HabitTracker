import { DailyBarsChart } from './SleepChart';
import { dailySeries } from '../utils/habitInsights';
import { formatNumber } from '../utils/habitStats';
import type { Habit } from '../types';

const DAYS = 14;

interface Props {
  habit: Habit;
  today: string;
  /** Tap on a day opens the day sheet for it. */
  onSelect: (date: string) => void;
}

/** Count habits: how many per day for two weeks against the daily target line. */
export function CountChart({ habit, today, onSelect }: Props) {
  const target = Math.max(1, habit.dailyTarget ?? 1);
  const points = dailySeries(habit, today, DAYS);
  const logged = points.filter((p) => p.value > 0);
  const avg = logged.length ? logged.reduce((s, p) => s + p.value, 0) / logged.length : null;
  const hit = logged.filter((p) => p.value >= target).length;
  const max = Math.max(Math.ceil(target * 1.25), ...points.map((p) => p.value));

  const subtitle =
    avg !== null ? `в среднем ${formatNumber(avg)} · цель взята ${hit} из ${DAYS} дней` : 'нет записей';

  return (
    <DailyBarsChart
      title="За 2 недели"
      subtitle={subtitle}
      points={points}
      color={habit.color}
      max={max}
      goal={target}
      goalLabel={`цель ${target}`}
      describe={(v) => `${v} из ${target}`}
      onSelect={onSelect}
    />
  );
}
