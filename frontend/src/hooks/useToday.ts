import { useEffect, useState } from 'react';
import { toDateString } from '../utils/dates';

/**
 * Today's local date (YYYY-MM-DD) that rolls over after midnight: re-checked when the Mini App
 * comes back to the foreground and once a minute while it is visible.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => toDateString(new Date()));

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setToday(toDateString(new Date()));
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, []);

  return today;
}
