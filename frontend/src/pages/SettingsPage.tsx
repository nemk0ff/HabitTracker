import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { BellOff, Check, MessageCircle, Sunrise } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { loadAppearance, setAppearance, type Appearance } from '../utils/appearance';
import {
  CHECKIN_PRESETS,
  DEFAULT_MORNING_TIME,
  MORNING_CHECKIN_PRESETS,
  MORNING_OFF,
  saveCheckinTime,
  saveMorningCheckinTime,
} from '../utils/checkin';

/** User settings: the evening check-in and (with morning habits) the morning one. */
export function SettingsPage() {
  const back = useNavStore((s) => s.back);
  const checkinTime = useAuthStore((s) => s.user?.checkinTime ?? null);
  const morningTime = useAuthStore((s) => s.user?.morningCheckinTime ?? null);
  const hasMorningHabits = useHabitsStore((s) => s.habits.some((h) => !h.archived && h.timeOfDay === 'morning'));
  // Sleep (an hours habit) is asked in the morning too: «Во сколько лёг и встал?».
  const hasSleep = useHabitsStore((s) => s.habits.some((h) => !h.archived && h.measure === 'hours'));

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

        {/* The morning briefing is on by default (null = 09:00); «Выключить» stores 'off'. */}
        <div className="mt-8">
          <TimeSection
            title="Утренняя сводка"
            hint={
              hasSleep
                ? 'Итоги вчера и план на сегодня; спросит, во сколько лёг и встал (кнопки по твоему обычному режиму), и вес' +
                  (hasMorningHabits ? '; плюс утренние привычки — вечером их уже не будет' : '')
                : hasMorningHabits
                  ? 'Итоги вчера и план на сегодня; плюс утренние привычки — вечером их уже не будет'
                  : 'Итоги вчера и план на сегодня'
            }
            icon={<Sunrise size={16} className="shrink-0 mt-0.5" aria-hidden />}
            presets={MORNING_CHECKIN_PRESETS}
            value={morningTime}
            save={saveMorningCheckinTime}
            offValue={MORNING_OFF}
            defaultTime={DEFAULT_MORNING_TIME}
          />
        </div>
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
  offValue = null,
  defaultTime,
}: {
  title: string;
  hint: string;
  icon: ReactNode;
  presets: readonly string[];
  value: string | null;
  save: (time: string | null) => Promise<boolean>;
  /** Stored value meaning «off» (null for the evening check-in, 'off' for the morning one). */
  offValue?: string | null;
  /** Time a null value means (shown as «HH:MM (по умолчанию)»); unset = null is off. */
  defaultTime?: string;
}) {
  // undefined = idle; otherwise the option being saved (offValue = «Выключить»).
  const [saving, setSaving] = useState<string | null | undefined>(undefined);
  const isOff = value === offValue;
  // The time actually in effect (null with a default → the default).
  const effective = isOff ? null : (value ?? defaultTime ?? null);
  const isDefault = value === null && !!defaultTime;

  // A non-preset time (set elsewhere) is still shown as an option so it stays selectable.
  const options: string[] = [...presets];
  if (effective && !options.includes(effective)) options.push(effective);
  options.sort();

  const select = async (time: string | null) => {
    if (saving !== undefined || time === value || (time !== offValue && time === effective)) return;
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
          <Option key={time} selected={effective === time} busy={saving === time} onSelect={() => select(time)}>
            <span className="text-lg font-medium tabular-nums">
              {time}
              {isDefault && time === defaultTime && <span className="text-sm font-normal text-tg-hint"> (по умолчанию)</span>}
            </span>
          </Option>
        ))}
        <Option selected={isOff} busy={saving === offValue} onSelect={() => select(offValue)}>
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
