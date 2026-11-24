// Self and total time per function of a .cpuprofile; wasm frames are named by the module's name section (or wasm-function[N]).
import { readFileSync } from 'node:fs';
const p = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const dt = new Map(); p.samples.forEach((s, i) => dt.set(s, (dt.get(s) ?? 0) + (p.timeDeltas[i] ?? 0)));
const label = (n) => { const f = n.callFrame; const file = f.url.split('/').slice(-1)[0]; return `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`; };
const self = new Map(), total = new Map(); let all = 0;
for (const [id, t] of dt) {
  all += t; const n = byId.get(id); self.set(label(n), (self.get(label(n)) ?? 0) + t);
  const seen = new Set(); let cur = id;
  while (cur != null) { const l = label(byId.get(cur)); if (!seen.has(l)) { seen.add(l); total.set(l, (total.get(l) ?? 0) + t); } cur = parent.get(cur); }
}
const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([l, t]) => `${(t / 1e6).toFixed(1).padStart(7)} s ${(100 * t / all).toFixed(1).padStart(5)}%  ${l}`).join('\n');
console.log(`total ${(all / 1e6).toFixed(1)} s`);
console.log('--- self'); console.log(top(self, Number(process.argv[3] ?? 25)));
console.log('--- total (inclusive), JS frames from the repo'); console.log(top(new Map([...total].filter(([l]) => /\.ts:|\.mjs:|\.js:/.test(l) && !/node_modules\/(vitest|@vitest|tinypool)/.test(l))), Number(process.argv[4] ?? 40)));
