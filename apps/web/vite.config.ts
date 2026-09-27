import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // The WASM packages locate their binaries via import.meta.url; pre-bundling would break that.
  optimizeDeps: { exclude: ['replicad-opencascadejs', '@salusoft89/planegcs'] },
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
