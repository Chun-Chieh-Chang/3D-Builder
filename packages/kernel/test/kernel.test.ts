import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type ShapeId, type Vec3 } from '../src/index';

let k: Kernel;
beforeAll(async () => {
  k = await Kernel.load();
});

const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const rect = (w: number, h: number): Region => ({
  outer: [
    { kind: 'line', a: [0, 0], b: [w, 0], source: 'l1' },
    { kind: 'line', a: [w, 0], b: [w, h], source: 'l2' },
    { kind: 'line', a: [w, h], b: [0, h], source: 'l3' },
    { kind: 'line', a: [0, h], b: [0, 0], source: 'l4' },
  ],
  holes: [],
});

const live: ShapeId[] = [];
const keep = (id: ShapeId) => (live.push(id), id);
afterEach(() => {
  for (const id of live.splice(0)) k.release(id);
});

describe('extrude', () => {
  it('tags side faces with their sketch entity and the two caps', () => {
    const r = k.extrude(front, [rect(20, 10)], [0, 0, 5]);
    keep(r.shape);
    const tags = r.faceOrigins.map((o) => o.map((x) => (x.rel === 'cap' ? `cap:${x.which}` : 'kind' in x && x.kind === 'profileEdge' ? x.source : '?')).join());
    expect(tags.sort()).toEqual(['cap:end', 'cap:start', 'l1', 'l2', 'l3', 'l4']);
    const topo = k.topology(r.shape);
    expect([topo.faces.length, topo.edges.length, topo.vertices.length]).toEqual([6, 12, 8]);
    expect(topo.edges.every((e) => e.faces.length === 2)).toBe(true);
    expect(k.massProps(r.shape).volume).toBeCloseTo(1000, 9);
    expect(k.isValid(r.shape)).toBe(true);
  });

  it('extrudes a region with a circular hole', () => {
    const region = rect(20, 10);
    region.holes.push([{ kind: 'circle', c: [10, 5], r: 2, source: 'hole' }]);
    const r = k.extrude(front, [region], [0, 0, 5]);
    keep(r.shape);
    expect(k.massProps(r.shape).volume).toBeCloseTo(1000 - Math.PI * 4 * 5, 6);
    expect(k.isValid(r.shape)).toBe(true);
  });

  it('reports a failure instead of crashing on an empty profile', () => {
    expect(() => k.extrude(front, [], [0, 0, 5])).toThrow('沒有可伸長的封閉輪廓');
  });
});

describe('fillet', () => {
  it('rounds one edge, reports generated and modified faces, and keeps volume exact', () => {
    const box = keep(k.extrude(front, [rect(20, 10)], [0, 0, 5]).shape);
    const topo = k.topology(box);
    // edge on x = 20, z = 5 (between side l2 and the end cap)
    const target = topo.edges.findIndex((e) => Math.abs(e.mid[0] - 20) < 1e-9 && Math.abs(e.mid[2] - 5) < 1e-9);
    const r = k.fillet(box, [target], 2);
    keep(r.shape);
    const generated = r.faceOrigins.filter((o) => o.some((x) => x.rel === 'generated' && x.kind === 'edge' && x.index === target));
    expect(generated).toHaveLength(1);
    expect(r.faceOrigins.every((o) => o.length > 0)).toBe(true);
    expect(k.massProps(r.shape).volume).toBeCloseTo(20 * 10 * 5 - (1 - Math.PI / 4) * 4 * 10, 6);
  });

  it('turns an impossible fillet into a KernelError', () => {
    const box = keep(k.extrude(front, [rect(20, 10)], [0, 0, 5]).shape);
    expect(() => k.fillet(box, [0], 50)).toThrow(/圓角失敗/);
  });
});

describe('a fillet whose radius evolves (variable radius, C5.2)', () => {
  /** A 40 × 30 × 12 box and its long top edge (along x, between the top face and the y = 30 side): a corner of 90° all the way. */
  const boxWithTopEdge = () => {
    const box = keep(k.extrude(front, [rect(40, 30)], [0, 0, 12]).shape);
    const topo = k.topology(box);
    const edge = topo.edges.findIndex((e) => Math.abs(e.mid[2] - 12) < 1e-9 && Math.abs(e.mid[1] - 30) < 1e-9);
    if (edge < 0) throw new Error('no long top edge');
    return { box, edge };
  };
  /** What a corner of 90° loses per unit length at radius r: the square of the corner less the quarter circle. */
  const corner = (r: number) => (1 - Math.PI / 4) * r * r;
  /**
   * The radius the fillet has at x, measured off the solid itself (AGENTS.md §3.5): the corner (y = 30, z = 12) loses material up to the distance
   * d = r·(√2 − 1) along the diagonal into it, so bisecting for where the material starts at that x gives r.
   */
  const radiusAt = (id: ShapeId, x: number): number => {
    let lo = 0;
    let hi = 12;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const p: Vec3 = [x, 30 - mid / Math.SQRT2, 12 - mid / Math.SQRT2];
      const [c] = k.classify(id, [p]);
      if (c === 'out') lo = mid;
      else hi = mid;
    }
    return ((lo + hi) / 2) * (1 + Math.SQRT2);
  };

  it('evolves the radius along the edge, interpolating linearly, and its volume is the integral', () => {
    const { box, edge } = boxWithTopEdge();
    // r = 2 at x = 0 growing to r = 6 at x = 40: the removed volume is the corner loss integrated along the edge
    const r = k.fillet(box, [edge], 2, new Map([[edge, [{ t: 0, r: 2 }, { t: 1, r: 6 }]]]));
    keep(r.shape);
    expect(k.isValid(r.shape)).toBe(true);
    expect(k.massProps(r.shape).volume).toBeCloseTo(14400 - ((1 - Math.PI / 4) * 2080) / 3, 3);
    expect(r.faceOrigins.filter((o) => o.some((x) => x.rel === 'generated' && x.kind === 'edge' && x.index === edge))).toHaveLength(1);
  });

  it('interpolates at the positions the points are, not at fixed steps', () => {
    const { box, edge } = boxWithTopEdge();
    // three points: r = 2 at x = 0, r = 4 at x = 10, r = 6 at x = 40 — two linear stretches
    const r = k.fillet(box, [edge], 2, new Map([[edge, [{ t: 0, r: 2 }, { t: 0.25, r: 4 }, { t: 1, r: 6 }]]]));
    keep(r.shape);
    // the volume is the integral of the two stretches (the kink where they meet leaves a few thousandths behind in OCCT's surface approximation)
    expect(k.massProps(r.shape).volume).toBeCloseTo(14400 - ((1 - Math.PI / 4) * 2560) / 3, 2);
    // the radius is exactly the one asked for at each point, and a straight line away from them in between
    expect(radiusAt(r.shape, 0.5)).toBeCloseTo(2.1, 5);
    expect(radiusAt(r.shape, 10)).toBeCloseTo(4, 5);
    expect(radiusAt(r.shape, 38)).toBeCloseTo(4 + 28 / 15, 5);
    expect(radiusAt(r.shape, 5)).toBeCloseTo(3, 5);
    expect(radiusAt(r.shape, 25)).toBeCloseTo(5, 5);
  });

  it('a law whose ends have the same radius is the constant fillet of that radius', () => {
    const { box, edge } = boxWithTopEdge();
    const varying = keep(k.fillet(box, [edge], 2, new Map([[edge, [{ t: 0, r: 2 }, { t: 1, r: 2 }]]])).shape);
    const constant = keep(k.fillet(box, [edge], 2).shape);
    expect(k.massProps(varying).volume).toBeCloseTo(k.massProps(constant).volume, 6);
    expect(k.massProps(constant).volume).toBeCloseTo(14400 - corner(2) * 40, 6);
  });

  it('rounds the other edges of the same fillet at the constant radius', () => {
    const { box, edge } = boxWithTopEdge();
    const topo = k.topology(box);
    const second = topo.edges.findIndex((e) => Math.abs(e.mid[2] - 12) < 1e-9 && Math.abs(e.mid[1]) < 1e-9);
    const r = k.fillet(box, [edge, second], 2, new Map([[edge, [{ t: 0, r: 2 }, { t: 1, r: 6 }]]]));
    keep(r.shape);
    expect(k.massProps(r.shape).volume).toBeCloseTo(14400 - ((1 - Math.PI / 4) * 2080) / 3 - corner(2) * 40, 3);
    // the second edge is rounded at 2 all the way, the first at its law
    expect(radiusAt(r.shape, 20)).toBeCloseTo(4, 5);
  });
});

describe('mesh and exchange', () => {
  it('produces face and edge groups that cover the whole mesh', () => {
    const box = keep(k.extrude(front, [rect(20, 10)], [0, 0, 5]).shape);
    const m = k.mesh(box);
    let covered = 0;
    for (let i = 0; i < m.faceRanges.length; i += 3) {
      expect(m.faceRanges[i + 2]).toBeGreaterThanOrEqual(0);
      covered += m.faceRanges[i + 1]!;
    }
    expect(covered).toBe(m.indices.length);
    expect(m.edgeRanges.length / 3).toBe(12);
  });

  it('draws each edge polyline along the whole edge', () => {
    const box = keep(k.extrude(front, [rect(20, 10)], [0, 0, 5]).shape);
    const rounded = keep(k.fillet(box, [0], 2).shape);
    const m = k.mesh(rounded);
    const topo = k.topology(rounded);
    for (let g = 0; g < m.edgeRanges.length; g += 3) {
      const [start, count, edge] = [m.edgeRanges[g]!, m.edgeRanges[g + 1]!, m.edgeRanges[g + 2]!];
      let length = 0;
      for (let p = start; p < start + count - 1; p++) {
        const d = [0, 1, 2].map((c) => m.edgePoints[(p + 1) * 3 + c]! - m.edgePoints[p * 3 + c]!);
        length += Math.hypot(d[0]!, d[1]!, d[2]!);
      }
      expect(length).toBeCloseTo(topo.edges[edge]!.length, 1);
      expect(count).toBeLessThan(200);
    }
  });

  it('round-trips STEP with identical volume', () => {
    const box = keep(k.extrude(front, [rect(20, 10)], [0, 0, 5]).shape);
    const text = k.exportStep(box, 'TestPart');
    expect(text).toContain('ISO-10303-21');
    const back = keep(k.importStep(text).shape);
    expect(k.massProps(back).volume).toBeCloseTo(1000, 6);
  });

  it('releases handles', () => {
    const before = k.liveShapes;
    const id = k.extrude(front, [rect(1, 1)], [0, 0, 1]).shape;
    k.release(id);
    expect(k.liveShapes).toBe(before);
  });

  it('adaptively uses high-precision integration on complex surfaces without breaking elementary geometries', () => {
    // Elementary geometries (boxes) stay fast with exact fixed integration
    const box = keep(k.extrude(front, [rect(10, 10)], [0, 0, 10]).shape);
    const p1 = k.massProps(box);
    const p2 = k.massProps(box, { eps: 1e-6 });
    expect(p1.volume).toBeCloseTo(1000, 9);
    expect(p2.volume).toBeCloseTo(1000, 9);
    expect(Math.abs(p1.volume - p2.volume)).toBeLessThan(1e-9);

    // Complex freeform/thread B-spline surfaces automatically switch to high-precision (eps: 1e-6)
    const threadRegion: Region = {
      outer: [
        { kind: 'line', a: [4.5, -0.4], b: [4.5, 0.4], source: 'l1' },
        { kind: 'line', a: [4.5, 0.4], b: [5.0, 0.1], source: 'l2' },
        { kind: 'line', a: [5.0, 0.1], b: [5.0, -0.1], source: 'l3' },
        { kind: 'line', a: [5.0, -0.1], b: [4.5, -0.4], source: 'l4' },
      ],
      holes: [],
    };
    const threadShape = keep(
      k.thread(
        { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] },
        [threadRegion],
        { axis: { origin: [0, 0, 0], dir: [0, 0, 1] }, pitch: 1.5, starts: 1, hand: 'right', from: 0, to: 6 }
      ).shape
    );

    const threadAuto = k.massProps(threadShape);
    const threadExact = k.massProps(threadShape, { eps: 1e-6 });
    const threadFixed = k.massProps(threadShape, { adaptive: false });

    // Automatic default call matches explicit eps: 1e-6 precision
    expect(threadAuto.volume).toBeCloseTo(threadExact.volume, 8);
    // Non-adaptive fixed integration deviates by ~1e-4 on long B-spline helicoidal faces
    expect(Math.abs(threadAuto.volume - threadFixed.volume)).toBeGreaterThan(1e-5);
  });
});
