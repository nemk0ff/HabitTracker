import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavStore } from '../stores/navStore';
import { HabitCard } from '../components/HabitCard';
import { fetchAllHabits } from '../api/admin';
import type { AdminUserGroup } from '../types';

function relativeTime(iso: string | null): string {
  if (!iso) return 'не заходил';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

function userTitle(u: AdminUserGroup['user']): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
  return name || `#${u.id}`;
}

export function AdminPage() {
  const navigate = useNavStore((s) => s.navigate);
  const [groups, setGroups] = useState<AdminUserGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchAllHabits()
      .then(setGroups)
      .catch((e: any) => setError(e.message || 'Ошибка загрузки'));
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -30 }}
      transition={{ duration: 0.2 }}
      className="scrollable"
    >
      <div className="p-4 pb-24">
        <h1 className="text-xl font-bold text-tg-text mb-4">Все привычки</h1>

        {error ? (
          <p className="text-tg-destructive text-sm">{error}</p>
        ) : groups === null ? (
          <p className="text-tg-hint">Загрузка...</p>
        ) : groups.length === 0 ? (
          <p className="text-tg-hint">Пока нет ни одной привычки.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <div key={group.user.id} className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-tg-text truncate">
                    {userTitle(group.user)}
                    {group.user.username && (
                      <span className="text-tg-hint font-normal"> @{group.user.username}</span>
                    )}
                  </span>
                  <span className="text-xs text-tg-hint shrink-0">
                    {relativeTime(group.user.lastSeenAt)}
                  </span>
                </div>
                {group.habits.map((habit) => (
                  <HabitCard key={habit.id} habit={habit} readOnly />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
