// Mutations of the shared blend rebuild (2026-11-26): each must turn a test of tests/phase8/recognize-shared-blend-rebuild.test.ts red. Each match is
// asserted to occur exactly once; the file is restored byte for byte after each, and checked against the original at the end.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const FILE = 'packages/regen/src/recognize/reconstruct.ts';
const original = readFileSync(FILE);
const text = original.toString('utf8');
const MUTANTS = [
  ['never shared', "options.shareBlendRebuilds === false", 'true'],
  ['always apart', 'return others.every((o) => {', 'return true || others.every((o) => {'],
  ['placed blends not remembered', '        since.push(blend);\n', ''],
  ['no reach', 'const BLEND_REACH = 4;', 'const BLEND_REACH = 0;'],
];
const run = () => { try { execSync('npx vitest run tests/phase8/recognize-shared-blend-rebuild.test.ts -t "blendsApart|a box"', { stdio: 'pipe' }); return 'green'; } catch (e) { return 'RED: ' + (String(e.stdout).replace(/\x1b\[[0-9;]*m/g, '').match(/^\s*×.*$/gm) ?? []).map((l) => l.trim().slice(0, 110)).join(' | '); } };
console.log('unmutated:', run());
for (const [name, from, to] of MUTANTS) {
  const n = text.split(from).length - 1;
  if (n !== 1) { console.log(`${name}: match occurs ${n} times, not run`); continue; }
  try { writeFileSync(FILE, text.replace(from, to)); console.log(`${name}:`, run()); } finally { writeFileSync(FILE, original); }
}
console.log('restored:', Buffer.compare(readFileSync(FILE), original) === 0);
