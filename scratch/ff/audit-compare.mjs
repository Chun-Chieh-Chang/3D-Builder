// Compare two real-part audits (jsonl from run-audit.mjs): rebuilt counts, regressions (rebuilt before, not now), gains, and slowdowns over 2×.
// usage: node scratch/ff/audit-compare.mjs <before.jsonl> <after.jsonl>
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2);
const read = (f) => new Map(readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((r) => [`${r.rel}|${r.label}`, r]));
const A = read(a), B = read(b);
const ok = (r) => r && r.status === 'rebuilt';
const count = (M) => [...M.values()].filter(ok).length;
console.log(`before ${count(A)}/${A.size} rebuilt; after ${count(B)}/${B.size}`);
for (const [k, r] of A) {
  const s = B.get(k);
  if (!s) console.log(`MISSING after: ${k}`);
  else if (ok(r) && !ok(s)) console.log(`REGRESSION: ${k}: ${s.status} ${String(s.reason ?? '').slice(0, 160)}`);
  else if (!ok(r) && ok(s)) console.log(`GAIN: ${k}`);
  else if (r.status !== s.status || (!ok(s) && String(r.reason).slice(0, 40) !== String(s.reason).slice(0, 40))) console.log(`CHANGED: ${k}: ${r.status} → ${s.status} ${String(s.reason ?? '').slice(0, 120)}`);
  if (s && r.ms && s.ms && s.ms > 2 * r.ms && s.ms - r.ms > 10000) console.log(`SLOWER: ${k}: ${r.ms} → ${s.ms} ms`);
}
