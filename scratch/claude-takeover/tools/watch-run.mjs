// Progress-page watcher for a long run: real done/total counts read from the run's log, written with prog.mjs at start, every INTERVAL seconds, and at the end.
// usage: node watch-run.mjs <ui|unit> <log> <phase> <idx> <total> [intervalSec=300]
//   ui:   counts verify-ui status lines (PASS/KNOWN/FAIL/ERROR/CONSOLE/NO ENTRY); done at "N of M pass"
//   unit: counts finished vitest files (✓/❯/× file lines); done at the "Test Files" summary
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const [mode, log, phase, idx, totalArg, iv] = process.argv.slice(2);
const total = Number(totalArg); const interval = Number(iv ?? 300) * 1000;
const PROG = join(dirname(fileURLToPath(import.meta.url)), 'prog.mjs');
const prog = (...a) => execFileSync(process.execPath, [PROG, ...a.map(String)], { stdio: 'ignore' });
const read = () => (existsSync(log) ? readFileSync(log, 'utf8').replace(/^﻿/, '') : '');
const name = mode === 'ui' ? 'verify:ui' : '全量單元測試';
const scan = () => {
  const t = read();
  if (mode === 'ui') {
    const rows = t.split(/\r?\n/).filter((l) => /^(PASS|KNOWN|FAIL|ERROR|CONSOLE|NO ENTRY)\s/.test(l));
    const bad = rows.filter((l) => !/^(PASS|KNOWN)\s/.test(l)).length;
    const end = t.match(/(\d+) of (\d+) pass; (\d+) pass with a known defect written down; (\d+) do not\./);
    return { done: rows.length, bad, end: end ? `${end[1]}/${end[2]} 通過、${end[3]} 已知缺陷、${end[4]} 未過` : null, failed: end ? Number(end[4]) > 0 : bad > 0 };
  }
  const files = t.split(/\r?\n/).filter((l) => /^\s*(✓|❯|×)\s+\S+\.test\.\w+/.test(l));
  const bad = files.filter((l) => /^\s*(❯|×)/.test(l)).length;
  const sf = t.match(/Test Files\s+([^\r\n]+)/), st = t.match(/\n\s+Tests\s+([^\r\n]+)/);
  return { done: files.length, bad, end: sf ? `檔案 ${sf[1].trim()}；測試 ${st ? st[1].trim() : '?'}` : null, failed: sf ? /failed/.test(sf[1]) : bad > 0 };
};
const note = (s) => `${name}：${s.done}/${total}${s.bad ? `，未過 ${s.bad}` : ''}`;
prog('item', phase, idx, 'run', 0, `${name}：開始（共 ${total}）`); prog('log', `${name} 開始（共 ${total}）`);
const tick = () => {
  const s = scan();
  if (s.end) {
    prog('item', phase, idx, s.failed ? 'run' : 'ok', 1, `${name} 結束：${s.end}`); prog('log', `${name} 結束：${s.end}`);
    console.log('WATCH-END', s.end); process.exit(0);
  }
  prog('item', phase, idx, 'run', Math.min(0.99, s.done / total).toFixed(3), note(s)); console.log('WATCH', note(s));
};
tick(); setInterval(tick, interval);
