import { useEffect, useState, type ReactNode } from 'react';
import { addMonths, endOfQuarter, format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { BottomSheet } from '../nutrition/BottomSheet';
import { useHabitsStore } from '../../stores/habitsStore';
import { toast } from '../../stores/toastStore';
import { haptic } from '../../hooks/useTelegramButtons';
import { createGoal, deleteGoal, updateGoal } from '../../api/dashboard';
import { toDateString } from '../../utils/dates';
import { fmt } from '../../utils/nutrition';
import type { QuarterGoal, QuarterGoalMetric } from '../../types';

const METRICS: { id: QuarterGoalMetric; label: string; unit: string; hint: string }[] = [
  { id: 'weight', label: 'Вес', unit: 'кг', hint: 'Вес к дедлайну, кг' },
  { id: 'trainings', label: 'Тренировки', unit: 'раз', hint: 'Сколько тренировок с сегодняшнего дня' },
  { id: 'sleep_share', label: 'Сон ≥ N ч', unit: '%', hint: 'Доля ночей, когда спал не меньше N часов' },
  { id: 'habit_count', label: 'Привычка', unit: 'раз', hint: 'Сколько отметок привычки с сегодняшнего дня' },
  { id: 'protein_days', label: 'Дни с белком', unit: 'дн', hint: 'Сколько дней с добранной нормой белка' },
];

export const metricUnit = (m: QuarterGoalMetric) => METRICS.find((x) => x.id === m)?.unit ?? '';

type DeadlinePreset = 'quarter' | 'months3' | 'date';

interface Props {
  open: boolean;
  onClose: () => void;
  /** null = create a new goal. */
  goal: QuarterGoal | null;
  onSaved: () => void;
  /** Hints for the create form from current data. */
  hints: { weightKg: number | null; trainingsPerWeek: number | null };
}

const field = 'w-full px-4 py-3 rounded-xl bg-tg-section text-tg-text text-base outline-none placeholder:text-tg-hint tabular-nums';

export function GoalSheet({ open, onClose, goal, onSaved, hints }: Props) {
  const habits = useHabitsStore((s) => s.habits);
  const activeHabits = habits.filter((h) => !h.archived);
  const today = toDateString(new Date());
  const quarterEnd = toDateString(endOfQuarter(new Date()));
  const in3Months = toDateString(addMonths(new Date(), 3));

  const [metric, setMetric] = useState<QuarterGoalMetric>('weight');
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [param, setParam] = useState<string>('7');
  const [habitId, setHabitId] = useState<number | null>(null);
  const [preset, setPreset] = useState<DeadlinePreset>('quarter');
  const [deadline, setDeadline] = useState(quarterEnd);
  const [busy, setBusy] = useState(false);

  // Reset the form each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    if (goal) {
      setMetric(goal.metric);
      setTitle(goal.title);
      setTarget(String(goal.target).replace('.', ','));
      setParam(goal.param !== null ? String(goal.param) : '7');
      setHabitId(goal.metric === 'habit_count' ? goal.param : null);
      setPreset('date');
      setDeadline(goal.deadline);
    } else {
      setMetric('weight');
      setTitle('');
      setTarget('');
      setParam('7');
      setHabitId(null);
      setPreset('quarter');
      setDeadline(quarterEnd);
    }
    setBusy(false);
  }, [open, goal, quarterEnd]);

  const editing = goal !== null;
  const targetNum = Number(target.replace(',', '.'));
  const paramNum = Number(param.replace(',', '.'));
  const habitName = activeHabits.find((h) => h.id === habitId)?.name ?? habits.find((h) => h.id === habitId)?.name;
  const deadlineLabel = format(parseISO(deadline), 'd MMMM', { locale: ru });

  const autoTitle = (() => {
    const t = target ? fmt(targetNum, 1) : '…';
    switch (metric) {
      case 'weight': return `${t} кг к ${deadlineLabel}`;
      case 'trainings': return `${t} тренировок к ${deadlineLabel}`;
      case 'sleep_share': return `${t}% ночей ≥ ${fmt(paramNum, 1)} ч`;
      case 'habit_count': return `${habitName ?? 'Привычка'}: ${t} раз`;
      case 'protein_days': return `${t} дней с белком`;
    }
  })();

  const daysToDeadline = Math.max(0, Math.round((parseISO(deadline).getTime() - parseISO(today).getTime()) / 86_400_000));
  const hint = (() => {
    if (editing) return null;
    if (metric === 'weight' && hints.weightKg !== null) return `Сейчас ~${fmt(hints.weightKg, 1)} кг`;
    if (metric === 'trainings' && hints.trainingsPerWeek !== null) {
      return `В среднем ${fmt(hints.trainingsPerWeek, 1)} в неделю → за ${daysToDeadline} дн. ~${fmt((hints.trainingsPerWeek * daysToDeadline) / 7)}`;
    }
    if (metric === 'protein_days') return `До дедлайна ${daysToDeadline} дн.`;
    return null;
  })();

  const valid =
    Number.isFinite(targetNum) &&
    targetNum > 0 &&
    (metric !== 'sleep_share' || (targetNum <= 100 && paramNum > 0 && paramNum <= 14)) &&
    (metric !== 'habit_count' || habitId !== null || editing) &&
    deadline > today;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const finalTitle = title.trim() || autoTitle;
      if (editing) {
        await updateGoal(goal.id, { title: finalTitle, target: targetNum, deadline });
      } else {
        await createGoal({
          title: finalTitle,
          metric,
          target: targetNum,
          param: metric === 'sleep_share' ? paramNum : metric === 'habit_count' ? habitId : null,
          deadline,
        });
      }
      haptic('success');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить');
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!goal || busy) return;
    setBusy(true);
    try {
      await updateGoal(goal.id, { archived: true });
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось убрать цель');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!goal || busy) return;
    if (!window.confirm('Удалить цель насовсем?')) return;
    setBusy(true);
    try {
      await deleteGoal(goal.id);
      haptic('warning');
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось удалить');
      setBusy(false);
    }
  };

  const meta = METRICS.find((m) => m.id === metric)!;

  return (
    <BottomSheet open={open} onClose={onClose}>
      <h2 className="text-lg font-semibold text-tg-text mb-4">{editing ? 'Цель' : 'Новая цель на квартал'}</h2>

      {!editing && (
        <div className="flex flex-wrap gap-2 mb-2" role="group" aria-label="Метрика">
          {METRICS.map((m) => (
            <Chip key={m.id} active={metric === m.id} onClick={() => { setMetric(m.id); haptic('select'); }}>
              {m.label}
            </Chip>
          ))}
        </div>
      )}
      <p className="text-sm text-tg-hint mb-4">{meta.hint}</p>

      {metric === 'sleep_share' && (
        <label className="block mb-3">
          <span className="text-sm text-tg-hint">Часов сна не меньше</span>
          <input
            inputMode="decimal"
            value={param}
            disabled={editing}
            onChange={(e) => setParam(e.target.value)}
            className={`${field} mt-1 disabled:opacity-60`}
          />
        </label>
      )}

      {metric === 'habit_count' && (
        <div className="mb-3">
          <span className="text-sm text-tg-hint">Привычка</span>
          {editing ? (
            <p className="text-base text-tg-text mt-1">{habitName ?? '—'}</p>
          ) : activeHabits.length === 0 ? (
            <p className="text-sm text-tg-hint mt-1">Сначала заведи привычку</p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1.5">
              {activeHabits.map((h) => (
                <Chip key={h.id} active={habitId === h.id} onClick={() => setHabitId(h.id)}>
                  {h.icon} {h.name}
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      <label className="block mb-1">
        <span className="text-sm text-tg-hint">Цель, {meta.unit}</span>
        <input
          inputMode="decimal"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={metric === 'weight' && hints.weightKg ? fmt(hints.weightKg, 1) : metric === 'sleep_share' ? '80' : ''}
          className={`${field} mt-1`}
        />
      </label>
      {hint && <p className="text-sm text-tg-hint mb-3 tabular-nums">{hint}</p>}

      <div className="mt-3 mb-3">
        <span className="text-sm text-tg-hint">Дедлайн</span>
        <div className="flex flex-wrap gap-2 mt-1.5">
          <Chip active={preset === 'quarter'} onClick={() => { setPreset('quarter'); setDeadline(quarterEnd); }}>
            до конца квартала
          </Chip>
          <Chip active={preset === 'months3'} onClick={() => { setPreset('months3'); setDeadline(in3Months); }}>
            через 3 месяца
          </Chip>
          <Chip active={preset === 'date'} onClick={() => setPreset('date')}>
            дата
          </Chip>
        </div>
        {preset === 'date' ? (
          <input type="date" value={deadline} min={today} onChange={(e) => e.target.value && setDeadline(e.target.value)} className={`${field} mt-2`} />
        ) : (
          <p className="text-sm text-tg-text mt-2 tabular-nums">{deadlineLabel} · {daysToDeadline} дн.</p>
        )}
      </div>

      <label className="block mb-5">
        <span className="text-sm text-tg-hint">Название</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} maxLength={80} className={`${field} mt-1`} />
      </label>

      <button
        onClick={save}
        disabled={!valid || busy}
        className="w-full py-3.5 rounded-xl text-base font-semibold text-white disabled:opacity-40 active:opacity-80"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        {editing ? 'Сохранить' : 'Поставить цель'}
      </button>

      {editing && (
        <div className="flex gap-2 mt-3">
          <button onClick={archive} disabled={busy} className="flex-1 py-3 rounded-xl bg-tg-section text-tg-text text-sm font-medium active:opacity-70">
            В архив
          </button>
          <button onClick={remove} disabled={busy} className="flex-1 py-3 rounded-xl bg-tg-section text-sm font-medium active:opacity-70" style={{ color: 'var(--tg-theme-destructive-text-color)' }}>
            Удалить
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="px-3 py-1.5 rounded-full text-sm font-medium min-h-[36px] active:opacity-70"
      style={
        active
          ? { backgroundColor: 'var(--accent)', color: '#fff' }
          : { backgroundColor: 'var(--tg-theme-section-bg-color)', color: 'var(--tg-theme-text-color)' }
      }
    >
      {children}
    </button>
  );
}
