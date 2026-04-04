import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAuthStore } from './stores/authStore';
import { useHabitsStore } from './stores/habitsStore';
import { HomePage } from './pages/HomePage';
import { HabitDetailPage } from './pages/HabitDetailPage';
import { HabitFormPage } from './pages/HabitFormPage';
import { LoadingScreen } from './components/LoadingScreen';

export default function App() {
  const { user, loading: authLoading, error: authError, authenticate } = useAuthStore();
  const { screen, load } = useHabitsStore();

  useEffect(() => {
    // Гарантированный выход из загрузки через 8 сек
    const safetyTimer = setTimeout(() => {
      useAuthStore.setState((s) =>
        s.loading && !s.user
          ? { loading: false, error: 'Не удалось загрузиться. Проверьте интернет и откройте снова из чата с ботом.' }
          : s,
      );
    }, 8000);

    function runAuth(webapp: any) {
      webapp.ready();
      webapp.expand();
      const initData = webapp.initData;
      if (initData) {
        authenticate(initData);
        return;
      }
      const t = setTimeout(() => {
        useAuthStore.setState({
          loading: false,
          error: 'Не получены данные от Telegram. Откройте приложение по кнопке «Трекер» в чате с ботом.',
        });
      }, 2500);
      return () => clearTimeout(t);
    }

    const w = (window as any);
    let attempt = 0;
    const maxAttempts = 15; // 15 * 200ms = 3 sec

    function tryInit() {
      const webapp = w.Telegram?.WebApp;
      if (webapp) {
        runAuth(webapp);
        return;
      }
      if (import.meta.env.DEV) {
        authenticate('dev-mode');
        return;
      }
      attempt += 1;
      if (attempt < maxAttempts) {
        setTimeout(tryInit, 200);
        return;
      }
      useAuthStore.setState({ loading: false, error: 'Откройте приложение из Telegram.' });
    }

    tryInit();

    return () => clearTimeout(safetyTimer);
  }, [authenticate]);

  useEffect(() => {
    if (user) {
      load();
    }
  }, [user, load]);

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (authError) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center">
          <p className="text-tg-hint text-lg mb-2">Не удалось авторизоваться</p>
          <p className="text-tg-hint text-sm">{authError}</p>
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {screen === 'home' && <HomePage key="home" />}
      {screen === 'habit' && <HabitDetailPage key="habit" />}
      {(screen === 'create' || screen === 'edit') && <HabitFormPage key="form" />}
    </AnimatePresence>
  );
}
