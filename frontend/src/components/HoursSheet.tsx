import { useEffect, useState } from 'react';
import { Pause } from 'lucide-react';
import { BottomSheet } from './nutrition/BottomSheet';
import { WheelPicker } from './WheelPicker';
import { haptic } from '../hooks/useTelegramButtons';
import { readableOn } from '../utils/colors';

interface Props {
  /** Date being edited (YYYY-MM-DD) or null when closed. */
  date: string | null;
  title: string;
  /** Current value in minutes (0 = none). */
  minutes: number;
  color: string;
  onClose: () => void;
  onSave: (minutes: number) => void;
  /** The day is a pass (ill / vacation). */
  skipped?: boolean;
  /** Pass for the day on / off; the button is shown only when this is set. */
  onSkip?: (skipped: boolean) => void;
}

const HOURS = Array.from({ length: 15 }, (_, i) => String(i));
const MINUTES = ['00', '30'];

/** Hours + half-hours picker for hours habits (sleep). */
export function HoursSheet({ date, title, minutes, color, onClose, onSave, skipped = false, onSkip }: Props) {
  const [h, setH] = useState(7);
  const [half, setHalf] = useState(0);

  useEffect(() => {
    if (date === null) return;
    const m = minutes > 0 ? minutes : 450;
    setH(Math.min(14, Math.floor(m / 60)));
    setHalf(m % 60 >= 15 ? 1 : 0);
  }, [date, minutes]);

  const save = (value: number) => {
    onSave(value);
    haptic('success');
    onClose();
  };

  return (
    <BottomSheet open={date !== null} onClose={onClose} label={title}>
      <>
        <h2 className="text-lg font-bold text-tg-text">{title}</h2>
        {date && (
          <p className="text-xs text-tg-hint mt-0.5">
            {new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
            {skipped && ' · пропуск'}
          </p>
        )}

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
          onClick={() => save(h * 60 + half * 30)}
          disabled={h === 0 && half === 0}
          className="w-full py-3 rounded-xl font-semibold text-sm active:opacity-80 disabled:opacity-40"
          style={{ backgroundColor: color, color: readableOn(color) }}
        >
          Сохранить
        </button>
        {minutes > 0 && (
          <button onClick={() => save(0)} className="w-full mt-2 py-3 rounded-xl text-sm font-medium text-tg-destructive active:opacity-70">
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
