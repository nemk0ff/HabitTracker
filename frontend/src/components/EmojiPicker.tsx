import { motion } from 'framer-motion';

const EMOJI_OPTIONS = [
  '💪', '🏃', '📚', '💧', '🧘', '🎯', '✍️', '🌅',
  '💊', '🥗', '😴', '🧠', '🎵', '🏋️', '🚶', '🍎',
  '🧹', '💰', '📱', '🎨', '🌿', '❤️', '⭐', '🔥',
];

interface Props {
  value: string | null;
  onChange: (emoji: string | null) => void;
}

export function EmojiPicker({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-8 gap-2">
      <motion.button
        whileTap={{ scale: 0.85 }}
        onClick={() => onChange(null)}
        className="w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-all"
        style={{
          backgroundColor: value === null ? 'var(--tg-theme-button-color, #2481cc)' : 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          color: value === null ? 'var(--tg-theme-button-text-color, #fff)' : undefined,
        }}
      >
        ✕
      </motion.button>
      {EMOJI_OPTIONS.map((emoji) => (
        <motion.button
          key={emoji}
          whileTap={{ scale: 0.85 }}
          onClick={() => {
            onChange(emoji);
            window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
          }}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all"
          style={{
            backgroundColor:
              value === emoji
                ? 'var(--tg-theme-button-color, #2481cc)'
                : 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
            boxShadow: value === emoji ? '0 0 0 2px var(--tg-theme-button-color, #2481cc)' : undefined,
          }}
        >
          {emoji}
        </motion.button>
      ))}
    </div>
  );
}
