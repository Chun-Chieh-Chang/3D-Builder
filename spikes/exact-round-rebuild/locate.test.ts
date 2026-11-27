/**
 * Where seed 73's rebuild exact round throws Standard_ConstructionError: `kernel.oc` wrapped so that every OCCT constructor and static function that
 * throws records its name and the JS stack at that moment (instance methods are not wrapped). Writes data/locate.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { recognizeStep, sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';

it('locates the throw', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const k = kernel as any;
  const thrown: { name: string; stack: string; type?: string }[] = [];
  const record = (name: string, e: unknown) => { let type: string | undefined; try { type = k.oc.getExceptionMessage?.(e)?.join(': '); } catch { /* not an OCCT exception */ } thrown.push({ name, type, stack: (new Error().stack ?? '').split('\n').slice(2, 14).join('\n') }); };
  const wrapFn = (name: string, f: any) => new Proxy(f, {
    construct(t, args) { try { return new t(...args); } catch (e) { record(`new ${name}`, e); throw e; } },
    apply(t, self, args) { try { return Reflect.apply(t, self, args); } catch (e) { record(name, e); throw e; } },
  });
  const raw = k.oc;
  const cache = new Map<PropertyKey, any>();
  k.oc = new Proxy(raw, {
    get(t, p) {
      if (cache.has(p)) return cache.get(p);
      const v = t[p];
      let w = v;
      if (typeof v === 'function') w = wrapFn(String(p), v);
      else if (v && typeof v === 'object' && /^[A-Z]/.test(String(p))) w = new Proxy(v, { get(o, q) { const x = o[q]; return typeof x === 'function' ? wrapFn(`${String(p)}.${String(q)}`, x.bind(o)) : x; } });
      cache.set(p, w);
      return w;
    },
  });
  const s = sample(73);
  const m = splineBoss(kernel, s.top, s.h);
  const shape = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
  thrown.length = 0; // only what the recognition's rebuild throws
  (globalThis as any).__erDbg = [];
  const r = await recognizeStep(kernel, solver, shape);
  mkdirSync('spikes/exact-round-rebuild/data', { recursive: true });
  writeFileSync('spikes/exact-round-rebuild/data/locate.json', JSON.stringify({ volumeError: r.report.volumeError, log: k.exactRoundLog, thrown, dbg: (globalThis as any).__erDbg }, null, 1));
}, 900_000);
