/**
 * Sweep along a helix curve (ADR 0169): a spring. The sweep's path names a helix feature instead of a sketch; the profile makes a screw motion about the
 * helix's axis (the binormal held on it, as a thread is made), so it does not twist.
 *
 * Ground truth (AGENTS.md §2.1-4), from the flux of the profile through its motion:
 * - a cylindrical helix is an exact screw motion: a profile in a plane through the axis sweeps Pappus' volume A · 2π·r̄ · N, measured to 1e-8;
 * - a cone changes the radius linearly with the turn, so the same with r̄ the mean radius; the profile also turns a little as the cone tilts the tangent
 *   (measured 3e-7 and 9e-7 off at 5°), held to 1e-5;
 * - a flat spiral turns the profile with the tangent's tilt outward (measured 0.22 % under Pappus at the mean radius for pitch 5 at R 10–30), held to 0.5 %
 *   and to the kernel's own floor;
 * - a groove cut wholly inside a rod takes exactly the spring's volume away.
 * Neighbouring turns that would meet and a profile on the axis are refused before OCCT is asked (§2.1-2).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type HelixFeature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, front, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const top: Ref = { kind: 'datum', name: 'plane:top' };
const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
// the bodies, and the compound the result keeps to show several bodies as one (it is the result's, not a body's)
const release = (r: RebuildResult) => {
  for (const b of r.bodies) kernel.release(b.shape);
  if (r.body && !r.bodies.some((b) => b.shape === r.body!.shape)) kernel.release(r.body.shape);
};
const statusOf = (r: RebuildResult, id: string) => statuses(r).find((s) => s.startsWith(`${id}=`));
const volumeOf = (r: RebuildResult, id: string) => {
  const b = r.bodies.find((x) => x.id === id);
  return b ? kernel.massProps(b.shape).volume : null;
};
const rel = (a: number | null, b: number) => Math.abs((a ?? NaN) - b) / b;

// a helix of radius 10 on the top plane (it rises along +y from (10, 0, 0)), pitch 5, 4 turns; the wire profile on the front plane, which holds the axis
const hx = (o: Partial<HelixFeature> = {}): HelixFeature => ({ id: 'hx', type: 'helix', name: 'hx', suppressed: false, definedBy: 'pitchAndRev', circle: { kind: 'datum', name: 'sk1' }, pitch: '5', revolutions: '4', ...o });
const sweep = (o: Record<string, unknown> = {}): Feature => ({ id: 'sw', type: 'sweep', name: 'sw', suppressed: false, sketch: 'prof', path: 'hx', op: 'boss', ...o }) as Feature;
const profile = (x: number, y: number, r: number) => sketch('prof', front, circle('p1', x, y, r));
const spring = (h: Partial<HelixFeature> = {}, prof = profile(10, 0, 1), ...extra: Feature[]) => build(sketch('sk1', top, circle('c1', 0, 0, 10)), hx(h), prof, sweep(), ...extra);
// Pappus: a circle of radius 1 carried round a mean radius r̄ for 4 turns
const pappus = (rMean: number, turns = 4, r = 1) => Math.PI * r * r * 2 * Math.PI * rMean * turns;

describe('Sweep along a helix (ADR 0169)', () => {
  describe('ground truth', () => {
    it('a cylindrical spring is Pappus to 1e-8, either hand, and the same swept from the far end', () => {
      for (const [h, prof] of [
        [{}, profile(10, 0, 1)],
        [{ clockwise: false }, profile(10, 0, 1)],
        [{}, profile(10, 20, 1)], // the profile at the far end (20 up): the sweep runs the helix backwards
      ] as const) {
        const r = rebuild(spring(h, prof));
        expect(statusOf(r, 'sw')).toBe('sw=ok');
        expect(rel(volumeOf(r, 'sw'), pappus(10))).toBeLessThan(1e-8);
        release(r);
      }
    });

    it('a cone is Pappus at the mean radius (10 ± 20·tan 5° / 2), outward and inward', () => {
      const half = (20 * Math.tan((5 * Math.PI) / 180)) / 2;
      for (const [taperOutward, mean] of [
        [true, 10 + half],
        [false, 10 - half],
      ] as const) {
        const r = rebuild(spring({ taperAngle: '5deg', taperOutward }));
        expect(statusOf(r, 'sw')).toBe('sw=ok');
        expect(rel(volumeOf(r, 'sw'), pappus(mean))).toBeLessThan(1e-5);
        release(r);
      }
    });

    it('a flat spiral (R 10 to 30) is within 0.5 % of Pappus at the mean radius 20', () => {
      const r = rebuild(spring({ definedBy: 'spiral', pitch: '5' }));
      expect(statusOf(r, 'sw')).toBe('sw=ok');
      expect(rel(volumeOf(r, 'sw'), pappus(20))).toBeLessThan(5e-3);
      release(r);
    });

    it('a groove cut wholly inside a rod takes away exactly the spring', () => {
      // rod R12, 50 long through the middle plane (y −25 to 25): the groove (R 9 to 11, y −1 to 21) is inside it
      const doc = build(
        sketch('sk1', top, circle('c1', 0, 0, 10)),
        hx(),
        sketch('rod', top, circle('r1', 0, 0, 12)),
        extrude('ex', 'rod', 'boss', { type: 'midPlane', depth: '50' }),
        profile(10, 0, 1),
        sweep({ op: 'cut' }),
      );
      const r = rebuild(doc);
      expect(statusOf(r, 'sw')).toBe('sw=ok');
      const rod = Math.PI * 144 * 50;
      expect(rel(volumeOf(r, 'ex'), rod - pappus(10))).toBeLessThan(1e-8);
      release(r);
    });

    it('names its side faces after the profile edge and the turn of the helix that made them', () => {
      const r = rebuild(spring());
      const view = r.body!;
      const part = view.parts.find((p) => p.id === 'sw')!;
      const faces = view.names.faces.slice(part.face0, part.face0 + part.faces);
      expect(faces.every((n) => n.length > 0)).toBe(true);
      for (const k of [0, 1, 2, 3]) expect(faces.some((n) => n.includes(`@hx:helix:${k}`))).toBe(true);
      release(r);
    });
  });

  describe('refused with a reason, before OCCT is asked', () => {
    const refused = (doc: PartDoc, reason: RegExp) => {
      const r = rebuild(doc);
      expect(statusOf(r, 'sw')).toMatch(reason);
      release(r);
    };

    it('neighbouring turns that would meet: a profile 5.2 wide on a pitch of 5', () => refused(spring({}, profile(10, 0, 2.6)), /寬 5\.200 mm，不小於螺距 5\.000 mm/));
    it('a spiral whose turns would meet', () => refused(spring({ definedBy: 'spiral', pitch: '5' }, profile(10, 0, 2.6)), /渦捲線徑向寬 5\.200 mm/));
    it('a profile over the axis', () => refused(spring({}, profile(0.5, 0, 1)), /碰到或越過螺旋軸/));
    it('a cone narrowing until the profile reaches the axis (end radius 0.67, profile radius 1)', () => refused(spring({ taperAngle: '25deg', taperOutward: false }), /碰到或越過螺旋軸/));
    it('a helix with neither end on the profile plane', () => refused(spring({ startAngle: '90deg' }), /路徑沒有一端在輪廓所在的平面上/));
    it('a helix that is suppressed', () => {
      const doc = spring();
      refused(applyCommand(doc, { type: 'setSuppressed', featureIds: ['hx'], value: true }), /螺旋曲線不存在、已抑制或失敗/);
    });
  });

  describe('the command and the dependency', () => {
    it('takes a helix before the sweep as its path, and refuses one after it', () => {
      const doc = spring();
      expect(() => applyCommand(doc, { type: 'setSweepPath', featureId: 'sw', path: 'hx' })).not.toThrow();
      const later = applyCommand(doc, { type: 'insertFeature', feature: hx({ id: 'hx2', name: 'hx2' }), index: doc.features.length });
      expect(() => applyCommand(later, { type: 'setSweepPath', featureId: 'sw', path: 'hx2' })).toThrow();
    });

    it('follows the helix: 3 turns instead of 4 is three quarters of the spring', () => {
      const r = rebuild(spring({ revolutions: '3' }));
      expect(rel(volumeOf(r, 'sw'), pappus(10, 3))).toBeLessThan(1e-8);
      release(r);
    });
  });

  it('releases every shape it makes over 30 rebuilds (heap growth printed: MakePipeShell alone, no boolean, see AGENTS.md §3.5)', () => {
    const doc = spring();
    release(rebuild(doc));
    const heap = () => (kernel.oc as any).wasmMemory?.buffer?.byteLength as number;
    const h0 = heap();
    expect(h0).toBeGreaterThan(0);
    const live = kernel.liveShapes;
    for (let i = 0; i < 30; i++) release(rebuild(doc));
    console.log(`spring: 30 rebuilds, heap ${((heap() - h0) / (1024 * 1024)).toFixed(1)} MiB`);
    expect(kernel.liveShapes).toBe(live);
  });
});
