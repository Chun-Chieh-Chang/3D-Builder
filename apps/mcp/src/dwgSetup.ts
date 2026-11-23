/** User-installed external executable, kept separate from the app distribution and its license. */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const VERSION = '0.14.9228';
const URL = `https://github.com/LibreDWG/libredwg/releases/download/${VERSION}/libredwg-${VERSION}-win64.zip`;
const SHA256 = '956d6ec5ac9333e0cbb7e08491b0b77f9b7a419ee7437a134d0be450b9267642';

export async function installDwg(archivePath?: string): Promise<string> {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw new Error('On Linux/macOS install LibreDWG 0.14.9228+ with dxf2dwg and dwg2dxf on PATH.');
  const parent = join(process.env.LOCALAPPDATA, '3D-Builder', 'converters');
  const destination = join(parent, 'libredwg');
  try {
    const info = await run(join(destination, 'dxf2dwg.exe'), ['--version'], { windowsHide: true, timeout: 10000 });
    await readFile(join(destination, 'dwg2dxf.exe'));
    if (info.stdout.includes(VERSION)) return destination;
  } catch { /* install the pinned engine when missing or broken */ }
  const dir = await mkdtemp(join(tmpdir(), '3db-dwg-setup-'));
  try {
    let bytes: Buffer;
    if (archivePath) bytes = await readFile(archivePath);
    else {
      const response = await fetch(URL, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`LibreDWG download failed: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (createHash('sha256').update(bytes).digest('hex') !== SHA256) throw new Error('LibreDWG download checksum mismatch.');
    const archive = join(dir, 'engine.zip'), extracted = join(dir, 'engine');
    await writeFile(archive, bytes);
    const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extracted)}`], { windowsHide: true, timeout: 60000 });
    await mkdir(parent, { recursive: true });
    const staging = join(parent, `libredwg-${process.pid}`), backup = join(parent, `libredwg-previous-${process.pid}`);
    await cp(extracted, staging, { recursive: true });
    let moved = false;
    try {
      try { await rename(destination, backup); moved = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      try { await rename(staging, destination); }
      catch (e) { if (moved) await rename(backup, destination); throw e; }
      if (moved) await rm(backup, { recursive: true, force: true });
    } finally { await rm(staging, { recursive: true, force: true }); }
    return destination;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
