/** External LibreDWG adapter. Never loads a native CAD library into the app process. */
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { cadIndexedColor, dxfUnescape, readDxf, type DxfEntity } from '@3db/drawing';

const run = promisify(execFile);
const MAX_DXF_BYTES = 64 * 1024 * 1024;
export const DWG_TIMEOUT_MS = 60_000;

const engineOptions = { timeout: DWG_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true };

function readerFor(engine: string): string {
  return join(engine, '..', process.platform === 'win32' ? 'dwg2dxf.exe' : 'dwg2dxf');
}

/** Compare the actual DWG read-back, including anonymous dimension blocks, rather than trusting exit status. */
export function verifyDwgRoundtrip(input: string, back: string): void {
  const a = readDxf(input), b = readDxf(back);
  const code = (e: DxfEntity, n: number, fallback = 0) => Number(e.pairs.find(([c]) => c === n)?.[1] ?? fallback);
  const facts = (e: DxfEntity, doc: typeof a) => JSON.stringify({ type: e.type, layer: e.layer,
    flags: e.type === 'DIMENSION' ? code(e, 70) & 7 : e.type === 'LWPOLYLINE' ? code(e, 70) & 1 : e.type === 'TEXT' ? [code(e, 72), code(e, 73)] : 0,
    width: code(e, 370) > 0 ? code(e, 370) : Number(doc.tables.get('LAYER')?.entries.find((l) => l.name === e.layer)?.pairs.find(([c]) => c === 370)?.[1] ?? 25),
    // Handles, owners, redundant defaults and block names are allowed to change; geometry, text and true color are not.
    pairs: e.pairs.filter(([c]) => (c >= 10 && c <= 59) || c === 1 || c === 420)
      .filter(([c]) => !(e.type === 'TEXT' && !e.pairs.some(([k, v]) => k === 72 && Number(v) !== 0) && [11, 21, 31].includes(c)))
      .filter(([c, v]) => !((c >= 30 && c <= 59 && Number(v) === 0) || (e.type === 'TEXT' && c === 41 && Number(v) === 1)))
      .map(([c, v]) => [c, c === 1 ? dxfUnescape(v) : Number(v)])
      .sort((x, y) => Number(x[0]) - Number(y[0])),
  });
  const modelA = a.entities.map((e) => facts(e, a)).sort(), modelB = b.entities.map((e) => facts(e, b)).sort();
  if (JSON.stringify(modelA) !== JSON.stringify(modelB)) {
    const at = modelA.findIndex((v, i) => v !== modelB[i]);
    throw new Error(`DWG read-back changed drawing geometry, text or colors; export refused. ${modelA[at]} / ${modelB[at]}`);
  }
  for (const [name, entities] of a.blockEntities) {
    if (name.startsWith('*Model_Space') || name.startsWith('*Paper_Space')) continue;
    const read = b.blockEntities.get(name);
    if (!read || JSON.stringify(entities.map((e) => facts(e, a)).sort()) !== JSON.stringify(read.map((e) => facts(e, b)).sort())) {
      throw new Error(`DWG read-back changed dimension block ${name}; export refused.`);
    }
  }
  for (const original of a.tables.get('LAYER')?.entries ?? []) {
    const copied = b.tables.get('LAYER')?.entries.find((l) => l.name === original.name);
    const layerFact = (l: typeof original) => {
      const aci = Number(l.pairs.find(([c]) => c === 62)?.[1] ?? 7);
      const rgb = l.pairs.find(([c]) => c === 420)?.[1];
      return [aci < 0, Number(l.pairs.find(([c]) => c === 370)?.[1] ?? 0), rgb !== undefined ? Number(rgb) : parseInt(cadIndexedColor(Math.abs(aci)).slice(1), 16)];
    };
    if (!copied || JSON.stringify(layerFact(original)) !== JSON.stringify(layerFact(copied))) throw new Error(`DWG read-back changed layer ${original.name}; export refused. ${JSON.stringify(layerFact(original))} / ${copied ? JSON.stringify(layerFact(copied)) : 'missing'}`);
    const pattern = (doc: typeof a, layer: typeof original) => {
      const name = layer.pairs.find(([c]) => c === 6)?.[1];
      return doc.tables.get('LTYPE')?.entries.find((l) => l.name === name)?.pairs.filter(([c]) => c === 49).map(([, v]) => Number(v)) ?? [];
    };
    if (JSON.stringify(pattern(a, original)) !== JSON.stringify(pattern(b, copied))) throw new Error(`DWG read-back changed layer linetype ${original.name}; export refused.`);
  }
}

/** Explicit configuration is authoritative: a broken configured engine must not silently fall back. */
export async function dwgConverter(): Promise<string> {
  const configured = process.env.THREEDB_DWG_CONVERTER;
  if (configured) {
    if (!isAbsolute(configured)) throw new Error('THREEDB_DWG_CONVERTER must be an absolute path to dxf2dwg.');
    await access(configured);
    return configured;
  }
  const exe = process.platform === 'win32' ? 'dxf2dwg.exe' : 'dxf2dwg';
  const dirs = [
    join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), '3D-Builder', 'converters', 'libredwg'),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
  ];
  for (const dir of dirs) {
    const file = join(dir, exe);
    try { await access(file); return file; } catch { /* try the next installed location */ }
  }
  throw new Error('LibreDWG dxf2dwg is not installed. Run npm run setup:dwg (Windows), put dxf2dwg on PATH, or set THREEDB_DWG_CONVERTER to its absolute path.');
}

/** R2018 supports Unicode and true color. Older LibreDWG encoders are rejected by the read-back check. */
export async function dxfToDwg(dxf: string): Promise<Uint8Array> {
  if (typeof dxf !== 'string' || !dxf.length || Buffer.byteLength(dxf) > MAX_DXF_BYTES) {
    throw new Error('DWG conversion requires a nonempty DXF of at most 64 MiB.');
  }
  if (!/\$ACADVER\s+1\s+AC1021(?:\s|$)/.test(dxf)) {
    throw new Error('DWG conversion requires an AC1021 UTF-8 DXF.');
  }
  const engine = await dwgConverter();
  const dir = await mkdtemp(join(tmpdir(), '3db-dwg-'));
  try {
    const input = join(dir, 'sheet.dxf');
    const output = join(dir, 'sheet.dwg');
    await writeFile(input, dxf, 'utf8');
    try {
      await run(engine, ['--as', 'r2018', '-o', output, input], { ...engineOptions, cwd: dir });
    } catch (e) {
      const why = e as Error & { stderr?: string };
      throw new Error(`LibreDWG conversion failed: ${why.message}${why.stderr ? `\n${why.stderr.slice(-2000)}` : ''}`);
    }
    const bytes = await readFile(output);
    if (bytes.length < 256 || bytes.subarray(0, 6).toString('ascii') !== 'AC1032') {
      throw new Error('LibreDWG did not produce an R2018 DWG file. Install LibreDWG 0.14.9228 or newer.');
    }
    const back = join(dir, 'checked.dxf');
    await run(readerFor(engine), ['-o', back, output], { ...engineOptions, cwd: dir });
    verifyDwgRoundtrip(dxf, await readFile(back, 'utf8'));
    return new Uint8Array(bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function dwgToDxf(bytes: Uint8Array): Promise<string> {
  const signature = Buffer.from(bytes.subarray(0, 6)).toString('ascii');
  if (bytes.length < 256 || bytes.length > MAX_DXF_BYTES || !/^AC10(?:09|12|14|15|18|21|24|27|32)$/.test(signature)) {
    throw new Error('Expected a DWG file (R12–R2018), from 256 bytes to 64 MiB.');
  }
  const engine = await dwgConverter();
  const dir = await mkdtemp(join(tmpdir(), '3db-dwg-'));
  try {
    const input = join(dir, 'drawing.dwg'), output = join(dir, 'drawing.dxf');
    await writeFile(input, bytes);
    await run(readerFor(engine), ['--as', 'r2007', '-o', output, input], { ...engineOptions, cwd: dir });
    const text = await readFile(output, 'utf8');
    if (Buffer.byteLength(text) > MAX_DXF_BYTES) throw new Error('Converted DXF exceeds 64 MiB.');
    const doc = readDxf(text);
    if (!doc.entities.length) throw new Error('DWG conversion produced no drawing entities; import refused.');
    return text;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
