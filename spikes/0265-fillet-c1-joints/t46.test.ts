// Probe: timing of each fillet call, each fillet shape (build / BRepCheck / tolerance) and exactRounds during rolling-ball fuzz seed 46. Product code untouched;
// Kernel methods are wrapped only to time them. Writes out/prof46/t46.log synchronously.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { Kernel } from '@3db/kernel';
import { fuzzFile } from '../../tests/phase8/recognize-rolling-ball.kit';

mkdirSync('out/prof46', { recursive: true });
const LOG = 'out/prof46/t46.log';
writeFileSync(LOG, '');
const log = (s: string) => appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${s}\n`);
const P = Kernel.prototype as any;
let depth = 0;
for (const name of ['fillet', 'build', 'valid', 'maxTolerance', 'exactRounds', 'history']) {
  const orig = P[name];
  P[name] = function (this: unknown, ...args: unknown[]) {
    const t0 = performance.now(); const pad = '  '.repeat(depth);
    const info = name === 'fillet' ? ` edges=${JSON.stringify(args[1])} r=${args[2]} exact=${args[5]}` : '';
    log(`${pad}> ${name}${info}`);
    depth++;
    try { const v = orig.apply(this, args); log(`${pad}< ${name} ok ${((performance.now() - t0) / 1000).toFixed(2)}s${name === 'valid' ? ' ' + v : ''}`); return v; }
    catch (e) { log(`${pad}< ${name} THROW ${((performance.now() - t0) / 1000).toFixed(2)}s ${String((e as Error)?.message ?? e).slice(0, 120)}`); throw e; }
    finally { depth--; }
  };
}
fuzzFile(46, 46);
