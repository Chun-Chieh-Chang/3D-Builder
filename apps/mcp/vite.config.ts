import { defineConfig } from 'vite';

/**
 * The MCP server as one file for Node (ADR 0237): the workspace packages are TypeScript sources and are bundled in; the packages from npm stay outside
 * (the two WASM modules find their own `.wasm` files next to them in node_modules).
 */
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'server.mjs' } },
  },
  ssr: { noExternal: [/^@3db\//] },
});
