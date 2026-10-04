// `npm run doctor`: is this computer ready to work on the project? Read-only (it only makes and removes one scratch link to test that links work here).
//
// The project moves between computers on a USB drive, and the three things that break when it does are all about this machine, not about the code:
// the links that npm workspaces make in node_modules (absolute paths: they point nowhere when the drive gets another letter, and they cannot be made at all on exFAT or FAT),
// the tools that are installed per computer (Node, git, and Rust with the C++ build tools for the desktop app), and the settings that git keeps per clone.
// Each line says what is wrong and the command that fixes it. Exit code 1 only when something that stops `npm run check` or `npm run dev` is wrong.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import net from 'node:net';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const note = (level, what, fix) => results.push({ level, what, fix });
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', cwd: root, shell: false, ...opts });

// ---------------------------------------------------------------- Node
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) note('FAIL', `Node ${process.versions.node} is too old (Vite 8 needs 22.12 or newer; the project is developed on 26)`, 'Install Node 26 (or 22 LTS) from https://nodejs.org and open a new terminal');
else note('OK', `Node ${process.versions.node}`);

// ---------------------------------------------------------------- git
const git = run('git', ['--version']);
if (git.status !== 0) note('FAIL', 'git is not installed or not on PATH', 'Install Git for Windows from https://git-scm.com');
else {
  note('OK', git.stdout.trim());
  const textconv = run('git', ['config', '--get', 'diff.3dbx.textconv']).stdout.trim();
  if (!textconv) note('WARN', '`git diff` cannot show what is inside .3dbx part files in this clone (the setting is per clone)', 'npm run setup:git');
  const crlf = run('git', ['config', '--get', 'core.autocrlf']).stdout.trim() || '(not set)';
  note('INFO', `git core.autocrlf = ${crlf} (the repository stores LF; this only changes what the working files look like on this computer)`);
  const dirty = run('git', ['status', '--porcelain']).stdout.trim();
  if (dirty) note('INFO', `${dirty.split('\n').length} uncommitted change(s) in the working tree`, 'git status');
}

// ---------------------------------------------------------------- workspace links
const modules = join(root, 'node_modules');
const workspaces = ['packages', 'apps'].flatMap((d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)).map((n) => join(root, d, n)) : [])).filter((p) => existsSync(join(p, 'package.json')));
if (!existsSync(modules)) note('FAIL', 'node_modules is missing', 'npm install');
else {
  const broken = [];
  for (const dir of workspaces) {
    const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name;
    const link = join(modules, ...name.split('/'));
    if (!existsSync(link)) broken.push(`${name}: missing`);
    else {
      let real = '';
      try { real = realpathSync(link); } catch { /* dangling */ }
      if (resolve(real).toLowerCase() !== resolve(dir).toLowerCase()) broken.push(`${name}: points to ${real || 'nowhere'}`);
    }
  }
  if (broken.length === 0) note('OK', `${workspaces.length} workspace links in node_modules all lead to this folder`);
  else note('FAIL', `node_modules workspace links are broken (${broken.length} of ${workspaces.length}): ${broken.slice(0, 3).join('; ')}${broken.length > 3 ? '; …' : ''}`, 'The links were made on another computer or under another drive letter. Run `npm install` here (it needs a drive that can make links: NTFS, not exFAT or FAT; see handoff 0.4)');
}

// can this drive make links at all? (a scratch junction/symlink inside the project, removed at once)
const scratch = join(root, '.doctor-scratch');
try {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch);
  symlinkSync(join(root, 'scripts'), join(scratch, 'link'), platform() === 'win32' ? 'junction' : 'dir');
  const ok = existsSync(join(scratch, 'link', 'doctor.mjs'));
  note(ok ? 'OK' : 'FAIL', ok ? 'this drive can make links' : 'a link was made but does not work', ok ? undefined : 'Move the project to an NTFS drive (for example C:)');
} catch (e) {
  note('FAIL', `this drive cannot make links (${e.code ?? e.message}): npm workspaces will not work here`, 'Move the project to an NTFS drive (for example C:), or see handoff section 6 "工作區連結" for the temporary aliases that were used on exFAT');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// ---------------------------------------------------------------- port of the dev server
await new Promise((done) => {
  const s = net.createServer();
  s.once('error', () => { note('WARN', 'port 5391 (the dev server) is in use', 'Close the other `npm run dev` (it is another copy of this project, or another program); the dev server will refuse to move to another port on purpose'); done(); });
  s.once('listening', () => s.close(() => { note('OK', 'port 5391 is free'); done(); }));
  s.listen(5391, '127.0.0.1');
});

// ---------------------------------------------------------------- desktop build (optional)
const cargoBin = join(homedir(), '.cargo', 'bin');
const cargo = run('cargo', ['--version'], { env: { ...process.env, PATH: `${process.env.PATH}${platform() === 'win32' ? ';' : ':'}${cargoBin}` } });
if (cargo.status === 0) note('OK', `${cargo.stdout.trim()} (only the desktop app needs Rust)${existsSync(join(cargoBin, 'cargo.exe')) || existsSync(join(cargoBin, 'cargo')) ? '; if `cargo` is not found in a new terminal, add ' + cargoBin + ' to PATH' : ''}`);
else note('INFO', 'Rust is not installed here: only needed to build the desktop installer (the web version needs none)', 'See apps/desktop/README.md "需要"; `winget install Rustlang.Rustup`, then `rustup default stable-x86_64-pc-windows-msvc`');
if (platform() === 'win32') {
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const out = existsSync(vswhere) ? run(vswhere, ['-all', '-prerelease', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']).stdout.trim() : '';
  const msvc = existsSync('C:\\Program Files (x86)\\Microsoft Visual Studio') && readdirSync('C:\\Program Files (x86)\\Microsoft Visual Studio').some((v) => existsSync(join('C:\\Program Files (x86)\\Microsoft Visual Studio', v, 'BuildTools', 'VC', 'Tools', 'MSVC')) && readdirSync(join('C:\\Program Files (x86)\\Microsoft Visual Studio', v, 'BuildTools', 'VC', 'Tools', 'MSVC')).some((x) => existsSync(join('C:\\Program Files (x86)\\Microsoft Visual Studio', v, 'BuildTools', 'VC', 'Tools', 'MSVC', x, 'bin', 'Hostx64', 'x64', 'link.exe'))));
  if (out || msvc) note('OK', 'C++ build tools found (for the desktop app)');
  else note('INFO', 'C++ build tools (Visual Studio Build Tools) not found: only needed for the desktop installer', 'See apps/desktop/README.md "需要"');
}

// ---------------------------------------------------------------- optional data
if (process.env.SW_SAMPLE_DIR) note(existsSync(process.env.SW_SAMPLE_DIR) ? 'OK' : 'WARN', `SW_SAMPLE_DIR = ${process.env.SW_SAMPLE_DIR}${existsSync(process.env.SW_SAMPLE_DIR) ? '' : ' (this folder does not exist on this computer)'}`);
else note('INFO', 'SW_SAMPLE_DIR is not set: the tests that need real SolidWorks sample files are skipped (21 skipped is normal)');

// ---------------------------------------------------------------- report
const mark = { OK: '  ok  ', INFO: ' info ', WARN: ' WARN ', FAIL: ' FAIL ' };
console.log(`3D-Builder doctor — ${root}\n`);
for (const r of results) {
  console.log(`[${mark[r.level]}] ${r.what}`);
  if (r.fix) console.log(`         → ${r.fix}`);
}
const fails = results.filter((r) => r.level === 'FAIL').length;
const warns = results.filter((r) => r.level === 'WARN').length;
console.log(`\n${fails === 0 ? 'Ready: npm run check and npm run dev should work here.' : `${fails} problem(s) stop npm run check / npm run dev here; fix them in the order shown.`}${warns ? ` ${warns} warning(s).` : ''}`);
process.exit(fails === 0 ? 0 : 1);
