import { useEffect, useState } from 'react';
import { Pause } from 'lucide-react';
import { BottomSheet } from './nutrition/BottomSheet';
import { WheelPicker } from './WheelPicker';
import { haptic } from '../hooks/useTelegramButtons';
import { readableOn } from '../utils/colors';
import { formatDuration, hasTimes, hhmmToMin, minToHHMM, sleepMinutes, suggestSleepTimes, type SleepTimes } from '../utils/habitInsights';
import type { HabitEntry } from '../types';

interface Props {
  /** Date being edited (YYYY-MM-DD, the wake date for sleep) or null when closed. */
  date: string | null;
  title: string;
  /** The habit's entries: the edited night plus history for pre-filling bed / wake. */
  entries: HabitEntry[];
  color: string;
  onClose: () => void;
  /** `times` is set when saved in the «Лёг / Встал» mode; `minutes` is then derived from them. */
  onSave: (minutes: number, times?: SleepTimes) => void;
  /** The day is a pass (ill / vacation). */
  skipped?: boolean;
  /** Pass for the day on / off; the button is shown only when this is set. */
  onSkip?: (skipped: boolean) => void;
}

const HOURS = Array.from({ length: 15 }, (_, i) => String(i));
const MINUTES = ['00', '30'];

/** 15-minute steps; the bed wheel starts in the evening so a usual bedtime is a short scroll. */
const STEP = 15;
const SLOTS = (24 * 60) / STEP;
const BED_START = 18 * 60;
const BED_TIMES = Array.from({ length: SLOTS }, (_, i) => minToHHMM(BED_START + i * STEP));
const WAKE_TIMES = Array.from({ length: SLOTS }, (_, i) => minToHHMM(i * STEP));

const snap = (hhmm: string) => Math.round(hhmmToMin(hhmm) / STEP) % SLOTS;
const bedIndex = (hhmm: string) => (snap(hhmm) - BED_START / STEP + SLOTS) % SLOTS;
const wakeIndex = (hhmm: string) => snap(hhmm);

type Mode = 'times' | 'hours';

/** Sleep input: «Лёг / Встал» (bed → wake wheels, default) or plain hours as a fallback. */
export function HoursSheet({ date, title, entries, color, onClose, onSave, skipped = false, onSkip }: Props) {
  const entry = date ? entries.find((e) => e.date === date) : undefined;
  const minutes = entry?.value ?? 0;
  const [mode, setMode] = useState<Mode>('times');
  const [h, setH] = useState(7);
  const [half, setHalf] = useState(0);
  const [bed, setBed] = useState(0);
  const [wake, setWake] = useState(0);

  // Re-seed only when the sheet opens for a date — not on every store update while it's open.
  useEffect(() => {
    if (date === null) return;
    const m = minutes > 0 ? minutes : 450;
    setH(Math.min(14, Math.floor(m / 60)));
    setHalf(m % 60 >= 15 ? 1 : 0);
    const t = suggestSleepTimes(entries, date, STEP);
    setBed(bedIndex(t.startTime));
    setWake(wakeIndex(t.endTime));
    // A night stored as bare hours opens in the hours mode so its value is what you see.
    setMode(minutes > 0 && !hasTimes(entry) ? 'hours' : 'times');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const bedTime = BED_TIMES[bed]!;
  const wakeTime = WAKE_TIMES[wake]!;
  const timesValid = bedTime !== wakeTime;
  const duration = timesValid ? sleepMinutes(bedTime, wakeTime) : 0;

  const finish = () => {
    haptic('success');
    onClose();
  };
  const saveHours = (value: number) => {
    onSave(value);
    finish();
  };
  const saveTimes = () => {
    onSave(duration, { startTime: bedTime, endTime: wakeTime });
    finish();
  };

  return (
    <BottomSheet open={date !== null} onClose={onClose} label={title}>
      <>
        <h2 className="text-lg font-bold text-tg-text">{title}</h2>
        {date && (
          <p className="text-xs text-tg-hint mt-0.5">
            ночь на {new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
            {skipped && ' · пропуск'}
          </p>
        )}

        <div className="flex gap-1 p-1 mt-4 rounded-xl bg-tg-secondary" role="tablist" aria-label="Способ ввода">
          {(
            [
              ['times', 'Лёг / Встал'],
              ['hours', 'Часы'],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                if (mode !== m) haptic('select');
                setMode(m);
              }}
              className="flex-1 min-h-[40px] rounded-lg text-sm font-medium transition-colors"
              style={
                mode === m
                  ? { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
                  : { color: 'var(--tg-theme-hint-color)' }
              }
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'times' ? (
          <>
            <div className="flex items-start justify-center gap-4 mt-5">
              <div className="w-28">
                <div className="text-xs text-tg-hint text-center mb-1">Лёг</div>
                <WheelPicker items={BED_TIMES} value={bed} onChange={setBed} label="Лёг" />
              </div>
              <div className="w-28">
                <div className="text-xs text-tg-hint text-center mb-1">Встал</div>
                <WheelPicker items={WAKE_TIMES} value={wake} onChange={setWake} label="Встал" />
              </div>
            </div>
            <p className="text-center text-base font-semibold text-tg-text tabular-nums mt-3 mb-5" aria-live="polite">
              {timesValid ? `Сон: ${formatDuration(duration)}` : 'Время отбоя и подъёма совпадает'}
            </p>
            <button
              onClick={saveTimes}
              disabled={!timesValid}
              className="w-full py-3 rounded-xl font-semibold text-sm active:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: color, color: readableOn(color) }}
            >
              Сохранить
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-center gap-1 my-6">
              <div className="w-24">
                <WheelPicker items={HOURS} value={h} onChange={setH} label="Часы" />
              </div>
              <span className="text-lg font-semibold text-tg-hint" aria-hidden="true">ч</span>
              <div className="w-24">
                <WheelPicker items={MINUTES} value={half} onChange={setHalf} label="Минуты" />
              </div>
              <span className="text-lg font-semibold text-tg-hint" aria-hidden="true">мин</span>
            </div>
            <button
              onClick={() => saveHours(h * 60 + half * 30)}
              disabled={h === 0 && half === 0}
              className="w-full py-3 rounded-xl font-semibold text-sm active:opacity-80 disabled:opacity-40"
              style={{ backgroundColor: color, color: readableOn(color) }}
            >
              Сохранить
            </button>
          </>
        )}

        {minutes > 0 && (
          <button onClick={() => saveHours(0)} className="w-full mt-2 py-3 rounded-xl text-sm font-medium text-tg-destructive active:opacity-70">
            Удалить запись
          </button>
        )}
        {onSkip && (
          // A pass (ill / vacation): not done, but the streak survives.
          <button
            onClick={() => {
              onSkip(!skipped);
              onClose();
            }}
            aria-pressed={skipped}
            className="w-full mt-2 min-h-[48px] rounded-xl text-base font-medium flex items-center justify-center gap-2 active:opacity-70"
            style={
              skipped
                ? { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
                : { color: 'var(--tg-theme-hint-color)' }
            }
          >
            <Pause size={18} aria-hidden />
            {skipped ? 'Убрать пропуск' : 'Пропуск (болею / отпуск)'}
          </button>
        )}
      </>
    </BottomSheet>
  );
}
