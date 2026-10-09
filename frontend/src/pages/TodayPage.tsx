import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronRight, Plus, Utensils, Scale, NotebookText, Settings, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../stores/authStore';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useNutritionStore } from '../stores/nutritionStore';
import { toast } from '../stores/toastStore';
import { CheckinBanner } from '../components/CheckinBanner';
import { useCantMessage, WriteAccessWarning } from '../components/WriteAccessWarning';
import { EmptyHabits } from '../components/EmptyHabits';
import { TodaySection } from '../components/TodaySection';
import { HabitActionSheet } from '../components/HabitActionSheet';
import { HoursSheet } from '../components/HoursSheet';
import { WeightSheet } from '../components/nutrition/WeightSheet';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { useToday } from '../hooks/useToday';
import { capitalizeFirst } from '../utils/dates';
import { MACRO_COLORS, fmt, mealByTime } from '../utils/nutrition';
import {
  TIME_OF_DAY,
  closedDaysStreak,
  isCountHabit,
  isClosedOn,
  isDayClosed,
  isHoursHabit,
  isMarkedOn,
  isReturningUser,
  isSkippedOn,
  pluralDays,
  sortHabits,
} from '../utils/habits';
import { dismissCheckinBanner, isCheckinBannerDismissed, saveCheckinTime } from '../utils/checkin';
import { incrementCount, setHabitValue, toggleHabitDay } from '../utils/habitActions';
import type { Habit } from '../types';

/** Time-of-day sections appear only from this many active habits (and with 2+ non-empty sections). */
const MIN_HABITS_FOR_SECTIONS = 6;

/**
 * Start screen: everything that is marked daily, without choosing a module first
 * (design review 07.10: habits got 2 marks per 36 opens behind the old hub).
 */
export function TodayPage() {
  const nutrition = useAuthStore((s) => !!s.user?.features?.nutrition);
  const habits = useHabitsStore((s) => s.habits);
  const navigate = useNavStore((s) => s.navigate);
  const today = useToday();
  const day = useNutritionStore((s) => s.days[today]);
  const plan = useNutritionStore((s) => s.plans[today]);
  const { loadDay, loadPlan, saveWeight } = useNutritionStore(
    useShallow((s) => ({ loadDay: s.loadDay, loadPlan: s.loadPlan, saveWeight: s.saveWeight })),
  );

  // Keep the id, not the object: the sheet must see the live entries after each save.
  const [hoursHabitId, setHoursHabitId] = useState<number | null>(null);
  const hoursHabit = habits.find((h) => h.id === hoursHabitId) ?? null;
  const [weightOpen, setWeightOpen] = useState(false);

  const checkinTime = useAuthStore((s) => s.user?.checkinTime ?? null);
  const [bannerHidden, setBannerHidden] = useState(isCheckinBannerDismissed);
  const active = useMemo(() => sortHabits(habits), [habits]);
  const cantMessage = useCantMessage();
  const showBanner = active.length > 0 && !checkinTime && !bannerHidden && !cantMessage;

  const markedToday = active.filter((h) => isMarkedOn(h, today)).length;
  // Skipped habits (ill / vacation) drop out of today's «N из M».
  const dueToday = active.filter((h) => !isSkippedOn(h, today)).length;

  // Soft return after a 3+ day break (plan §3.6): a welcome banner, dismissible for the day.
  const returning = useMemo(() => isReturningUser(active, today), [active, today]);
  const [returnDismissed, setReturnDismissed] = useState(() => isReturnBannerDismissed(today));
  useEffect(() => setReturnDismissed(isReturnBannerDismissed(today)), [today]);
  const showReturnBanner = returning && !returnDismissed;

  // Long-pressed tile → actions sheet. Keep the id so the sheet sees live entries.
  const [menuHabitId, setMenuHabitId] = useState<number | null>(null);
  const menuHabit = habits.find((h) => h.id === menuHabitId) ?? null;
  const closed = useMemo(() => isDayClosed(active, today), [active, today]);
  const closedStreak = useMemo(() => (closed ? closedDaysStreak(active, today) : 0), [closed, active, today]);

  // Morning / day / evening / any time; only non-empty ones are shown. With few habits, sections of
  // 1–2 tiles leave most of a 3-column row empty and stretch the screen — so they only appear with
  // ≥ 6 habits spread over ≥ 2 sections; otherwise one flat grid ordered by section, then sortOrder.
  const sections = useMemo(() => {
    const bySection = TIME_OF_DAY.map((t) => ({
      ...t,
      habits: active.filter((h) => (h.timeOfDay ?? null) === t.key),
    })).filter((s) => s.habits.length > 0);
    if (active.length >= MIN_HABITS_FOR_SECTIONS && bySection.length >= 2) return bySection;
    return [{ key: null, label: 'Привычки', habits: bySection.flatMap((s) => s.habits) }];
  }, [active]);
  const doneSections = sections
    .filter((s) => s.habits.every((h) => isClosedOn(h, today)))
    .map((s) => s.key ?? 'any')
    .join(',');

  // Success haptic when a section or the whole day becomes done (not on first render).
  const prevDone = useRef<{ sections: string; closed: boolean; date: string } | null>(null);
  useEffect(() => {
    const prev = prevDone.current;
    prevDone.current = { sections: doneSections, closed, date: today };
    if (!prev || prev.date !== today) return;
    const newSection = doneSections.split(',').some((k) => k && !prev.sections.split(',').includes(k));
    if (newSection || (closed && !prev.closed)) haptic('success');
  }, [doneSections, closed, today]);

  useBackButton(null);
  useMainButton(null, () => {});

  useEffect(() => {
    if (!nutrition) return;
    loadDay(today);
    loadPlan(today);
  }, [nutrition, today, loadDay, loadPlan]);

  const target = plan?.todayKcal ?? day?.goal?.kcal ?? null;
  const eaten = day?.totals.kcal ?? 0;
  const left = target !== null ? target - eaten : null;
  // No goal and nothing eaten today → not a calorie counter (yet): a compact invite below the
  // habits instead of the big block. Until day/plan load, keep the old layout (no flash for loggers).
  const [nutritionInviteHidden, setNutritionInviteHidden] = useState(isNutritionInviteDismissed);
  const notCounting =
    !!day &&
    plan !== undefined &&
    !day.goal &&
    !plan?.todayKcal &&
    day.entries.length === 0 &&
    // Weighing in counts as using the tracker — keep the full block (with the weight row).
    plan?.weightKg == null &&
    plan?.lastWeightKg == null;
  const showNutritionBlock = nutrition && !notCounting;
  const showNutritionInvite = nutrition && notCounting && !nutritionInviteHidden;
  const proteinTarget = plan?.proteinTarget ?? day?.goal?.protein ?? null;
  const proteinLeft = proteinTarget !== null ? Math.max(0, proteinTarget - (day?.totals.protein ?? 0)) : null;

  const logWeight = async (kg: number) => {
    await saveWeight(today, kg);
    haptic('success');
    toast(`Вес ${fmt(kg, 1)} кг записан`);
  };

  // Stable callbacks so memoized tiles re-render only when their own habit changes.
  const tapHabit = useCallback(
    (h: Habit) =>
      isHoursHabit(h) ? setHoursHabitId(h.id) : isCountHabit(h) ? incrementCount(h, today) : toggleHabitDay(h, today),
    [today],
  );
  const openHabit = useCallback((id: number) => navigate('habit', { selectedHabitId: id }), [navigate]);
  const openMenu = useCallback((h: Habit) => setMenuHabitId(h.id), []);

  const addTile = (
    <motion.button
      type="button"
      whileTap={{ scale: 0.95 }}
      onClick={() => navigate('create')}
      className="aspect-square rounded-2xl p-3 flex flex-col items-center justify-center gap-1.5 text-tg-hint"
      style={{ boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--tg-theme-hint-color) 45%, transparent)' }}
    >
      <Plus size={24} aria-hidden />
      <span className="text-sm font-medium">Добавить</span>
    </motion.button>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="scrollable">
      <div className="p-4 pb-10">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-tg-text pt-2">
              {capitalizeFirst(format(parseISO(today), 'EEEE, d MMMM', { locale: ru }))}
            </h1>
            {active.length > 0 && (
              <div className="mt-2">
                <div className="flex items-baseline gap-2">
                  {/* The habits count is the screen's big number unless the kcal block already holds that role. */}
                  <span
                    className={
                      nutrition || dueToday === 0 ? 'text-2xl font-semibold leading-none' : 'font-display text-[36px] leading-none'
                    }
                    style={{ color: closed ? 'var(--accent)' : 'var(--tg-theme-text-color)' }}
                  >
                    {dueToday === 0 ? 'Сегодня пропуск' : `${markedToday} из ${dueToday}`}
                  </span>
                  {dueToday > 0 && <span className="text-sm text-tg-hint">сегодня</span>}
                </div>
                {closed && (
                  <p className="text-sm font-medium mt-1.5" style={{ color: 'var(--accent)' }}>
                    День закрыт ✓ · серия {pluralDays(closedStreak)}
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => navigate('settings')}
            aria-label="Настройки"
            className="w-11 h-11 -mr-2 shrink-0 rounded-xl flex items-center justify-center text-tg-hint active:opacity-60"
          >
            <Settings size={22} aria-hidden />
          </button>
        </div>

        {showReturnBanner && (
          <section
            className="relative rounded-2xl p-4 pr-12 mb-5"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 9%, transparent)' }}
          >
            <button
              type="button"
              onClick={() => {
                dismissReturnBanner(today);
                setReturnDismissed(true);
                haptic('select');
              }}
              aria-label="Скрыть"
              className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center text-tg-hint active:opacity-60"
            >
              <X size={18} aria-hidden />
            </button>
            <p className="text-base font-medium text-tg-text">С возвращением! Начнём с сегодня — серии не главное 🙂</p>
          </section>
        )}

        {cantMessage && <WriteAccessWarning className="mb-5" />}

        {showBanner && !showReturnBanner && (
          <CheckinBanner
            onAccept={async () => {
              if (await saveCheckinTime('21:00')) setBannerHidden(true);
            }}
            onOther={() => navigate('settings')}
            onDismiss={() => {
              dismissCheckinBanner();
              setBannerHidden(true);
              haptic('select');
            }}
          />
        )}

        {/* The day's main block: what's left to eat + weight */}
        {showNutritionBlock && (
          <section
            className="rounded-3xl p-5 mb-6"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 9%, transparent)' }}
          >
            {left === null ? (
              <button onClick={() => navigate('food-goal')} className="text-base font-medium" style={{ color: 'var(--accent)' }}>
                Поставь цель по калориям, чтобы видеть остаток
              </button>
            ) : (
              <>
                <div className="text-sm text-tg-hint">{left >= 0 ? 'Осталось съесть' : 'Сверх нормы'}</div>
                <div
                  className="font-display text-[44px] leading-none mt-1"
                  style={{ color: left >= 0 ? 'var(--accent)' : 'var(--over)' }}
                >
                  {fmt(Math.abs(left))}
                  <span className="text-xl ml-1.5">ккал</span>
                </div>
                {proteinLeft !== null && (
                  <div className="text-sm mt-2" style={{ color: MACRO_COLORS.protein }}>
                    {proteinLeft > 0 ? `и ещё ${fmt(proteinLeft)} г белка` : 'белок добран ✓'}
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => navigate('food-add', { foodDate: today, foodMeal: mealByTime() })}
                className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-1.5 active:opacity-80"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <Plus size={18} aria-hidden /> Еда
              </button>
              <button
                onClick={() => navigate('food-suggest', { foodDate: today })}
                className="flex-1 min-h-[44px] rounded-xl text-sm font-medium bg-tg-section text-tg-text flex items-center justify-center gap-1.5 active:opacity-70"
              >
                <Utensils size={18} aria-hidden /> Что доесть
              </button>
            </div>

            {/* Weight: one tap for the three realistic readings of a 0.5 kg scale */}
            <div className="flex items-center gap-2 mt-4">
              <Scale size={18} className="text-tg-hint shrink-0" aria-hidden />
              {plan?.weightKg != null ? (
                <button onClick={() => setWeightOpen(true)} className="text-sm text-tg-text min-h-[36px]">
                  Вес сегодня: {fmt(plan.weightKg, 1)} кг
                  {plan.trendKg != null && <span className="text-tg-hint"> · тренд {fmt(plan.trendKg, 1)}</span>}
                </button>
              ) : plan?.lastWeightKg != null ? (
                <div className="flex gap-1.5 flex-1">
                  {[plan.lastWeightKg - 0.5, plan.lastWeightKg, plan.lastWeightKg + 0.5].map((kg) => (
                    <button
                      key={kg}
                      onClick={() => logWeight(kg)}
                      className="flex-1 min-h-[36px] rounded-lg bg-tg-section text-sm text-tg-text active:opacity-70"
                    >
                      {fmt(kg, 1)}
                    </button>
                  ))}
                  <button
                    onClick={() => setWeightOpen(true)}
                    className="min-h-[36px] px-2 rounded-lg bg-tg-section text-sm text-tg-hint active:opacity-70"
                    aria-label="Другой вес"
                  >
                    …
                  </button>
                </div>
              ) : (
                <button onClick={() => setWeightOpen(true)} className="text-sm min-h-[36px]" style={{ color: 'var(--accent)' }}>
                  Взвеситься
                </button>
              )}
            </div>

            <button
              onClick={() => navigate('food-day', { foodDate: today })}
              className="mt-3 text-sm text-tg-hint flex items-center gap-1 min-h-[32px]"
            >
              <NotebookText size={16} aria-hidden /> Дневник питания
              <ChevronRight size={16} aria-hidden />
            </button>
          </section>
        )}

        {/* Habits: tap a tile to mark today */}
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-base font-semibold text-tg-text">Привычки</h2>
          <button onClick={() => navigate('home')} className="text-sm text-tg-hint flex items-center min-h-[44px] -my-2">
            Прогресс <ChevronRight size={16} aria-hidden />
          </button>
        </div>

        {active.length === 0 ? (
          <EmptyHabits onPickMore={() => navigate('onboarding')} />
        ) : (
          sections.map((s, i) => (
            <TodaySection
              key={s.key ?? 'any'}
              label={s.label}
              habits={s.habits}
              date={today}
              showHeader={sections.length > 1}
              onTap={tapHabit}
              onOpen={openHabit}
              onMenu={openMenu}
              trailing={i === sections.length - 1 ? addTile : undefined}
            />
          ))
        )}

        {showNutritionInvite && (
          <section
            className="relative rounded-2xl p-4 pr-12 mt-6"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 9%, transparent)' }}
          >
            <button
              type="button"
              onClick={() => {
                dismissNutritionInvite();
                setNutritionInviteHidden(true);
                haptic('select');
              }}
              aria-label="Скрыть"
              className="absolute top-1 right-1 w-11 h-11 flex items-center justify-center text-tg-hint active:opacity-60"
            >
              <X size={18} aria-hidden />
            </button>
            <p className="text-base font-medium text-tg-text flex items-start gap-1.5">
              <Utensils size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} aria-hidden />
              Считать калории?
            </p>
            <p className="text-sm text-tg-hint mt-0.5">Поставь цель — покажу, сколько осталось на день</p>
            <button
              type="button"
              onClick={() => navigate('food-goal')}
              className="mt-3 min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white active:opacity-80"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Поставить цель
            </button>
          </section>
        )}
      </div>

      {hoursHabit && (
        <HoursSheet
          date={today}
          title={hoursHabit.name}
          minutes={hoursHabit.entries.find((e) => e.date === today)?.value ?? 0}
          color={hoursHabit.color}
          onClose={() => setHoursHabitId(null)}
          onSave={(m) => setHabitValue(hoursHabit, today, m)}
        />
      )}
      <HabitActionSheet habit={menuHabit} date={today} onClose={() => setMenuHabitId(null)} onOpen={openHabit} />
      <WeightSheet
        open={weightOpen}
        initialKg={plan?.weightKg ?? plan?.lastWeightKg ?? null}
        onClose={() => setWeightOpen(false)}
        onSave={logWeight}
      />
    </motion.div>
  );
}

const RETURN_BANNER_KEY = 'returnBannerDismissed';

/** The welcome-back banner was closed today (storage may be unavailable — then it just shows). */
function isReturnBannerDismissed(today: string): boolean {
  try {
    return localStorage.getItem(RETURN_BANNER_KEY) === today;
  } catch {
    return false;
  }
}

function dismissReturnBanner(today: string) {
  try {
    localStorage.setItem(RETURN_BANNER_KEY, today);
  } catch {
    /* private mode: the banner is hidden for this session only */
  }
}

const NUTRITION_INVITE_KEY = 'nutritionInviteDismissed';

function isNutritionInviteDismissed(): boolean {
  try {
    return localStorage.getItem(NUTRITION_INVITE_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissNutritionInvite() {
  try {
    localStorage.setItem(NUTRITION_INVITE_KEY, '1');
  } catch {
    /* private mode: hidden for this session only */
  }
}
