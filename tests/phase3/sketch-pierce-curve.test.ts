/**
 * Pierce points on curved edges (G4, ADR 0173): where a helix (radius 10 about y, pitch 5, 4 turns from (10, 0, 0), one edge per turn, ADR 0168) passes
 * through a sketch plane. Truth by hand: at height y it is at angle t = 2π·y/5, x = 10 cos t; the front plane (z = 0, holding the axis) is crossed at
 * t = kπ, (±10, 2.5k). A crossing lies on the plane to 1e-12 (the kernel's root finding) and on the ideal helix to the kernel helix's own tolerance,
 * Precision::Confusion = 1e-7 (see edge-crossings.test.ts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { type Feature, type HelixFeature, type PartDoc, type Ref, type SketchEntity } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { convertEdges, modelSnapItems, piercePoints, Regenerator, type ReferenceScope, type RebuildResult } from '@3db/regen';
import { build, circle, front, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const CONFUSION = 1e-7;
const top: Ref = { kind: 'datum', name: 'plane:top' };
const hx: HelixFeature = { id: 'hx', type: 'helix', name: 'hx', suppressed: false, definedBy: 'pitchAndRev', circle: { kind: 'datum', name: 'sk1' }, pitch: '5', revolutions: '4' } as HelixFeature;
/** 基準面1: the top plane moved up `y`. */
const at = (y: number): Feature => ({ id: 'pl', type: 'refPlane', name: '基準面1', suppressed: false, def: { mode: 'offset', plane: top, distance: String(y) } }) as Feature;
const helixDoc = (...more: Feature[]): PartDoc => build(sketch('sk1', top, circle('c1', 0, 0, 10)), hx, ...more);
const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const release = (r: RebuildResult) => {
  for (const b of r.bodies) kernel.release(b.shape);
  if (r.body && !r.bodies.some((b) => b.shape === r.body!.shape)) kernel.release(r.body.shape);
};

/** What the sketch `s` sees: the model before it, with the kernel to find where curves cross its plane. */
function scopeOf(r: RebuildResult, s: string, withCurves = true): ReferenceScope {
  const body = r.body!;
  const frame = r.frames.get(s)!;
  return { names: body.names, topology: body.topology, frame, ...(withCurves ? { curves: { crossings: (i: number) => kernel.edgePlaneCrossings(body.shape, i, { origin: frame.origin, normal: frame.normal }) } } : {}) };
}
const toWorld = (scope: ReferenceScope, p: [number, number]) => {
  const f = scope.frame;
  return [0, 1, 2].map((k) => f.origin[k]! + f.xDir[k]! * p[0] + f.yDir[k]! * p[1]) as [number, number, number];
};

describe('where a helix passes through a sketch plane', () => {
  it('the front plane: the 4 places inside the turns, (−10, 2.5), (−10, 7.5), (−10, 12.5), (−10, 17.5), are pierce snap items; the turn ends are vertices', () => {
    const r = rebuild(helixDoc(sketch('s', front)));
    try {
      const scope = scopeOf(r, 's');
      const pierces = modelSnapItems(scope, (i) => edgeFingerprint(scope.topology, i)).flatMap((i) => ('pierce' in i ? [toWorld(scope, i.pierce)] : []));
      expect(pierces).toHaveLength(4);
      for (const y of [2.5, 7.5, 12.5, 17.5]) {
        const p = pierces.find((q) => Math.abs(q[1] - y) < 1e-6);
        expect(p, `y = ${y}`).toBeDefined();
        expect(Math.abs(p![2])).toBeLessThan(1e-12); // on the plane
        expect(Math.abs(p![0] + 10)).toBeLessThan(CONFUSION); // on the helix
      }
    } finally {
      release(r);
    }
  });

  it('「貫穿」 of the second turn (y 5 to 10) from the front plane: a point at each place, its two ends and the middle (−10, 7.5)', () => {
    const r = rebuild(helixDoc(sketch('s', front)));
    try {
      const scope = scopeOf(r, 's');
      const turn = scope.topology.edges.findIndex((_, i) => piercePoints(scope, i).some((p) => Math.abs(toWorld(scope, p)[1] - 7.5) < 1e-6));
      expect(turn).toBeGreaterThanOrEqual(0);
      const ref: Ref = { kind: 'edge', name: scope.names.edges[turn]!, fingerprint: edgeFingerprint(scope.topology, turn) };
      const { items, errors } = convertEdges(scope, [ref], 'pierce');
      expect(errors).toEqual([]);
      const ys = items.map((i) => ('pierce' in i ? toWorld(scope, i.pierce)[1] : NaN)).sort((a, b) => a - b);
      expect(ys.map((y) => Math.round(y * 1e6) / 1e6)).toEqual([5, 7.5, 10]);
    } finally {
      release(r);
    }
  });

  it('a plane the helix crosses once (y = 7.3): one place, at x = 10 cos(2π·7.3/5)', () => {
    const r = rebuild(helixDoc(at(7.3), sketch('s', { kind: 'datum', name: 'pl' })));
    try {
      const scope = scopeOf(r, 's');
      const all = scope.topology.edges.flatMap((_, i) => (scope.curves!.crossings(i).length ? piercePoints(scope, i) : []));
      expect(all).toHaveLength(1);
      const p = toWorld(scope, all[0]!);
      expect(Math.abs(p[1] - 7.3)).toBeLessThan(1e-12);
      expect(Math.abs(p[0] - 10 * Math.cos((2 * Math.PI * 7.3) / 5))).toBeLessThan(CONFUSION);
    } finally {
      release(r);
    }
  });

  it('without the kernel a curved edge is refused as before (only straight edges), and a curve that does not reach the plane says so', () => {
    const r = rebuild(helixDoc(at(25), sketch('s', { kind: 'datum', name: 'pl' })));
    try {
      const turn = 0;
      expect(() => piercePoints(scopeOf(r, 's', false), turn)).toThrow(/straight|直線/);
      expect(() => piercePoints(scopeOf(r, 's'), turn)).toThrow(/pass through|穿過/);
    } finally {
      release(r);
    }
  });
});

describe('a pierce point that follows a helix', () => {
  /** The name of the turn holding height `y` (from a front-plane look at the helix). */
  function turnAt(y: number): Ref {
    const r = rebuild(helixDoc(sketch('s', front)));
    try {
      const scope = scopeOf(r, 's');
      const i = scope.topology.edges.findIndex((_, k) => piercePoints(scope, k).some((p) => Math.abs(toWorld(scope, p)[1] - y) < 1e-6));
      return { kind: 'edge', name: scope.names.edges[i]!, fingerprint: edgeFingerprint(scope.topology, i) };
    } finally {
      release(r);
    }
  }
  const pointOf = (r: RebuildResult, s: string, id: string) => {
    const g = r.sketches.get(s)!.solved.geometry.get(id);
    return g?.type === 'point' ? g.p : null;
  };

  it('on a plane at y = 7.3 it is where the helix is, and goes with it when the plane moves to 8.6 (the same turn)', () => {
    const turn = turnAt(7.5);
    for (const y of [7.3, 8.6]) {
      const p: SketchEntity = { id: 'v', type: 'point', x: 0, y: 0, pierce: turn };
      const r = rebuild(helixDoc(at(y), sketch('s', { kind: 'datum', name: 'pl' }, { entities: [p], constraints: [] } as never)));
      try {
        expect(statuses(r).at(-1)).toBe('s=ok');
        const w = toWorld(scopeOf(r, 's'), pointOf(r, 's', 'v')!);
        expect(Math.abs(w[1] - y)).toBeLessThan(1e-9);
        expect(Math.abs(w[0] - 10 * Math.cos((2 * Math.PI * y) / 5))).toBeLessThan(CONFUSION);
      } finally {
        release(r);
      }
    }
  });

  it('on the front plane, where the turn crosses three times, it keeps the crossing nearest where it was', () => {
    const turn = turnAt(7.5);
    for (const [stored, want] of [
      [[-9, 7], [-10, 7.5]],
      [[9, 5.4], [10, 5]],
      [[9, 9.6], [10, 10]],
    ] as const) {
      const p: SketchEntity = { id: 'v', type: 'point', x: stored[0], y: stored[1], pierce: turn };
      const r = rebuild(helixDoc(sketch('s', front, { entities: [p], constraints: [] } as never)));
      try {
        const w = toWorld(scopeOf(r, 's'), pointOf(r, 's', 'v')!);
        expect(Math.hypot(w[0] - want[0], w[1] - want[1])).toBeLessThan(CONFUSION);
      } finally {
        release(r);
      }
    }
  });
});
