// Window-rounds fuzz outcomes per seed from three logs (CI or local, ANSI stripped or not): node window-outcomes.mjs <before> <after> <now>. A seed is
// read only under its own "stdout | …window-rounds-fuzz… > seed N" header: other kits print "#N rebuilt (…)" too.
import { readFileSync } from 'node:fs';
const clean = (s) => s.replace(/\^\[\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
const parse = (f) => { const m = new Map(); let cur = null;
  for (const raw of readFileSync(f, 'utf8').split('\n')) { const line = clean(raw);
    const h = /stdout \| (\S+) > seed (\d+)/.exec(line); if (h) { cur = /window-rounds-fuzz/.test(h[1]) ? h[2] : null; continue; }
    if (/stdout \|/.test(line)) { cur = null; continue; }
    const o = /#(\d+) (rebuilt|refused|budget) \(/.exec(line); if (o && cur === o[1]) m.set(+o[1], o[2]); }
  return m; };
const [a, b, c] = [...process.argv.slice(2, 5)].map(parse);
const count = (m) => [...m.values()].reduce((o, v) => (o[v] = (o[v] ?? 0) + 1, o), {});
console.log('464366fa CI', JSON.stringify(count(a)), '| 51d55cfc CI', JSON.stringify(count(b)), '| now local', JSON.stringify(count(c)), c.size);
for (let s = 1; s <= 100; s++) { const x = a.get(s) ?? '-', y = b.get(s) ?? '-', z = c.get(s) ?? '-'; if (x !== z || y !== z) console.log(s, x, y, '->', z); }
