import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { CadSession, messageOf, MIN_MESH_TOLERANCE, type ExportFormat } from './session';
import { runScript } from './script';
import { renderView, RENDER_VIEWS, type RenderOptions } from './render';

/** The CLI only executes declarative JSON. It never evaluates source code. */
export async function headless(argv: string[]): Promise<number> {
  const [verb, ...rest] = argv;
  if (!['headless', 'render', 'export'].includes(verb ?? '')) throw new Error('expected headless, render or export');
  const options = new Map<string, string>();
  let inspect = false;
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]!;
    if (key === '--inspect' && verb === 'headless' && !inspect) { inspect = true; continue; }
    const allowed = ['--input', '--output', ...(verb === 'render' ? ['--camera'] : []), ...(verb === 'export' ? ['--format', '--meshTolerance'] : [])];
    if (!allowed.includes(key) || options.has(key) || !rest[i + 1] || rest[i + 1]!.startsWith('--')) throw new Error(`invalid or repeated option ${key}`);
    options.set(key, rest[++i]!);
  }
  if (!options.has('--input') || !options.has('--output')) throw new Error('--input and --output are required');
  const output = resolve(options.get('--output')!);
  const camera = options.get('--camera') ?? 'isometric';
  if (verb === 'render' && !(RENDER_VIEWS as readonly string[]).includes(camera)) throw new Error(`unsupported camera ${camera}`);
  const format = options.get('--format');
  if (verb === 'export' && !['step', 'stl', '3mf'].includes(format ?? '')) throw new Error('--format must be step, stl or 3mf');
  const tolerance = options.has('--meshTolerance') ? Number(options.get('--meshTolerance')) : undefined;
  if (tolerance !== undefined && !(Number.isFinite(tolerance) && tolerance >= MIN_MESH_TOLERANCE)) throw new Error(`--meshTolerance must be finite and at least ${MIN_MESH_TOLERANCE} mm`);
  const raw = JSON.parse(await readFile(resolve(options.get('--input')!), 'utf8'));
  // The command line owns outputs. A script cannot silently create additional deliverables.
  if (raw.outputs !== undefined) throw new Error('remove script outputs when using the explicit --output CLI');
  const session = await CadSession.create({ root: dirname(output), locale: 'en' });
  try {
    const result = await runScript(session, raw);
    if (!result.committed) { process.stderr.write(`${JSON.stringify(result.report)}\n`); return 1; }
    await mkdir(dirname(output), { recursive: true });
    if (verb === 'headless') await writeFile(output, JSON.stringify({ summary: session.summary(undefined, true), ...(inspect ? { bodies: session.inspectBodies() } : {}) }, null, 2));
    else if (verb === 'render') await writeFile(output, (await renderView(session, { view: camera as RenderOptions['view'] })).png);
    else await session.exportFile(basename(output), format as ExportFormat, tolerance);
    return 0;
  } finally { session.dispose(); }
}

export async function main(argv: string[]): Promise<void> {
  try { process.exitCode = await headless(argv); }
  catch (e) { process.stderr.write(`${messageOf(e)}\n`); process.exitCode = 1; }
}
