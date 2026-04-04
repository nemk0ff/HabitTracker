import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useHabitsStore } from '../stores/habitsStore';
import { HabitCard } from '../components/HabitCard';

export function HomePage() {
  const { habits, loading, navigate } = useHabitsStore();

  useEffect(() => {
    const webapp = window.Telegram?.WebApp;
    if (webapp) {
      webapp.BackButton?.hide?.();

      webapp.MainButton?.setParams?.({
        text: 'Добавить привычку',
        is_visible: true,
      });
      const handler = () => navigate('create');
      webapp.MainButton?.onClick?.(handler);

      return () => {
        webapp.MainButton?.offClick?.(handler);
        webapp.MainButton?.hide?.();
      };
    }
  }, [navigate]);

  if (loading) {
    return (
      <div className="scrollable flex items-center justify-center">
        <div className="text-tg-hint">Загрузка...</div>
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
        <h1 className="text-xl font-bold text-tg-text mb-4">Мои привычки</h1>

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
