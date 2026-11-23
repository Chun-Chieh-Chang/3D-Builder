/**
 * Stages the self-contained MCP server runtime and native launcher for Tauri desktop bundling:
 *   - Builds `@3db/mcp` (`apps/mcp/dist/`)
 *   - Compiles the tiny Rust launcher `3d-builder-mcp.exe` into `src-tauri/binaries/3d-builder-mcp-x86_64-pc-windows-msvc.exe`
 *   - Populates `src-tauri/resources/mcp/` with `node.exe`, `dist/`, `package.json`, `licenses/dxf-parser-MIT.txt`, and the stripped runtime `node_modules/`
 *     (only `opencascade_single.wasm` from `libcascade`, no multi-thread WASM, symbols, `.d.ts`, or docs).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, '..');
const repoRoot = resolve(desktopDir, '..', '..');
const tauriDir = join(desktopDir, 'src-tauri');
const mcpSrcDir = join(repoRoot, 'apps', 'mcp');
const stageDir = join(tauriDir, 'resources', 'mcp');
const binDir = join(tauriDir, 'binaries');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rustcCmd = process.platform === 'win32' ? 'rustc.exe' : 'rustc';
const targetTriple = process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-unknown-linux-gnu';
const exeExt = process.platform === 'win32' ? '.exe' : '';

function run(cmd, args, cwd = repoRoot) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd.endsWith('.cmd') });
}

// 1. Build @3db/mcp
run(npmCmd, ['run', 'build', '-w', '@3db/mcp']);

// 2. Compile zero-dependency Rust launcher directly into src-tauri/binaries/<name>-<triple><ext>
mkdirSync(binDir, { recursive: true });
const launcherSrc = join(__dirname, '3d-builder-mcp.rs');
const stagedLauncher = join(binDir, `3d-builder-mcp-${targetTriple}${exeExt}`);
run(rustcCmd, ['-O', '-C', 'strip=symbols', launcherSrc, '-o', stagedLauncher]);

// 3. Reset resources/mcp/
rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, 'node_modules'), { recursive: true });

// 4. Copy bundled Node runtime + MCP dist + minimal package.json
copyFileSync(process.execPath, join(stageDir, `node${exeExt}`));
cpSync(join(mcpSrcDir, 'dist'), join(stageDir, 'dist'), { recursive: true });
writeFileSync(join(stageDir, 'package.json'), JSON.stringify({ name: '@3db/mcp-runtime', private: true, type: 'module' }, null, 2) + '\n');

// 4b. Third-party licence texts the standalone MCP package must carry: the DXF/DWG colour table in the drawing export comes from dxf-parser (MIT).
// A missing file stops the staging; a package without its licence text must not be built.
const licenseSrc = join(repoRoot, 'apps', 'web', 'public', 'licenses', 'dxf-parser-MIT.txt');
if (!existsSync(licenseSrc)) throw new Error(`Licence text missing, cannot stage the MCP runtime: ${licenseSrc}`);
mkdirSync(join(stageDir, 'licenses'), { recursive: true });
copyFileSync(licenseSrc, join(stageDir, 'licenses', 'dxf-parser-MIT.txt'));

// 5. Trace full runtime npm dependency closure across @3db/mcp and every @3db/* workspace package it bundles
const workspacePkgs = new Map();
const packagesRoot = join(repoRoot, 'packages');
for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pj = join(packagesRoot, entry.name, 'package.json');
  if (!existsSync(pj)) continue;
  const parsed = JSON.parse(readFileSync(pj, 'utf8'));
  if (parsed.name) workspacePkgs.set(parsed.name, parsed);
}
const mcpPkg = JSON.parse(readFileSync(join(mcpSrcDir, 'package.json'), 'utf8'));
const seen = new Set();
const visitedWorkspaces = new Set();
const queue = [...Object.keys(mcpPkg.dependencies ?? {})];
while (queue.length > 0) {
  const pkgName = queue.shift();
  if (workspacePkgs.has(pkgName)) {
    if (visitedWorkspaces.has(pkgName)) continue;
    visitedWorkspaces.add(pkgName);
    for (const dep of Object.keys(workspacePkgs.get(pkgName).dependencies ?? {})) queue.push(dep);
    continue;
  }
  if (seen.has(pkgName)) continue;
  const pkgJsonPath = join(repoRoot, 'node_modules', pkgName, 'package.json');
  if (!existsSync(pkgJsonPath)) continue;
  seen.add(pkgName);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push(dep);
}

const SKIP_DIRS = new Set(['test', 'tests', '__tests__', 'docs', 'doc', 'example', 'examples', '.github']);
const SKIP_EXTS = ['.d.ts', '.d.mts', '.d.cts', '.map', '.md', '.ts', '.symbols'];

function copyFiltered(src, dst) {
  const st = statSync(src);
  if (st.isDirectory()) {
    const base = src.split(/[\\/]/).pop();
    if (SKIP_DIRS.has(base)) return;
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) copyFiltered(join(src, entry), join(dst, entry));
    return;
  }
  const lower = src.toLowerCase();
  if (SKIP_EXTS.some((ext) => lower.endsWith(ext))) return;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

for (const pkgName of seen) {
  const srcPkg = join(repoRoot, 'node_modules', pkgName);
  const dstPkg = join(stageDir, 'node_modules', pkgName);
  if (pkgName === 'libcascade') {
    // Only single-thread OCCT WASM + JS wrappers (drops ~90 MB of multi-thread WASM, symbols, api-reference.json, and .d.ts)
    mkdirSync(join(dstPkg, 'dist'), { recursive: true });
    copyFileSync(join(srcPkg, 'package.json'), join(dstPkg, 'package.json'));
    for (const file of readdirSync(join(srcPkg, 'dist'))) {
      const lower = file.toLowerCase();
      if (lower.includes('multi') || lower === 'api-reference.json' || lower.endsWith('.d.ts') || lower.endsWith('.symbols') || lower.endsWith('.map')) continue;
      copyFileSync(join(srcPkg, 'dist', file), join(dstPkg, 'dist', file));
    }
    continue;
  }
  copyFiltered(srcPkg, dstPkg);
}

function dirBytes(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? dirBytes(p) : statSync(p).size;
  }
  return total;
}

const stagedMb = (dirBytes(stageDir) / (1024 * 1024)).toFixed(2);
const launcherKb = (statSync(stagedLauncher).size / 1024).toFixed(1);
console.log(`Staged MCP runtime (${seen.size} pkgs): ${stagedMb} MiB + launcher ${launcherKb} KiB`);
