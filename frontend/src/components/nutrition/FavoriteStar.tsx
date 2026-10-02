import { haptic } from '../../hooks/useTelegramButtons';
import { NUTRITION_COLOR } from '../../utils/nutrition';

interface Props {
  active: boolean;
  onToggle: () => void;
  className?: string;
}

/** ☆/★ toggle for favorite foods. Stops the click so the row/card under it doesn't open. */
export function FavoriteStar({ active, onToggle, className = '' }: Props) {
  return (
    <button
      type="button"
      aria-label={active ? 'Убрать из любимых' : 'В любимые'}
      onClick={(e) => {
        e.stopPropagation();
        haptic('select');
        onToggle();
      }}
      className={`shrink-0 w-8 h-8 flex items-center justify-center text-lg leading-none active:scale-90 transition-transform ${className}`}
      style={{ color: active ? NUTRITION_COLOR : 'var(--tg-theme-hint-color)' }}
    >
      {active ? '★' : '☆'}
    </button>
  );
}
