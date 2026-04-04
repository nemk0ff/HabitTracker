import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tg: {
          bg: 'var(--tg-theme-bg-color, #ffffff)',
          text: 'var(--tg-theme-text-color, #000000)',
          hint: 'var(--tg-theme-hint-color, #999999)',
          link: 'var(--tg-theme-link-color, #2481cc)',
          button: 'var(--tg-theme-button-color, #2481cc)',
          'button-text': 'var(--tg-theme-button-text-color, #ffffff)',
          secondary: 'var(--tg-theme-secondary-bg-color, #f0f0f0)',
          'header-bg': 'var(--tg-theme-header-bg-color, #ffffff)',
          section: 'var(--tg-theme-section-bg-color, #ffffff)',
          'section-header': 'var(--tg-theme-section-header-text-color, #6d6d71)',
          subtitle: 'var(--tg-theme-subtitle-text-color, #999999)',
          destructive: 'var(--tg-theme-destructive-text-color, #ff3b30)',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
