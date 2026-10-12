import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { suppressNativeMenu } from './nativeMenu';
import { store } from './state/store';
import './app.css';

(window as any).__store = store;
suppressNativeMenu();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
