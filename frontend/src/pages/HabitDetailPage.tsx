import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Bell, Pencil } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import { Heatmap } from '../components/Heatmap';
import { StatCard } from '../components/StatCard';
import { NotificationSheet } from '../components/NotificationSheet';
import { calculateStreak, getMonthCompletionRate } from '../utils/dates';
import { fetchReminder, saveReminder } from '../api/habits';
import { HoursSheet } from '../components/HoursSheet';
import { averageHours, formatHours, isHoursHabit, levelEntries, weekProgress, weeklyStreak } from '../utils/habits';
import { toDateString } from '../utils/dates';
import { HabitDaySheet } from '../components/HabitDaySheet';
import { SleepChart } from '../components/SleepChart';
import { setHabitValue } from '../utils/habitActions';
import type { Reminder, DayOfWeek } from '../types';

const HOURS_LEVEL_LABELS = ['меньше 5 ч', '5–7 ч', '7+ ч'];

export function HabitDetailPage() {
  const { selectedHabitId, navigate, back } = useNavStore(
    useShallow((s) => ({ selectedHabitId: s.selectedHabitId, navigate: s.navigate, back: s.back })),
  );
  const habit = useHabitsStore((s) => s.habits.find((h) => h.id === selectedHabitId));
  const removeHabit = useHabitsStore((s) => s.removeHabit);
  const [showConfirm, setShowConfirm] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [hoursDate, setHoursDate] = useState<string | null>(null);
  const [dayDate, setDayDate] = useState<string | null>(null);

  const loadReminder = useCallback(async () => {
    if (!selectedHabitId) return;
    try {
      const r = await fetchReminder(selectedHabitId);
      setReminder(r);
    } catch {
      setReminder(null);
    }
  }, [selectedHabitId]);

  useEffect(() => {
    loadReminder();
  }, [loadReminder]);

  // Back returns to wherever the habit was opened from (Today or the list).
  useBackButton(back);
  useMainButton(null, () => {});

  const heatEntries = useMemo(() => (habit ? levelEntries(habit) : []), [habit]);

  if (!habit) {
    return (
      <div className="scrollable flex items-center justify-center">
        <p className="text-tg-hint">Привычка не найдена</p>
      </div>
    );
  }

  const { current, best } = calculateStreak(habit.entries);
  const now = new Date();
  const completionRate = getMonthCompletionRate(habit.entries, now.getFullYear(), now.getMonth());

  const hours = isHoursHabit(habit);
  const today = toDateString(now);
  const avg7 = hours ? averageHours(habit.entries, toDateString(new Date(Date.now() - 6 * 86_400_000))) : null;
  const week = weekProgress(habit, today);

  // Calendar edits go through the same path as the Today screen: undo toast, no silent rewrites.
  const saveDay = (date: string, value: number) => setHabitValue(habit, date, value, { askIntensity: false });

  // Weekly-goal habits are judged by weeks, daily ones by days in a row.
  const stats: { label: string; value: string | number }[] = hours
    ? [
        { label: 'Дней подряд', value: current },
        { label: 'Рекорд, дней', value: best },
        { label: 'Среднее за 7 дн', value: avg7 !== null ? formatHours(avg7) : '—' },
      ]
    : habit.weeklyTarget
      ? [
          { label: 'Эта неделя', value: `${week.done} из ${week.target}` },
          { label: 'Недель подряд', value: weeklyStreak(habit, today) },
          { label: 'За месяц', value: `${completionRate}%` },
        ]
      : [
          { label: 'Дней подряд', value: current },
          { label: 'Рекорд, дней', value: best },
          { label: 'За месяц', value: `${completionRate}%` },
        ];

  const handleDelete = async () => {
    await removeHabit(habit.id);
    haptic('warning');
  };

  const handleSaveReminder = async (data: { enabled: boolean; days: DayOfWeek[]; time: string; snooze: boolean }) => {
    try {
      const saved = await saveReminder(habit.id, data);
      setReminder(saved);
    } catch (err) {
      console.error('Failed to save reminder:', err);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          {habit.icon && <span className="text-3xl">{habit.icon}</span>}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-tg-text truncate">{habit.name}</h1>
          </div>
          <button
            onClick={() => {
              setNotifOpen(true);
              haptic('light');
            }}
            aria-label={reminder?.enabled ? 'Напоминание включено' : 'Напоминание'}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-tg-secondary active:opacity-70 transition-opacity"
          >
            {reminder?.enabled ? (
              <Bell size={18} fill={habit.color} color={habit.color} strokeWidth={1.5} aria-hidden />
            ) : (
              <Bell size={18} strokeWidth={1.5} aria-hidden />
            )}
          </button>
          <button
            onClick={() => navigate('edit', { selectedHabitId: habit.id })}
            aria-label="Редактировать"
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-tg-secondary active:opacity-70 transition-opacity"
          >
            <Pencil size={18} strokeWidth={1.5} aria-hidden />
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-2 mb-5">
          {stats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} color={habit.color} />
          ))}
        </div>

        {hours && (
          <div className="bg-tg-section rounded-2xl p-4 mb-5">
            <SleepChart entries={habit.entries} color={habit.color} today={today} onSelect={setHoursDate} />
          </div>
        )}

        {/* Heatmap: a tap opens the day sheet (explicit choice) instead of cycling the value */}
        <div className="bg-tg-section rounded-2xl p-4 mb-5">
          {hours ? (
            <Heatmap entries={heatEntries} color={habit.color} onSelect={setHoursDate} levelLabels={HOURS_LEVEL_LABELS} />
          ) : (
            <Heatmap entries={habit.entries} color={habit.color} binary={habit.binary} onSelect={setDayDate} />
          )}
        </div>

        {/* Legend */}
        {hours ? (
          <div className="flex items-center justify-center gap-2 mb-8 text-xs text-tg-hint">
            {['< 5 ч', '5–7 ч', '7+ ч'].map((label, i) => (
              <span key={label} className="flex items-center gap-1">
                <span
                  className="w-4 h-4 rounded-[3px] inline-block"
                  style={{
                    backgroundColor: `rgba(${parseInt(habit.color.slice(1, 3), 16)}, ${parseInt(habit.color.slice(3, 5), 16)}, ${parseInt(habit.color.slice(5, 7), 16)}, ${[0.3, 0.6, 1][i]})`,
                  }}
                />
                {label}
              </span>
            ))}
          </div>
        ) : habit.binary ? (
          <div className="flex items-center justify-center gap-2 mb-8 text-xs text-tg-hint">
            <div
              className="w-4 h-4 rounded-[3px]"
              style={{ backgroundColor: window.Telegram?.WebApp?.colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
            />
            <span>Не выполнено</span>
            <div className="w-4 h-4 rounded-[3px]" style={{ backgroundColor: habit.color }} />
            <span>Выполнено</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 mb-8 text-xs text-tg-hint">
            <span>Меньше</span>
            {[0, 1, 2, 3].map((v) => (
              <div
                key={v}
                className="w-4 h-4 rounded-[3px]"
                style={{
                  backgroundColor:
                    v === 0
                      ? (window.Telegram?.WebApp?.colorScheme === 'dark'
                          ? 'rgba(255,255,255,0.08)'
                          : 'rgba(0,0,0,0.06)')
                      : `rgba(${parseInt(habit.color.slice(1, 3), 16)}, ${parseInt(habit.color.slice(3, 5), 16)}, ${parseInt(habit.color.slice(5, 7), 16)}, ${[0, 0.3, 0.6, 1][v]})`,
                }}
              />
            ))}
            <span>Больше</span>
          </div>
        )}

        {/* Delete */}
        {showConfirm ? (
          <div className="bg-tg-section rounded-2xl p-4">
            <p className="text-sm text-tg-text text-center mb-3">
              Удалить привычку «{habit.name}»?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-tg-secondary text-tg-text font-medium text-sm active:opacity-70 transition-opacity"
              >
                Отмена
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 py-2.5 rounded-xl bg-tg-destructive/10 text-tg-destructive font-medium text-sm active:opacity-70 transition-opacity"
              >
                Удалить
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            className="w-full py-3 text-sm text-tg-destructive font-medium active:opacity-70 transition-opacity"
          >
            Удалить привычку
          </button>
        )}
      </div>

      {hours && (
        <HoursSheet
          date={hoursDate}
          title={habit.name}
          minutes={habit.entries.find((e) => e.date === hoursDate)?.value ?? 0}
          color={habit.color}
          onClose={() => setHoursDate(null)}
          onSave={(m) => hoursDate && saveDay(hoursDate, m)}
        />
      )}
      {!hours && <HabitDaySheet habit={habit} date={dayDate} onClose={() => setDayDate(null)} onSave={(v) => dayDate && saveDay(dayDate, v)} />}

      <NotificationSheet
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        reminder={reminder}
        onSave={handleSaveReminder}
        color={habit.color}
      />
    </motion.div>
  );
}
