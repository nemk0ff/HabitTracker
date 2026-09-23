import { useEffect, useState } from 'react';
import { BottomSheet } from './nutrition/BottomSheet';
import { WheelPicker } from './WheelPicker';
import { haptic } from '../hooks/useTelegramButtons';

interface Props {
  /** Date being edited (YYYY-MM-DD) or null when closed. */
  date: string | null;
  title: string;
  /** Current value in minutes (0 = none). */
  minutes: number;
  color: string;
  onClose: () => void;
  onSave: (minutes: number) => void;
}

const HOURS = Array.from({ length: 15 }, (_, i) => String(i));
const MINUTES = ['00', '30'];

/** Hours + half-hours picker for hours habits (sleep). */
export function HoursSheet({ date, title, minutes, color, onClose, onSave }: Props) {
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
    <BottomSheet open={date !== null} onClose={onClose}>
      <>
        <h2 className="text-lg font-bold text-tg-text">{title}</h2>
        {date && <p className="text-xs text-tg-hint mt-0.5">{new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</p>}

        <div className="flex items-center justify-center gap-1 my-6">
          <div className="w-24">
            <WheelPicker items={HOURS} value={h} onChange={setH} />
          </div>
          <span className="text-lg font-semibold text-tg-hint">ч</span>
          <div className="w-24">
            <WheelPicker items={MINUTES} value={half} onChange={setHalf} />
          </div>
          <span className="text-lg font-semibold text-tg-hint">мин</span>
        </div>

        <button
          onClick={() => save(h * 60 + half * 30)}
          disabled={h === 0 && half === 0}
          className="w-full py-3 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-40"
          style={{ backgroundColor: color }}
        >
          Сохранить
        </button>
        {minutes > 0 && (
          <button onClick={() => save(0)} className="w-full mt-2 py-3 rounded-xl text-sm font-medium text-tg-destructive active:opacity-70">
            Удалить запись
          </button>
        )}
      </>
    </BottomSheet>
  );
}
