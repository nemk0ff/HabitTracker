import { useEffect, useRef, useState } from 'react';
import { getTextLog, startTextLog, undoTextLog, type TextLogJob } from '../../api/nutrition';
import { useNutritionStore } from '../../stores/nutritionStore';
import { haptic } from '../../hooks/useTelegramButtons';
import { NUTRITION_COLOR, fmt, mealLabel } from '../../utils/nutrition';
import type { Meal } from '../../types';

interface Props {
  date: string;
  meal: Meal;
  onDone: () => void;
}

const POLL_MS = 3000;
const MAX_WAIT_MS = 12 * 60_000; // server-side agent timeout is 10 min

/**
 * "Добавить текстом" via the developer's Hermes agent: the server runs it as a
 * background job (minutes), this panel polls it. Results are written right away;
 * "Отменить" removes the entries and any products the agent created.
 */
export function AgentLogPanel({ date, meal, onDone }: Props) {
  const loadDay = useNutritionStore((s) => s.loadDay);
  const [text, setText] = useState('');
  const [job, setJob] = useState<TextLogJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const poll = (id: string, startedAt: number) => {
    pollRef.current = setTimeout(async () => {
      try {
        const j = await getTextLog(id);
        setJob(j);
        if (j.status === 'running') {
          if (Date.now() - startedAt < MAX_WAIT_MS) poll(id, startedAt);
          else setError('Агент слишком долго думает — проверь дневник позже');
          return;
        }
        if (j.status === 'done') {
          haptic('success');
          loadDay(date);
        } else {
          haptic('error');
        }
      } catch (e: any) {
        setError(e.message || 'Связь с сервером потеряна');
      }
    }, POLL_MS);
  };

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setError(null);
    setUndone(false);
    try {
      const j = await startTextLog(t, date, meal);
      setJob(j);
      poll(j.id, Date.now());
    } catch (e: any) {
      setError(e.message || 'Не удалось отправить');
    }
  };

  const undo = async () => {
    if (!job) return;
    try {
      await undoTextLog(job.id);
      setUndone(true);
      haptic('medium');
      loadDay(date);
    } catch (e: any) {
      setError(e.message || 'Не удалось отменить');
    }
  };

  const running = job?.status === 'running' && !error;
  const result = job?.status === 'done' ? job.result : null;

  return (
    <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={running}
        placeholder="Что съел, где и сколько. Например: «удон с курицей из Лавки и 2 мандарина» или «бургер в Вкусно и точка, картошка фри большая»"
        rows={4}
        className="w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text text-base outline-none resize-none placeholder:text-tg-hint disabled:opacity-60"
      />
      <button
        onClick={submit}
        disabled={!text.trim() || running}
        className="w-full mt-2 py-3 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-40"
        style={{ backgroundColor: NUTRITION_COLOR }}
      >
        {running ? 'Агент ищет КБЖУ…' : `Записать в ${mealLabel(meal).toLowerCase()}`}
      </button>

      {running && (
        <p className="text-xs text-tg-hint text-center mt-3">
          Обычно 2–5 минут. Экран можно закрыть — еда запишется сама
        </p>
      )}

      {(error || job?.status === 'error') && (
        <div className="mt-3 rounded-xl bg-tg-section px-4 py-3 text-sm text-tg-destructive">{error ?? job?.error}</div>
      )}

      {result && (
        <div className="mt-4 bg-tg-section rounded-2xl p-4">
          <div className="text-sm font-semibold text-tg-text mb-2">
            {undone ? '↩️ Отменено' : `✅ Записано в ${mealLabel(result.meal).toLowerCase()}`}
          </div>
          <div className={`flex flex-col gap-2 ${undone ? 'opacity-40 line-through' : ''}`}>
            {result.items.map((i) => (
              <div key={i.entryId} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-tg-text">
                    {i.name}
                    <span
                      className="ml-1.5 text-xs font-semibold px-1.5 py-0.5 rounded-full align-middle"
                      style={
                        i.status === 'new'
                          ? { backgroundColor: `${NUTRITION_COLOR}22`, color: NUTRITION_COLOR }
                          : { backgroundColor: 'rgba(76,175,80,0.15)', color: '#4CAF50' }
                      }
                    >
                      {i.status === 'new' ? 'новый в базе' : 'из базы'}
                    </span>
                  </div>
                  <div className="text-xs text-tg-hint">
                    {i.brand ? `${i.brand} · ` : ''}
                    {fmt(i.grams)} г · Б {fmt(i.protein, 1)} · Ж {fmt(i.fat, 1)} · У {fmt(i.carbs, 1)}
                  </div>
                </div>
                <span className="text-sm font-medium text-tg-text shrink-0">{fmt(i.kcal)}</span>
              </div>
            ))}
          </div>
          <div className="text-xs text-tg-hint mt-3">
            Итого {fmt(result.totals.kcal)} ккал · Б {fmt(result.totals.protein)} · Ж {fmt(result.totals.fat)} · У{' '}
            {fmt(result.totals.carbs)}
          </div>
          {result.skipped.map((s) => (
            <div key={s} className="text-xs text-tg-destructive mt-1">
              ⚠️ {s}
            </div>
          ))}

          {!undone && (
            <div className="flex gap-2 mt-4">
              <button
                onClick={undo}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-tg-secondary text-tg-text active:opacity-70"
              >
                ↩️ Отменить
              </button>
              <button
                onClick={onDone}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white active:opacity-80"
                style={{ backgroundColor: NUTRITION_COLOR }}
              >
                Готово
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
