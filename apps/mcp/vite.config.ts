import { defineConfig } from 'vite';

/**
 * The MCP server and the headless CLI as files for Node (ADR 0237): the workspace packages are TypeScript sources and are bundled in; the packages from npm stay outside
 * (the two WASM modules find their own `.wasm` files next to them in node_modules).
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { input: { server: 'src/main.ts', cli: 'src/cli.ts' }, output: { entryFileNames: '[name].mjs' } },
  },
  ssr: { noExternal: [/^@3db\//] },
});
