import { useEffect, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { parseISO, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useNavStore } from '../../stores/navStore';
import { toast } from '../../stores/toastStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { useHabitsStore } from '../../stores/habitsStore';
import { isCountHabit, isHoursHabit } from '../../utils/habits';
import { useBackButton, useMainButton, haptic } from '../../hooks/useTelegramButtons';
import { deleteWeight, fetchStats, saveWeight } from '../../api/nutrition';
import { toDateString } from '../../utils/dates';
import { ACTIVITY_LEVELS, NUTRITION_COLOR, calculateGoal, fmt, type Sex } from '../../utils/nutrition';
import { PHASE_COLORS, PHASE_LABELS, phaseTimeline } from '../../utils/phases';
import type { GoalPhase, Habit, PhaseType, WeightPoint } from '../../types';

const PROTEIN_PER_KG_PRESETS = [1.6, 1.8, 2.0, 2.2];
const DEFAULT_PROTEIN_PER_KG = 1.8;

/** Editable phase row; numbers stay strings while typing. */
interface PhaseDraft {
  key: number;
  type: PhaseType;
  until: string;
  by: 'weight' | 'rate';
  target: string;
  rate: string;
}

let phaseKey = 0;
const toDraft = (p: GoalPhase): PhaseDraft => ({
  key: ++phaseKey,
  type: p.type,
  until: p.until,
  by: p.rateKgPerWeek != null && p.targetWeightKg == null ? 'rate' : 'weight',
  target: p.targetWeightKg != null ? String(p.targetWeightKg) : '',
  rate: p.rateKgPerWeek != null ? String(Math.abs(p.rateKgPerWeek)) : '',
});

const CALC_STORAGE_KEY = 'nutrition-calc-profile';

interface CalcProfile {
  sex: Sex;
  age: string;
  height: string;
  activity: number;
}

function loadProfile(): CalcProfile {
  try {
    const raw = localStorage.getItem(CALC_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // storage unavailable
  }
  return { sex: 'male', age: '', height: '', activity: 1.55 };
}

function saveProfile(p: CalcProfile) {
  try {
    localStorage.setItem(CALC_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable
  }
}

const num = (s: string) => Number(s.replace(',', '.'));
const str = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

export function FoodGoalPage() {
  const back = useNavStore((s) => s.back);
  const { goal, goalLoaded, loadGoal, setGoal, loadPlan } = useNutritionStore();
  const allHabits = useHabitsStore((s) => s.habits);

  const today = toDateString(new Date());
  const plan = useNutritionStore((s) => s.plans[today]);

  const [proteinMode, setProteinMode] = useState<'perKg' | 'manual'>('perKg');
  const [proteinPerKg, setProteinPerKg] = useState(DEFAULT_PROTEIN_PER_KG);
  const [phases, setPhases] = useState<PhaseDraft[]>([]);

  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [startWeight, setStartWeight] = useState('');
  const [targetWeight, setTargetWeight] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [trainingHabitId, setTrainingHabitId] = useState<number | null>(null);
  const [sleepHabitId, setSleepHabitId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [weights, setWeights] = useState<WeightPoint[]>([]);
  const [todayWeight, setTodayWeight] = useState('');

  const [calcOpen, setCalcOpen] = useState(false);
  const [profile, setProfile] = useState<CalcProfile>(loadProfile);
  const [calcNote, setCalcNote] = useState<string | null>(null);

  useEffect(() => {
    if (!goalLoaded) loadGoal();
    if (!useNutritionStore.getState().plans[today]) loadPlan(today);
    fetchStats(today, today)
      .then((s) => {
        setWeights(s.weights);
        const w = s.weights.find((x) => x.date === today);
        if (w) setTodayWeight(String(w.weightKg));
      })
      .catch(() => {});
  }, [goalLoaded, loadGoal, loadPlan, today]);

  useEffect(() => {
    if (!goal) return;
    setKcal(str(goal.kcal));
    setProtein(str(goal.protein));
    setFat(str(goal.fat));
    setCarbs(str(goal.carbs));
    setStartWeight(str(goal.startWeightKg));
    setTargetWeight(str(goal.targetWeightKg));
    setTargetDate(goal.targetDate ?? '');
    setTrainingHabitId(goal.trainingHabitId);
    setSleepHabitId(goal.sleepHabitId);
    if (goal.proteinPerKg != null) {
      setProteinMode('perKg');
      setProteinPerKg(goal.proteinPerKg);
    } else {
      setProteinMode(goal.protein != null ? 'manual' : 'perKg');
    }
    setPhases((goal.phases ?? []).map(toDraft));
  }, [goal]);

  const kcalNum = num(kcal);
  const valid = Number.isFinite(kcalNum) && kcalNum >= 500 && kcalNum <= 10000;
  const opt = (s: string) => (s.trim() && Number.isFinite(num(s)) ? num(s) : null);

  const currentWeight = weights.length ? weights[weights.length - 1]!.weightKg : opt(startWeight);
  // Protein per kg follows the smoothed trend, like the backend model does.
  const proteinBaseKg = plan?.trendKg ?? plan?.weightKg ?? currentWeight;
  const proteinGrams = (perKg: number) => (proteinBaseKg ? Math.round(proteinBaseKg * perKg) : null);

  // Per-row problems that the server would reject (400) — shown inline, and they block saving.
  const phaseIssues = new Map<number, string>();
  for (const p of phases) {
    if (!p.until) phaseIssues.set(p.key, 'Укажи дату окончания');
    else if (phases.some((q) => q.key !== p.key && q.until === p.until)) phaseIssues.set(p.key, 'Другая фаза заканчивается в тот же день');
    else if (p.type !== 'maintain' && opt(p.target) === null && opt(p.rate) === null) {
      phaseIssues.set(p.key, p.by === 'weight' ? 'Укажи целевой вес' : 'Укажи темп');
    }
  }
  const canSave = valid && phaseIssues.size === 0;

  const phasesOut = (): GoalPhase[] =>
    phases
      .filter((p) => p.until)
      .map((p): GoalPhase => {
        const out: GoalPhase = { type: p.type, until: p.until };
        if (p.type === 'maintain') return out;
        if (p.by === 'weight') {
          const t = opt(p.target);
          if (t !== null) out.targetWeightKg = t;
        } else {
          const r = opt(p.rate);
          // Signed: cut loses weight.
          if (r !== null) out.rateKgPerWeek = p.type === 'cut' ? -Math.abs(r) : Math.abs(r);
        }
        return out;
      })
      .sort((a, b) => a.until.localeCompare(b.until));

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const perKg = proteinMode === 'perKg';
      await setGoal({
        kcal: kcalNum,
        // Per-kg: the model computes grams from the weight trend, a stored snapshot would go stale.
        protein: perKg ? null : opt(protein),
        proteinPerKg: perKg ? proteinPerKg : null,
        phases: phasesOut(),
        fat: opt(fat),
        carbs: opt(carbs),
        startWeightKg: opt(startWeight),
        targetWeightKg: opt(targetWeight),
        targetDate: targetDate || null,
        trainingHabitId,
        sleepHabitId,
      });
      haptic('success');
      back();
    } catch (e) {
      haptic('error');
      toast(e instanceof Error && e.message ? e.message : 'Не удалось сохранить цель', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  useBackButton(back);
  useMainButton(canSave ? 'Сохранить цель' : null, save, { progress: saving });

  const runCalc = () => {
    const age = num(profile.age);
    const height = num(profile.height);
    const weight = currentWeight ?? NaN;
    const target = opt(targetWeight);
    if (!(age > 0 && height > 0 && weight > 0 && target && targetDate)) {
      setCalcNote('Заполни возраст, рост, текущий (или стартовый) вес, целевой вес и дату');
      return;
    }
    saveProfile(profile);
    const r = calculateGoal(
      { sex: profile.sex, age, heightCm: height, weightKg: weight, activity: profile.activity, targetWeightKg: target, targetDate },
      today,
    );
    setKcal(String(r.kcal));
    setProtein(String(r.protein));
    setFat(String(r.fat));
    setCarbs(String(r.carbs));
    if (!startWeight) setStartWeight(String(weight));
    setCalcNote(
      `Поддержка ≈ ${fmt(r.tdee)} ккал, ${r.dailyDelta >= 0 ? 'профицит' : 'дефицит'} ${fmt(Math.abs(r.dailyDelta))} ккал/день → ${fmt(r.kcal)} ккал. Б ${r.protein} · Ж ${r.fat} · У ${r.carbs} г`,
    );
    haptic('success');
  };

  const logWeight = async () => {
    const w = num(todayWeight);
    if (!(w >= 20 && w <= 400)) return;
    const saved = await saveWeight(today, w);
    setWeights((ws) => [...ws.filter((x) => x.date !== today), saved].sort((a, b) => a.date.localeCompare(b.date)));
    haptic('success');
  };

  const removeWeight = async (date: string) => {
    await deleteWeight(date);
    setWeights((ws) => ws.filter((x) => x.date !== date));
    if (date === today) setTodayWeight('');
  };

  const field = 'w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text text-base outline-none placeholder:text-tg-hint';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24 flex flex-col gap-5">
        {/* Weight today */}
        <section>
          <h2 className="text-base font-semibold text-tg-text mb-2">Вес сегодня</h2>
          <div className="flex gap-2">
            <input
              value={todayWeight}
              onChange={(e) => setTodayWeight(e.target.value.replace(/[^\d.,]/g, ''))}
              inputMode="decimal"
              placeholder="кг"
              className={`${field} flex-1`}
            />
            <button
              onClick={logWeight}
              className="px-5 rounded-xl text-white font-semibold text-sm active:opacity-80"
              style={{ backgroundColor: NUTRITION_COLOR }}
            >
              Записать
            </button>
          </div>
          {weights.length > 0 && (
            <div className="mt-2 flex flex-col">
              {[...weights].reverse().slice(0, 5).map((w) => (
                <div key={w.date} className="flex items-center justify-between px-1 py-1.5 text-sm">
                  <span className="text-tg-hint">{format(parseISO(w.date), 'd MMMM', { locale: ru })}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-tg-text font-medium">{fmt(w.weightKg, 1)} кг</span>
                    <button onClick={() => removeWeight(w.date)} className="text-tg-hint text-xs">
                      ✕
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Weight goal */}
        <section>
          <h2 className="text-base font-semibold text-tg-text mb-2">Цель по весу</h2>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Стартовый вес, кг" value={startWeight} onChange={setStartWeight} />
            <Num label="Целевой вес, кг" value={targetWeight} onChange={setTargetWeight} />
          </div>
          <div className="mt-2">
            <div className="text-xs text-tg-hint mb-1.5 px-1">К какой дате</div>
            <input type="date" value={targetDate} min={today} onChange={(e) => setTargetDate(e.target.value)} className={field} />
          </div>
        </section>

        {/* Phases */}
        <section>
          <h2 className="text-base font-semibold text-tg-text mb-1">Фазы</h2>
          <p className="text-xs text-tg-hint mb-2">
            {phases.length
              ? 'Текущая фаза задаёт профицит или дефицит вместо цели по весу выше'
              : 'Например, набор до 77 кг к марту, потом поддержание. Без фаз работает цель по весу'}
          </p>
          <PhaseTimeline phases={phases} today={today} />
          <div className="flex flex-col gap-2">
            {phases.map((p, i) => (
              <PhaseRow
                key={p.key}
                index={i}
                phase={p}
                today={today}
                issue={phaseIssues.get(p.key) ?? null}
                onChange={(next) => setPhases((ps) => ps.map((x) => (x.key === p.key ? next : x)))}
                onRemove={() => setPhases((ps) => ps.filter((x) => x.key !== p.key))}
              />
            ))}
          </div>
          <button
            onClick={() => {
              const type: PhaseType = phases.length ? 'maintain' : 'bulk';
              setPhases((ps) => [...ps, { key: ++phaseKey, type, until: '', by: 'weight', target: '', rate: '' }]);
            }}
            className="w-full mt-2 py-2.5 rounded-xl text-sm font-semibold active:opacity-80"
            style={{ backgroundColor: `${NUTRITION_COLOR}22`, color: NUTRITION_COLOR }}
          >
            + Добавить фазу
          </button>
        </section>

        {/* Calculator */}
        <section className="bg-tg-section rounded-2xl">
          <button onClick={() => setCalcOpen(!calcOpen)} className="w-full flex items-center justify-between px-4 py-3.5">
            <span className="text-sm font-medium text-tg-text">🧮 Рассчитать калории из цели</span>
            <span className={`text-tg-hint transition-transform ${calcOpen ? 'rotate-90' : ''}`}>›</span>
          </button>
          <AnimatePresence>
            {calcOpen && (
              <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                <div className="px-4 pb-4 flex flex-col gap-2">
                  <div className="flex gap-2">
                    {(
                      [
                        ['male', 'Мужской'],
                        ['female', 'Женский'],
                      ] as const
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        onClick={() => setProfile({ ...profile, sex: k })}
                        className="flex-1 py-2 rounded-xl text-sm font-medium"
                        style={profile.sex === k ? { backgroundColor: NUTRITION_COLOR, color: '#fff' } : { backgroundColor: 'rgba(128,128,128,0.1)', color: 'var(--tg-theme-text-color)' }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="Возраст" value={profile.age} onChange={(v) => setProfile({ ...profile, age: v })} secondary />
                    <Num label="Рост, см" value={profile.height} onChange={(v) => setProfile({ ...profile, height: v })} secondary />
                  </div>
                  <div className="flex flex-col gap-1">
                    {ACTIVITY_LEVELS.map((a) => (
                      <button
                        key={a.factor}
                        onClick={() => setProfile({ ...profile, activity: a.factor })}
                        className="text-left px-3 py-2 rounded-xl text-sm"
                        style={{
                          backgroundColor: profile.activity === a.factor ? `${NUTRITION_COLOR}22` : 'transparent',
                          color: profile.activity === a.factor ? NUTRITION_COLOR : 'var(--tg-theme-text-color)',
                        }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={runCalc}
                    className="w-full mt-1 py-2.5 rounded-xl text-sm font-semibold active:opacity-80"
                    style={{ backgroundColor: `${NUTRITION_COLOR}22`, color: NUTRITION_COLOR }}
                  >
                    Рассчитать
                  </button>
                  {calcNote && <p className="text-xs text-tg-hint">{calcNote}</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Linked habits */}
        <section>
          <h2 className="text-base font-semibold text-tg-text mb-1">Связь с привычками</h2>
          <p className="text-xs text-tg-hint mb-2">
            В дни тренировок норма чуть выше (углеводы), в дни отдыха — чуть ниже; сон идёт в подсказки
          </p>
          <HabitPicker
            label="💪 Тренировки"
            habits={pickable(allHabits, trainingHabitId, (h) => !isHoursHabit(h) && !isCountHabit(h))}
            value={trainingHabitId}
            onChange={setTrainingHabitId}
          />
          <HabitPicker
            label="😴 Сон (часы)"
            habits={pickable(allHabits, sleepHabitId, isHoursHabit)}
            value={sleepHabitId}
            onChange={setSleepHabitId}
            empty="Нет привычки с типом «Часы» — создай её в трекере привычек"
          />
        </section>

        {/* Daily targets */}
        <section>
          <h2 className="text-base font-semibold text-tg-text mb-2">Норма на день</h2>
          <Num label="Калории, ккал" value={kcal} onChange={setKcal} />

          <div className="mt-3">
            <div className="text-xs text-tg-hint mb-1.5 px-1">Белок</div>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...PROTEIN_PER_KG_PRESETS, proteinPerKg])].sort((a, b) => a - b).map((v) => (
                <Chip key={v} active={proteinMode === 'perKg' && proteinPerKg === v} onClick={() => { setProteinMode('perKg'); setProteinPerKg(v); }}>
                  {fmt(v, 1)}
                </Chip>
              ))}
              <Chip active={proteinMode === 'manual'} onClick={() => setProteinMode('manual')}>
                вручную
              </Chip>
            </div>
            {proteinMode === 'perKg' ? (
              <p className="text-sm text-tg-text mt-2 px-1 tabular-nums">
                {fmt(proteinPerKg, 1)} г на кг веса
                {proteinGrams(proteinPerKg) !== null ? (
                  <span className="text-tg-hint"> — сейчас {proteinGrams(proteinPerKg)} г ({fmt(proteinBaseKg!, 1)} кг)</span>
                ) : (
                  <span className="text-tg-hint"> — запиши вес, чтобы посчитать граммы</span>
                )}
              </p>
            ) : (
              <div className="mt-2">
                <Num label="Белки, г" value={protein} onChange={setProtein} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3">
            <Num label="Жиры, г" value={fat} onChange={setFat} />
            <Num label="Углеводы, г" value={carbs} onChange={setCarbs} />
          </div>
        </section>

        <button
          onClick={save}
          disabled={!canSave || saving}
          className="w-full py-3 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-40"
          style={{ backgroundColor: NUTRITION_COLOR }}
        >
          Сохранить цель
        </button>
      </div>
    </motion.div>
  );
}

function Num({ label, value, onChange, secondary }: { label: string; value: string; onChange: (v: string) => void; secondary?: boolean }) {
  return (
    <div>
      <div className="text-xs text-tg-hint mb-1.5 px-1">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        inputMode="decimal"
        className={`w-full px-4 py-3 rounded-xl text-tg-text text-base outline-none ${secondary ? 'bg-tg-secondary' : 'bg-tg-section'}`}
      />
    </div>
  );
}

/** Active habits of the right kind, plus the currently linked one even if archived (so it can be unlinked). */
function pickable(all: Habit[], linkedId: number | null, kind: (h: Habit) => boolean): Habit[] {
  return all.filter((h) => kind(h) && (!h.archived || h.id === linkedId));
}

function HabitPicker({
  label,
  habits,
  value,
  onChange,
  empty,
}: {
  label: string;
  habits: Habit[];
  value: number | null;
  onChange: (id: number | null) => void;
  empty?: string;
}) {
  return (
    <div className="mb-2">
      <div className="text-xs text-tg-hint mb-1.5 px-1">{label}</div>
      {habits.length === 0 ? (
        <p className="text-xs text-tg-hint px-1">{empty ?? 'Нет подходящих привычек'}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {[{ id: null, name: 'Не учитывать', icon: null } as const, ...habits].map((h) => (
            <button
              key={h.id ?? 'none'}
              onClick={() => onChange(h.id)}
              className="px-3 py-1.5 rounded-full text-xs font-medium"
              style={
                value === h.id
                  ? { backgroundColor: NUTRITION_COLOR, color: '#fff' }
                  : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
              }
            >
              {h.icon ? `${h.icon} ` : ''}
              {h.name}
              {'archived' in h && h.archived ? ' (в архиве)' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  const c = color ?? NUTRITION_COLOR;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="px-3 py-1.5 rounded-full text-sm font-medium tabular-nums min-h-[32px]"
      style={active ? { backgroundColor: c, color: '#fff' } : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }}
    >
      {children}
    </button>
  );
}

function PhaseRow({
  index,
  phase,
  today,
  issue,
  onChange,
  onRemove,
}: {
  index: number;
  phase: PhaseDraft;
  today: string;
  issue: string | null;
  onChange: (p: PhaseDraft) => void;
  onRemove: () => void;
}) {
  const field = 'w-full px-3 py-2.5 rounded-xl bg-tg-secondary text-tg-text text-base outline-none placeholder:text-tg-hint';
  const done = phase.until !== '' && phase.until < today;
  return (
    <div className="bg-tg-section rounded-2xl p-3 flex flex-col gap-2" style={{ opacity: done ? 0.6 : 1 }}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-tg-hint w-4 tabular-nums">{index + 1}</span>
        <div className="flex flex-wrap gap-1.5 flex-1">
          {(Object.keys(PHASE_LABELS) as PhaseType[]).map((t) => (
            <Chip key={t} active={phase.type === t} color={PHASE_COLORS[t]} onClick={() => onChange({ ...phase, type: t })}>
              {PHASE_LABELS[t]}
            </Chip>
          ))}
        </div>
        <button onClick={onRemove} aria-label="Удалить фазу" className="hit-44 text-tg-hint text-sm px-1">
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-tg-hint w-6 shrink-0">до</span>
        <input type="date" value={phase.until} onChange={(e) => onChange({ ...phase, until: e.target.value })} className={field} />
      </div>
      {done && <p className="text-xs text-tg-hint">Фаза завершена</p>}
      {phase.type !== 'maintain' && (
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5 shrink-0">
            <Chip active={phase.by === 'weight'} onClick={() => onChange({ ...phase, by: 'weight' })}>
              к весу
            </Chip>
            <Chip active={phase.by === 'rate'} onClick={() => onChange({ ...phase, by: 'rate' })}>
              темп
            </Chip>
          </div>
          <input
            value={phase.by === 'weight' ? phase.target : phase.rate}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.,]/g, '');
              onChange(phase.by === 'weight' ? { ...phase, target: v } : { ...phase, rate: v });
            }}
            inputMode="decimal"
            placeholder={phase.by === 'weight' ? 'кг' : 'кг/нед'}
            className={field}
          />
        </div>
      )}
      {issue && (
        <p className="text-xs" style={{ color: 'var(--over)' }}>
          {issue}
        </p>
      )}
    </div>
  );
}

function PhaseTimeline({ phases, today }: { phases: PhaseDraft[]; today: string }) {
  const t = phaseTimeline(phases, today);
  if (!t || t.segments.length === 0) return null;
  const end = t.segments[t.segments.length - 1]!.until;
  return (
    <div className="mb-3 pt-1" aria-hidden>
      <div className="relative">
        <div className="relative h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--empty-cell)' }}>
          {t.segments.map((s, i) => (
            <div
              key={i}
              className="absolute inset-y-0"
              style={{
                left: `${s.left * 100}%`,
                width: `${s.width * 100}%`,
                backgroundColor: PHASE_COLORS[s.type],
                borderLeft: i > 0 ? '2px solid var(--tg-theme-secondary-bg-color)' : undefined,
              }}
            />
          ))}
        </div>
        {/* «сейчас» marker */}
        <div className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-tg-text" style={{ left: `calc(${t.now * 100}% - 1px)` }} />
      </div>
      <div className="relative h-4 mt-1.5 text-[11px] leading-none">
        <span className="absolute top-0 -translate-x-1/2 text-tg-text font-medium" style={{ left: `${Math.max(6, Math.min(80, t.now * 100))}%` }}>
          сейчас
        </span>
        <span className="absolute right-0 top-0 text-tg-hint tabular-nums">
          {format(parseISO(end), 'd MMM yyyy', { locale: ru })}
        </span>
      </div>
    </div>
  );
}
