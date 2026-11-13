// Seeds FROM..TO of the rolling-ball recognition fuzz in batches of 10, each batch its own process (fresh heap); progress page per batch.
// usage: node scratch/ff/run-rbfuzz.mjs <from> <to> <phase> <idx>
import { spawnSync, execFileSync } from 'node:child_process';
const [from, to, phase, idx] = process.argv.slice(2).map(Number);
const prog = (...a) => execFileSync(process.execPath, ['scratch/claude-takeover/tools/prog.mjs', ...a.map(String)], { stdio: 'ignore' });
for (let a = from; a <= to; a += 10) {
  const b = Math.min(to, a + 9);
  prog('item', phase, idx, 'run', ((a - from) / (to - from + 1)).toFixed(3), `fuzz 量測：種子 ${a}–${b}（共 ${from}–${to}）`);
  const r = spawnSync('npx.cmd', ['vitest', 'run', '--config', 'scratch/ff/ff.config.mts', 'scratch/ff/rbfuzz.test.ts', '--silent=false'], { env: { ...process.env, FROM: String(a), TO: String(b) }, encoding: 'utf8', shell: true, maxBuffer: 1 << 26 });
  const lines = (r.stdout + r.stderr).split(/\r?\n/).filter((l) => /ROLLING-BALL|×|Error|Exception|constructor:/.test(l));
  console.log(lines.join('\n'));
}
console.log('RBFUZZ-END');
