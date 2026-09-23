import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { parseISO, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useNavStore } from '../../stores/navStore';
import { useNutritionStore } from '../../stores/nutritionStore';
import { useHabitsStore } from '../../stores/habitsStore';
import { isHoursHabit } from '../../utils/habits';
import { useBackButton, useMainButton, haptic } from '../../hooks/useTelegramButtons';
import { deleteWeight, fetchStats, saveWeight } from '../../api/nutrition';
import { toDateString } from '../../utils/dates';
import { ACTIVITY_LEVELS, NUTRITION_COLOR, calculateGoal, fmt, type Sex } from '../../utils/nutrition';
import type { Habit, WeightPoint } from '../../types';

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
  const navigate = useNavStore((s) => s.navigate);
  const { goal, goalLoaded, loadGoal, setGoal } = useNutritionStore();
  const habits = useHabitsStore((s) => s.habits);
  const today = toDateString(new Date());

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
    fetchStats(today, today)
      .then((s) => {
        setWeights(s.weights);
        const w = s.weights.find((x) => x.date === today);
        if (w) setTodayWeight(String(w.weightKg));
      })
      .catch(() => {});
  }, [goalLoaded, loadGoal, today]);

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
  }, [goal]);

  const kcalNum = num(kcal);
  const valid = Number.isFinite(kcalNum) && kcalNum >= 500 && kcalNum <= 10000;
  const opt = (s: string) => (s.trim() && Number.isFinite(num(s)) ? num(s) : null);

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await setGoal({
        kcal: kcalNum,
        protein: opt(protein),
        fat: opt(fat),
        carbs: opt(carbs),
        startWeightKg: opt(startWeight),
        targetWeightKg: opt(targetWeight),
        targetDate: targetDate || null,
        trainingHabitId,
        sleepHabitId,
      });
      haptic('success');
      navigate('food-day');
    } catch {
      haptic('error');
    } finally {
      setSaving(false);
    }
  };

  useBackButton(() => navigate('food-day'));
  useMainButton(valid ? 'Сохранить цель' : null, save, { progress: saving });

  const currentWeight = weights.length ? weights[weights.length - 1]!.weightKg : opt(startWeight);

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
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
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
            habits={habits.filter((h) => !isHoursHabit(h))}
            value={trainingHabitId}
            onChange={setTrainingHabitId}
          />
          <HabitPicker
            label="😴 Сон (часы)"
            habits={habits.filter(isHoursHabit)}
            value={sleepHabitId}
            onChange={setSleepHabitId}
            empty="Нет привычки с типом «Часы» — создай её в трекере привычек"
          />
        </section>

        {/* Daily targets */}
        <section>
          <h2 className="text-base font-semibold text-tg-text mb-2">Норма на день</h2>
          <Num label="Калории, ккал" value={kcal} onChange={setKcal} />
          <div className="grid grid-cols-3 gap-2 mt-2">
            <Num label="Белки, г" value={protein} onChange={setProtein} />
            <Num label="Жиры, г" value={fat} onChange={setFat} />
            <Num label="Углеводы, г" value={carbs} onChange={setCarbs} />
          </div>
        </section>

        <button
          onClick={save}
          disabled={!valid || saving}
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
