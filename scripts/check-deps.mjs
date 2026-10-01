// Enforces the layering rules of the blueprint (§2.2): dependencies only point downward, and the
// UI main thread never imports the geometry kernel at runtime (OCCT lives in the Web Worker).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** package → internal packages it may import. This table is the single definition of the layering. */
const ALLOWED = {
  i18n: [],
  model: ['i18n'],
  sketch: ['model', 'i18n'],
  naming: ['model'],
  kernel: ['i18n'],
  assembly: ['model', 'i18n'],
  regen: ['model', 'sketch', 'naming', 'assembly', 'kernel', 'i18n'],
  io: ['model', 'kernel', 'i18n'],
  render: [],
};

/** Main-thread UI files may use these only as `import type` (runtime code stays in the worker). */
const WORKER_ONLY = ['kernel', 'regen', 'sketch', 'io'];
// Pure-TypeScript entry points without WASM: parent/child derivation and sketch interaction geometry.
const MAIN_THREAD_ALLOWED_SUBPATHS = ['@3db/regen/dag', '@3db/io', '@3db/sketch/interact', '@3db/sketch/ops', '@3db/sketch/check', '@3db/sketch/profiles'];

const root = process.cwd();
const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });

const IMPORT = /^\s*import\s+(type\s+)?[^'"]*?from\s+['"](@3db\/[^'"]+)['"]/gm;
const violations = [];

for (const pkg of Object.keys(ALLOWED)) {
  for (const file of files(join(root, 'packages', pkg, 'src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = m[2].split('/')[1];
      if (target !== pkg && !ALLOWED[pkg].includes(target)) {
        violations.push(`${relative(root, file)}: @3db/${pkg} must not import ${m[2]}`);
      }
    }
  }
}

for (const file of files(join(root, 'apps', 'web', 'src'))) {
  if (file.includes(`${sep}worker${sep}`)) continue;
  for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
    const [, isType, spec] = m;
    const target = spec.split('/')[1];
    if (!isType && WORKER_ONLY.includes(target) && !MAIN_THREAD_ALLOWED_SUBPATHS.includes(spec)) {
      violations.push(`${relative(root, file)}: main-thread UI imports ${spec} at runtime (use the worker or \`import type\`)`);
    }
  }
}

if (violations.length) {
  console.error(`Layering violations (${violations.length}):\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log('Layering OK');
