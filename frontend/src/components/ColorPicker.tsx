import { motion } from 'framer-motion';
import { HABIT_COLORS } from '../utils/colors';

interface Props {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-6 gap-3">
      {HABIT_COLORS.map((color) => (
        <motion.button
          key={color}
          whileTap={{ scale: 0.85 }}
          onClick={() => {
            onChange(color);
            window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
          }}
          className="w-10 h-10 rounded-xl flex items-center justify-center transition-all"
          style={{
            backgroundColor: color,
            boxShadow: value === color ? `0 0 0 3px ${color}40, 0 0 0 5px ${color}` : undefined,
            transform: value === color ? 'scale(1.1)' : undefined,
          }}
        >
          {value === color && (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M4 9.5L7.5 13L14 5"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </motion.button>
      ))}
    </div>
  );
}
