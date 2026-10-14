import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Minus, Plus } from 'lucide-react';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { ColorPicker } from '../components/ColorPicker';
import { EmojiPicker } from '../components/EmojiPicker';
import { HABIT_COLORS, readableOn } from '../utils/colors';
import { CHALLENGE_PRESETS, CHALLENGE_TEMPLATES, clampChallengeDays, HABIT_TEMPLATES, type HabitTemplate } from '../utils/habitTemplates';
import { Switch } from '../components/NotificationSheet';
import { toDateString } from '../utils/dates';
import { pluralDays, TIME_OF_DAY } from '../utils/habits';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import type { Habit, TimeOfDay } from '../types';

/** What a day records. Measure kinds ('hours' / 'count') are fixed after creation — entries aren't converted. */
type Kind = 'check' | 'levels' | 'count' | 'hours';

const KINDS: { key: Kind; title: string; hint: string }[] = [
  { key: 'check', title: 'Галочка', hint: 'Сделал или нет' },
  { key: 'levels', title: 'С оценкой', hint: 'Легко · средне · тяжело' },
  { key: 'count', title: 'Количество', hint: 'Например, 8 стаканов воды за день' },
  { key: 'hours', title: 'Часы (сон)', hint: 'Сколько часов, с точностью до получаса' },
];

const DEFAULT_DAILY_TARGET = 8;

function kindOf(h: Pick<Habit, 'measure' | 'binary'>): Kind {
  if (h.measure === 'hours') return 'hours';
  if (h.measure === 'count') return 'count';
  return h.binary ? 'check' : 'levels';
}

/** «9 окт.» for the challenge hint. */
function formatStart(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

const clampTarget = (n: number) => Math.min(99, Math.max(1, Math.round(n) || 1));
const normName = (s: string) => s.trim().toLocaleLowerCase('ru');

export function HabitFormPage() {
  const habits = useHabitsStore((s) => s.habits);
  const addHabit = useHabitsStore((s) => s.addHabit);
  const editHabit = useHabitsStore((s) => s.editHabit);
  const screen = useNavStore((s) => s.screen);
  const selectedHabitId = useNavStore((s) => s.selectedHabitId);
  const navigate = useNavStore((s) => s.navigate);
  const back = useNavStore((s) => s.back);
  const isEdit = screen === 'edit';
  const existing = isEdit ? habits.find((h) => h.id === selectedHabitId) : null;

  const [name, setName] = useState(existing?.name || '');
  const [color, setColor] = useState(existing?.color || HABIT_COLORS[0]!);
  const [icon, setIcon] = useState<string | null>(existing?.icon || null);
  // New habits default to the simple check.
  const [kind, setKind] = useState<Kind>(existing ? kindOf(existing) : 'check');
  const [dailyTarget, setDailyTarget] = useState(existing?.dailyTarget ?? DEFAULT_DAILY_TARGET);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay | null>(existing?.timeOfDay ?? null);
  const [weeklyTarget, setWeeklyTarget] = useState<number | null>(existing?.weeklyTarget ?? null);
  const [saving, setSaving] = useState(false);
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  // Challenge: N done days from the start date; null = a plain open-ended habit.
  const [challengeDays, setChallengeDays] = useState<number | null>(
    existing?.challengeDays ? clampChallengeDays(existing.challengeDays) : null,
  );

  const count = kind === 'count';
  // The frequency goal applies to check / levels habits only.
  const hasFrequency = kind === 'check' || kind === 'levels';
  // Editing can't switch measure kinds; check ↔ levels stays possible.
  const kinds = isEdit ? KINDS.filter((k) => k.key === kind || (hasFrequency && (k.key === 'check' || k.key === 'levels'))) : KINDS;

  // Same name already in the list (case-insensitive) — a hint, not a block.
  const duplicate = useMemo(() => {
    const n = normName(name);
    if (!n) return null;
    return habits.find((h) => !h.archived && h.id !== existing?.id && normName(h.name) === n) ?? null;
  }, [name, habits, existing?.id]);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const today = toDateString(new Date());
      // A new challenge starts today; changing the length of a running one keeps its start.
      const challenge =
        challengeDays === null
          ? existing?.challengeDays
            ? { challengeDays: null, challengeStart: null }
            : {}
          : challengeDays !== existing?.challengeDays
            ? { challengeDays, challengeStart: existing?.challengeDays ? existing.challengeStart ?? today : today }
            : {};
      const common = {
        name: name.trim(),
        color,
        icon: icon || undefined,
        timeOfDay,
        weeklyTarget: hasFrequency ? weeklyTarget : null,
        ...challenge,
      };
      const ok =
        isEdit && selectedHabitId
          ? await editHabit(selectedHabitId, {
              ...common,
              ...(hasFrequency ? { binary: kind === 'check' } : {}),
              ...(count ? { dailyTarget: clampTarget(dailyTarget) } : {}),
            })
          : await addHabit({
              ...common,
              binary: kind === 'check',
              measure: kind === 'hours' ? 'hours' : count ? 'count' : null,
              dailyTarget: count ? clampTarget(dailyTarget) : null,
            });
      // On failure stay here so the input isn't lost; the Toaster shows the store error.
      if (!ok) {
        haptic('error');
        return;
      }
      haptic('success');
      navigate(isEdit ? 'habit' : 'hub');
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = (t: HabitTemplate) => {
    haptic('select');
    setTemplateKey(t.key);
    setName(t.name);
    setIcon(t.icon);
    setColor(t.color);
    setKind(kindOf(t));
    if (t.dailyTarget) setDailyTarget(t.dailyTarget);
    setWeeklyTarget(t.weeklyTarget);
    setTimeOfDay(t.timeOfDay);
    setChallengeDays(t.challengeDays ? clampChallengeDays(t.challengeDays) : null);
  };

  useBackButton(back);
  useMainButton(name.trim() ? (isEdit ? 'Сохранить' : 'Создать') : null, save, { progress: saving });

  const selectedStyle = { backgroundColor: color, color: readableOn(color) };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24">
        <h1 className="text-xl font-bold text-tg-text mb-6">
          {isEdit ? 'Редактировать' : 'Новая привычка'}
        </h1>

        {/* Ready-made templates: one tap fills everything below */}
        {!isEdit && (
          <div className="mb-6 -mx-4">
            <p className="text-sm font-semibold text-tg-text mb-2 px-4">Готовые</p>
            <div className="flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
              {HABIT_TEMPLATES.map((t) => {
                const on = templateKey === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    aria-pressed={on}
                    className="shrink-0 min-h-[44px] px-3.5 rounded-full text-sm font-medium flex items-center gap-1.5 transition-colors"
                    style={
                      on
                        ? { backgroundColor: t.color, color: readableOn(t.color) }
                        : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
                    }
                  >
                    <span aria-hidden>{t.icon}</span>
                    {t.name}
                  </button>
                );
              })}
            </div>
            <p className="text-sm font-semibold text-tg-text mt-4 mb-2 px-4">Челленджи</p>
            <div className="flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
              {CHALLENGE_TEMPLATES.map((t) => {
                const on = templateKey === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    aria-pressed={on}
                    className="shrink-0 min-h-[44px] px-3.5 rounded-full text-sm font-medium flex items-center gap-1.5 transition-colors"
                    style={
                      on
                        ? { backgroundColor: t.color, color: readableOn(t.color) }
                        : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
                    }
                  >
                    <span aria-hidden>{t.icon}</span>
                    {t.name}
                    <span className="text-xs tabular-nums" style={{ opacity: 0.7 }}>
                      {t.challengeDays} дн.
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Name */}
        <div className="mb-6">
          <label htmlFor="habit-name" className="block text-sm font-semibold text-tg-text mb-2">
            Название
          </label>
          <input
            id="habit-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTemplateKey(null);
            }}
            placeholder="Например: Медитация"
            maxLength={30}
            autoFocus={isEdit}
            aria-describedby="habit-name-dup"
            className="w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text placeholder:text-tg-hint text-base outline-none focus:ring-2 focus:ring-tg-button/30 transition-shadow"
          />
          <p id="habit-name-dup" aria-live="polite" className="text-sm text-hint-strong px-1 empty:hidden mt-1.5">
            {duplicate ? `У тебя уже есть «${duplicate.name}»` : ''}
          </p>
        </div>

        {/* When: the section on Today */}
        <div className="mb-6">
          <p id="time-of-day-label" className="block text-sm font-semibold text-tg-text mb-2">
            Когда
          </p>
          <div
            className="grid grid-cols-[1fr_1fr_1fr_1.7fr] gap-1 bg-tg-section rounded-xl p-1"
            role="radiogroup"
            aria-labelledby="time-of-day-label"
          >
            {TIME_OF_DAY.map(({ key, label }) => {
              const on = timeOfDay === key;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setTimeOfDay(key)}
                  className="min-h-[44px] px-1 rounded-lg text-sm font-medium leading-tight transition-colors"
                  style={on ? selectedStyle : { color: 'var(--tg-theme-text-color)' }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Color */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-tg-text mb-2">
            Цвет
          </label>
          <div className="bg-tg-section rounded-2xl p-4">
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>

        {/* Icon */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-tg-text mb-2">
            Иконка
          </label>
          <div className="bg-tg-section rounded-2xl p-4">
            <EmojiPicker value={icon} onChange={setIcon} />
          </div>
        </div>

        {/* What a day records */}
        <div className="mb-6">
          <p id="kind-label" className="block text-sm font-semibold text-tg-text mb-2">
            Как отмечать
          </p>
          <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="kind-label">
            {kinds.map(({ key, title, hint }) => {
              const on = kind === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setKind(key)}
                  className="w-full min-h-[56px] px-4 py-2.5 rounded-2xl bg-tg-section flex items-center justify-between gap-3 text-left transition-shadow"
                  style={{ boxShadow: on ? `inset 0 0 0 2px ${color}` : undefined }}
                >
                  <span>
                    <span className="block text-sm font-medium text-tg-text">{title}</span>
                    <span className="block text-xs text-tg-hint mt-0.5">{hint}</span>
                  </span>
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                    style={on ? selectedStyle : { boxShadow: 'inset 0 0 0 1.5px var(--tg-theme-hint-color)' }}
                  >
                    {on && <Check size={14} aria-hidden />}
                  </span>
                </button>
              );
            })}
          </div>

          {count && (
            <div className="mt-2 bg-tg-section rounded-2xl pl-4 pr-2 py-2 flex items-center gap-2">
              <span id="daily-target-label" className="flex-1 text-sm font-medium text-tg-text">
                Цель в день
              </span>
              <button
                type="button"
                onClick={() => setDailyTarget((n) => clampTarget(n - 1))}
                disabled={dailyTarget <= 1}
                aria-label="Меньше"
                className="w-11 h-11 rounded-xl bg-tg-secondary text-tg-text flex items-center justify-center disabled:opacity-30 active:opacity-70"
              >
                <Minus size={18} aria-hidden />
              </button>
              <input
                type="text"
                inputMode="numeric"
                aria-labelledby="daily-target-label"
                value={dailyTarget}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(-2);
                  setDailyTarget(digits ? clampTarget(Number(digits)) : 1);
                }}
                className="w-12 text-center font-display text-xl text-tg-text bg-transparent outline-none focus-ring rounded-lg"
              />
              <button
                type="button"
                onClick={() => setDailyTarget((n) => clampTarget(n + 1))}
                disabled={dailyTarget >= 99}
                aria-label="Больше"
                className="w-11 h-11 rounded-xl bg-tg-secondary text-tg-text flex items-center justify-center disabled:opacity-30 active:opacity-70"
              >
                <Plus size={18} aria-hidden />
              </button>
            </div>
          )}
        </div>

        {/* Frequency goal: daily or N times a week (drives the weekly progress instead of a daily streak) */}
        {hasFrequency && (
          <div className="mb-6">
            <label className="block text-sm font-semibold text-tg-text mb-2">
              Как часто
            </label>
            <div className="bg-tg-section rounded-2xl p-3">
              <div className="flex gap-1.5" role="radiogroup" aria-label="Сколько раз в неделю">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={weeklyTarget === n}
                    onClick={() => setWeeklyTarget(n)}
                    className="flex-1 min-h-[44px] rounded-xl text-base font-semibold transition-colors"
                    style={
                      weeklyTarget === n
                        ? selectedStyle
                        : { backgroundColor: 'var(--tg-theme-secondary-bg-color)', color: 'var(--tg-theme-text-color)' }
                    }
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={weeklyTarget === null}
                  onClick={() => setWeeklyTarget(null)}
                  className="flex-[2] min-h-[44px] rounded-xl text-sm font-semibold transition-colors"
                  style={
                    weeklyTarget === null
                      ? selectedStyle
                      : { backgroundColor: 'var(--tg-theme-secondary-bg-color)', color: 'var(--tg-theme-text-color)' }
                  }
                >
                  Каждый день
                </button>
              </div>
              <p className="text-sm text-tg-hint mt-2 px-1">
                {weeklyTarget === null
                  ? 'Серия считается по дням подряд'
                  : `${weeklyTarget} ${weeklyTarget >= 2 && weeklyTarget <= 4 ? 'раза' : 'раз'} в неделю — прогресс и серия считаются по неделям`}
              </p>
            </div>
          </div>
        )}

        {/* Challenge: a goal with an end — «12/30» on the tile, a celebration at the finish */}
        <div className="mb-6">
          <div className="bg-tg-section rounded-2xl pl-4 pr-1 py-1">
            <div className="flex items-center gap-3 min-h-[52px]">
              <span className="flex-1">
                <span id="challenge-label" className="block text-sm font-medium text-tg-text">
                  Сделать челленджем
                </span>
                <span id="challenge-hint" className="block text-xs text-tg-hint mt-0.5">
                  {challengeDays === null
                    ? 'Цель с финишем: например, 30 дней без сахара'
                    : existing?.challengeDays && existing.challengeStart
                      ? `Нужно отметить ${pluralDays(challengeDays)}, отсчёт с ${formatStart(existing.challengeStart)}`
                      : `Нужно отметить ${pluralDays(challengeDays)}, старт сегодня`}
                </span>
              </span>
              <Switch
                checked={challengeDays !== null}
                onChange={(on) => setChallengeDays(on ? clampChallengeDays(existing?.challengeDays ?? 30) : null)}
                color={color}
                labelledBy="challenge-label"
                describedBy="challenge-hint"
              />
            </div>
            {challengeDays !== null && (
              <div className="flex gap-1.5 pr-3 pb-3 pt-1" role="radiogroup" aria-label="Длина челленджа">
                {CHALLENGE_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={challengeDays === n}
                    onClick={() => {
                      haptic('select');
                      setChallengeDays(n);
                    }}
                    className="flex-1 min-h-[44px] rounded-xl text-sm font-semibold tabular-nums transition-colors"
                    style={
                      challengeDays === n
                        ? selectedStyle
                        : { backgroundColor: 'var(--tg-theme-secondary-bg-color)', color: 'var(--tg-theme-text-color)' }
                    }
                  >
                    {n} дн.
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-tg-text mb-2">
            Превью
          </label>
          <div className="bg-tg-section rounded-2xl p-4 flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
              style={{ backgroundColor: color + '20' }}
            >
              {icon || '•'}
            </div>
            <span className="font-semibold text-tg-text">
              {name.trim() || 'Название привычки'}
            </span>
          </div>
        </div>

        {/* Fallback submit for non-Telegram env */}
        <button
          onClick={save}
          disabled={!name.trim() || saving}
          className="w-full py-3 rounded-xl bg-tg-button text-tg-button-text font-medium text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать привычку'}
        </button>
      </div>
    </motion.div>
  );
}
