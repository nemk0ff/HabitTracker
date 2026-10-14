import { useEffect, useRef, useState } from 'react';
import { getTextLog, startTextLog, undoTextLog, type TextLogHabit, type TextLogJob, type TextLogResult } from '../../api/nutrition';
import { useNutritionStore } from '../../stores/nutritionStore';
import { useHabitsStore } from '../../stores/habitsStore';
import { haptic } from '../../hooks/useTelegramButtons';
import { NUTRITION_COLOR, fmt, mealLabel } from '../../utils/nutrition';
import type { Meal } from '../../types';

interface Props {
  date: string;
  meal: Meal;
  onDone: () => void;
}

const POLL_MS = 3000;
const FIRST_POLL_MS = 600; // offline-parsed messages («вес 70,5») finish at once
const MAX_WAIT_MS = 12 * 60_000; // server-side agent timeout is 10 min

const hours = (minutes: number) => fmt(minutes / 60, 1);

function habitLine(h: TextLogHabit): string {
  const name = `${h.icon ? `${h.icon} ` : ''}${h.name}`;
  if (h.action === 'skip') return `⏭ ${name} — пропуск`;
  if (h.action === 'undone') return `◻️ ${name} — отметка снята`;
  const value = h.value === null ? '' : h.measure === 'hours' ? ` — ${hours(h.value)} ч` : ` — ${h.value}`;
  return `✅ ${name}${value}`;
}

/** Weight / sleep / habits lines of the result. */
function otherLines(r: TextLogResult): string[] {
  const lines: string[] = [];
  if (r.weight) lines.push(`⚖️ ${fmt(r.weight.kg, 1)} кг`);
  if (r.sleep) {
    lines.push(
      r.sleep.bed && r.sleep.wake ? `😴 ${r.sleep.bed}–${r.sleep.wake} · ${hours(r.sleep.minutes)} ч` : `😴 ${hours(r.sleep.minutes)} ч`,
    );
  }
  for (const h of r.habits ?? []) lines.push(habitLine(h));
  return lines;
}

/**
 * "Добавить текстом" via the developer's Hermes agent (the assistant): the server runs it as a
 * background job (minutes), this panel polls it. One message can log food, weight, sleep and
 * habits or ask a question; results are written right away and "Отменить" restores everything.
 */
export function AgentLogPanel({ date, meal, onDone }: Props) {
  const loadDay = useNutritionStore((s) => s.loadDay);
  const loadHabits = useHabitsStore((s) => s.load);
  const [text, setText] = useState('');
  const [job, setJob] = useState<TextLogJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  const refresh = (r: TextLogResult | null) => {
    loadDay(date);
    if (r && (r.habits?.length || r.sleep)) void loadHabits();
  };

  const poll = (id: string, startedAt: number, delay = POLL_MS) => {
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
          refresh(j.result);
        } else {
          haptic('error');
        }
      } catch (e: any) {
        setError(e.message || 'Связь с сервером потеряна');
      }
    }, delay);
  };

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setError(null);
    setUndone(false);
    try {
      const j = await startTextLog(t, date, meal);
      setJob(j);
      poll(j.id, Date.now(), FIRST_POLL_MS);
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
      refresh(job.result);
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
        placeholder="Что съел, где и сколько — и заодно вес, сон, привычки или вопрос. Например: «удон с курицей из Лавки, вес 70,5, спал с 1:30 до 8, зарядка сделана»"
        rows={4}
        className="w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text text-base outline-none resize-none placeholder:text-tg-hint disabled:opacity-60"
      />
      <button
        onClick={submit}
        disabled={!text.trim() || running}
        className="w-full mt-2 py-3 rounded-xl text-white font-semibold text-sm active:opacity-80 disabled:opacity-40"
        style={{ backgroundColor: NUTRITION_COLOR }}
      >
        {running ? 'Агент думает…' : `Записать (еда — в ${mealLabel(meal).toLowerCase()})`}
      </button>

      {running && (
        <p className="text-xs text-tg-hint text-center mt-3">
          Обычно 2–5 минут. Экран можно закрыть — всё запишется само
        </p>
      )}

      {(error || job?.status === 'error') && (
        <div className="mt-3 rounded-xl bg-tg-section px-4 py-3 text-sm text-tg-destructive">{error ?? job?.error}</div>
      )}

      {result && (
        <div className="mt-4 bg-tg-section rounded-2xl p-4">
          {result.agentError && (
            <div className="text-xs text-tg-destructive mb-2">⚠️ Агент сейчас недоступен —{' '}
              {result.items.length || result.weight || result.sleep || result.habits?.length
                ? 'записал только то, что понял'
                : 'вот факты из базы'}
            </div>
          )}
          {undone && <div className="text-sm font-semibold text-tg-text mb-2">↩️ Отменено — всё вернул как было</div>}
          {result.items.length > 0 && (
            <>
              <div className="text-sm font-semibold text-tg-text mb-2">
                {undone ? '🍽 Еда' : `🍽 Записано в ${mealLabel(result.meal).toLowerCase()}`}
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
            </>
          )}
          {otherLines(result).length > 0 && (
            <div className={`flex flex-col gap-1 text-sm text-tg-text ${result.items.length ? 'mt-3' : ''} ${undone ? 'opacity-40 line-through' : ''}`}>
              {otherLines(result).map((l) => (
                <div key={l}>{l}</div>
              ))}
            </div>
          )}
          {[...result.skipped, ...(result.notes ?? [])].map((s) => (
            <div key={s} className="text-xs text-tg-destructive mt-1">
              ⚠️ {s}
            </div>
          ))}
          {result.answer && <div className="text-sm text-tg-text mt-3 whitespace-pre-line">💬 {result.answer}</div>}

          {!undone && (
            <div className="flex gap-2 mt-4">
              {job?.canUndo !== false && (
                <button
                  onClick={undo}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-tg-secondary text-tg-text active:opacity-70"
                >
                  ↩️ Отменить
                </button>
              )}
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
