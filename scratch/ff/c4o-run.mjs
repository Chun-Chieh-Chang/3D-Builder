import fs from 'node:fs'; import { spawnSync } from 'node:child_process';
const K = 'packages/kernel/src/kernel.ts'; const orig = fs.readFileSync(K, 'utf8');
const a = 'return deviation <= tol ? { geometry, deviation } : null;'; if (!orig.includes(a)) throw new Error('anchor');
fs.writeFileSync(K, orig.replace(a, 'return { geometry, deviation };'));
try { const r = spawnSync('npx.cmd', ['vitest', 'run', '--config', 'scratch/ff/ff.config.mts', 'scratch/ff/c4o.test.ts'], { encoding: 'utf8', shell: true, maxBuffer: 1 << 26 }); console.log((r.stdout + r.stderr).match(/Tests\s+.*$/m)?.[0] ?? 'no summary'); }
finally { fs.writeFileSync(K, orig); }
