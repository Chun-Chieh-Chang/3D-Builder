/**
 * Headless 3D-Builder (ADR 0237): runs a modelling script without a window.
 *
 *   node apps/mcp/dist/cli.mjs run <script.json> [--set name=value ...] [--out <folder>]
 *
 * The outputs are written in `--out` (default: the script's folder) and nowhere else. The figures of the part go to stdout as JSON. Exit code 0: the part
 * was built and written; 1: the script was refused (the reason is on stderr and in the JSON); 2: the command line is wrong.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CadSession, messageOf } from './session';
import { parseSets, runScript } from './script';

const USAGE = 'usage: cli.mjs run <script.json> [--set name=value ...] [--out <folder>]';

async function main(argv: string[]): Promise<number> {
  const [verb, file, ...rest] = argv;
  if (verb !== 'run' || !file) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const sets: string[] = [];
  let out: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--set' && rest[i + 1]) sets.push(rest[++i]!);
    else if (rest[i] === '--out' && rest[i + 1]) out = rest[++i]!;
    else {
      process.stderr.write(`unknown argument ${rest[i]}\n${USAGE}\n`);
      return 2;
    }
  }
  const scriptPath = resolve(file);
  const root = resolve(out ?? dirname(scriptPath));
  const session = await CadSession.create({ root, locale: process.env.THREEDB_LOCALE === 'en' ? 'en' : 'zh-TW' });
  try {
    const result = await runScript(session, JSON.parse(await readFile(scriptPath, 'utf8')), parseSets(sets));
    process.stdout.write(`${JSON.stringify({ committed: result.committed, written: result.written, error: result.report.error, broken: result.report.broken, summary: result.report.after }, null, 1)}\n`);
    if (!result.committed) process.stderr.write(`refused: ${result.report.error?.message ?? 'unknown'}\n`);
    return result.committed ? 0 : 1;
  } catch (e) {
    process.stderr.write(`refused: ${messageOf(e)}\n`);
    process.stdout.write(`${JSON.stringify({ committed: false, error: { message: messageOf(e) } })}\n`);
    return 1;
  } finally {
    session.dispose();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(1);
  },
);
