import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { ColorPicker } from '../components/ColorPicker';
import { EmojiPicker } from '../components/EmojiPicker';
import { HABIT_COLORS } from '../utils/colors';
import { HABIT_TEMPLATES, type HabitTemplate } from '../utils/habitTemplates';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';

export function HabitFormPage() {
  const { habits, addHabit, editHabit } = useHabitsStore();
  const { screen, selectedHabitId, navigate } = useNavStore();
  const isEdit = screen === 'edit';
  const existing = isEdit ? habits.find((h) => h.id === selectedHabitId) : null;

  const [name, setName] = useState(existing?.name || '');
  const [color, setColor] = useState(existing?.color || HABIT_COLORS[0]!);
  const [icon, setIcon] = useState<string | null>(existing?.icon || null);
  const [binary, setBinary] = useState(existing?.binary ?? true); // new habits default to the simple check
  // Hours habits store minutes; the kind is chosen on creation only (entries aren't converted).
  const [hours, setHours] = useState(existing?.measure === 'hours');
  const [weeklyTarget, setWeeklyTarget] = useState<number | null>(existing?.weeklyTarget ?? null);
  const [saving, setSaving] = useState(false);
  const [templateKey, setTemplateKey] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const ok =
        isEdit && selectedHabitId
          ? await editHabit(selectedHabitId, { name: name.trim(), color, icon: icon || undefined, binary, weeklyTarget: hours ? null : weeklyTarget })
          : await addHabit({ name: name.trim(), color, icon: icon || undefined, binary: hours ? false : binary, measure: hours ? 'hours' : null, weeklyTarget: hours ? null : weeklyTarget });
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
    setHours(t.measure === 'hours');
    setBinary(t.binary);
    setWeeklyTarget(t.weeklyTarget);
  };

  const back = useNavStore((s) => s.back);
  useBackButton(back);
  useMainButton(name.trim() ? (isEdit ? 'Сохранить' : 'Создать') : null, save, { progress: saving });

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
                        ? { backgroundColor: t.color, color: '#fff' }
                        : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
                    }
                  >
                    <span aria-hidden>{t.icon}</span>
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Name */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-tg-text mb-2">
            Название
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTemplateKey(null);
            }}
            placeholder="Например: Медитация"
            maxLength={30}
            autoFocus={isEdit}
            className="w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text placeholder:text-tg-hint text-base outline-none focus:ring-2 focus:ring-tg-button/30 transition-shadow"
          />
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

        {/* Kind: hours (create only) */}
        {!isEdit ? (
          <div className="mb-6">
            <label className="block text-sm font-semibold text-tg-text mb-2">
              Что отмечаем
            </label>
            <div className="flex bg-tg-section rounded-xl p-1">
              {(
                [
                  [false, 'Выполнение'],
                  [true, 'Часы (сон)'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setHours(value)}
                  className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={hours === value ? { backgroundColor: color, color: '#fff' } : { color: 'var(--tg-theme-text-color)' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          hours && <p className="text-xs text-tg-hint mb-6 px-1">Тип: часы — сохраняется при создании привычки</p>
        )}

        {/* How a day is marked: a plain check or a check with an effort level */}
        {!hours && (
          <div className="mb-6">
            <label className="block text-sm font-semibold text-tg-text mb-2">Как отмечать</label>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Как отмечать">
              {(
                [
                  [true, 'Просто галочка', 'Сделал или нет'],
                  [false, 'С оценкой', 'Легко · средне · тяжело'],
                ] as const
              ).map(([value, title, hint]) => {
                const on = binary === value;
                return (
                  <button
                    key={title}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setBinary(value)}
                    className="w-full min-h-[56px] px-4 py-2.5 rounded-2xl bg-tg-section flex items-center justify-between gap-3 text-left transition-shadow"
                    style={{ boxShadow: on ? `inset 0 0 0 2px ${color}` : undefined }}
                  >
                    <span>
                      <span className="block text-sm font-medium text-tg-text">{title}</span>
                      <span className="block text-xs text-tg-hint mt-0.5">{hint}</span>
                    </span>
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-white"
                      style={on ? { backgroundColor: color } : { boxShadow: 'inset 0 0 0 1.5px var(--tg-theme-hint-color)' }}
                    >
                      {on && <Check size={14} aria-hidden />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Frequency goal: daily or N times a week (drives the weekly progress instead of a daily streak) */}
        {!hours && (
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
                        ? { backgroundColor: color, color: '#fff' }
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
                      ? { backgroundColor: color, color: '#fff' }
                      : { backgroundColor: 'var(--tg-theme-secondary-bg-color)', color: 'var(--tg-theme-text-color)' }
                  }
                >
                  Каждый день
                </button>
              </div>
              <p className="text-sm text-tg-hint mt-2 px-1">
                {weeklyTarget === null
                  ? 'Серия считается по дням подряд'
                  : `${weeklyTarget} ${weeklyTarget === 1 ? 'раз' : weeklyTarget < 5 ? 'раза' : 'раз'} в неделю — прогресс и серия считаются по неделям`}
              </p>
            </div>
          </div>
        )}

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
