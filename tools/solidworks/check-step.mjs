// Checks the STEP files that BatchExportStep.bas wrote: what each file holds, and whether an assembly kept its structure.
//
//   node tools/solidworks/check-step.mjs "D:\parts\STEP"
//
// For every .step / .stp under the folder it counts the products (PRODUCT), the assembly usages (NEXT_ASSEMBLY_USAGE_OCCURRENCE: one per component placed in an assembly) and the
// solids (MANIFOLD_SOLID_BREP, BREP_WITH_VOIDS). With export-log.csv beside them it also says which of the files were assemblies: an assembly with no usages was flattened into one
// solid, which is the thing to look for (it is then not an assembly in 3D-Builder either). Exit code 1 when something is wrong, so it can be used in a script.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const root = process.argv[2];
if (!root || !existsSync(root)) {
  console.error('usage: node tools/solidworks/check-step.mjs <the STEP folder BatchExportStep wrote>');
  process.exit(2);
}

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (['.step', '.stp'].includes(extname(name).toLowerCase())) files.push(p);
  }
};
walk(root);

/** The log of the macro: file → kind, result (a quoted CSV, UTF-16 as the macro writes it, or UTF-8). */
const kinds = new Map();
/** Paths compared in one spelling: lower case, forward slashes (the log has the Windows paths the macro used). */
const norm = (p) => p.replaceAll('\\', '/').toLowerCase();
const logPath = join(root, 'export-log.csv');
if (existsSync(logPath)) {
  const raw = readFileSync(logPath);
  const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
  for (const line of text.split(/\r?\n/).slice(1)) {
    // file,kind,result,message,seconds,step — the quoted ones are file, message and step
    const parts = line.match(/^"((?:[^"]|"")*)",([^,]*),([^,]*),"((?:[^"]|"")*)",([^,]*),"((?:[^"]|"")*)"$/);
    if (parts) kinds.set(norm(parts[6].replace(/""/g, '"')), { kind: parts[2], result: parts[3], source: parts[1].replace(/""/g, '"') });
  }
}

const count = (text, entity) => (text.match(new RegExp(`=\\s*${entity}\\s*\\(`, 'g')) ?? []).length;
let problems = 0;
const rows = [];
for (const file of files) {
  const text = readFileSync(file, 'latin1');
  const row = { file: relative(root, file), products: count(text, 'PRODUCT'), usages: count(text, 'NEXT_ASSEMBLY_USAGE_OCCURRENCE'), solids: count(text, 'MANIFOLD_SOLID_BREP') + count(text, 'BREP_WITH_VOIDS'), note: '' };
  const tail = '/' + norm(relative(root, file));
  const known = [...kinds].find(([path]) => path.endsWith(tail))?.[1];
  if (!text.includes('ISO-10303-21')) row.note = 'not a STEP file';
  else if (row.solids === 0) row.note = 'no solid in it (surfaces only, or empty)';
  else if (known?.kind === 'assembly' && row.usages === 0) row.note = 'an assembly with no assembly structure: flattened into one body';
  else if (known?.kind === 'part' && row.usages > 0) row.note = 'a part with assembly usages (a multi-body part?)';
  if (row.note) problems++;
  rows.push(row);
}
for (const [step, info] of kinds) if (info.result === 'failed') {
  console.log(`FAILED in the log: ${info.source}`);
  problems++;
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('file', 60)} ${pad('products', 9)} ${pad('usages', 7)} ${pad('solids', 7)} note`);
for (const r of rows) console.log(`${pad(r.file, 60)} ${pad(r.products, 9)} ${pad(r.usages, 7)} ${pad(r.solids, 7)} ${r.note}`);
console.log(`\n${rows.length} STEP files, ${problems} to look at.`);
process.exit(problems > 0 ? 1 : 0);
