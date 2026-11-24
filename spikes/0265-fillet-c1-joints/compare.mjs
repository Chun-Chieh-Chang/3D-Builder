// Compares the fuzz outcomes of a local run (argv[2]) with the CI run's log (argv[3]): ROLLING-BALL-FUZZ / DRAFTED-SPLINE-FUZZ summaries (heap left
// out, it is printed, not asserted) and the window-rounds per-seed lines.
import { readFileSync } from 'node:fs';
const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
function outcomes(text) {
  const m = new Map();
  for (const line of clean(text).split(/\r?\n/)) {
    let x = /((?:ROLLING-BALL|DRAFTED-SPLINE)-FUZZ (?:rounds |walls )?\d+-\d+) (\{.*\})/.exec(line);
    if (x) { const o = JSON.parse(x[2]); delete o.heapMiB; delete o.worst; m.set(x[1], JSON.stringify(o)); continue; }
    x = /(#\d+(?:\.\d+)?) (rebuilt|not made|budget|refused)\b(.*)$/.exec(line);
    if (x) m.set('WR ' + x[1], (x[2] + x[3]).trim());
  }
  return m;
}
const a = outcomes(readFileSync(process.argv[2], 'utf8')), b = outcomes(readFileSync(process.argv[3], 'utf8'));
let same = 0; const diff = [];
for (const [k, v] of b) { if (!a.has(k)) diff.push(`missing locally: ${k}`); else if (a.get(k) !== v) diff.push(`${k}\n  CI:    ${v}\n  local: ${a.get(k)}`); else same++; }
for (const k of a.keys()) if (!b.has(k)) diff.push(`only locally: ${k}`);
console.log(`same ${same} of ${b.size} (local ${a.size})`); console.log(diff.join('\n'));
