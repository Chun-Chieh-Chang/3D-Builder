import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { suppressNativeMenu } from './nativeMenu';
import { store } from './state/store';
import './app.css';

(window as any).__store = store;
suppressNativeMenu();

const params = new URLSearchParams(window.location.search);
const loadUrl = params.get('load');
if (loadUrl) {
  fetch(loadUrl)
    .then((r) => r.json())
    .then((doc) => {
      (store as any).load(doc, null, params.get('name') ?? 'part.3dbx');
    })
    .catch((err) => console.error('Failed to load url doc:', err));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
