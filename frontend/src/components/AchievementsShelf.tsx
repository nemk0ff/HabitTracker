import { useEffect, useMemo } from 'react';
import { ACHIEVEMENTS, computeEarned, rememberedEarned, unlockNew } from '../utils/achievements';
import { toast } from '../stores/toastStore';
import { haptic } from '../hooks/useTelegramButtons';
import type { Habit } from '../types';

/**
 * «Достижения» on Progress: earned badges in colour, locked ones greyed out; a tap tells what the
 * badge is for. On mount, progress earned elsewhere (bot check-ins, old data) is recorded silently.
 */
export function AchievementsShelf({ habits, today }: { habits: Habit[]; today: string }) {
  const computed = useMemo(() => computeEarned(habits, today), [habits, today]);

  useEffect(() => {
    // Same set before and after → nothing toasts, new keys are just remembered and reported.
    unlockNew(computed, computed);
  }, [computed]);

  // Remembered keys keep a badge after the data that earned it changed.
  const earned = useMemo(() => new Set([...rememberedEarned(), ...computed]), [computed]);

  const count = ACHIEVEMENTS.filter((a) => earned.has(a.key)).length;

  return (
    <section className="mt-6" aria-labelledby="achievements-title">
      <div className="flex items-baseline justify-between mb-2">
        <h2 id="achievements-title" className="text-base font-semibold text-tg-text">
          Достижения
        </h2>
        <span className="text-sm tabular-nums text-hint-strong">
          {count} из {ACHIEVEMENTS.length}
        </span>
      </div>
      <ul className="grid grid-cols-4 gap-2">
        {ACHIEVEMENTS.map((a) => {
          const on = earned.has(a.key);
          return (
            <li key={a.key}>
              <button
                type="button"
                onClick={() => {
                  haptic('select');
                  toast(on ? `${a.icon} ${a.title} — получено` : `🔒 ${a.title}: ${a.hint.toLowerCase()}`, { ms: 3500 });
                }}
                aria-label={`${a.title}: ${on ? 'получено' : `ещё не получено. ${a.hint}`}`}
                className="w-full min-h-[96px] rounded-2xl bg-tg-section px-1.5 py-2.5 flex flex-col items-center justify-start gap-1.5 text-center active:opacity-70 transition-opacity"
                style={on ? { boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 45%, transparent)' } : undefined}
              >
                <span
                  className="w-11 h-11 rounded-full flex items-center justify-center text-2xl"
                  style={
                    on
                      ? { backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)' }
                      : { backgroundColor: 'var(--empty-cell)', filter: 'grayscale(1)', opacity: 0.45 }
                  }
                  aria-hidden
                >
                  {a.icon}
                </span>
                <span className={`text-[11px] leading-tight font-medium ${on ? 'text-tg-text' : 'text-tg-hint'}`}>{a.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
