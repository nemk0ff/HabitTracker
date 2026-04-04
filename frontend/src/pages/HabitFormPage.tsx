import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useHabitsStore } from '../stores/habitsStore';
import { ColorPicker } from '../components/ColorPicker';
import { EmojiPicker } from '../components/EmojiPicker';
import { HABIT_COLORS } from '../utils/colors';

export function HabitFormPage() {
  const { habits, screen, selectedHabitId, navigate, addHabit, editHabit } = useHabitsStore();
  const isEdit = screen === 'edit';
  const existing = isEdit ? habits.find((h) => h.id === selectedHabitId) : null;

  const [name, setName] = useState(existing?.name || '');
  const [color, setColor] = useState(existing?.color || HABIT_COLORS[0]!);
  const [icon, setIcon] = useState<string | null>(existing?.icon || null);
  const [binary, setBinary] = useState(existing?.binary ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const webapp = window.Telegram?.WebApp;
    if (!webapp) return;

    webapp.BackButton?.show?.();
    const backHandler = () => navigate(isEdit ? 'habit' : 'home', selectedHabitId);
    webapp.BackButton?.onClick?.(backHandler);

    webapp.MainButton?.setParams?.({
      text: isEdit ? 'Сохранить' : 'Создать',
      is_visible: true,
    });

    const mainHandler = async () => {
      if (!name.trim() || saving) return;
      setSaving(true);
      webapp.MainButton?.showProgress?.(false);

      try {
        if (isEdit && selectedHabitId) {
          await editHabit(selectedHabitId, { name: name.trim(), color, icon: icon || undefined, binary });
          navigate('habit', selectedHabitId);
        } else {
          await addHabit({ name: name.trim(), color, icon: icon || undefined, binary });
          navigate('home');
        }
        webapp.HapticFeedback?.notificationOccurred('success');
      } finally {
        webapp.MainButton?.hideProgress?.();
        setSaving(false);
      }
    };
    webapp.MainButton?.onClick?.(mainHandler);

    return () => {
      webapp.BackButton?.offClick?.(backHandler);
      webapp.MainButton?.offClick?.(mainHandler);
      webapp.MainButton?.hide?.();
    };
  }, [name, color, icon, binary, isEdit, selectedHabitId, saving, navigate, addHabit, editHabit]);

  const handleSubmit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      if (isEdit && selectedHabitId) {
        await editHabit(selectedHabitId, { name: name.trim(), color, icon: icon || undefined, binary });
        navigate('habit', selectedHabitId);
      } else {
        await addHabit({ name: name.trim(), color, icon: icon || undefined, binary });
        navigate('home');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24">
        <h1 className="text-xl font-bold text-tg-text mb-6">
          {isEdit ? 'Редактировать' : 'Новая привычка'}
        </h1>

        {/* Name */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-tg-section-header uppercase tracking-wider mb-2">
            Название
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например: Медитация"
            maxLength={50}
            autoFocus
            className="w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text placeholder:text-tg-hint text-base outline-none focus:ring-2 focus:ring-tg-button/30 transition-shadow"
          />
        </div>

        {/* Color */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-tg-section-header uppercase tracking-wider mb-3">
            Цвет
          </label>
          <div className="bg-tg-section rounded-2xl p-4">
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>

        {/* Icon */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-tg-section-header uppercase tracking-wider mb-3">
            Иконка
          </label>
          <div className="bg-tg-section rounded-2xl p-4">
            <EmojiPicker value={icon} onChange={setIcon} />
          </div>
        </div>

        {/* Binary mode */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-tg-section-header uppercase tracking-wider mb-3">
            Режим
          </label>
          <div className="bg-tg-section rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-tg-text">Только выполнено / нет</p>
              <p className="text-xs text-tg-hint mt-0.5">Без оттенков интенсивности</p>
            </div>
            <button
              type="button"
              onClick={() => setBinary((b) => !b)}
              className="relative shrink-0 w-12 h-7 rounded-full transition-colors duration-200"
              style={{ backgroundColor: binary ? 'var(--tg-theme-button-color, #2196F3)' : 'rgba(120,120,128,0.32)' }}
            >
              <div
                className="absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                style={{ transform: binary ? 'translateX(22px)' : 'translateX(4px)' }}
              />
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-tg-section-header uppercase tracking-wider mb-3">
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
          onClick={handleSubmit}
          disabled={!name.trim() || saving}
          className="w-full py-3 rounded-xl bg-tg-button text-tg-button-text font-medium text-sm disabled:opacity-50 active:opacity-80 transition-opacity"
        >
          {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать привычку'}
        </button>
      </div>
    </motion.div>
  );
}
