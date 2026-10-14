import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { fmt } from '../../utils/nutrition';
import type { DashboardData } from '../../types';

const W = 320;
const HINT = 'var(--tg-theme-hint-color)';
const GRID = 'rgba(128,128,128,0.2)';

const shortDate = (ms: number) => format(new Date(ms), 'd MMM', { locale: ru });
const weekLabel = (d: string) => format(parseISO(d), 'd.MM');

// ─── Weight ───────────────────────────────────────────────────────────────────

const PLAN_EXTEND_DAYS = 14;

/** Polyline cut at `maxMs` (the crossing segment is interpolated). */
function clipLine(ps: { ms: number; kg: number }[], maxMs: number): { ms: number; kg: number }[] {
  const out: { ms: number; kg: number }[] = [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    if (p.ms <= maxMs) {
      out.push(p);
      continue;
    }
    const prev = ps[i - 1];
    if (prev && prev.ms < maxMs) out.push({ ms: maxMs, kg: prev.kg + ((p.kg - prev.kg) * (maxMs - prev.ms)) / (p.ms - prev.ms) });
    break;
  }
  return out;
}

/** Weigh-ins (dots), EMA trend (solid), phase plan (dashed). */
export function DashWeightChart({ weight }: { weight: DashboardData['weight'] }) {
  const { points, trend } = weight;
  if (points.length === 0 && trend.length === 0) {
    return <p className="text-sm text-tg-hint text-center py-6">Нет взвешиваний за период</p>;
  }
  const H = 160;
  const PAD = { l: 34, r: 10, t: 10, b: 22 };
  const t = (d: string) => parseISO(d).getTime();
  // X range = the data; the plan line may extend it by at most PLAN_EXTEND_DAYS (clipped there),
  // so a phase ending months ahead doesn't squash the history.
  const data = [...points, ...trend];
  const dataXs = data.map((p) => t(p.date));
  const x0 = Math.min(...dataXs);
  const dataMax = Math.max(...dataXs);
  const planEnd = weight.plan.length ? Math.max(...weight.plan.map((p) => t(p.date))) : dataMax;
  const x1 = Math.max(dataMax, Math.min(planEnd, dataMax + PLAN_EXTEND_DAYS * 86_400_000), x0 + 86_400_000);
  const plan = clipLine(weight.plan.map((p) => ({ ms: t(p.date), kg: p.kg })), x1);
  const all = [...data.map((p) => ({ ms: t(p.date), kg: p.kg })), ...plan];
  const kgs = all.map((p) => p.kg);
  const yMin = Math.floor(Math.min(...kgs) - 0.5);
  const yMax = Math.ceil(Math.max(...kgs) + 0.5);
  const sx = (ms: number) => PAD.l + ((ms - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (kg: number) => PAD.t + (1 - (kg - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const line = (ps: { date: string; kg: number }[]) =>
    ps.map((p, i) => `${i ? 'L' : 'M'}${sx(t(p.date)).toFixed(1)},${sy(p.kg).toFixed(1)}`).join(' ');
  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  const planPath = plan.map((p, i) => `${i ? 'L' : 'M'}${sx(p.ms).toFixed(1)},${sy(p.kg).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="График веса">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke={GRID} strokeWidth={1} />
          <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" fontSize={9} fill={HINT}>
            {fmt(v, 1)}
          </text>
        </g>
      ))}
      {plan.length > 1 && (
        <path d={planPath} fill="none" stroke={HINT} strokeWidth={1.5} strokeDasharray="5 4" />
      )}
      {trend.length > 1 && (
        <path d={line(trend)} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {points.map((p) => (
        <circle key={p.date} cx={sx(t(p.date))} cy={sy(p.kg)} r={2.5} fill="var(--accent)" opacity={0.4} />
      ))}
      <text x={PAD.l} y={H - 6} fontSize={9} fill={HINT}>
        {shortDate(x0)}
      </text>
      <text x={W - PAD.r} y={H - 6} fontSize={9} textAnchor="end" fill={HINT}>
        {shortDate(x1)}
      </text>
    </svg>
  );
}

// ─── Weekly bars vs target ────────────────────────────────────────────────────

interface BarsProps {
  weekStarts: string[];
  values: (number | null)[];
  targets: (number | null)[];
  color: string;
  label: string;
  digits?: number;
  /** Horizontal reference line (e.g. 7 h of sleep). */
  reference?: number;
}

/** One bar per week; the week's target is a short dark tick over the bar slot. */
export function WeeklyBars({ weekStarts, values, targets, color, label, digits = 0, reference }: BarsProps) {
  const n = weekStarts.length;
  if (n === 0 || values.every((v) => v === null)) {
    return <p className="text-sm text-tg-hint text-center py-6">Нет данных за период</p>;
  }
  const H = 130;
  const PAD = { l: 34, r: 6, t: 14, b: 18 };
  const nums = [...values, ...targets, reference ?? null].filter((v): v is number => v !== null);
  const yMax = Math.max(...nums) * 1.1 || 1;
  const slot = (W - PAD.l - PAD.r) / n;
  const bw = Math.min(28, slot * 0.6);
  const sy = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const cx = (i: number) => PAD.l + slot * (i + 0.5);
  const labelEvery = n > 6 ? 2 : 1;
  const showValues = n <= 6;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={label}>
      {[0, yMax / 2].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke={GRID} strokeWidth={1} />
          <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" fontSize={9} fill={HINT}>
            {fmt(v, v < 10 && digits ? 1 : 0)}
          </text>
        </g>
      ))}
      {reference !== undefined && (
        <line x1={PAD.l} x2={W - PAD.r} y1={sy(reference)} y2={sy(reference)} stroke={HINT} strokeWidth={1} strokeDasharray="3 3" />
      )}
      {values.map((v, i) => {
        const tg = targets[i];
        const met = v !== null && tg !== null && tg !== undefined && v >= tg * 0.95;
        return (
          <g key={weekStarts[i]}>
            {v !== null && (
              <rect
                x={cx(i) - bw / 2}
                y={sy(v)}
                width={bw}
                height={Math.max(0, sy(0) - sy(v))}
                rx={3}
                fill={color}
                opacity={tg == null || met ? 0.9 : 0.5}
              >
                <title>{`${weekLabel(weekStarts[i]!)}: ${fmt(v, digits)}${tg != null ? ` из ${fmt(tg, digits)}` : ''}`}</title>
              </rect>
            )}
            {tg != null && (
              <line
                x1={cx(i) - bw / 2 - 3}
                x2={cx(i) + bw / 2 + 3}
                y1={sy(tg)}
                y2={sy(tg)}
                stroke="var(--tg-theme-text-color)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            )}
            {showValues && v !== null && (
              <text x={cx(i)} y={sy(Math.max(v, tg ?? 0)) - 4} textAnchor="middle" fontSize={9} fill="var(--tg-theme-text-color)">
                {fmt(v, digits)}
              </text>
            )}
            {i % labelEvery === (n - 1) % labelEvery && (
              <text x={cx(i)} y={H - 5} textAnchor="middle" fontSize={8.5} fill={HINT}>
                {weekLabel(weekStarts[i]!)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Bedtime ──────────────────────────────────────────────────────────────────

/** "HH:MM" → minutes relative to midnight; evening times are negative (23:30 → −30). */
function bedMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const min = (h ?? 0) * 60 + (m ?? 0);
  return min >= 12 * 60 ? min - 24 * 60 : min;
}

function minutesToClock(min: number): string {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** Average bedtime per week (dot) with its spread (whisker ±spread). Later = lower. */
export function BedtimeChart({ weekStarts, bedtimes, spreads }: { weekStarts: string[]; bedtimes: (string | null)[]; spreads: (number | null)[] }) {
  const n = weekStarts.length;
  const pts = bedtimes.map((b) => (b ? bedMinutes(b) : null));
  const vals = pts.flatMap((p, i) => (p === null ? [] : [p - (spreads[i] ?? 0), p + (spreads[i] ?? 0)]));
  if (vals.length === 0) return null;
  const H = 100;
  const PAD = { l: 34, r: 6, t: 8, b: 18 };
  const lo = Math.floor(Math.min(...vals) / 30) * 30;
  const hi = Math.max(Math.ceil(Math.max(...vals) / 30) * 30, lo + 60);
  const slot = (W - PAD.l - PAD.r) / n;
  const sy = (v: number) => PAD.t + ((v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const cx = (i: number) => PAD.l + slot * (i + 0.5);
  const labelEvery = n > 6 ? 2 : 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Средний отбой по неделям">
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke={GRID} strokeWidth={1} />
          <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" fontSize={9} fill={HINT}>
            {minutesToClock(v)}
          </text>
        </g>
      ))}
      {pts.map((p, i) => (
        <g key={weekStarts[i]}>
          {p !== null && (
            <>
              {spreads[i] ? (
                <line x1={cx(i)} x2={cx(i)} y1={sy(p - spreads[i]!)} y2={sy(p + spreads[i]!)} stroke="var(--carbs)" strokeWidth={2} opacity={0.4} strokeLinecap="round" />
              ) : null}
              <circle cx={cx(i)} cy={sy(p)} r={3.5} fill="var(--carbs)">
                <title>{`${weekLabel(weekStarts[i]!)}: ${bedtimes[i]}${spreads[i] ? ` ±${spreads[i]} мин` : ''}`}</title>
              </circle>
            </>
          )}
          {i % labelEvery === (n - 1) % labelEvery && (
            <text x={cx(i)} y={H - 5} textAnchor="middle" fontSize={8.5} fill={HINT}>
              {weekLabel(weekStarts[i]!)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
