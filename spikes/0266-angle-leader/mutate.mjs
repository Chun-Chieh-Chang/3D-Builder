// Mutations of the angle dimension's leader (ADR 0266): each must turn apps/mcp/test/drawing-angle-leader.test.ts red. Each match occurs exactly once
// (asserted); the file is restored byte for byte after each, and checked at the end.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const MUTANTS = [
  ['still dropped', 'apps/mcp/src/drawingSession.ts', "        commands.push({ type: 'setDimension', dimensionId: d.id, patch: { leader: LEADER_ANGLE_LENGTH, angle: 45, ...supplementary } });\n        leadered.push(d.id);", '        detached.push(d.id);'],
  ['wrong value with a leader', 'packages/drawing/src/dimension.ts', "    return { value, text, ...stackedParts(parts), items, handle: { kind: 'round', centre: tip, radius: 0 }", "    return { value: value * 1.001, text, ...stackedParts(parts), items, handle: { kind: 'round', centre: tip, radius: 0 }"],
  ['no check of the leader', 'packages/model/src/drawing.ts', "    if (d.leader !== undefined && !(Number.isFinite(d.leader) && d.leader > 0)) throw new CommandError(t('drawing.dimBadLeader'));\n    if (d.angle !== undefined", '    if (d.angle !== undefined'],
  ['no check of the pair', 'packages/model/src/drawing.ts', "    if ((d.leader === undefined) !== (d.angle === undefined)) throw new CommandError(t('drawing.dimLeaderPair'));\n", ''],
  ['leader dropped on reading', 'packages/model/src/serialize.ts', '  raw = upgrade(raw, DRAWING_SCHEMA_VERSION, drawingMigrations);\n', "  raw = upgrade(raw, DRAWING_SCHEMA_VERSION, drawingMigrations);\n  for (const pg of raw.pages ?? []) for (const d of pg.dimensions ?? []) if (d.kind === 'angle') { delete d.leader; delete d.angle; }\n"],
  ['no migration to 45', 'packages/model/src/serialize.ts', '  44: (doc) => doc,\n};', '};'],
];
const run = () => { try { execSync('npx vitest run apps/mcp/test/drawing-angle-leader.test.ts', { stdio: 'pipe' }); return 'green'; } catch (e) { return 'RED: ' + (String(e.stdout).replace(/\x1b\[[0-9;]*m/g, '').match(/^\s*×.*$/gm) ?? ['(no test lines: ' + String(e.stdout).slice(-200) + ')']).map((l) => l.trim().slice(0, 90)).join(' | '); } };
console.log('unmutated:', run());
for (const [name, file, from, to] of MUTANTS) {
  const original = readFileSync(file);
  const text = original.toString('utf8');
  const n = text.split(from).length - 1;
  if (n !== 1) { console.log(`${name}: match occurs ${n} times, not run`); continue; }
  try { writeFileSync(file, text.replace(from, to)); console.log(`${name}:`, run()); } finally { writeFileSync(file, original); }
  if (Buffer.compare(readFileSync(file), original) !== 0) throw new Error(`${file} not restored`);
}
console.log('restored');
