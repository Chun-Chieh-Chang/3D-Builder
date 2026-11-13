// Adds the files with a FAIL/ERROR/CONSOLE/NO ENTRY row in <log> to the --only regex in <file> (written by rest-ui.mjs).
// usage: node scratch/ff/rest-bad.mjs <log> <file>
import { readFileSync, writeFileSync } from 'node:fs';
const [log, file] = process.argv.slice(2);
const rows = readFileSync(log, 'utf8').split(/\r?\n/).filter((l) => /^(FAIL|ERROR|CONSOLE|NO ENTRY)\s/.test(l));
const bad = [...new Set(rows.map((l) => l.replace(/^NO ENTRY/, 'NOENTRY').trim().split(/\s+/)[1]))];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inner = readFileSync(file, 'utf8').slice(2, -2).split('|').filter(Boolean);
for (const b of bad) if (!inner.includes(esc(b))) inner.push(esc(b));
writeFileSync(file, `^(${inner.join('|')})$`);
console.log('bad', bad.join(' '), '| files', inner.length);
