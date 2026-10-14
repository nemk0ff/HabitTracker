import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { BellOff, Check, MessageCircle, Sunrise } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { loadAppearance, setAppearance, type Appearance } from '../utils/appearance';
import { CHECKIN_PRESETS, MORNING_CHECKIN_PRESETS, saveCheckinTime, saveMorningCheckinTime } from '../utils/checkin';

/** User settings: the evening check-in and (with morning habits) the morning one. */
export function SettingsPage() {
  const back = useNavStore((s) => s.back);
  const checkinTime = useAuthStore((s) => s.user?.checkinTime ?? null);
  const morningTime = useAuthStore((s) => s.user?.morningCheckinTime ?? null);
  const hasMorningHabits = useHabitsStore((s) => s.habits.some((h) => !h.archived && h.timeOfDay === 'morning'));

  useBackButton(back);
  useMainButton(null, () => {});

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

        <AppearanceSection />

        <div className="mt-8" />

        <TimeSection
          title="Вечерняя сводка в боте"
          hint="Бот пришлёт одно сообщение — отметишь привычки прямо в чате, не открывая приложение"
          icon={<MessageCircle size={16} className="shrink-0 mt-0.5" aria-hidden />}
          presets={CHECKIN_PRESETS}
          value={checkinTime}
          save={saveCheckinTime}
        />

        {/* Second message only makes sense when there's something to do in the morning. */}
        {(hasMorningHabits || morningTime !== null) && (
          <div className="mt-8">
            <TimeSection
              title="Утренняя сводка"
              hint="Только утренние привычки; вечером их уже не будет"
              icon={<Sunrise size={16} className="shrink-0 mt-0.5" aria-hidden />}
              presets={MORNING_CHECKIN_PRESETS}
              value={morningTime}
              save={saveMorningCheckinTime}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** №23 «Вид»: theme and font size, stored on this device. */
function AppearanceSection() {
  const [a, setA] = useState<Appearance>(loadAppearance);
  const change = (next: Appearance) => {
    haptic('select');
    setA(next);
    setAppearance(next);
  };

  return (
    <section>
      <h2 className="text-base font-semibold text-tg-text mb-3">Вид</h2>
      <Segmented
        label="Тема"
        value={a.theme}
        options={[
          ['telegram', 'Как в Telegram'],
          ['dark', 'Тёмная'],
        ]}
        onChange={(theme) => change({ ...a, theme })}
      />
      <div className="mt-3" />
      <Segmented
        label="Шрифт"
        value={a.font}
        options={[
          ['normal', 'Обычный'],
          ['large', 'Крупный'],
        ]}
        onChange={(font) => change({ ...a, font })}
      />
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="text-sm text-tg-hint mb-1.5 px-1">{label}</div>
      <div className="flex gap-1 p-1 rounded-2xl bg-tg-section" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => value !== v && onChange(v)}
            className="flex-1 min-h-[44px] rounded-xl text-sm font-medium transition-colors"
            style={
              value === v
                ? { backgroundColor: 'var(--accent)', color: '#fff' }
                : { color: 'var(--tg-theme-text-color)' }
            }
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeSection({
  title,
  hint,
  icon,
  presets,
  value,
  save,
}: {
  title: string;
  hint: string;
  icon: ReactNode;
  presets: readonly string[];
  value: string | null;
  save: (time: string | null) => Promise<boolean>;
}) {
  // undefined = idle; otherwise the option being saved (null = «Выключить»).
  const [saving, setSaving] = useState<string | null | undefined>(undefined);

  // A non-preset time (set elsewhere) is still shown as an option so it stays selectable.
  const options: string[] = [...presets];
  if (value && !options.includes(value)) options.push(value);
  options.sort();

  const select = async (time: string | null) => {
    if (saving !== undefined || time === value) return;
    haptic('select');
    setSaving(time);
    await save(time);
    setSaving(undefined);
  };

  return (
    <section>
      <h2 className="text-base font-semibold text-tg-text">{title}</h2>
      <p className="text-sm text-tg-hint mt-1 mb-4 flex items-start gap-1.5">
        {icon}
        {hint}
      </p>

      <div className="flex flex-col gap-2" role="radiogroup" aria-label={title}>
        {options.map((time) => (
          <Option key={time} selected={value === time} busy={saving === time} onSelect={() => select(time)}>
            <span className="text-lg font-medium tabular-nums">{time}</span>
          </Option>
        ))}
        <Option selected={value === null} busy={saving === null} onSelect={() => select(null)}>
          <span className="flex items-center gap-2 text-base">
            <BellOff size={18} aria-hidden /> Выключить
          </span>
        </Option>
      </div>
    </section>
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
