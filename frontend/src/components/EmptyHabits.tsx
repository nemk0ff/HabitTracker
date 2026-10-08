import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useHabitsStore } from '../stores/habitsStore';
import { haptic } from '../hooks/useTelegramButtons';
import { readableOn } from '../utils/colors';
import { HABIT_TEMPLATES, QUICK_TEMPLATE_KEYS, templateToHabit, type HabitTemplate } from '../utils/habitTemplates';

/** No habits yet: one tap on a chip creates a ready-made habit; the full picker is one more tap away. */
export function EmptyHabits({ onPickMore }: { onPickMore: () => void }) {
  const addHabit = useHabitsStore((s) => s.addHabit);
  const [busy, setBusy] = useState<string | null>(null);
  const quick = QUICK_TEMPLATE_KEYS.map((k) => HABIT_TEMPLATES.find((t) => t.key === k)).filter(
    (t): t is HabitTemplate => !!t,
  );

  const add = async (t: HabitTemplate) => {
    if (busy) return;
    setBusy(t.key);
    const ok = await addHabit(templateToHabit(t));
    setBusy(null);
    haptic(ok ? 'success' : 'error');
  };

  return (
    <div className="rounded-2xl bg-tg-section p-4">
      <p className="text-base font-medium text-tg-text">Начни с одной привычки</p>
      <p className="text-sm text-tg-hint mt-0.5">Нажми — и она появится здесь, отмечать можно сразу</p>
      <div className="flex flex-wrap gap-2 mt-3">
        {quick.map((t) => (
          <motion.button
            key={t.key}
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => add(t)}
            disabled={!!busy}
            className="min-h-[44px] px-4 rounded-full text-sm font-medium flex items-center gap-1.5 disabled:opacity-60"
            style={{ backgroundColor: t.color, color: readableOn(t.color) }}
          >
            <span aria-hidden>{t.icon}</span> {t.name}
          </motion.button>
        ))}
      </div>
      <button
        type="button"
        onClick={onPickMore}
        className="mt-2 min-h-[44px] text-sm font-medium flex items-center gap-1"
        style={{ color: 'var(--accent)' }}
      >
        Выбрать из списка <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}