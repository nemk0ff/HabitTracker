import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useNavStore } from '../stores/navStore';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { fetchDashboard, type DashboardWeeks } from '../api/dashboard';
import { DashWeightChart, WeeklyBars, BedtimeChart } from '../components/dashboard/DashboardCharts';
import { GoalSheet } from '../components/dashboard/GoalSheet';
import { fmt } from '../utils/nutrition';
import { pluralForm } from '../utils/plural';
import type { DashboardData, QuarterGoal } from '../types';

const STATUS: Record<QuarterGoal['status'], { color: string; label: string }> = {
  done: { color: 'var(--accent)', label: 'достигнута' },
  on: { color: 'var(--accent)', label: 'по графику' },
  behind: { color: 'var(--over)', label: 'отстаёшь' },
  unknown: { color: 'var(--tg-theme-hint-color)', label: 'мало данных' },
};

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Progress dashboard (plans/14-10-2026-iteration-C.md): quarter goals + weekly weight/food/sleep/training charts. */
export function DashboardPage() {
  const back = useNavStore((s) => s.back);
  useBackButton(back);
  useMainButton(null, () => {});

  const [weeks, setWeeks] = useState<DashboardWeeks>(4);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<{ goal: QuarterGoal | null } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    let alive = true;
    fetchDashboard(weeks)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Не удалось загрузить'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [weeks]);

  useEffect(() => load(), [load]);

  const w = data?.weeks ?? [];
  const starts = w.map((x) => x.weekStart);
  const lastTrend = data?.weight.trend.length ? data.weight.trend[data.weight.trend.length - 1]!.kg : null;
  const lastPoint = data?.weight.points.length ? data.weight.points[data.weight.points.length - 1]!.kg : null;
  const trainingsPerWeek = avg(w.map((x) => x.trainings));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="scrollable">
      <div className="p-4 pb-24 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 pt-1">
          <h1 className="text-xl font-bold text-tg-text">Дашборд</h1>
          <div className="flex rounded-xl bg-tg-section p-0.5" role="group" aria-label="Период">
            {([4, 12] as const).map((n) => (
              <button
                key={n}
                onClick={() => {
                  if (n !== weeks) haptic('select');
                  setWeeks(n);
                }}
                aria-pressed={weeks === n}
                className="px-3 min-h-[36px] rounded-[10px] text-sm font-medium tabular-nums"
                style={weeks === n ? { backgroundColor: 'var(--accent)', color: '#fff' } : { color: 'var(--tg-theme-text-color)' }}
              >
                {n} недель
              </button>
            ))}
          </div>
        </div>

        {error && !data && (
          <div className="text-center py-10">
            <p className="text-tg-hint text-sm mb-3">{error}</p>
            <button onClick={load} className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
              Повторить
            </button>
          </div>
        )}
        {!data && !error && <p className="text-tg-hint text-sm text-center py-10">Загрузка...</p>}

        {data && (
          <div className={`flex flex-col gap-4 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {/* Quarter goals */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-semibold text-tg-text">Цели на квартал</h2>
                <button
                  onClick={() => setSheet({ goal: null })}
                  className="flex items-center gap-1 text-sm font-medium min-h-[36px] px-1 active:opacity-60"
                  style={{ color: 'var(--accent)' }}
                >
                  <Plus size={16} aria-hidden /> Цель
                </button>
              </div>
              {data.goals.length === 0 ? (
                <button
                  onClick={() => setSheet({ goal: null })}
                  className="w-full bg-tg-section rounded-2xl p-4 text-left text-sm text-tg-hint active:opacity-70"
                >
                  Поставь 1–3 цели на квартал: вес, тренировки, сон, привычка или белок — здесь будет прогресс и темп.
                </button>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.goals.map((g) => (
                    <GoalCard key={g.id} goal={g} onClick={() => setSheet({ goal: g })} />
                  ))}
                </div>
              )}
            </section>

            {/* Weight */}
            <Card title="Вес" aside={lastTrend !== null ? `${fmt(lastTrend, 1)} кг` : lastPoint !== null ? `${fmt(lastPoint, 1)} кг` : undefined}>
              <DashWeightChart weight={data.weight} />
              <Legend items={[['var(--accent)', 'тренд'], ['var(--tg-theme-hint-color)', 'план фазы', true]]} />
              {data.phaseLine && <p className="text-sm text-tg-text mt-2 tabular-nums">{data.phaseLine}</p>}
            </Card>

            {/* Kcal & protein */}
            <Card title="Калории и белок" aside="ср. за полные дни">
              <WeeklyBars
                weekStarts={starts}
                values={w.map((x) => x.kcalAvg)}
                targets={w.map((x) => x.kcalTarget)}
                color="var(--accent)"
                label="Калории по неделям"
              />
              <p className="text-xs text-tg-hint mb-3">ккал в день · черта — план недели</p>
              <WeeklyBars
                weekStarts={starts}
                values={w.map((x) => x.proteinAvg)}
                targets={w.map((x) => x.proteinTarget)}
                color="var(--protein)"
                label="Белок по неделям"
              />
              <p className="text-xs text-tg-hint">белок, г в день</p>
              {w.some((x) => x.completeDays < 4) && (
                <p className="text-xs text-tg-hint mt-2 tabular-nums">
                  Полных дней: {w.map((x) => x.completeDays).join(' · ')}
                </p>
              )}
            </Card>

            {/* Sleep */}
            <Card title="Сон" aside={sleepAside(w)}>
              <WeeklyBars
                weekStarts={starts}
                values={w.map((x) => (x.sleepAvgMin !== null ? x.sleepAvgMin / 60 : null))}
                targets={w.map(() => null)}
                color="var(--carbs)"
                label="Средний сон по неделям"
                digits={1}
                reference={7}
              />
              <p className="text-xs text-tg-hint mb-3">часов в среднем · пунктир — 7 ч</p>
              <BedtimeChart weekStarts={starts} bedtimes={w.map((x) => x.bedtimeAvg)} spreads={w.map((x) => x.bedtimeSpreadMin)} />
              {w.some((x) => x.bedtimeAvg) && (
                <p className="text-xs text-tg-hint">средний отбой · усы — разброс{bedtimeSpreadText(w)}</p>
              )}
            </Card>

            {/* Trainings */}
            <Card
              title="Тренировки"
              aside={trainingsPerWeek !== null ? `${fmt(trainingsPerWeek, 1)} в неделю` : undefined}
            >
              {w.every((x) => x.trainings === null) ? (
                <p className="text-sm text-tg-hint">Привяжи привычку тренировок в «Цель и вес»</p>
              ) : (
                <>
                  <WeeklyBars
                    weekStarts={starts}
                    values={w.map((x) => x.trainings)}
                    targets={w.map((x) => x.trainingTarget)}
                    color="var(--fat)"
                    label="Тренировки по неделям"
                  />
                  <p className="text-xs text-tg-hint">
                    {w.some((x) => x.trainingTarget !== null) ? 'за неделю · черта — цель привычки' : 'за неделю'}
                  </p>
                </>
              )}
            </Card>

            {/* Links */}
            <Card title="Связи">
              {data.links === null || data.links.length === 0 ? (
                <p className="text-sm text-tg-hint">Мало данных — нужно 2+ недели дневника, сна и тренировок.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-tg-hint/15">
                  {data.links.map((l) => (
                    <li key={l.label} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="text-sm text-tg-text">{l.label}</div>
                      <div className="flex gap-3 text-[15px] font-semibold text-tg-text tabular-nums mt-0.5">
                        <span>{l.a}</span>
                        <span className="text-tg-hint font-normal">vs</span>
                        <span>{l.b}</span>
                      </div>
                      {l.note && <div className="text-xs text-tg-hint mt-0.5">{l.note}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>

      <GoalSheet
        open={sheet !== null}
        goal={sheet?.goal ?? null}
        onClose={() => setSheet(null)}
        onSaved={load}
        hints={{ weightKg: lastTrend ?? lastPoint, trainingsPerWeek }}
      />
    </motion.div>
  );
}

function sleepAside(w: DashboardData['weeks']): string | undefined {
  const m = avg(w.map((x) => x.sleepAvgMin));
  return m !== null ? `${fmt(m / 60, 1)} ч в среднем` : undefined;
}

function bedtimeSpreadText(w: DashboardData['weeks']): string {
  const s = avg(w.map((x) => x.bedtimeSpreadMin));
  return s !== null ? ` (±${fmt(s)} мин)` : '';
}

function GoalCard({ goal, onClick }: { goal: QuarterGoal; onClick: () => void }) {
  const st = STATUS[goal.status];
  const pct = Math.round(Math.max(0, Math.min(1, goal.progress)) * 100);
  const days =
    goal.status === 'done'
      ? 'готово'
      : goal.daysLeft > 0
        ? `${goal.daysLeft} ${pluralForm(goal.daysLeft, 'день', 'дня', 'дней')}`
        : 'срок вышел';
  return (
    <button onClick={onClick} className="w-full bg-tg-section rounded-2xl p-4 text-left active:opacity-80">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-tg-text min-w-0 truncate">{goal.title}</span>
        <span className="text-xs text-tg-hint shrink-0 tabular-nums">{days}</span>
      </div>
      <div
        className="h-2 rounded-full mt-2.5 overflow-hidden"
        style={{ backgroundColor: 'var(--empty-cell)' }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${goal.title}: ${pct}%`}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: st.color }} />
      </div>
      <div className="flex items-baseline justify-between gap-3 mt-2">
        <span className="text-sm text-tg-text tabular-nums min-w-0">{goal.summary}</span>
        <span className="text-xs font-medium shrink-0" style={{ color: st.color }}>
          {st.label}
        </span>
      </div>
    </button>
  );
}

function Card({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="bg-tg-section rounded-2xl p-4">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="text-base font-semibold text-tg-text">{title}</h2>
        {aside && <span className="text-sm text-tg-hint tabular-nums">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Legend({ items }: { items: [string, string, boolean?][] }) {
  return (
    <div className="flex gap-4 text-xs text-tg-hint mt-1">
      {items.map(([c, label, dashed]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden>
            <line x1="0" y1="2" x2="16" y2="2" stroke={c} strokeWidth={dashed ? 1.5 : 2.5} strokeDasharray={dashed ? '4 3' : undefined} />
          </svg>
          {label}
        </span>
      ))}
    </div>
  );
}
