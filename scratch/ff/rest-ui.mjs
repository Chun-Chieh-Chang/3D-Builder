// Which verify:ui files a stopped run did not reach; writes the --only regex for them.
// usage: node scratch/ff/rest-ui.mjs <log> <out>
import { readFileSync, writeFileSync } from 'node:fs';
import { uiJobs } from '../../scripts/ui-jobs.mjs';
const [log, out] = process.argv.slice(2);
const rows = readFileSync(log, 'utf8').split(/\r?\n/).filter((l) => /^(PASS|KNOWN|FAIL|ERROR|CONSOLE|NO ENTRY)\s/.test(l));
const seen = new Map();
for (const l of rows) { const f = l.replace(/^NO ENTRY/, 'NOENTRY').trim().split(/\s+/)[1]; seen.set(f, (seen.get(f) ?? 0) + 1); }
const jobs = [...uiJobs('tests/e2e', null)];
const rest = jobs.filter(({ file, calls }) => (seen.get(file) ?? 0) < calls.length);
const partial = rest.filter(({ file }) => seen.has(file));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
writeFileSync(out, `^(${rest.map(({ file }) => esc(file)).join('|')})$`);
console.log('files', jobs.length, 'calls', jobs.reduce((a, j) => a + j.calls.length, 0));
console.log('rest files', rest.length, 'calls', rest.reduce((a, j) => a + j.calls.length, 0), 'partial', partial.map((j) => j.file).join(','));
console.log(rest.map((j) => j.file).join(' '));
