import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useHabitsStore } from '../stores/habitsStore';
import { Heatmap } from '../components/Heatmap';
import { StatCard } from '../components/StatCard';
import { NotificationSheet } from '../components/NotificationSheet';
import { calculateStreak, getMonthCompletionRate } from '../utils/dates';
import { fetchReminder, saveReminder } from '../api/habits';
import type { Reminder, DayOfWeek } from '../types';

export function HabitDetailPage() {
  const { habits, selectedHabitId, navigate, toggleEntry, removeHabit } = useHabitsStore();
  const habit = habits.find((h) => h.id === selectedHabitId);
  const [showConfirm, setShowConfirm] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [reminder, setReminder] = useState<Reminder | null>(null);

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

  useEffect(() => {
    const webapp = window.Telegram?.WebApp;
    if (webapp) {
      webapp.BackButton?.show?.();
      const handler = () => navigate('home');
      webapp.BackButton?.onClick?.(handler);

      webapp.MainButton?.hide?.();

      return () => {
        webapp.BackButton?.offClick?.(handler);
        webapp.BackButton?.hide?.();
      };
    }
  }, [navigate]);

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

  const handleToggle = (date: string, value: number) => {
    toggleEntry(habit.id, date, value);
  };

  const handleDelete = async () => {
    await removeHabit(habit.id);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('warning');
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
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
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
              window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
            }}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-tg-secondary active:opacity-70 transition-opacity"
          >
            {reminder?.enabled ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill={habit.color} stroke={habit.color} strokeWidth="1.5">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            )}
          </button>
          <button
            onClick={() => navigate('edit', habit.id)}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-tg-secondary active:opacity-70 transition-opacity"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M13.5 2.5L15.5 4.5M14.5 1.5L9 7V9H11L16.5 3.5L14.5 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M15 10V14C15 14.6 14.6 15 14 15H4C3.4 15 3 14.6 3 14V4C3 3.4 3.4 3 4 3H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-2 mb-5">
          <StatCard label="Текущий" value={current} color={habit.color} />
          <StatCard label="Лучший" value={best} color={habit.color} />
          <StatCard label="За месяц" value={`${completionRate}%`} color={habit.color} />
        </div>

        {/* Heatmap */}
        <div className="bg-tg-section rounded-2xl p-4 mb-5">
          <Heatmap entries={habit.entries} color={habit.color} binary={habit.binary} onToggle={handleToggle} />
        </div>

        {/* Legend */}
        {habit.binary ? (
          <div className="flex items-center justify-center gap-2 mb-8 text-[11px] text-tg-hint">
            <div
              className="w-4 h-4 rounded-[3px]"
              style={{ backgroundColor: window.Telegram?.WebApp?.colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
            />
            <span>Не выполнено</span>
            <div className="w-4 h-4 rounded-[3px]" style={{ backgroundColor: habit.color }} />
            <span>Выполнено</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 mb-8 text-[11px] text-tg-hint">
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
