import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { onHostConfig } from './sdk/mnemo-sdk';
import { adoptHostZoom } from './components/distance';
import { setHostLanguage } from './i18n';
import './styles.css';

// Inherit the host shell's theme and live tokens (the person's accent
// included), follow its language, and learn how far the board is zoomed
// out (the far view, doc 177 §13.7).
onHostConfig((config) => {
  setHostLanguage(config.lang);
  adoptHostZoom(config.zoom);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
