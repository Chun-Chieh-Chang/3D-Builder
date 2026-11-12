// Heartbeat for the progress page (dev/index.html), run beside a CLI session by start-cli.cmd: every 30 s it writes dev/beat.js with the time, the
// newest change among the project's working files (which file, when) and whether the session is still alive. It never touches state.json/data.js,
// which only the work itself writes (prog.mjs). It stops when dev/beat-stop exists (start-cli.cmd creates it when the CLI exits) and then says so.
import { readdirSync, statSync, writeFileSync, renameSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const DEV = join(dirname(fileURLToPath(import.meta.url)), '..', 'dev'); const ROOT = join(DEV, '..', '..', '..');
const WATCH = ['packages', 'tests', 'apps/web/src', 'scratch/ff', 'docs', 'handoff.md', 'DEV_LOG.md', 'AGENTS.md'];
const SKIP = new Set(['node_modules', '.git', 'dist', 'target', 'out']);
const STOP = join(DEV, 'beat-stop'); if (existsSync(STOP)) rmSync(STOP);
const started = Date.now() / 1000;
function newest() {
  let best = { t: 0, f: '' };
  const walk = (p, depth) => { let st; try { st = statSync(p); } catch { return; }
    if (st.isFile()) { if (st.mtimeMs / 1000 > best.t) best = { t: st.mtimeMs / 1000, f: relative(ROOT, p).replaceAll('\\', '/') }; return; }
    if (!st.isDirectory() || depth > 6) return; for (const n of readdirSync(p)) if (!SKIP.has(n)) walk(join(p, n), depth + 1); };
  for (const w of WATCH) walk(join(ROOT, w), 0);
  return best;
}
function write(alive, why) {
  const b = { t: Date.now() / 1000, started, alive, why: why ?? '', activity: newest() };
  writeFileSync(join(DEV, 'beat.js.tmp'), 'window.BEAT=' + JSON.stringify(b) + ';', 'utf8'); renameSync(join(DEV, 'beat.js.tmp'), join(DEV, 'beat.js'));
}
write(true);
// started by start-cli.cmd, or by prog.mjs when it finds no fresh heartbeat; ends by itself when the work is marked stopped or has written no progress
// for 6 hours, so that it never lingers on its own
const idle = () => { try { const st = JSON.parse(readFileSync(join(DEV, 'state.json'), 'utf8')); return st.run?.state === 'stopped' || Date.now() / 1000 - (st.updated ?? 0) > 6 * 3600; } catch { return false; } };
const timer = setInterval(() => {
  if (existsSync(STOP)) { clearInterval(timer); write(false, 'CLI 已結束'); rmSync(STOP); process.exit(0); }
  if (idle()) { clearInterval(timer); write(false, '工作已停止或 6 小時沒有進度'); process.exit(0); }
  write(true);
}, 30_000);
