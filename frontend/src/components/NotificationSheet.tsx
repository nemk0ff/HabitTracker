import { useState, useEffect, useMemo, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WheelPicker } from './WheelPicker';
import { BottomSheet } from './nutrition/BottomSheet';
import { readableOn, legibleColor, useIsDark } from '../utils/colors';
import type { Reminder, DayOfWeek } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  reminder: Reminder | null;
  onSave: (data: { enabled: boolean; days: DayOfWeek[]; time: string; snooze: boolean }) => void;
  color: string;
}

const ALL_DAYS: { key: DayOfWeek; short: string; label: string }[] = [
  { key: 'mon', short: 'Пн', label: 'Понедельник' },
  { key: 'tue', short: 'Вт', label: 'Вторник' },
  { key: 'wed', short: 'Ср', label: 'Среда' },
  { key: 'thu', short: 'Чт', label: 'Четверг' },
  { key: 'fri', short: 'Пт', label: 'Пятница' },
  { key: 'sat', short: 'Сб', label: 'Суббота' },
  { key: 'sun', short: 'Вс', label: 'Воскресенье' },
];

const WEEKDAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKENDS: DayOfWeek[] = ['sat', 'sun'];
const EVERY_DAY: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function localTimeToUTC(localTime: string): string {
  const parts = localTime.split(':').map(Number);
  const totalMin = (parts[0] ?? 0) * 60 + (parts[1] ?? 0) + new Date().getTimezoneOffset();
  const normalized = ((totalMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function utcTimeToLocal(utcTime: string): string {
  const parts = utcTime.split(':').map(Number);
  const totalMin = (parts[0] ?? 0) * 60 + (parts[1] ?? 0) - new Date().getTimezoneOffset();
  const normalized = ((totalMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function getDaysLabel(days: DayOfWeek[]): string {
  if (days.length === 0) return 'Никогда';
  if (days.length === 7) return 'Каждый день';

  const isWeekdays = WEEKDAYS.every((d) => days.includes(d)) && days.length === 5;
  if (isWeekdays) return 'Будни';

  const isWeekends = WEEKENDS.every((d) => days.includes(d)) && days.length === 2;
  if (isWeekends) return 'Выходные';

  const sorted = ALL_DAYS.filter((d) => days.includes(d.key));
  if (sorted.length === 1) return `Каждый ${sorted[0]!.label.toLowerCase().slice(0, -1)}`;
  const names = sorted.map((d) => d.short);
  return names.slice(0, -1).join(', ') + ' и ' + names[names.length - 1];
}

export function NotificationSheet({ open, onClose, reminder, onSave, color }: Props) {
  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState<DayOfWeek[]>(EVERY_DAY);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [snooze, setSnooze] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);

  useEffect(() => {
    if (reminder) {
      setEnabled(reminder.enabled);
      setDays(reminder.days);
      const localTime = utcTimeToLocal(reminder.time);
      const parts = localTime.split(':').map(Number);
      setHour(parts[0] ?? 9);
      setMinute(parts[1] ?? 0);
      setSnooze(reminder.snooze);
    } else {
      setEnabled(true);
      setDays([...EVERY_DAY]);
      setHour(9);
      setMinute(0);
      setSnooze(false);
    }
    setShowDayPicker(false);
  }, [reminder, open]);

  const daysLabel = useMemo(() => getDaysLabel(days), [days]);
  const isDark = useIsDark();
  const textColor = legibleColor(color, isDark);
  const titleId = useId();
  const snoozeId = useId();
  const snoozeHintId = useId();

  const toggleDay = (day: DayOfWeek) => {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const handleSave = () => {
    const localTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const utcTime = localTimeToUTC(localTime);
    onSave({ enabled, days, time: utcTime, snooze });
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} label="Уведомления" maxHeightClass="max-h-[85vh]">
      {/* Title + Toggle */}
      <div className="flex items-center justify-between mb-6">
        <h2 id={titleId} className="text-lg font-bold text-tg-text">Уведомления</h2>
        <Switch checked={enabled} onChange={setEnabled} color={color} labelledBy={titleId} />
      </div>

      <div
        className={`transition-opacity duration-200 ${enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}
        aria-disabled={!enabled}
        inert={!enabled}
      >
        {/* Time Picker (iOS-style wheels) */}
        <div className="flex items-center justify-center gap-1 mb-6">
          <div className="w-24">
            <WheelPicker items={HOURS} value={hour} onChange={setHour} label="Часы" />
          </div>
          <span className="text-2xl font-bold text-tg-text" aria-hidden="true">:</span>
          <div className="w-24">
            <WheelPicker items={MINUTES} value={minute} onChange={setMinute} label="Минуты" />
          </div>
        </div>

        {/* Repeat selector */}
        <button
          onClick={() => setShowDayPicker(!showDayPicker)}
          aria-expanded={showDayPicker}
          className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-tg-secondary mb-2"
        >
          <span className="text-sm font-medium text-tg-text">Повтор</span>
          <div className="flex items-center gap-1.5">
            <span className="text-sm" style={{ color: textColor }}>{daysLabel}</span>
            <svg
              width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
              className={`transition-transform duration-200 ${showDayPicker ? 'rotate-90' : ''}`}
            >
              <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-tg-hint" />
            </svg>
          </div>
        </button>

        {/* Days grid */}
        <AnimatePresence>
          {showDayPicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-2 pb-4 flex flex-col gap-1">
                {ALL_DAYS.map((d) => {
                  const active = days.includes(d.key);
                  return (
                    <button
                      key={d.key}
                      aria-pressed={active}
                      onClick={() => {
                        toggleDay(d.key);
                        window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
                      }}
                      className="flex items-center justify-between px-4 py-3 min-h-[44px] rounded-xl transition-colors"
                      style={{
                        backgroundColor: active ? `${color}18` : 'transparent',
                      }}
                    >
                      <span className="text-sm text-tg-text">{`Каждый ${d.label.toLowerCase()}`}</span>
                      {active && (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill={textColor} aria-hidden="true">
                          <path d="M13.3 4.3L6.5 11.1L2.7 7.3L3.7 6.3L6.5 9.1L12.3 3.3L13.3 4.3Z" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Snooze toggle */}
        <div className="flex items-center justify-between pl-4 pr-2 py-1.5 rounded-xl bg-tg-secondary mt-2 mb-6">
          <div>
            <span id={snoozeId} className="text-sm font-medium text-tg-text">Повторение сигнала</span>
            <p id={snoozeHintId} className="text-xs text-hint-strong mt-0.5">Каждые 5 мин, пока не отметишь</p>
          </div>
          <Switch checked={snooze} onChange={setSnooze} color={color} labelledBy={snoozeId} describedBy={snoozeHintId} />
        </div>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        className="w-full py-3 rounded-xl font-semibold text-sm active:opacity-80 transition-opacity"
        style={{ backgroundColor: color, color: readableOn(color) }}
      >
        Сохранить
      </button>
    </BottomSheet>
  );
}

/** iOS-style switch: role="switch", 44px hit area, off track ≥3:1 (`--switch-off`). */
function Switch({
  checked,
  onChange,
  color,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  color: string;
  labelledBy: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={() => {
        onChange(!checked);
        window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
      }}
      className="shrink-0 h-11 w-14 flex items-center justify-center rounded-full focus-ring"
    >
      <span
        className="relative block w-12 h-7 rounded-full transition-colors duration-200"
        style={{ backgroundColor: checked ? color : 'var(--switch-off)' }}
      >
        <span
          className="absolute top-0.5 left-0 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }}
        />
      </span>
    </button>
  );
}
