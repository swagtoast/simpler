import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { applyDocumentLocale } from './i18n/t';
import App from './App';
import './styles/tokens.css';
import './styles/app.css';

applyDocumentLocale();
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
