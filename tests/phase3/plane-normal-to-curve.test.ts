/**
 * A reference plane normal to a curve at a point on it (G5, ADR 0174): at the start of a helix (radius 10 about y, pitch 5, 4 turns from (10, 0, 0), ADR 0168),
 * where C(t) = (10 cos t, 5t/2π, ±10 sin t), the plane goes through (10, 0, 0) with its normal along C′(0) ∝ (0, 5/2π, ±10). The kernel's helix is the ideal one
 * to Precision::Confusion = 1e-7 (edge-crossings.test.ts), so that is the tolerance of these comparisons.
 *
 * And the spring it is for (ADR 0169): a circle of radius 1 on that plane, swept along the helix. A profile kept square to its path sweeps its area times the
 * path's length: π · 1² · 4·√((2π·10)² + 5²).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type HelixFeature, type PartDoc, type PlaneDefinition, type Ref } from '@3db/model';
import { edgeFingerprint, vertexFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { parentsOf, Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const CONFUSION = 1e-7;
const top: Ref = { kind: 'datum', name: 'plane:top' };
const hx: HelixFeature = { id: 'hx', type: 'helix', name: 'hx', suppressed: false, definedBy: 'pitchAndRev', circle: { kind: 'datum', name: 'sk1' }, pitch: '5', revolutions: '4' } as HelixFeature;
const helixDoc = (...more: Feature[]): PartDoc => build(sketch('sk1', top, circle('c1', 0, 0, 10)), hx, ...more);
const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const release = (r: RebuildResult) => {
  for (const b of r.bodies) kernel.release(b.shape);
  if (r.body && !r.bodies.some((b) => b.shape === r.body!.shape)) kernel.release(r.body.shape);
};
const plane = (def: PlaneDefinition): Feature => ({ id: 'pl', type: 'refPlane', name: '基準面1', suppressed: false, def }) as Feature;

/** The helix's start vertex, (10, 0, 0), and the edge of the first turn, by name (from a rebuild of the helix alone). */
function refs(): { start: Ref; firstTurn: Ref; elsewhere: Ref } {
  const r = rebuild(helixDoc());
  try {
    const b = r.body!;
    const v = b.topology.vertices.findIndex((x) => Math.hypot(x.point[0] - 10, x.point[1], x.point[2]) < 1e-6);
    const other = b.topology.vertices.findIndex((x) => Math.abs(x.point[1] - 10) < 1e-6);
    const e = b.topology.edges.findIndex((x) => x.vertices.includes(v));
    return {
      start: { kind: 'vertex', name: b.names.vertices[v]!, fingerprint: vertexFingerprint(b.topology, v) },
      firstTurn: { kind: 'edge', name: b.names.edges[e]!, fingerprint: edgeFingerprint(b.topology, e) },
      elsewhere: { kind: 'vertex', name: b.names.vertices[other]!, fingerprint: vertexFingerprint(b.topology, other) },
    };
  } finally {
    release(r);
  }
}

describe('a reference plane normal to a curve (ADR 0174)', () => {
  it('at the start of the helix: (10, 0, 0) is on it, its normal along the helix there, (0, 5/2π, ±10) made unit', () => {
    const { start, firstTurn } = refs();
    const r = rebuild(helixDoc(plane({ mode: 'normalToCurve', curve: firstTurn, point: start } as PlaneDefinition)));
    try {
      expect(statuses(r)).toEqual(['sk1=ok', 'hx=ok', 'pl=ok']);
      const f = r.frames.get('pl')!;
      // a plane's frame has its origin where the part origin projects onto it (planeFrame), so the point is checked to lie in the plane
      expect(Math.abs((10 - f.origin[0]) * f.normal[0] + (0 - f.origin[1]) * f.normal[1] + (0 - f.origin[2]) * f.normal[2])).toBeLessThan(CONFUSION);
      const rise = 5 / (2 * Math.PI);
      const l = Math.hypot(rise, 10);
      expect(Math.abs(f.normal[0])).toBeLessThan(CONFUSION);
      expect(Math.abs(Math.abs(f.normal[1]) - rise / l)).toBeLessThan(CONFUSION);
      expect(Math.abs(Math.abs(f.normal[2]) - 10 / l)).toBeLessThan(CONFUSION);
    } finally {
      release(r);
    }
  });

  it('「反轉方向」 turns the normal round; the plane stays where it is', () => {
    const { start, firstTurn } = refs();
    const n = (reverse: boolean) => {
      const r = rebuild(helixDoc(plane({ mode: 'normalToCurve', curve: firstTurn, point: start, ...(reverse ? { reverse: true } : {}) } as PlaneDefinition)));
      try {
        return r.frames.get('pl')!;
      } finally {
        release(r);
      }
    };
    const [a, b] = [n(false), n(true)];
    expect(a.normal[0] + b.normal[0]).toBeCloseTo(0, 12);
    expect(a.normal[1] + b.normal[1]).toBeCloseTo(0, 12);
    expect(a.normal[2] + b.normal[2]).toBeCloseTo(0, 12);
    expect(Math.hypot(a.origin[0] - b.origin[0], a.origin[1] - b.origin[1], a.origin[2] - b.origin[2])).toBeLessThan(1e-12);
  });

  it('a point that is not on the curve is refused with a reason, never moved onto it', () => {
    const { elsewhere, firstTurn } = refs();
    const r = rebuild(helixDoc(plane({ mode: 'normalToCurve', curve: firstTurn, point: elsewhere } as PlaneDefinition)));
    try {
      const pl = r.features.find((x) => x.id === 'pl')!;
      expect(pl.status).toBe('error');
      expect(pl.message).toMatch(/曲線|curve/);
    } finally {
      release(r);
    }
  });

  it('the spring it is for: a circle of radius 1 on the plane, centred on a point that follows the start of the helix (ADR 0171), swept along it, is π · 1² · the helix length', () => {
    const { start, firstTurn } = refs();
    const length = 4 * Math.hypot(2 * Math.PI * 10, 5);
    const doc = helixDoc(
      plane({ mode: 'normalToCurve', curve: firstTurn, point: start } as PlaneDefinition),
      sketch('prof', { kind: 'datum', name: 'pl' }, {
        entities: [
          { id: 'o', type: 'point', x: 0, y: 0, ref: start },
          { id: 'C', type: 'circle', center: 'o', radius: 1 },
        ],
        constraints: [{ id: 'r', type: 'radius', circle: 'C', value: '1' }],
      } as never),
      { id: 'sw', type: 'sweep', name: 'sw', suppressed: false, sketch: 'prof', path: 'hx', op: 'boss' } as Feature,
    );
    const r = rebuild(doc);
    try {
      expect(statuses(r).filter((s) => !s.endsWith('=ok'))).toEqual([]);
      const sw = r.bodies.find((b) => b.id === 'sw')!;
      const v = kernel.massProps(sw.shape).volume;
      expect(Math.abs(v - Math.PI * length) / (Math.PI * length)).toBeLessThan(1e-6);
    } finally {
      release(r);
    }
  });

  it('the commands: the curve is an edge, the point a vertex or an earlier reference point; the plane is a child of the helix', () => {
    const { start, firstTurn } = refs();
    const ok = helixDoc(plane({ mode: 'normalToCurve', curve: firstTurn, point: start } as PlaneDefinition));
    expect(parentsOf(ok.features.find((f) => f.id === 'pl')!, ok)).toContain('hx');
    const set = (def: PlaneDefinition) => applyCommand(ok, { type: 'setRefPlane', featureId: 'pl', def });
    expect(() => set({ mode: 'normalToCurve', curve: { kind: 'face', name: 'x' }, point: start } as PlaneDefinition)).toThrow();
    expect(() => set({ mode: 'normalToCurve', curve: firstTurn, point: { kind: 'edge', name: 'x' } } as PlaneDefinition)).toThrow();
    expect(() => set({ mode: 'normalToCurve', curve: firstTurn, point: { kind: 'datum', name: 'later' } } as PlaneDefinition)).toThrow();
  });
});
