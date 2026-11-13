// The MakeDraft trap: fuzz sample JOB (seed) alone in a fresh kernel, and with its angle and height nudged; one line per try (trap / refused / ok).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { isTrap, Kernel } from '@3db/kernel';

const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const trace = (m: string) => appendFileSync('scratch/ff/c6j.trace', `${new Date().toISOString().slice(11, 19)} ${m}\n`);
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sample(seed: number) {
  const r = rng(seed); const rd = (v: number) => Math.round(v * 1000) / 1000;
  const [w, h] = [rd(15 + 25 * r()), rd(12 + 18 * r())];
  const n = 1 + Math.floor(r() * 3);
  const mids = Array.from({ length: n }, (_, i) => [rd(w * (1 - (i + 1) / (n + 1))), rd(h + (r() * 1.4 - 0.4) * h * 0.4)]);
  const sign = r() < 0.5 ? 1 : -1; const H = rd(3 + 22 * r()); const deg = 0.5 + 7.5 * r();
  const angle = sign * Math.min((deg * Math.PI) / 180, Math.atan((0.2 * Math.min(w, h)) / H));
  const hole = seed % 3 === 0 ? { c: [rd(w / 2), rd(h / 2.5)], r: rd(Math.min(w, h) * (0.06 + 0.06 * r())) } : null;
  return { w, h, mids, H, angle, hole };
}
it('c6j', async () => {
  const seed = Number(process.env.JOB);
  const s = sample(seed);
  const outer = [L([0, 0], [s.w, 0], 'a'), L([s.w, 0], [s.w, s.h], 'b'), { kind: 'spline', points: [[s.w, s.h], ...s.mids, [0, s.h]], source: 'c' }, L([0, s.h], [0, 0], 'd')];
  const region = { outer, holes: s.hole ? [[{ kind: 'circle', c: s.hole.c, r: s.hole.r, source: 'h' }]] : [] };
  const rows: string[] = [];
  for (const [label, angle, H] of [['as is', s.angle, s.H], ['angle +0.1°', s.angle + 0.0017453, s.H], ['angle −0.1°', s.angle - 0.0017453, s.H], ['H +1', s.angle, s.H + 1], ['H −1', s.angle, s.H - 1], ['no draft→straight check', 0, s.H]] as const) {
    let kernel = await Kernel.load();
    trace(`seed ${seed} ${label}: start`);
    try {
      const r = kernel.extrude(XY as never, [region] as never, [0, 0, H], 0, undefined, angle || undefined);
      rows.push(`${label}: ok valid ${kernel.check(r.shape).valid}`);
      kernel.release(r.shape);
    } catch (e) {
      rows.push(`${label}: ${isTrap(e) ? 'TRAP ' : 'refused '}${String((e as Error).message).slice(0, 70)}`);
      if (isTrap(e)) kernel = await Kernel.load();
    }
    trace(`seed ${seed} ${label}: done`);
  }
  log(`trap seed ${seed} (${((s.angle * 180) / Math.PI).toFixed(2)}°, H ${s.H}): ${rows.join(' | ')}`);
}, 600_000);
