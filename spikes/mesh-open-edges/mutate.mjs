// Mutations of the open-edge gate of part_verify_against_2d (2026-11-26): each must turn apps/mcp/test/verify2d.test.ts red. Each match occurs exactly once
// (asserted); the file is restored byte for byte after each, and checked.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const FILE = 'apps/mcp/src/verify2d.ts';
const MUTANTS = [
  ['open edges not in the verdict', 'pass: unmeshedFaces.length === 0 && openEdges === 0 && totalFaces > 0,', 'pass: unmeshedFaces.length === 0 && totalFaces > 0,'],
  ['never any open edge', '  let open = 0;\n  for (const n of use.values()) if (n === 1) open++;\n  return open;', '  return 0;'],
  ['a squeezed triangle counted', '      if (a === b) continue;\n', ''],
  ['no welding', 'Math.round(mesh.positions[3 * k]! * 1e4)', 'k'],
  ['the faces-without-triangles gate off', '      unmeshedFaces.push(fi);', '      void fi;'],
];
const run = () => { try { execSync('npx vitest run apps/mcp/test/verify2d.test.ts', { stdio: 'pipe' }); return 'green'; } catch (e) { return 'RED: ' + (String(e.stdout).replace(/\x1b\[[0-9;]*m/g, '').match(/^\s*×.*$/gm) ?? ['(no test lines)']).map((l) => l.trim().slice(0, 90)).join(' | '); } };
const original = readFileSync(FILE);
const text = original.toString('utf8');
console.log('unmutated:', run());
for (const [name, from, to] of MUTANTS) {
  const n = text.split(from).length - 1;
  if (n !== 1) { console.log(`${name}: match occurs ${n} times, not run`); continue; }
  try { writeFileSync(FILE, text.replace(from, to)); console.log(`${name}:`, run()); } finally { writeFileSync(FILE, original); }
}
console.log('restored:', Buffer.compare(readFileSync(FILE), original) === 0);
