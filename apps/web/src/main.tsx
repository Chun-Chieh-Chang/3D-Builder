import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { suppressNativeMenu } from './nativeMenu';
import { store } from './state/store';
import './app.css';

suppressNativeMenu();

// A dev-only window handle, so the e2e scripts and the console can reach the store while debugging. Never
// shipped: it would expose the whole document model to any script running on the page.
if (import.meta.env.DEV) (window as any).__store = store;

// Loads a part by URL (?load=…&name=…) — used by the real-machine checks against files on disk. Dev only:
// in a build it would let a crafted link read and display arbitrary JSON as the open document.
if (import.meta.env.DEV) {
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
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
