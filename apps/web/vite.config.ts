import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { autoClose, graceFromEnv } from './dev/autoClose.ts';
import { shutdown } from './dev/shutdown.ts';

// `npm run dev:auto` runs this with `--mode autoclose`: the dev server stops by itself 30 seconds (or `DEV_AUTO_CLOSE_SECONDS`) after the last page connected to it is gone.
export default defineConfig(({ mode }) => ({
  // `shutdown()` (ADR 0135) serves the 「關閉伺服器」 button in every dev mode: it is `apply: 'serve'`, so a production build never carries it.
  plugins: [react(), shutdown(), ...(mode === 'autoclose' ? [autoClose({ graceSeconds: graceFromEnv(process.env.DEV_AUTO_CLOSE_SECONDS) })] : [])],
  worker: { format: 'es' },
  // The WASM packages locate their binaries via import.meta.url; pre-bundling would break that.
  optimizeDeps: { exclude: ['libcascade', '@salusoft89/planegcs'] },
  // 5173/4173 are every Vite project's defaults, so another project (or a service worker it left in the
  // browser) can answer there. Use an address of our own, and fail loudly if it is taken instead of moving.
  server: { host: '127.0.0.1', port: 5391, strictPort: true },
  preview: { host: '127.0.0.1', port: 5392, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
}));
