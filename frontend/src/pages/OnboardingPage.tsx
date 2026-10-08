import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, Plus, BellOff, MessageCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { saveMe } from '../api/me';
import { toast } from '../stores/toastStore';
import { HABIT_TEMPLATES, templateHint, templateToHabit } from '../utils/habitTemplates';
import { readableOn } from '../utils/colors';

const MAX_PICK = 3;
const CHECKIN_PRESETS = ['20:00', '21:00', '22:00'] as const;

/**
 * First launch: pick 1–5 ready-made habits, then the evening check-in time, then straight to Today.
 * Goal: first value in < 30 s instead of the 8-decision create form.
 */
export function OnboardingPage() {
  const navigate = useNavStore((s) => s.navigate);
  const back = useNavStore((s) => s.back);
  const canLeave = useNavStore((s) => s.history.length > 0);
  const addHabit = useHabitsStore((s) => s.addHabit);

  const [step, setStep] = useState<1 | 2>(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [checkin, setCheckin] = useState<string | null>('21:00');
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => {
    if (picked.includes(key)) {
      haptic('select');
      setPicked(picked.filter((k) => k !== key));
    } else if (picked.length >= MAX_PICK) {
      haptic('warning');
    } else {
      haptic('select');
      setPicked([...picked, key]);
    }
  };

  const next = () => {
    if (picked.length === 0) return;
    haptic('light');
    setStep(2);
  };

  const finish = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Sequential so the habits keep the order they were picked in.
      const left = [...picked];
      for (const key of picked) {
        const t = HABIT_TEMPLATES.find((x) => x.key === key);
        if (!t) continue;
        const ok = await addHabit(templateToHabit(t));
        if (!ok) {
          // Keep only what wasn't created, so a retry doesn't duplicate habits; the Toaster shows the error.
          setPicked(left);
          haptic('error');
          return;
        }
        left.shift();
      }
      try {
        await saveMe({ checkinTime: checkin, onboarded: true });
      } catch {
        // Habits are created; the check-in time can be set later — say so, but don't block the user here.
        toast('Не удалось сохранить время вечерней отметки — его можно поменять позже', { tone: 'error', ms: 5000 });
      }
      useAuthStore.getState().patchUser({ onboarded: true, checkinTime: checkin });
      haptic('success');
      navigate('hub');
    } finally {
      setSaving(false);
    }
  };

  // Opened from Today (there is a screen to return to) → step 1 gets Back too, no dead end.
  useBackButton(step === 2 ? () => setStep(1) : canLeave ? back : null);
  useMainButton(
    step === 1 ? (picked.length > 0 ? `Дальше (${picked.length})` : null) : 'Начать',
    step === 1 ? next : finish,
    { progress: saving },
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-10 min-h-full flex flex-col">
        <p className="text-sm text-tg-hint mb-1">Шаг {step} из 2</p>

        {step === 1 ? (
          <>
            <h1 className="text-2xl font-semibold text-tg-text">Что хочешь отслеживать?</h1>
            <p className="text-sm text-tg-hint mt-1">Отмечай одним касанием — плитка закрасится. Начни с 1–3</p>
            <p
              className="text-sm mt-1 mb-4 min-h-[20px] transition-opacity"
              style={{ color: 'var(--accent)', opacity: picked.length >= MAX_PICK ? 1 : 0 }}
              aria-live="polite"
            >
              {picked.length >= MAX_PICK ? 'Для начала хватит трёх — остальные добавишь потом' : ''}
            </p>

            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Готовые привычки">
              {HABIT_TEMPLATES.map((t) => {
                const on = picked.includes(t.key);
                const blocked = !on && picked.length >= MAX_PICK;
                return (
                  <motion.button
                    key={t.key}
                    type="button"
                    whileTap={{ scale: 0.95 }}
                    onClick={() => toggle(t.key)}
                    aria-pressed={on}
                    className="relative aspect-square rounded-2xl p-3 flex flex-col justify-between text-left transition-colors duration-200"
                    style={{
                      backgroundColor: on ? t.color : 'var(--tg-theme-section-bg-color)',
                      color: on ? readableOn(t.color) : 'var(--tg-theme-text-color)',
                      boxShadow: on ? undefined : `inset 0 0 0 1.5px ${t.color}55`,
                      opacity: blocked ? 0.45 : 1,
                    }}
                  >
                    <span className="text-2xl leading-none" aria-hidden>
                      {t.icon}
                    </span>
                    <span>
                      <span className="block text-sm font-medium leading-tight">{t.name}</span>
                      <span className="block text-xs mt-0.5" style={{ opacity: on ? 0.9 : 0.6 }}>
                        {templateHint(t)}
                      </span>
                    </span>
                    {on && (
                      <span
                        className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: 'color-mix(in srgb, currentColor 22%, transparent)' }}
                      >
                        <Check size={16} aria-hidden />
                      </span>
                    )}
                  </motion.button>
                );
              })}

              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                onClick={() => navigate('create')}
                className="aspect-square rounded-2xl p-3 flex flex-col justify-between text-left bg-tg-section text-tg-text"
                style={{ boxShadow: 'inset 0 0 0 1.5px var(--tg-theme-hint-color)' }}
              >
                <Plus size={24} className="text-tg-hint" aria-hidden />
                <span className="block text-sm font-medium leading-tight">Своя привычка</span>
              </motion.button>
            </div>

            <div className="flex-1" />
            {/* Visible fallback for the native MainButton (plain browser) */}
            <button
              type="button"
              onClick={next}
              disabled={picked.length === 0}
              className="mt-6 w-full min-h-[48px] rounded-xl text-base font-semibold text-white disabled:opacity-40 active:opacity-80 transition-opacity"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {picked.length > 0 ? `Дальше (${picked.length})` : 'Выбери привычки'}
            </button>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-tg-text">Когда напоминать отметить день?</h1>
            <p className="text-sm text-tg-hint mt-1 mb-5 flex items-start gap-1.5">
              <MessageCircle size={16} className="shrink-0 mt-0.5" aria-hidden />
              Бот пришлёт одно сообщение: отметишь привычки прямо в чате
            </p>

            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Время вечернего напоминания">
              {CHECKIN_PRESETS.map((time) => (
                <CheckinOption key={time} selected={checkin === time} onSelect={() => setCheckin(time)}>
                  <span className="font-display text-xl">{time}</span>
                </CheckinOption>
              ))}
              <CheckinOption selected={checkin === null} onSelect={() => setCheckin(null)}>
                <span className="flex items-center gap-2 text-base">
                  <BellOff size={18} aria-hidden /> Не напоминать
                </span>
              </CheckinOption>
            </div>

            <div className="flex-1" />
            <button
              type="button"
              onClick={finish}
              disabled={saving}
              className="mt-6 w-full min-h-[48px] rounded-xl text-base font-semibold text-white disabled:opacity-60 active:opacity-80 transition-opacity"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {saving ? 'Создаю…' : 'Начать'}
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

function CheckinOption({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => {
        haptic('select');
        onSelect();
      }}
      className="w-full min-h-[56px] px-4 rounded-2xl bg-tg-section text-tg-text flex items-center justify-between transition-shadow"
      style={{ boxShadow: selected ? 'inset 0 0 0 2px var(--accent)' : undefined }}
    >
      {children}
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
        style={
          selected
            ? { backgroundColor: 'var(--accent)', color: '#fff' }
            : { boxShadow: 'inset 0 0 0 1.5px var(--tg-theme-hint-color)' }
        }
      >
        {selected && <Check size={14} aria-hidden />}
      </span>
    </button>
  );
}
