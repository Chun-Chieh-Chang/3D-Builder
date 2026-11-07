/**
 * ADR 0241: the mass properties of spline faces against a truth that does not pass through OCCT's volume integrals. An extrusion's figures follow from its section,
 * and the section comes from the exact curve sampled finely (`sectionEdges`), read with the shoelace formulas. A second, independent truth is the sum of the prism's
 * caps: the area of the cap is integrated by OCCT on a plane, where the fixed rule is exact.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type MassProps, type ShapeId } from '@3db/kernel';
import { closedLoops, polyline } from '../phase6/section-edges-helpers';

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;
const WIDE = { u0: -500, u1: 500, v0: -500, v1: 500 };

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

function seeded(start: number) {
  let seed = start;
  return (a: number, b: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return a + (seed / 0x7fffffff) * (b - a);
  };
}

const closedSpline = (points: [number, number][]) => ({ outer: [{ kind: 'spline', points, closed: true, source: 's' }], holes: [] }) as never;

/** The section of the prism at mid height, by the shoelace formulas. */
function truthOf(id: ShapeId, height: number) {
  const loops = closedLoops(kernel.sectionEdges(id, { ...XY, origin: [0, 0, height / 2] } as never, WIDE).map((e) => polyline(e, 2048)));
  if (loops.length !== 1) return null;
  const loop = loops[0]!;
  let A = 0, cx = 0, cy = 0, ixx = 0, iyy = 0;
  for (let i = 0; i < loop.length - 1; i++) {
    const [x0, y0] = loop[i] as [number, number];
    const [x1, y1] = loop[i + 1] as [number, number];
    const c = x0 * y1 - x1 * y0;
    A += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
    ixx += (y0 * y0 + y0 * y1 + y1 * y1) * c;
    iyy += (x0 * x0 + x0 * x1 + x1 * x1) * c;
  }
  A /= 2;
  cx /= 6 * A;
  cy /= 6 * A;
  const polar = (Math.sign(A) * (ixx + iyy)) / 12 - Math.abs(A) * (cx * cx + cy * cy);
  return { volume: Math.abs(A) * height, center: [cx, cy, height / 2], izz: polar * height };
}

const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('closed-spline extrusions against their section', () => {
  it('have the right volume on the fast path and the right centre and inertia on the exact one, over 150 random shapes', () => {
    const rnd = seeded(20261107);
    let measured = 0;
    let fixedRuleVolumeOff = 0;
    let fixedRuleCentreOff = 0;
    let fixedRuleInertiaOff = 0;
    for (let i = 0; i < 150; i++) {
      const n = 6 + Math.floor(rnd(0, 7));
      const points = Array.from({ length: n }, (_, k): [number, number] => {
        const a = (2 * Math.PI * k) / n;
        const r = rnd(8, 30);
        return [r * Math.cos(a), r * Math.sin(a)];
      });
      const h = rnd(3, 40);
      const id = kernel.extrude(XY as never, [closedSpline(points)], [0, 0, h]).shape;
      try {
        // a profile that crosses itself is not a solid: its figures mean nothing, it only has to come back
        const fast = kernel.massProps(id);
        const exact = kernel.massPropsExact(id);
        expect([fast.volume, ...fast.center, ...fast.inertia].every(Number.isFinite), `case ${i}`).toBe(true);
        if (!kernel.isValid(id)) continue;
        const truth = truthOf(id, h);
        if (!truth) continue;
        measured++;
        const fixed: MassProps = kernel.massProps(id, { adaptive: false });
        expect(Math.abs(fast.volume - truth.volume) / truth.volume, `volume, case ${i}`).toBeLessThan(1e-6);
        expect(Math.abs(exact.volume - truth.volume) / truth.volume, `exact volume, case ${i}`).toBeLessThan(1e-6);
        expect(distance(exact.center, truth.center), `centre, case ${i}`).toBeLessThan(2e-4);
        expect(Math.abs(exact.inertia[8]! - truth.izz) / truth.izz, `inertia, case ${i}`).toBeLessThan(1e-5);
        // the fast path's centre and inertia are the fixed rule's, nothing else
        expect(fast.center).toEqual(fixed.center);
        expect(fast.inertia).toEqual(fixed.inertia);
        if (Math.abs(fixed.volume - truth.volume) / truth.volume > 1e-3) fixedRuleVolumeOff++;
        if (distance(fixed.center, truth.center) > 1e-2) fixedRuleCentreOff++;
        if (Math.abs(fixed.inertia[8]! - truth.izz) / truth.izz > 1e-3) fixedRuleInertiaOff++;
      } finally {
        kernel.release(id);
      }
    }
    // enough real shapes, and the fixed rule really is off on them: without that the branch above proves nothing (AGENTS.md §3.2)
    expect(measured).toBeGreaterThan(40);
    expect(fixedRuleVolumeOff).toBeGreaterThan(3);
    expect(fixedRuleCentreOff).toBeGreaterThan(3);
    expect(fixedRuleInertiaOff).toBeGreaterThan(3);
  }, 300_000);

  it('a fixed-rule figure and an eps figure are still what they were asked for', () => {
    const points: [number, number][] = Array.from({ length: 12 }, (_, k) => {
      const a = (2 * Math.PI * k) / 12;
      const r = k % 2 ? 12 : 28;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    const id = kernel.extrude(XY as never, [closedSpline(points)], [0, 0, 10]).shape;
    const oc = kernel.oc as never as { GProp_GProps: new () => { Mass(): number; delete(): void }; BRepGProp: { VolumeProperties(...args: unknown[]): void } };
    const shape = (kernel as never as { get(id: ShapeId): unknown }).get(id);
    const raw = (...args: unknown[]) => {
      const p = new oc.GProp_GProps();
      oc.BRepGProp.VolumeProperties(shape, p, ...args);
      const mass = p.Mass();
      p.delete();
      return mass;
    };
    expect(kernel.massProps(id, { adaptive: false }).volume).toBe(raw(false, false, false));
    expect(kernel.massProps(id, { eps: 1e-3 }).volume).toBe(raw(1e-3, false, false));
    kernel.release(id);
  });
});

describe('what the refinement does not touch', () => {
  it('a block and a cylinder return exactly the figures of the fixed rule, on either path', () => {
    const rect = { outer: [{ kind: 'line', a: [0, 0], b: [40, 0], source: 'a' }, { kind: 'line', a: [40, 0], b: [40, 30], source: 'b' }, { kind: 'line', a: [40, 30], b: [0, 30], source: 'c' }, { kind: 'line', a: [0, 30], b: [0, 0], source: 'd' }], holes: [] } as never;
    const disc = { outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] } as never;
    for (const [region, volume] of [[rect, 40 * 30 * 12], [disc, Math.PI * 225 * 12]] as const) {
      const id = kernel.extrude(XY as never, [region], [0, 0, 12]).shape;
      const fixed = kernel.massProps(id, { adaptive: false });
      expect(fixed.volume).toBeCloseTo(volume, 6);
      expect(kernel.massProps(id)).toEqual(fixed);
      expect(kernel.massPropsExact(id)).toEqual(fixed);
      kernel.release(id);
    }
  });

  it('an open spline extruded takes the same integral and agrees with the fixed rule, which is good there', () => {
    const points: [number, number][] = [[10, 0], [22, 8], [18, 20], [24, 30], [10, 34]];
    const region = { outer: [{ kind: 'spline', points, closed: false, source: 's' }, { kind: 'line', a: [10, 34], b: [0, 34], source: 'a' }, { kind: 'line', a: [0, 34], b: [0, 0], source: 'b' }, { kind: 'line', a: [0, 0], b: [10, 0], source: 'c' }], holes: [] } as never;
    const id = kernel.extrude(XY as never, [region], [0, 0, 15]).shape;
    const fast = kernel.massProps(id);
    const exact = kernel.massPropsExact(id);
    const truth = truthOf(id, 15)!;
    expect(Math.abs(fast.volume - truth.volume) / truth.volume).toBeLessThan(1e-6);
    expect(distance(exact.center, truth.center)).toBeLessThan(2e-4);
    kernel.release(id);
  });
});

describe('a loft between two identical closed splines: a prism on B-spline faces', () => {
  it('keeps the adaptive rule, whose volume is right there and whose centre and inertia are not; the exact path gets those right', () => {
    const rnd = seeded(3141);
    let checked = 0;
    let fixedRuleOff = 0;
    let adaptiveInertiaOff = 0;
    for (let i = 0; i < 60; i++) {
      const n = 6 + Math.floor(rnd(0, 7));
      const points = Array.from({ length: n }, (_, k): [number, number] => {
        const a = (2 * Math.PI * k) / n;
        const r = rnd(8, 30);
        return [r * Math.cos(a), r * Math.sin(a)];
      });
      const h = rnd(5, 40);
      const frame = (z: number) => ({ ...XY, origin: [0, 0, z] }) as never;
      const loop = [{ kind: 'spline', points, closed: true, source: 's' }] as never;
      let id: ShapeId;
      try {
        id = kernel.loft([{ frame: frame(0), outer: loop }, { frame: frame(h), outer: loop }]).shape;
      } catch {
        continue; // OCCT refuses some of these random profiles; `checked` below says enough were left
      }
      const truth = kernel.isValid(id) ? truthOf(id, h) : null;
      if (truth) {
        const auto = kernel.massProps(id);
        expect(auto, `the eps path, case ${i}`).toEqual(kernel.massProps(id, { eps: 1e-6 }));
        const exact = kernel.massPropsExact(id);
        expect(exact.volume, `the volume stays, case ${i}`).toBe(auto.volume);
        expect(exact.area, `the area stays, case ${i}`).toBe(auto.area);
        expect(Math.abs(auto.volume - truth.volume) / truth.volume, `volume, case ${i}`).toBeLessThan(1e-6);
        // measured at most 2.1e-4 mm on these lofts at this tolerance (1.8e-5 at GK 1e-8), against 0.13 mm for the adaptive rule
        expect(distance(exact.center, truth.center), `centre, case ${i}`).toBeLessThan(5e-4);
        expect(Math.abs(exact.inertia[8]! - truth.izz) / truth.izz, `inertia, case ${i}`).toBeLessThan(1e-5);
        if (Math.abs(kernel.massProps(id, { adaptive: false }).volume - truth.volume) / truth.volume > 1e-3) fixedRuleOff++;
        if (Math.abs(auto.inertia[8]! - truth.izz) / truth.izz > 1e-3) adaptiveInertiaOff++;
        checked++;
      }
      kernel.release(id);
    }
    expect(checked).toBeGreaterThan(10);
    expect(fixedRuleOff).toBeGreaterThan(0);
    expect(adaptiveInertiaOff).toBeGreaterThan(0);
  }, 120_000);
});

describe('a revolved spline', () => {
  /**
   * Pappus: the section's first moment about the axis times 2 pi. The section is read on a plane tilted about the axis: on the plane of the sketch itself the same 2048 samples
   * are up to 2e-5 off, shrinking by 16 for 4 times the samples, which is the sampling and not the integral (tolerances from 1e-6 to 1e-10 agree to 1e-11 there).
   */
  function pappus(id: ShapeId): number | null {
    const tilted = { origin: [0, 0, 0], xDir: [Math.cos(1), 0, -Math.sin(1)], yDir: [0, 1, 0], normal: [Math.sin(1), 0, Math.cos(1)] } as never;
    let loops: number[][][];
    try {
      loops = closedLoops(kernel.sectionEdges(id, tilted, { u0: 0.001, u1: 500, v0: -500, v1: 500 }).map((e) => polyline(e, 512)));
    } catch {
      return null; // pieces that do not chain: no truth for this one, `checked` says enough were left
    }
    if (loops.length !== 1) return null;
    const loop = loops[0]!;
    let moment = 0;
    for (let k = 0; k < loop.length - 1; k++) {
      const [x0, y0] = loop[k] as [number, number];
      const [x1, y1] = loop[k + 1] as [number, number];
      moment += (x0 + x1) * (x0 * y1 - x1 * y0);
    }
    return (Math.PI * Math.abs(moment)) / 3;
  }

  function revolved(region: never): ShapeId | null {
    try {
      return kernel.revolve(XY as never, [region], { origin: [0, 0, 0], dir: [0, 1, 0] } as never, 2 * Math.PI).shape;
    } catch {
      return null; // OCCT refuses some of these random profiles
    }
  }

  it('an open profile has the volume of Pappus', () => {
    const rnd = seeded(77);
    let checked = 0;
    for (let i = 0; i < 20; i++) {
      const n = 3 + Math.floor(rnd(0, 5));
      const h = rnd(10, 40);
      const prof: [number, number][] = Array.from({ length: n + 1 }, (_, k) => [rnd(6, 25), (h * k) / n]);
      const id = revolved({ outer: [{ kind: 'spline', points: prof, closed: false, source: 's' }, { kind: 'line', a: prof[n], b: [2, h], source: 'a' }, { kind: 'line', a: [2, h], b: [2, 0], source: 'b' }, { kind: 'line', a: [2, 0], b: prof[0], source: 'c' }], holes: [] } as never);
      if (id === null) continue;
      const truth = kernel.isValid(id) ? pappus(id) : null;
      if (truth !== null) {
        expect(Math.abs(Math.abs(kernel.massProps(id).volume) - truth) / truth, `case ${i}`).toBeLessThan(1e-6);
        checked++;
      }
      kernel.release(id);
    }
    expect(checked).toBeGreaterThan(5);
  }, 120_000);

  it('a closed profile off the axis has it too, where the fixed rule does not', () => {
    const oc = kernel.oc as never as { GProp_GProps: new () => { Mass(): number; delete(): void }; BRepGProp: { VolumePropertiesGK(...args: unknown[]): void } };
    const rnd = seeded(4242);
    let checked = 0;
    let fixedRuleOff = 0;
    for (let i = 0; i < 40; i++) {
      const n = 9 + Math.floor(rnd(0, 4));
      const points = Array.from({ length: n }, (_, k): [number, number] => {
        const a = (2 * Math.PI * k) / n;
        const r = rnd(6, 25);
        return [50 + r * Math.cos(a), r * Math.sin(a)];
      });
      const id = revolved(closedSpline(points) as never);
      if (id === null) continue;
      const truth = kernel.isValid(id) ? pappus(id) : null;
      if (truth !== null) {
        // two truths in layers: the section is itself a fitted curve, up to 2e-6 off whatever its sampling or angle; the integral against itself at a far tighter tolerance has no such limit
        const volume = Math.abs(kernel.massProps(id).volume);
        expect(Math.abs(volume - truth) / truth, `case ${i}`).toBeLessThan(5e-6);
        const tight = new oc.GProp_GProps();
        oc.BRepGProp.VolumePropertiesGK((kernel as never as { get(id: ShapeId): unknown }).get(id), tight, 1e-10, false, true, false, false, false);
        expect(Math.abs(volume - Math.abs(tight.Mass())) / volume, `converged, case ${i}`).toBeLessThan(1e-7);
        tight.delete();
        if (Math.abs(Math.abs(kernel.massProps(id, { adaptive: false }).volume) - truth) / truth > 1e-3) fixedRuleOff++;
        checked++;
      }
      kernel.release(id);
    }
    expect(checked).toBeGreaterThan(5);
    expect(fixedRuleOff).toBeGreaterThan(0);
  }, 300_000);
});

describe('what it holds on to', () => {
  it('leaves no shape behind; the heap is measured by its real path', () => {
    const buffer = () => (kernel.oc as never as { wasmMemory: { buffer: { byteLength: number } } }).wasmMemory.buffer.byteLength;
    const initial = buffer();
    expect(initial).toBeGreaterThan(0);
    const points: [number, number][] = Array.from({ length: 12 }, (_, k) => {
      const a = (2 * Math.PI * k) / 12;
      const r = k % 2 ? 12 : 28;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
    const id = kernel.extrude(XY as never, [closedSpline(points)], [0, 0, 10]).shape;
    const live = kernel.liveShapes;
    for (let i = 0; i < 1000; i++) kernel.massProps(id);
    for (let i = 0; i < 200; i++) kernel.massPropsExact(id);
    expect(kernel.liveShapes).toBe(live);
    console.log(`mass properties, 1000 fast and 200 exact: heap ${((buffer() - initial) / 1048576).toFixed(1)} MiB`);
    kernel.release(id);
  }, 120_000);
});
