import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { BellOff, Check, MessageCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useNavStore } from '../stores/navStore';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { CHECKIN_PRESETS, saveCheckinTime } from '../utils/checkin';

/** User settings: for now only the evening check-in message in the bot. */
export function SettingsPage() {
  const back = useNavStore((s) => s.back);
  const checkinTime = useAuthStore((s) => s.user?.checkinTime ?? null);
  const [saving, setSaving] = useState<string | null | undefined>(undefined);

  useBackButton(back);
  useMainButton(null, () => {});

  // A non-preset time (set elsewhere) is still shown as an option so it stays selectable.
  const options: string[] = [...CHECKIN_PRESETS];
  if (checkinTime && !options.includes(checkinTime)) options.push(checkinTime);
  options.sort();

  const select = async (time: string | null) => {
    if (saving !== undefined || time === checkinTime) return;
    haptic('select');
    setSaving(time);
    await saveCheckinTime(time);
    setSaving(undefined);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-10">
        <h1 className="text-xl font-semibold text-tg-text mb-5">Настройки</h1>

        <h2 className="text-base font-semibold text-tg-text">Вечерняя сводка в боте</h2>
        <p className="text-sm text-tg-hint mt-1 mb-4 flex items-start gap-1.5">
          <MessageCircle size={16} className="shrink-0 mt-0.5" aria-hidden />
          Бот пришлёт одно сообщение — отметишь привычки прямо в чате, не открывая приложение
        </p>

        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Время вечерней сводки">
          {options.map((time) => (
            <Option key={time} selected={checkinTime === time} busy={saving === time} onSelect={() => select(time)}>
              <span className="text-lg font-medium tabular-nums">{time}</span>
            </Option>
          ))}
          <Option selected={checkinTime === null} busy={saving === null} onSelect={() => select(null)}>
            <span className="flex items-center gap-2 text-base">
              <BellOff size={18} aria-hidden /> Выключить
            </span>
          </Option>
        </div>
      </div>
    </motion.div>
  );
}

function Option({
  selected,
  busy,
  onSelect,
  children,
}: {
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-busy={busy}
      onClick={onSelect}
      className="w-full min-h-[56px] px-4 rounded-2xl bg-tg-section text-tg-text flex items-center justify-between transition-shadow active:opacity-80"
      style={{ boxShadow: selected ? 'inset 0 0 0 2px var(--accent)' : undefined, opacity: busy ? 0.6 : 1 }}
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
