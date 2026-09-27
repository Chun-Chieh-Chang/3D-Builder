import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // The WASM packages locate their binaries via import.meta.url; pre-bundling would break that.
  optimizeDeps: { exclude: ['libcascade', '@salusoft89/planegcs'] },
  // 5173/4173 are every Vite project's defaults, so another project (or a service worker it left in the
  // browser) can answer there. Use an address of our own, and fail loudly if it is taken instead of moving.
  server: { host: '127.0.0.1', port: 5391, strictPort: true },
  preview: { host: '127.0.0.1', port: 5392, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
