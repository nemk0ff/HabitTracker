import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import App from './App';
import { installBackButtonGuard } from './hooks/useTelegramButtons';
import './index.css';

// Before any page registers a BackButton handler: lets open sheets own the Back press.
installBackButtonGuard();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);

// Expose Telegram's light/dark scheme to the CSS tokens in index.css.
const webApp = (window as any).Telegram?.WebApp;
const applyScheme = () => {
  if (webApp?.colorScheme) document.documentElement.dataset.scheme = webApp.colorScheme;
};
applyScheme();
webApp?.onEvent?.('themeChanged', applyScheme);
