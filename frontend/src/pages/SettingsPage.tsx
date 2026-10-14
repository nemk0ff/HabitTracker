import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { BellOff, Check, Copy, MessageCircle, Share2, Sunrise, UserPlus } from 'lucide-react';
import { fetchInvite } from '../api/me';
import { toast } from '../stores/toastStore';
import type { InviteInfo } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { useCantMessage, WriteAccessWarning } from '../components/WriteAccessWarning';
import { CHECKIN_PRESETS, MORNING_CHECKIN_PRESETS, saveCheckinTime, saveMorningCheckinTime } from '../utils/checkin';

/** User settings: the evening check-in and (with morning habits) the morning one. */
export function SettingsPage() {
  const back = useNavStore((s) => s.back);
  const checkinTime = useAuthStore((s) => s.user?.checkinTime ?? null);
  const morningTime = useAuthStore((s) => s.user?.morningCheckinTime ?? null);
  const cantMessage = useCantMessage();
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

        {cantMessage && <WriteAccessWarning className="mb-6" />}

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

        <InviteSection />
      </div>
    </motion.div>
  );
}

const INVITE_TEXT = 'Веду привычки и питание в этом трекере — присоединяйся';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** «Пригласить друга»: the personal t.me link, Telegram's share sheet and how many joined. */
function InviteSection() {
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchInvite()
      .then((i) => alive && setInvite(i))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const share = async () => {
    if (!invite) return;
    haptic('light');
    const url = `https://t.me/share/url?url=${encodeURIComponent(invite.link)}&text=${encodeURIComponent(INVITE_TEXT)}`;
    const wa = window.Telegram?.WebApp;
    if (wa?.openTelegramLink) {
      try {
        wa.openTelegramLink(url);
        return;
      } catch {
        /* fall back to copying */
      }
    }
    await copy();
  };

  const copy = async () => {
    if (!invite) return;
    if (await copyText(invite.link)) {
      haptic('success');
      toast('Ссылка скопирована — отправь её другу');
    } else {
      toast('Не удалось скопировать — выдели ссылку и скопируй вручную', { tone: 'error' });
    }
  };

  return (
    <section className="mt-8" aria-labelledby="invite-title">
      <h2 id="invite-title" className="text-base font-semibold text-tg-text">
        Пригласить друга
      </h2>
      <p className="text-sm text-tg-hint mt-1 mb-4 flex items-start gap-1.5">
        <UserPlus size={16} className="shrink-0 mt-0.5" aria-hidden />
        Вместе держать привычки проще — отправь ссылку, и друг откроет трекер в один тап
      </p>
      <div className="bg-tg-section rounded-2xl p-4">
        {invite ? (
          <>
            <p className="text-sm text-tg-text break-all select-all font-medium">{invite.link}</p>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => void share()}
                className="flex-1 min-h-[48px] rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 active:opacity-80"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <Share2 size={17} aria-hidden /> Поделиться
              </button>
              <button
                type="button"
                onClick={() => void copy()}
                aria-label="Скопировать ссылку"
                className="w-12 min-h-[48px] rounded-xl bg-tg-secondary text-tg-text flex items-center justify-center active:opacity-70"
              >
                <Copy size={18} aria-hidden />
              </button>
            </div>
            <p className="text-sm text-hint-strong mt-3">
              Пригласил: <span className="font-semibold tabular-nums text-tg-text">{invite.invitedCount}</span>
            </p>
          </>
        ) : failed ? (
          <p className="text-sm text-tg-hint">Не удалось загрузить ссылку — загляни сюда позже</p>
        ) : (
          <div className="h-[104px] rounded-xl bg-tg-secondary animate-pulse" aria-busy="true" aria-label="Загрузка ссылки" />
        )}
      </div>
    </section>
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
