import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useAuthStore } from '../stores/authStore';
import { HabitCard } from '../components/HabitCard';
import { useBackButton, useMainButton } from '../hooks/useTelegramButtons';

export function HomePage() {
  const { habits, loading } = useHabitsStore(useShallow((s) => ({ habits: s.habits, loading: s.loading })));
  const navigate = useNavStore((s) => s.navigate);
  const back = useNavStore((s) => s.back);
  const isAdmin = useAuthStore((s) => !!s.user?.isAdmin);

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
          <h1 className="text-xl font-bold text-tg-text">Мои привычки</h1>
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
      <h2 className="text-lg font-semibold text-tg-text mb-2">Нет привычек</h2>
      <p className="text-sm text-tg-hint text-center mb-6 max-w-[250px]">
        Добавьте первую привычку и начните отслеживать прогресс каждый день
      </p>
      <button
        onClick={onAdd}
        className="px-6 py-2.5 rounded-xl font-medium text-sm text-tg-button-text bg-tg-button active:opacity-80 transition-opacity"
      >
        Добавить привычку
      </button>
    </motion.div>
  );
}
