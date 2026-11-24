// Probe (setup file): every Kernel.fillet call of the test suite, each fillet shape it tries and how that try ended, one JSON line per call in
// out/fillet-probe/<pid>.jsonl. Only observes: the wrapped methods are called as they are and their results and errors passed on unchanged.
import { appendFileSync, mkdirSync } from 'node:fs';
import { expect } from 'vitest';
import { Kernel } from '@3db/kernel';

mkdirSync('out/fillet-probe', { recursive: true });
const FILE = `out/fillet-probe/${process.pid}.jsonl`;
const P = Kernel.prototype as any;
if (!P.__filletProbe) {
  P.__filletProbe = true;
  type Try = { build?: number; ok?: boolean; valid?: boolean; tol?: number; err?: string };
  let tries: Try[] | null = null;
  const cur = () => tries?.[tries.length - 1];
  const wrap = (name: string, on: (v: any, args: any[]) => void, onErr?: (e: any) => void) => {
    const orig = P[name];
    P[name] = function (this: unknown, ...args: any[]) {
      const t0 = performance.now();
      if (name === 'build' && tries) tries.push({});
      try { const v = orig.apply(this, args); if (tries) { on(v, args); if (name === 'build') cur()!.build = performance.now() - t0; } return v; }
      catch (e) { if (tries && name === 'build') { cur()!.build = performance.now() - t0; cur()!.err = 'build'; } onErr?.(e); throw e; }
    };
  };
  wrap('build', () => { cur()!.ok = true; });
  wrap('valid', (v) => { const c = cur(); if (c) c.valid = v; });
  wrap('maxTolerance', (v) => { const c = cur(); if (c) c.tol = v; });
  const fillet = P.fillet;
  P.fillet = function (this: unknown, ...args: any[]) {
    const outer = tries; tries = [];
    const t0 = performance.now();
    const stack = new Error().stack ?? '';
    const rec: any = { file: (() => { try { return expect.getState().testPath?.replace(/.*3D-Builder[\/]/, ''); } catch { return null; } })(), test: (() => { try { return expect.getState().currentTestName; } catch { return null; } })(), edges: args[1]?.length, r: args[2], laws: !!(args[3] && args[3].size), exact: !!args[5], bisect: /at works /.test(stack) };
    try { const v = fillet.apply(this, args); rec.outcome = 'ok'; return v; }
    catch (e) { rec.outcome = 'throw'; rec.msg = String((e as Error)?.message ?? e).slice(0, 80); throw e; }
    finally { rec.ms = Math.round(performance.now() - t0); rec.tries = tries.map((t) => ({ ...t, build: Math.round(t.build ?? 0) })); tries = outer; try { appendFileSync(FILE, JSON.stringify(rec) + '\n'); } catch { /* probe only */ } }
  };
}
