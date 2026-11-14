import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build, type Plugin } from 'vite';

const moduleId = 'virtual:disassembly-viewer';
const entry = fileURLToPath(new URL('../src/disassembly/viewer.js', import.meta.url));

/** Bundle the offline viewer as a classic script that can run from a local HTML file. */
export function disassemblyBundle(): Plugin {
  return {
    name: 'disassembly-bundle',
    resolveId(id) { if (id === moduleId) return `\0${id}`; },
    async load(id) {
      if (id !== `\0${moduleId}`) return;
      this.addWatchFile(entry);
      const output = await build({ configFile: false, logLevel: 'silent', build: {
        write: false, minify: true, target: 'es2022', lib: { entry, name: 'DisassemblyViewer', formats: ['iife'] },
      } });
      const result = Array.isArray(output) ? output[0] : output;
      if (!result || !('output' in result)) throw new Error('The offline viewer did not compile');
      const script = result.output.find((file) => file.type === 'chunk');
      if (!script) throw new Error('The offline viewer bundle is empty');
      const require = createRequire(entry);
      const license = await readFile(resolve(require.resolve('three'), '../../LICENSE'), 'utf8');
      return `export default ${JSON.stringify(`/*!\n${license}\n*/\n${script.code}`)};`;
    },
  };
}
