// Keeps user-facing text out of the code (D9.1): a line of code with Chinese characters in it is a text that
// cannot be translated. Texts belong to `@3db/i18n` and are read with `t(key)`.
//
// This is a ratchet. `i18n-baseline.json` records how many such lines each file still has; a file may have
// fewer, never more, and a file that is not listed may have none. Move a file's texts to the catalog, then
// run `node scripts/check-i18n.mjs --update` to lower its number. Comments and the catalog itself are not counted.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const BASELINE = join(root, 'scripts', 'i18n-baseline.json');
const CJK = /[　-〿一-鿿＀-￯]/;

const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? (name === 'node_modules' ? [] : files(p)) : /\.tsx?$/.test(name) ? [p] : [];
  });

/** Lines of code (not comments) with Chinese characters in them. */
function count(text) {
  let n = 0;
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) continue;
    if (CJK.test(line.replace(/\/\/.*$/, ''))) n += 1;
  }
  return n;
}

const roots = [join(root, 'apps', 'web', 'src'), ...readdirSync(join(root, 'packages')).map((p) => join(root, 'packages', p, 'src'))];
const catalog = join(root, 'packages', 'i18n', 'src', 'zh-TW');
const current = {};
for (const dir of roots) {
  let listed;
  try {
    listed = files(dir);
  } catch {
    continue; // a package without src
  }
  for (const file of listed) {
    if (file.startsWith(catalog + sep)) continue;
    const n = count(readFileSync(file, 'utf8'));
    if (n > 0) current[relative(root, file).split(sep).join('/')] = n;
  }
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const grown = Object.entries(current).filter(([f, n]) => n > (baseline[f] ?? 0));

if (process.argv.includes('--update')) {
  if (grown.length) {
    console.error(`Refusing to raise the baseline:\n  ${grown.map(([f, n]) => `${f}: ${baseline[f] ?? 0} → ${n}`).join('\n  ')}`);
    process.exit(1);
  }
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Baseline updated: ${Object.values(sorted).reduce((a, b) => a + b, 0)} lines in ${Object.keys(sorted).length} files`);
  process.exit(0);
}

if (grown.length) {
  console.error(
    `Text in code (${grown.length} file${grown.length > 1 ? 's' : ''}): use t('…') from @3db/i18n and add the text to packages/i18n/src/zh-TW\n  ` +
      grown.map(([f, n]) => `${f}: ${n} lines (allowed ${baseline[f] ?? 0})`).join('\n  '),
  );
  process.exit(1);
}
const total = Object.values(current).reduce((a, b) => a + b, 0);
const stale = Object.keys(baseline).filter((f) => (current[f] ?? 0) < baseline[f]);
console.log(`i18n OK: ${total} lines of text still in code (${Object.keys(current).length} files)${stale.length ? `; ${stale.length} file(s) can be lowered: node scripts/check-i18n.mjs --update` : ''}`);
