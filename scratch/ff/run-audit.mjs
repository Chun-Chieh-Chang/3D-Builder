// Runs scratch/ff/audit.test.ts once per STEP file under D:\3DB實機確認 (files with the same content once), appending to OUT; the progress page is
// updated at each file. usage: node scratch/ff/run-audit.mjs <out.jsonl> <phase> <idx>
import { readdirSync, statSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
const DIR = 'D:\\3DB實機確認';
const [out = 'scratch/ff/audit-c28.jsonl', phase = '2', idx = '16'] = process.argv.slice(2);
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(step|stp)$/i.test(n) ? [p] : []; });
const seen = new Set();
const list = walk(DIR).sort().filter((p) => { const h = createHash('sha256').update(readFileSync(p)).digest('hex'); if (seen.has(h)) return false; seen.add(h); return true; });
if (existsSync(out)) rmSync(out);
const prog = (...a) => execFileSync(process.execPath, ['scratch/claude-takeover/tools/prog.mjs', ...a.map(String)], { stdio: 'ignore' });
list.forEach((p, i) => {
  const rel = relative(DIR, p);
  prog('item', phase, idx, 'run', (i / list.length).toFixed(3), `實件回歸：${i}/${list.length} 檔，現在 ${rel}`);
  const r = spawnSync('npx.cmd', ['vitest', 'run', '--config', 'scratch/ff/ff.config.mts', 'scratch/ff/audit.test.ts', '--silent=false'], { env: { ...process.env, STEP_DIR: DIR, FILE: rel, OUT: resolve(out) }, encoding: 'utf8', shell: true, maxBuffer: 1 << 26 });
  const lines = (r.stdout + r.stderr).split(/\r?\n/).filter((l) => /^AUDIT|Error|FAIL/.test(l));
  console.log(`[${i + 1}/${list.length}] ${rel}\n  ${lines.join('\n  ')}`);
});
console.log('AUDIT-END', list.length);
