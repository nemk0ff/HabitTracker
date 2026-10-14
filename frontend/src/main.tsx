import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import App from './App';
import { installBackButtonGuard } from './hooks/useTelegramButtons';
import { applyAppearance } from './utils/appearance';
import './index.css';

// Before any page registers a BackButton handler: lets open sheets own the Back press.
installBackButtonGuard();

// Theme (forced dark / Telegram's scheme) and font size before the first render — no flash.
applyAppearance();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
