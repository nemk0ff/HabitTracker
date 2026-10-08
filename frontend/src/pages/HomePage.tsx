import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useAuthStore } from '../stores/authStore';
import { ChevronRight, Settings } from 'lucide-react';
import { HabitCard } from '../components/HabitCard';
import { useBackButton, useMainButton } from '../hooks/useTelegramButtons';

export function HomePage() {
  const { habits, loading } = useHabitsStore(useShallow((s) => ({ habits: s.habits, loading: s.loading })));
  const navigate = useNavStore((s) => s.navigate);
  const back = useNavStore((s) => s.back);
  const isAdmin = useAuthStore((s) => !!s.user?.isAdmin);
  const checkinTime = useAuthStore((s) => s.user?.checkinTime ?? null);

  useBackButton(back);
  useMainButton('Добавить привычку', () => navigate('create'));

  if (loading) {
    return (
      // Skeleton in the shape of the habit cards, so the screen doesn't jump when data arrives
      <div className="scrollable" aria-busy="true" aria-label="Загрузка привычек">
        <div className="p-4 flex flex-col gap-3">
          <div className="h-7 w-40 rounded-lg bg-tg-section mb-1" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[104px] rounded-2xl bg-tg-section animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="scrollable"
    >
      <div className="p-4 pb-24">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-tg-text">Прогресс</h1>
          {isAdmin && (
            <button
              onClick={() => navigate('admin')}
              className="px-3 py-1.5 rounded-xl text-sm font-medium bg-tg-secondary text-tg-text active:opacity-70 transition-opacity"
            >
              Все пользователи
            </button>
          )}
        </div>

        {habits.length === 0 ? (
          <EmptyState onAdd={() => navigate('create')} />
        ) : (
          <div className="flex flex-col gap-3">
            {habits.map((habit) => (
              <HabitCard key={habit.id} habit={habit} />
            ))}
          </div>
        )}

        <button
          onClick={() => navigate('settings')}
          className="mt-6 w-full min-h-[52px] px-4 rounded-2xl bg-tg-section flex items-center gap-3 text-left active:opacity-70 transition-opacity"
        >
          <Settings size={18} className="text-tg-hint" aria-hidden />
          <span className="flex-1">
            <span className="block text-sm text-tg-text">Вечерняя сводка в боте</span>
          </span>
          <span className="text-sm tabular-nums text-tg-hint">{checkinTime ?? 'выкл'}</span>
          <ChevronRight size={16} className="text-tg-hint" aria-hidden />
        </button>
      </div>
    </motion.div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="flex flex-col items-center justify-center py-20"
    >
      <div className="text-5xl mb-4">🎯</div>
      <h2 className="text-lg font-semibold text-tg-text mb-2">Пока пусто</h2>
      <p className="text-sm text-tg-hint text-center mb-6 max-w-[260px]">
        Добавь первую привычку — здесь появится её прогресс за каждый день
      </p>
      <button
        onClick={onAdd}
        className="min-h-[44px] px-6 rounded-xl font-semibold text-sm text-white active:opacity-80 transition-opacity"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        Добавить привычку
      </button>
    </motion.div>
  );
}
