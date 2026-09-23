import type { Insight } from '../../types';

const ICON: Record<Insight['level'], string> = { good: '✅', info: '💡', warn: '⚠️' };

/** Model insights (sleep, training, pace) — explanations, not part of the kcal formula. */
export function InsightsCard({ insights }: { insights: Insight[] }) {
  return (
    <div className="bg-tg-section rounded-2xl px-4 py-3 mt-3 flex flex-col gap-2">
      {insights.map((i) => (
        <div key={i.text} className="flex gap-2 text-sm text-tg-text leading-snug">
          <span className="shrink-0">{ICON[i.level]}</span>
          <span>{i.text}</span>
        </div>
      ))}
    </div>
  );
}
