import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type ShapeId } from '../src/index';

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
    const tags = r.faceOrigins.map((o) => o.map((x) => (x.rel === 'cap' ? `cap:${x.which}` : x.kind === 'profileEdge' ? x.source : '?')).join());
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
    const back = keep(k.importStep(text));
    expect(k.massProps(back).volume).toBeCloseTo(1000, 6);
  });

  it('releases handles', () => {
    const before = k.liveShapes;
    const id = k.extrude(front, [rect(1, 1)], [0, 0, 1]).shape;
    k.release(id);
    expect(k.liveShapes).toBe(before);
  });
});
