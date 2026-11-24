// Sums up out/fillet-probe/*.jsonl: how each fillet call's tries ended, and above all whether a later fillet shape ever succeeded after an earlier
// one was refused for its tolerance (or for BRepCheck, or failed to build).
import { readdirSync, readFileSync } from 'node:fs';
const dir = process.argv[2] ?? 'out/fillet-probe';
const recs = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const RATIO = 0.25;
const why = (t) => (t.err ? 'build' : t.valid === false ? 'invalid' : t.tol !== undefined && t.tol > 0 ? 'tol?' : 'ok');
const pattern = (r) => r.tries.map((t, i) => (t.err ? 'B' : t.valid === false ? 'V' : i === r.tries.length - 1 && r.outcome === 'ok' ? 'ok' : 'T')).join(',');
const count = {};
for (const r of recs) { const k = `${pattern(r)} -> ${r.outcome}`; count[k] = (count[k] ?? 0) + 1; }
console.log('calls', recs.length, 'files', new Set(recs.map((r) => r.file)).size);
console.log(Object.entries(count).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}\t${k}`).join('\n'));
const rescued = recs.filter((r) => r.outcome === 'ok' && r.tries.length > 1);
const after = (c) => rescued.filter((r) => r.tries.slice(0, -1).some((t) => (c === 'T' ? !t.err && t.valid !== false : c === 'V' ? t.valid === false : t.err)));
for (const c of ['T', 'V', 'B']) { const a = after(c); console.log(`\nrescued after an earlier ${c}: ${a.length}`); for (const r of a.slice(0, 15)) console.log(' ', r.file, '|', r.test?.slice(0, 90), '| r', r.r, 'tries', JSON.stringify(r.tries)); }
const tAll = recs.filter((r) => r.tries.length && !r.tries[0].err && r.tries[0].valid !== false && (r.tries.length > 1 || r.outcome === 'throw'));
console.log('\ncalls whose first try built, passed BRepCheck and was refused for tolerance:', tAll.length);
const time = (f) => recs.filter(f).reduce((s, r) => s + r.ms, 0) / 1000;
console.log('seconds in fillet: all', time(() => true).toFixed(1), '| bisection', time((r) => r.bisect).toFixed(1), '| tries after a tolerance refusal', (recs.reduce((s, r) => { const i = r.tries.findIndex((t) => !t.err && t.valid !== false && t !== r.tries[r.tries.length - 1]); return s + (i < 0 ? 0 : r.tries.slice(i + 1).reduce((a, t) => a + (t.build ?? 0), 0)); }, 0) / 1000).toFixed(1));
