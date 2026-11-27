// Runs the ten rolling-ball fuzz files and prints each file's outcome line (ROLLING-BALL-FUZZ …), for a comparison before and after a change.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const tag = process.argv[2] ?? 'after';
const files = ['', '-2', '-3', '-4', '-5', '-6', '-7', '-8', '-9', '-10'].map((s) => `tests/phase8/recognize-rolling-ball-fuzz${s}.test.ts`);
let out = '';
try { out = execSync(`npx vitest run ${files.join(' ')} --maxWorkers 2 --reporter=verbose --silent=false`, { encoding: 'utf8', maxBuffer: 1 << 28 }); } catch (e) { out = e.stdout ?? String(e); }
const lines = out.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.includes('ROLLING-BALL-FUZZ') || /Tests +\d|Test Files/.test(l));
writeFileSync(`spikes/exact-round-rebuild/data/classes-${tag}.txt`, lines.join('\n'));
console.log(lines.join('\n'));
