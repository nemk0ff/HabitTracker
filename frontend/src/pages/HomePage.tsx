import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useHabitsStore } from '../stores/habitsStore';
import { useNavStore } from '../stores/navStore';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';
import { Archive, ArrowDown, ArrowUp, ChevronDown, ChevronRight, RotateCcw, Settings } from 'lucide-react';
import { HabitCard } from '../components/HabitCard';
import { sortHabits } from '../utils/habits';
import { useBackButton, useMainButton, haptic } from '../hooks/useTelegramButtons';
import type { Habit } from '../types';

export function HomePage() {
  const { habits, loading } = useHabitsStore(useShallow((s) => ({ habits: s.habits, loading: s.loading })));
  const reorder = useHabitsStore((s) => s.reorder);
  const setArchived = useHabitsStore((s) => s.setArchived);
  const navigate = useNavStore((s) => s.navigate);
  const back = useNavStore((s) => s.back);
  const isAdmin = useAuthStore((s) => !!s.user?.isAdmin);
  const checkinTime = useAuthStore((s) => s.user?.checkinTime ?? null);

  const [editRequested, setEditing] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const active = useMemo(() => sortHabits(habits), [habits]);
  const archived = useMemo(
    () => habits.filter((h) => h.archived).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [habits],
  );
  // Leaves edit mode by itself once the last active habit went to the archive.
  const editing = editRequested && active.length > 0;

  // In edit mode Back leaves the mode first.
  useBackButton(editing ? () => setEditing(false) : back);
  useMainButton(editing ? 'Готово' : 'Добавить привычку', editing ? () => setEditing(false) : () => navigate('create'));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= active.length) return;
    haptic('select');
    const ids = active.map((h) => h.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    void reorder(ids);
  };

  const archive = async (h: Habit) => {
    haptic('light');
    const ok = await setArchived(h.id, true);
    if (ok) {
      toast(`«${h.name}» в архиве`, {
        actions: [{ label: 'Вернуть', onClick: () => void setArchived(h.id, false) }],
      });
    }
  };

  const restore = (h: Habit) => {
    haptic('success');
    void setArchived(h.id, false);
  };

  if (loading) {
    return (
      // Skeleton in the shape of the habit cards, so the screen doesn't jump when data arrives
      <div className="scrollable" aria-busy="true" aria-label="Загрузка привычек">
        <div className="p-4 flex flex-col gap-3">
          <div className="h-7 w-40 rounded-lg bg-tg-section mb-1" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[236px] rounded-2xl bg-tg-section animate-pulse" />
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
        <div className="flex items-center justify-between gap-2 mb-4">
          <h1 className="text-xl font-bold text-tg-text">Прогресс</h1>
          <div className="flex items-center gap-2">
            {isAdmin && !editing && (
              <button
                onClick={() => navigate('admin')}
                className="min-h-[36px] px-3 rounded-xl text-sm font-medium bg-tg-secondary text-tg-text active:opacity-70 transition-opacity hit-44"
              >
                Все пользователи
              </button>
            )}
            {active.length > 0 && (
              <button
                onClick={() => {
                  haptic('select');
                  setEditing(!editing);
                }}
                aria-pressed={editing}
                className="min-h-[36px] px-3 rounded-xl text-sm font-semibold active:opacity-70 transition-opacity hit-44"
                style={
                  editing
                    ? { backgroundColor: 'var(--accent)', color: '#fff' }
                    : { color: 'var(--accent)' }
                }
              >
                {editing ? 'Готово' : 'Изменить'}
              </button>
            )}
          </div>
        </div>

        {active.length === 0 ? (
          <EmptyState onAdd={() => navigate('create')} />
        ) : editing ? (
          <ul className="flex flex-col gap-2" aria-label="Порядок привычек">
            <AnimatePresence initial={false}>
              {active.map((habit, i) => (
                <EditRow
                  key={habit.id}
                  habit={habit}
                  first={i === 0}
                  last={i === active.length - 1}
                  onUp={() => move(i, -1)}
                  onDown={() => move(i, 1)}
                  onArchive={() => void archive(habit)}
                />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <div className="flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {active.map((habit) => (
                <HabitCard key={habit.id} habit={habit} />
              ))}
            </AnimatePresence>
          </div>
        )}

        {archived.length > 0 && (
          <section className="mt-6">
            <button
              onClick={() => setArchiveOpen((v) => !v)}
              aria-expanded={archiveOpen}
              aria-controls="habits-archive"
              className="w-full min-h-[44px] flex items-center gap-2 text-left text-sm font-semibold text-hint-strong"
            >
              <Archive size={16} aria-hidden />
              <span className="flex-1">Архив ({archived.length})</span>
              <ChevronDown
                size={18}
                aria-hidden
                className="transition-transform"
                style={{ transform: archiveOpen ? 'rotate(180deg)' : undefined }}
              />
            </button>
            {archiveOpen && (
              <ul id="habits-archive" className="flex flex-col gap-2 mt-1">
                {archived.map((h) => (
                  <li key={h.id} className="min-h-[56px] pl-4 pr-2 rounded-2xl bg-tg-section flex items-center gap-3">
                    <span className="text-lg shrink-0 opacity-60" aria-hidden>{h.icon || '•'}</span>
                    <span className="flex-1 min-w-0 truncate text-sm text-tg-hint">{h.name}</span>
                    <button
                      onClick={() => restore(h)}
                      aria-label={`Вернуть «${h.name}»`}
                      className="min-h-[44px] px-3 rounded-xl text-sm font-semibold flex items-center gap-1.5 active:opacity-70"
                      style={{ color: 'var(--accent)' }}
                    >
                      <RotateCcw size={15} aria-hidden />
                      Вернуть
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
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

function EditRow({
  habit,
  first,
  last,
  onUp,
  onDown,
  onArchive,
}: {
  habit: Habit;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onArchive: () => void;
}) {
  const arrow =
    'w-11 h-11 rounded-xl flex items-center justify-center bg-tg-secondary text-tg-text active:opacity-70 disabled:opacity-30 transition-opacity';
  return (
    <motion.li
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="min-h-[60px] pl-4 pr-2 py-2 rounded-2xl bg-tg-section flex items-center gap-2"
    >
      <span className="text-xl shrink-0" aria-hidden>{habit.icon || '•'}</span>
      <span className="flex-1 min-w-0 text-sm font-semibold text-tg-text line-clamp-2 break-words">{habit.name}</span>
      <button onClick={onUp} disabled={first} aria-label={`Поднять «${habit.name}» выше`} className={arrow}>
        <ArrowUp size={18} aria-hidden />
      </button>
      <button onClick={onDown} disabled={last} aria-label={`Опустить «${habit.name}» ниже`} className={arrow}>
        <ArrowDown size={18} aria-hidden />
      </button>
      <button
        onClick={onArchive}
        aria-label={`Убрать «${habit.name}» в архив`}
        className="min-h-[44px] px-2.5 rounded-xl text-xs font-semibold text-hint-strong flex flex-col items-center justify-center active:opacity-70"
      >
        <Archive size={16} aria-hidden />
        В архив
      </button>
    </motion.li>
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
