import { useEffect, useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { WheelPicker } from '../WheelPicker';
import { NUTRITION_COLOR } from '../../utils/nutrition';

interface Props {
  open: boolean;
  /** Initial value — last known weight. */
  initialKg: number | null;
  onClose: () => void;
  onSave: (kg: number) => Promise<void> | void;
}

const MIN_KG = 35;
const KG = Array.from({ length: 150 - MIN_KG + 1 }, (_, i) => String(MIN_KG + i));
const HALVES = [',0', ',5'];

/** Whole kilos + half-kilo wheel — matches a mechanical scale with 0.5 kg resolution. */
export function WeightSheet({ open, initialKg, onClose, onSave }: Props) {
  const [kgIdx, setKgIdx] = useState(30);
  const [half, setHalf] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const v = Math.round((initialKg ?? 65) * 2) / 2;
    setKgIdx(Math.max(0, Math.min(KG.length - 1, Math.floor(v) - MIN_KG)));
    setHalf(v % 1 ? 1 : 0);
  }, [open, initialKg]);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(MIN_KG + kgIdx + half * 0.5);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose}>
      <h2 className="text-lg font-bold text-tg-text">Вес сегодня</h2>
      <p className="text-xs text-tg-hint mt-0.5">Лучше утром, до еды. Точность 0,5 кг — тренд всё сгладит</p>
      <div className="flex items-center justify-center gap-1 my-6">
        <div className="w-24">
          <WheelPicker items={KG} value={kgIdx} onChange={setKgIdx} />
        </div>
        <div className="w-16">
          <WheelPicker items={HALVES} value={half} onChange={setHalf} />
        </div>
        <span className="text-lg font-semibold text-tg-hint">кг</span>
      </div>
      <button
        onClick={save}
        disabled={busy}
        className="w-full py-3 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-40"
        style={{ backgroundColor: NUTRITION_COLOR }}
      >
        {busy ? '…' : 'Записать'}
      </button>
    </BottomSheet>
  );
}
