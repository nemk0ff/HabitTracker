import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { Insight } from '../../types';

const ICON = { good: CheckCircle2, info: Info, warn: AlertTriangle } as const;
const COLOR: Record<Insight['level'], string> = {
  good: 'var(--accent)',
  info: 'var(--tg-theme-hint-color)',
  warn: 'var(--over)',
};
const PRIORITY: Record<Insight['level'], number> = { warn: 0, good: 1, info: 2 };

/**
 * Model insights (sleep, training, pace) — explanations, not part of the kcal formula.
 * Only the most important one is shown; the rest open on tap so the diary stays in view.
 */
export function InsightsCard({ insights }: { insights: Insight[] }) {
  const [open, setOpen] = useState(false);
  const sorted = [...insights].sort((a, b) => PRIORITY[a.level] - PRIORITY[b.level]);
  const shown = open ? sorted : sorted.slice(0, 1);
  const rest = sorted.length - 1;

  return (
    <div className="bg-tg-section rounded-2xl px-4 py-3 mt-3 flex flex-col gap-2">
      {shown.map((i) => {
        const Icon = ICON[i.level];
        return (
          <div key={i.text} className="flex gap-2 text-sm text-tg-text leading-snug">
            <Icon size={18} className="shrink-0 mt-px" style={{ color: COLOR[i.level] }} aria-hidden />
            <span>{i.text}</span>
          </div>
        );
      })}
      {rest > 0 && (
        <button onClick={() => setOpen((o) => !o)} className="self-start text-sm text-tg-hint min-h-[32px]">
          {open ? 'Свернуть' : `Ещё ${rest}`}
        </button>
      )}
    </div>
  );
}
