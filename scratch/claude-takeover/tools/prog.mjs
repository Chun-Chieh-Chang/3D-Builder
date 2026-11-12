// Node port of prog.py for the Windows host (same state.json/data.js format).
// usage: node prog.mjs stop <why> | item <phase> <idx> <st> [frac|-] [note] | now <html> | log <msg> | target <idx1based> <st> [note] | add <phase> <text> | find <text>
import { readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const D = join(dirname(fileURLToPath(import.meta.url)), '..', 'dev'); const S = join(D, 'state.json');
const s = JSON.parse(readFileSync(S, 'utf8')); const a = process.argv.slice(2); const now = Date.now() / 1000;
if (a[0] === 'find') { s.phases.forEach((p, i) => p.items.forEach((it, j) => { if ((p.name + it.t).includes(a[1])) console.log(i, j, it.st, it.t); })); process.exit(0); }
s.run = a[0] === 'stop' ? { state: 'stopped', t: now, why: a[1] ?? '' } : { state: 'running', t: now };
if (a[0] === 'item') { const it = s.phases[+a[1]].items[+a[2]]; it.st = a[3]; if (a[4] !== undefined && a[4] !== '-') it.frac = +a[4]; if (a[5] !== undefined) it.note = a[5]; }
else if (a[0] === 'now') { s.now = a[1]; s.nowT = now; }
else if (a[0] === 'log') { s.log.push({ t: now, m: a[1] }); s.log = s.log.slice(-60); }
else if (a[0] === 'target') { const t = s.targets[+a[1] - 1]; t.st = a[2]; if (a[3] !== undefined) t.note = a[3]; }
else if (a[0] === 'add') s.phases[+a[1]].items.push({ t: a[2], st: 'wait' });
s.updated = now;
// the newest change among the working files, so that the page can tell work going on without a separate heartbeat (see livebeat.mjs)
try {
  const ROOT = join(D, '..', '..', '..'); const SKIP = new Set(['node_modules', '.git', 'dist', 'target', 'out']); let best = { t: 0, f: '' };
  const walk = (p, depth) => { let st; try { st = statSync(p); } catch { return; } if (st.isFile()) { if (st.mtimeMs / 1000 > best.t) best = { t: st.mtimeMs / 1000, f: relative(ROOT, p).replaceAll('\\', '/') }; return; } if (!st.isDirectory() || depth > 6) return; for (const n of readdirSync(p)) if (!SKIP.has(n)) walk(join(p, n), depth + 1); };
  for (const w of ['packages', 'tests', 'apps/web/src', 'scratch/ff', 'docs', 'handoff.md', 'DEV_LOG.md', 'AGENTS.md']) walk(join(ROOT, w), 0);
  s.activity = best;
} catch { /* the page does without */ }
// keep the heartbeat going while the work runs: started here (detached, outlives this call) when beat.js is missing or more than 90 s old
if (a[0] !== 'stop') try {
  let fresh = false; try { const b = JSON.parse(readFileSync(join(D, 'beat.js'), 'utf8').replace(/^window\.BEAT=/, '').replace(/;\s*$/, '')); fresh = b.alive && now - b.t < 90; } catch { /* none yet */ }
  if (!fresh) spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'livebeat.mjs')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
} catch { /* the page falls back on progress and the activity above */ }
writeFileSync(S, JSON.stringify(s), 'utf8');
writeFileSync(join(D, 'data.js.tmp'), 'window.DEV=' + JSON.stringify(s) + ';', 'utf8'); renameSync(join(D, 'data.js.tmp'), join(D, 'data.js'));
