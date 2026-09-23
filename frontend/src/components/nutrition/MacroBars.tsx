import { MACRO_COLORS, TRACK_COLOR, fmt } from '../../utils/nutrition';
import type { Macros, NutritionGoal } from '../../types';

interface Props {
  totals: Macros;
  goal: NutritionGoal | null;
}

const ROWS = [
  { key: 'protein', label: 'Белки' },
  { key: 'fat', label: 'Жиры' },
  { key: 'carbs', label: 'Углеводы' },
] as const;

export function MacroBars({ totals, goal }: Props) {
  return (
    <div className="flex flex-col gap-2.5 flex-1 min-w-0">
      {ROWS.map(({ key, label }) => {
        const value = totals[key];
        const target = goal?.[key] ?? null;
        const pct = target ? Math.min(100, (value / target) * 100) : 0;
        return (
          <div key={key}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-tg-hint">{label}</span>
              <span className="text-tg-text font-medium">
                {fmt(value)}
                {target ? <span className="text-tg-hint font-normal"> / {target} г</span> : ' г'}
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: TRACK_COLOR }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: target ? `${pct}%` : value > 0 ? '100%' : '0%', backgroundColor: MACRO_COLORS[key], opacity: target ? 1 : 0.35 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
