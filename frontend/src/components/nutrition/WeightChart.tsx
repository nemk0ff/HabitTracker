import { parseISO, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { NUTRITION_COLOR, fmt } from '../../utils/nutrition';
import type { NutritionGoal, WeightPoint } from '../../types';

interface Props {
  weights: WeightPoint[];
  goal: NutritionGoal | null;
  projectedKg: number | null;
}

const W = 320;
const H = 160;
const PAD = { l: 34, r: 10, t: 10, b: 22 };

/** Actual weight (solid), plan line start→target (dotted), trend projection to the target date (dashed). */
export function WeightChart({ weights, goal, projectedKg }: Props) {
  if (weights.length === 0) {
    return <p className="text-sm text-tg-hint text-center py-8">Записывай вес хотя бы раз в неделю — здесь появится график</p>;
  }

  const t = (d: string) => parseISO(d).getTime();
  const first = weights[0]!;
  const last = weights[weights.length - 1]!;
  const hasPlan = goal?.targetDate && goal.targetWeightKg !== null;
  const startKg = goal?.startWeightKg ?? first.weightKg;

  const x0 = t(first.date);
  const x1 = Math.max(hasPlan ? t(goal!.targetDate!) : t(last.date), x0 + 86_400_000);
  const ys = [...weights.map((w) => w.weightKg), startKg];
  if (hasPlan) ys.push(goal!.targetWeightKg!);
  if (projectedKg !== null) ys.push(projectedKg);
  const yMin = Math.floor(Math.min(...ys) - 1);
  const yMax = Math.ceil(Math.max(...ys) + 1);

  const sx = (ms: number) => PAD.l + ((ms - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (kg: number) => PAD.t + (1 - (kg - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);

  const path = weights.map((w, i) => `${i ? 'L' : 'M'}${sx(t(w.date)).toFixed(1)},${sy(w.weightKg).toFixed(1)}`).join(' ');
  const ticks = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="rgba(128,128,128,0.2)" strokeWidth={1} />
          <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" fontSize={9} fill="var(--tg-theme-hint-color)">
            {fmt(v, 1)}
          </text>
        </g>
      ))}

      {hasPlan && (
        <line
          x1={sx(x0)}
          y1={sy(startKg)}
          x2={sx(t(goal!.targetDate!))}
          y2={sy(goal!.targetWeightKg!)}
          stroke="var(--tg-theme-hint-color)"
          strokeWidth={1.5}
          strokeDasharray="2 4"
        />
      )}

      {projectedKg !== null && hasPlan && (
        <line
          x1={sx(t(last.date))}
          y1={sy(last.weightKg)}
          x2={sx(t(goal!.targetDate!))}
          y2={sy(projectedKg)}
          stroke={NUTRITION_COLOR}
          strokeWidth={1.5}
          strokeDasharray="6 4"
          opacity={0.6}
        />
      )}

      <path d={path} fill="none" stroke={NUTRITION_COLOR} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {weights.map((w) => (
        <circle key={w.date} cx={sx(t(w.date))} cy={sy(w.weightKg)} r={2.5} fill={NUTRITION_COLOR} />
      ))}

      <text x={PAD.l} y={H - 6} fontSize={9} fill="var(--tg-theme-hint-color)">
        {format(parseISO(first.date), 'd MMM', { locale: ru })}
      </text>
      <text x={W - PAD.r} y={H - 6} fontSize={9} textAnchor="end" fill="var(--tg-theme-hint-color)">
        {format(new Date(x1), 'd MMM', { locale: ru })}
      </text>
    </svg>
  );
}
