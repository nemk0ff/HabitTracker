import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useAuthStore } from './stores/authStore';
import { useHabitsStore } from './stores/habitsStore';
import { useNavStore } from './stores/navStore';
import { HubPage } from './pages/HubPage';
import { HomePage } from './pages/HomePage';
import { HabitDetailPage } from './pages/HabitDetailPage';
import { HabitFormPage } from './pages/HabitFormPage';
import { AdminPage } from './pages/AdminPage';
import { FoodDayPage } from './pages/nutrition/FoodDayPage';
import { FoodAddPage } from './pages/nutrition/FoodAddPage';
import { FoodProductFormPage } from './pages/nutrition/FoodProductFormPage';
import { FoodStatsPage } from './pages/nutrition/FoodStatsPage';
import { FoodGoalPage } from './pages/nutrition/FoodGoalPage';
import { FoodSuggestPage } from './pages/nutrition/FoodSuggestPage';
import { LoadingScreen } from './components/LoadingScreen';

export default function App() {
  const { user, loading: authLoading, error: authError, authenticate } = useAuthStore();
  const load = useHabitsStore((s) => s.load);
  const navScreen = useNavStore((s) => s.screen);

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
      // Plain browser in dev: telegram-web-app.js is loaded but there's no initData.
      if (import.meta.env.DEV) {
        authenticate('dev-mode');
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

  // Nutrition screens are gated by the feature flag from /api/auth.
  const screen = navScreen.startsWith('food-') && !user?.features?.nutrition ? 'hub' : navScreen;

  return (
    <AnimatePresence mode="wait">
      {screen === 'hub' && <HubPage key="hub" />}
      {screen === 'home' && <HomePage key="home" />}
      {screen === 'admin' && <AdminPage key="admin" />}
      {screen === 'habit' && <HabitDetailPage key="habit" />}
      {(screen === 'create' || screen === 'edit') && <HabitFormPage key="form" />}
      {screen === 'food-day' && <FoodDayPage key="food-day" />}
      {screen === 'food-add' && <FoodAddPage key="food-add" />}
      {screen === 'food-product' && <FoodProductFormPage key="food-product" />}
      {screen === 'food-stats' && <FoodStatsPage key="food-stats" />}
      {screen === 'food-goal' && <FoodGoalPage key="food-goal" />}
      {screen === 'food-suggest' && <FoodSuggestPage key="food-suggest" />}
    </AnimatePresence>
  );
}
