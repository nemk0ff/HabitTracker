import { NUTRITION_COLOR, TRACK_COLOR, fmt } from '../../utils/nutrition';

interface Props {
  eaten: number;
  goal: number | null;
  size?: number;
  stroke?: number;
  /** Compact mode: only the number inside (hub card). */
  compact?: boolean;
}

/** Progress ring of eaten kcal vs goal; turns red past 110%. */
export function CalorieRing({ eaten, goal, size = 150, stroke = 12, compact = false }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = goal ? eaten / goal : 0;
  const shown = Math.min(ratio, 1);
  const color = ratio > 1.1 ? '#E0602A' : NUTRITION_COLOR;
  const left = goal ? goal - eaten : null;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke={TRACK_COLOR} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className={`${compact ? 'text-sm' : 'text-3xl'} font-bold text-tg-text leading-none`}>{fmt(eaten)}</div>
        {!compact && (
          <>
            <div className="text-xs text-tg-hint mt-1">{goal ? `из ${fmt(goal)} ккал` : 'ккал'}</div>
            {left !== null && (
              <div className="text-xs font-medium mt-1" style={{ color: left >= 0 ? 'var(--tg-theme-hint-color)' : color }}>
                {left >= 0 ? `осталось ${fmt(left)}` : `+${fmt(-left)} сверх`}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
