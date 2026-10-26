/** Rebuildable repository facts, document ownership and local-link validation. No product modules are executed. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uiJobs } from './ui-jobs.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = 'docs/repository-inventory.md';
const slash = value => value.split(sep).join('/');
const read = (root, file) => readFileSync(join(root, file), 'utf8');
export function repositoryFiles(root) {
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].filter(file => existsSync(join(root, file))).sort();
}
/** Each document has one role. Historical versions are evidence, not current feature claims. */
export function documentRole(file) {
  const named = {
    'README.md': '入口', 'handoff.md': '交接', 'DEV_LOG.md': '交付歷史', 'AGENTS.md': '工作規則', 'THIRD_PARTY_NOTICES.md': '授權',
    'docs/README.md': '文件導覽', 'docs/project-state.md': '產品現況', 'docs/development.md': '開發操作',
    'docs/repository-inventory.md': '衍生盤點', 'docs/cleanup-candidates.md': '清理紀錄',
    'docs/phase0-verification.md': '歷史驗證', 'docs/phase1-verification.md': '歷史驗證',
    'docs/blueprint.md': '範圍規格', 'docs/automated-acceptance.md': '驗證操作', 'docs/verification-coverage.md': '歷史驗證',
    'docs/implementation-sequence.md': '交付歷史', 'docs/sketch-constraint-expansion.md': '能力規格',
    'docs/fillet-picking-impact.md': '設計歷史', 'docs/ui-interaction-audit.md': '設計歷史', 'docs/handoff-history.md': '交接歷史',
  };
  if (named[file]) return named[file];
  if (/^docs\/adr\/[^/]+\.md$/.test(file)) return '架構決策';
  if (file.startsWith('docs/archive/')) return '封存歷史';
  if (file.startsWith('docs/design/')) return '設計提案';
  if (/^docs\/[^/]+-plan\.md$/.test(file)) return '階段計畫快照';
  if (/^apps\/[^/]+\/README\.md$/.test(file)) return '平台操作';
  if (file.startsWith('apps/web/src/icons/')) return '圖示授權';
  if (file.startsWith('tests/')) return '測試資料說明';
  if (file.startsWith('spikes/')) return '研究證據';
  throw new Error(`Document needs a single owner/role: ${file}`);
}
/** Ignore code examples; preserve line numbers. Accept ordinary and angle-delimited Markdown targets. */
export function markdownLinks(text) {
  const plain = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, block => block.replace(/[^\n]/g, ' ')).replace(/`[^`\n]+`/g, match => ' '.repeat(match.length));
  return [...plain.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+['"][^'"]*['"])?\s*\)/g)].map(match => ({ target: match[1] ?? match[2], line: plain.slice(0, match.index).split('\n').length }));
}
function exactPath(root, path) {
  let cursor = root;
  for (const name of relative(root, path).split(sep)) {
    if (!name || name === '.') continue;
    if (name === '..' || !existsSync(cursor) || !statSync(cursor).isDirectory() || !readdirSync(cursor).includes(name)) return false;
    cursor = join(cursor, name);
  }
  return existsSync(cursor);
}
export function localLinkProblems(root, file, text) {
  return markdownLinks(text).flatMap(({ target, line }) => {
    if (/^[a-z][\w+.-]*:/i.test(target) || target.startsWith('//')) return [];
    const local = target.split('#')[0].split('?')[0];
    if (!local) return [];
    let decoded; try { decoded = decodeURIComponent(local); } catch { return [`${file}:${line}: invalid URI ${target}`]; }
    const dest = resolve(dirname(join(root, file)), decoded);
    const rel = relative(root, dest);
    if (isAbsolute(decoded) || rel === '..' || rel.startsWith(`..${sep}`) || !exactPath(root, dest)) return [`${file}:${line}: missing, outside-repository or wrong-case target ${target}`];
    return [];
  });
}
export function auditRepository(root = ROOT) {
  const files = repositoryFiles(root), markdown = files.filter(file => file.endsWith('.md'));
  const documents = markdown.map(file => ({ file, title: read(root, file).match(/^#\s+(.+)$/m)?.[1] ?? file, role: documentRole(file) }));
  const problems = markdown.flatMap(file => localLinkProblems(root, file, read(root, file)));
  const schema = (file, constant) => {
    const value = read(root, file).match(new RegExp(`export const ${constant} = (\\d+);`));
    if (!value) throw new Error(`Cannot find schema source ${file}:${constant}`);
    return Number(value[1]);
  };
  const workspaces = files.filter(file => /^(?:apps|packages)\/[^/]+\/package\.json$/.test(file)).map(file => ({ file, ...JSON.parse(read(root, file)) }));
  const jobs = uiJobs(join(root, 'tests/e2e'));
  const manualIds = [...read(root, 'docs/manual-verification.html').matchAll(/<details\b[^>]*\bdata-id="([^"]+)"/g)].map(match => match[1]);
  if (!manualIds.length) problems.push('No manual acceptance IDs found; review the discovery contract');
  if (!jobs.some(job => job.calls.length)) problems.push('No runnable browser calls found');
  if (!workspaces.length) problems.push('No workspace manifests found');
  if (new Set(manualIds).size !== manualIds.length) problems.push('Duplicate manual acceptance IDs');
  const hashGroups = new Map();
  for (const file of files) {
    const bytes = readFileSync(join(root, file)), hash = createHash('sha256').update(bytes).digest('hex');
    if (!bytes.length) problems.push(`Empty tracked/source file needs review: ${file}`);
    const same = hashGroups.get(hash) ?? []; same.push(file); hashGroups.set(hash, same);
  }
  return {
    schemas: { part: schema('packages/model/src/schema.ts', 'SCHEMA_VERSION'), assembly: schema('packages/model/src/schema.ts', 'ASSEMBLY_SCHEMA_VERSION'), drawing: schema('packages/model/src/drawing.ts', 'DRAWING_SCHEMA_VERSION') },
    workspaces: workspaces.map(({ file, name }) => ({ file, name })),
    adrCount: files.filter(file => /^docs\/adr\/\d{4}-.*\.md$/.test(file)).length,
    ui: { files: files.filter(file => file.startsWith('tests/e2e/')).length, scripts: jobs.filter(job => job.calls.length).length, calls: jobs.reduce((sum, job) => sum + job.calls.length, 0) },
    manualItems: manualIds.length,
    wiki: files.some(file => file.toLowerCase().startsWith('wiki/')),
    dependencies: Object.entries(JSON.parse(read(root, 'package-lock.json')).packages).filter(([path, pkg]) => path.includes('node_modules/') && !pkg.link).map(([path, pkg]) => ({ name: path.split('node_modules/').at(-1), version: pkg.version, license: pkg.license ?? '未記載，需審閱', dev: !!pkg.dev, optional: !!pkg.optional })),
    cargoLockPackages: [...read(root, 'apps/desktop/src-tauri/Cargo.lock').matchAll(/^\[\[package\]\]$/gm)].length,
    scripts: Object.entries(JSON.parse(read(root, 'package.json')).scripts),
    documents, duplicateFiles: [...hashGroups.values()].filter(group => group.length > 1), problems,
  };
}
export function inventoryMarkdown(facts) {
  const lines = ['# 儲存庫盤點（自動產生）', '', '> 由 `npm run docs:sync` 從程式與工作區設定衍生；請勿手改。`npm run lint:repo` 會比對。數量不代表本版全部驗證通過。', '', '## 程式事實', '', '| 項目 | 程式來源值 |', '|---|---|', `| 零件／組合件／工程圖 Schema | ${facts.schemas.part}／${facts.schemas.assembly}／${facts.schemas.drawing} |`, `| ADR 文件 | ${facts.adrCount} |`, `| 瀏覽器檔案／可執行腳本／呼叫 | ${facts.ui.files}／${facts.ui.scripts}／${facts.ui.calls} |`, `| 實機清單項目 | ${facts.manualItems} |`, `| 本地 wiki/ | ${facts.wiki ? '存在，列於文件分類' : '不存在；未假定另有遠端 wiki'} |`, '', '## 工作區', '', '| 套件 | 設定來源 |', '|---|---|'];
  for (const w of facts.workspaces) lines.push(`| ${w.name} | [${w.file}](../${w.file}) |`);
  lines.push('', '## 開發指令', '', '| npm run | package.json 的實際內容 |', '|---|---|');
  for (const [name, command] of facts.scripts) lines.push(`| \`${name}\` | \`${command.replaceAll('|', '\\|')}\` |`);
  lines.push('', '## 鎖定依賴（含跨平台可選套件）', '', `npm lock條目：${facts.dependencies.length}，其中production標記${facts.dependencies.filter(d => !d.dev).length}、development標記${facts.dependencies.filter(d => d.dev).length}。此處按lockfile記錄，不等同本機安裝數或實際bundle包含數。`, '', `Cargo.lock：${facts.cargoLockPackages}個package條目（含本專案）。Rust授權未由lockfile提供，不能套用舊人工掃描結論。`, '', '| npm套件 | 鎖定版本 | lockfile授權欄 | 分類 |', '|---|---|---|---|');
  for (const d of facts.dependencies) lines.push(`| ${d.name} | ${d.version} | ${d.license} | ${d.dev ? 'development' : 'production'}${d.optional ? '／optional' : ''} |`);
  lines.push('', '## 文件分類（每份只有一個主要角色）', '', '操作與現況讀 [文件導覽](README.md)；決策、階段計畫與交付歷史的數字屬其記錄時間，不當成當前能力。', '');
  for (const role of [...new Set(facts.documents.map(d => d.role))].sort()) {
    lines.push(`### ${role}`, '');
    for (const d of facts.documents.filter(d => d.role === role)) lines.push(`- [${d.title.replaceAll('[', '').replaceAll(']', '')}](<${slash(relative('docs', d.file))}>)`);
    lines.push('');
  }
  lines.push('## 資源盤點', '', `逐位元相同的檔案群組：${facts.duplicateFiles.length}。相同內容只是候選，不能據此刪除不同平台圖示、測試探針或授權原稿。`, '');
  for (const group of facts.duplicateFiles) lines.push(`- ${group.map(file => `\`${file}\``).join('、')}`);
  return lines.join('\n');
}
function main() {
  const facts = auditRepository(), output = inventoryMarkdown(facts);
  if (process.argv.includes('--write')) writeFileSync(join(ROOT, INVENTORY), output);
  const at = process.argv.indexOf('--json');
  if (at >= 0) {
    if (!process.argv[at + 1]) throw new Error('--json requires an output path');
    const dest = resolve(ROOT, process.argv[at + 1]); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, JSON.stringify(facts, null, 2) + '\n');
  }
  const problems = [...facts.problems];
  if (!existsSync(join(ROOT, INVENTORY)) || read(ROOT, INVENTORY) !== output) problems.push(`Stale ${INVENTORY}; run npm run docs:sync`);
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.log(`Repository OK: ${facts.documents.length} documents, ${facts.workspaces.length} workspaces, ${facts.ui.calls} browser calls; local paths use exact case.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
