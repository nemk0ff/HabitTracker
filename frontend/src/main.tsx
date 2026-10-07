import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Expose Telegram's light/dark scheme to the CSS tokens in index.css.
const webApp = (window as any).Telegram?.WebApp;
const applyScheme = () => {
  if (webApp?.colorScheme) document.documentElement.dataset.scheme = webApp.colorScheme;
};
applyScheme();
webApp?.onEvent?.('themeChanged', applyScheme);
