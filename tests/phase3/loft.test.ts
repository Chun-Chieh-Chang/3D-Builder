/**
 * Phase 3a-6c (C4.5): the loft. A body through two or more sections, each the closed outline of a sketch. Volumes are hand-calculated (prism, pyramid
 * and cone frustum), every face has a name of its own (`<loft>:side:<first sketch>.<edge of the first section>`, `cap:start`, `cap:end`), what comes
 * after finds its edges, and every way it cannot be done says why (ADR 0032).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type LoftFeature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, edge, extrude, face, fillet, front, rectangle, sketch, statuses, type SketchParts } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

/** A plane parallel to the front plane, `z` above it. */
const plane = (id: string, z: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z) } }) as Feature;
const on = (id: string) => ({ kind: 'datum', name: id }) as const;
const loft = (sections: string[], extra: Partial<LoftFeature> = {}): Feature => ({ id: 'lf1', type: 'loft', name: 'lf1', suppressed: false, sections, op: 'boss', ...extra }) as Feature;
/** Two sections: `a` on the front plane, `b` on a plane `z` above it. */
const two = (a: SketchParts, b: SketchParts, z = 20, extra: Partial<LoftFeature> = {}) => build(plane('pl1', z), sketch('s1', front, a), sketch('s2', on('pl1'), b), loft(['s1', 's2'], extra));
const centred = (id: string, w: number, h: number) => rectangle(id, -w / 2, -h / 2, w, h);

describe('the loft (C4.5)', () => {
  it('two equal rectangles: the prism, with a face for each edge of the first section and a cap at each end', () => {
    const r = rebuild(two(centred('a', 10, 6), centred('b', 10, 6)));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(1200, 6);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.body!.names.faces.slice().sort()).toEqual(['lf1:cap:end', 'lf1:cap:start', 'lf1:side:s1.al0', 'lf1:side:s1.al1', 'lf1:side:s1.al2', 'lf1:side:s1.al3']);
  });

  it('20 × 10 to 10 × 10 over 20, 20 × 20 to 10 × 10: a wedge (3000) and a pyramid frustum h/3·(A1 + √(A1·A2) + A2)', () => {
    expect(volume(rebuild(two(centred('a', 20, 10), centred('b', 10, 10))))).toBeCloseTo(3000, 6);
    const frustum = rebuild(two(centred('a', 20, 20), centred('b', 10, 10)));
    expect(failures(frustum)).toEqual([]);
    expect(volume(frustum)).toBeCloseTo((20 / 3) * (400 + 200 + 100), 6);
    // the other way round is the same body
    expect(volume(rebuild(two(centred('a', 10, 10), centred('b', 20, 20))))).toBeCloseTo((20 / 3) * 700, 6);
  });

  it('a circle to a smaller circle: the cone frustum π·h/3·(R² + R·r + r²), three faces', () => {
    const r = rebuild(two(circle('a', 0, 0, 5), circle('b', 0, 0, 2)));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(((Math.PI * 20) / 3) * (25 + 10 + 4), 6);
    expect(r.body!.names.faces.slice().sort()).toEqual(['lf1:cap:end', 'lf1:cap:start', 'lf1:side:s1.a']);
  });

  it('a square to a circle, a different number of edges: valid, between the circle and the square, every face with a name of its own', () => {
    for (const [a, b] of [[centred('a', 10, 10), circle('b', 0, 0, 5)], [circle('a', 0, 0, 5), centred('b', 10, 10)]] as const) {
      const r = rebuild(two(a, b));
      expect(failures(r)).toEqual([]);
      expect(kernel.isValid(r.body!.shape)).toBe(true);
      // the cylinder of the circle (r = 5) is inside, the prism of the square outside
      expect(volume(r)).toBeGreaterThan(Math.PI * 25 * 20);
      expect(volume(r)).toBeLessThan(10 * 10 * 20);
      const names = r.body!.names.faces;
      expect(new Set(names).size).toBe(names.length);
      expect(names.some((n) => n.endsWith(':face'))).toBe(false);
      expect(names).toEqual(expect.arrayContaining(['lf1:cap:start', 'lf1:cap:end']));
    }
  });

  it('three sections: equal rectangles are the prism of both spans; a swelling one passes through the middle section', () => {
    const prism = rebuild(build(plane('pl1', 20), plane('pl2', 40), sketch('s1', front, centred('a', 10, 6)), sketch('s2', on('pl1'), centred('b', 10, 6)), sketch('s3', on('pl2'), centred('c', 10, 6)), loft(['s1', 's2', 's3'])));
    expect(failures(prism)).toEqual([]);
    expect(volume(prism)).toBeCloseTo(2400, 6);
    const swell = rebuild(build(plane('pl1', 10), plane('pl2', 20), sketch('s1', front, centred('a', 10, 10)), sketch('s2', on('pl1'), centred('b', 20, 20)), sketch('s3', on('pl2'), centred('c', 10, 10)), loft(['s1', 's2', 's3'])));
    expect(failures(swell)).toEqual([]);
    expect(kernel.isValid(swell.body!.shape)).toBe(true);
    // the box of the shape is the box of its control points (loose for a smooth surface): measure the mesh
    const xs = Array.from(kernel.mesh(swell.body!.shape).positions).filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(19.9); // it reaches the whole width of the middle section
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(22);
    // more than the two prisms of the small section, less than the box of the big one
    expect(volume(swell)).toBeGreaterThan(10 * 10 * 20);
    expect(volume(swell)).toBeLessThan(20 * 20 * 20);
    expect(new Set(swell.body!.names.faces).size).toBe(swell.body!.names.faces.length);
  });

  it('the kernel lines the sections up: a section that starts at another corner, or goes the other way round, is the same loft', () => {
    const frame = (z: number) => ({ origin: [0, 0, z] as [number, number, number], xDir: [1, 0, 0] as [number, number, number], yDir: [0, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] });
    const corners: [number, number][] = [[-5, -3], [5, -3], [5, 3], [-5, 3]];
    const loop = (start: number, reversed: boolean) => {
      let c = corners.slice(start).concat(corners.slice(0, start));
      if (reversed) c = [c[0]!, ...c.slice(1).reverse()];
      return c.map((a, i) => ({ kind: 'line' as const, a, b: c[(i + 1) % 4]!, source: `e${i}` }));
    };
    for (const [start, reversed] of [[0, false], [2, false], [0, true], [3, true]] as const) {
      const r = kernel.loft([{ frame: frame(0), outer: loop(0, false) }, { frame: frame(20), outer: loop(start, reversed) }]);
      expect(kernel.massProps(r.shape).volume).toBeCloseTo(1200, 6);
      expect(kernel.isValid(r.shape)).toBe(true);
      kernel.release(r.shape);
    }
  });

  it('a cut: a cone frustum taken out of a block, and the groove it leaves has the names of the sections', () => {
    const block = [sketch('s0', front, rectangle('b', -20, -20, 40, 40)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '30' })];
    const doc = build(...block, plane('pl1', 5), plane('pl2', 25), sketch('s1', on('pl1'), circle('a', 0, 0, 5)), sketch('s2', on('pl2'), circle('c', 0, 0, 2)), loft(['s1', 's2'], { op: 'cut' }));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(40 * 40 * 30 - ((Math.PI * 20) / 3) * (25 + 10 + 4), 6);
    expect(r.body!.names.faces).toContain('lf1:side:s1.a');
  });

  it('a boss touching a body fuses with it; apart from it a body of its own', () => {
    const block = [sketch('s0', front, rectangle('b', -20, -20, 40, 40)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '10' })];
    const rod = (merge?: false) => build(...block, plane('pl1', 10), plane('pl2', 30), sketch('s1', on('pl1'), centred('a', 10, 10)), sketch('s2', on('pl2'), circle('c', 0, 0, 3)), loft(['s1', 's2'], merge === false ? { merge: false } : {}));
    const merged = rebuild(rod());
    expect(failures(merged)).toEqual([]);
    expect(merged.bodies).toHaveLength(1);
    expect(rebuild(rod(false)).bodies).toHaveLength(2);
  });

  it('what follows finds its edges: a fillet on an edge of the loft, a sketch on its cap, and a bigger first section keeps the names', () => {
    const lofted = (extra: Feature[] = []) => build(plane('pl1', 20), sketch('s1', front, centred('a', 10, 6)), sketch('s2', on('pl1'), centred('b', 8, 6)), loft(['s1', 's2']), fillet('f1', [edge('{lf1:cap:end|lf1:side:s1.al0}')], '1'), ...extra);
    const r = rebuild(lofted());
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const wider = rebuild(applyCommand(lofted(), { type: 'setDimension', featureId: 's1', constraintId: 'aw', value: '14' }));
    expect(failures(wider)).toEqual([]);
    expect(volume(wider)).toBeGreaterThan(volume(r));
    const sketched = rebuild(build(plane('pl1', 20), sketch('s1', front, centred('a', 10, 6)), sketch('s2', on('pl1'), centred('b', 8, 6)), loft(['s1', 's2']), sketch('s3', face('lf1:cap:end'), circle('k', 0, 0, 1)), extrude('e3', 's3', 'boss', { type: 'blind', depth: '5' })));
    expect(failures(sketched)).toEqual([]);
    expect(volume(sketched)).toBeCloseTo(rebuild(two(centred('a', 10, 6), centred('b', 8, 6))).bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0) + Math.PI * 5, 6);
  });

  it('says what is wrong with the sections', () => {
    const msg = (doc: PartDoc) => failures(rebuild(doc)).find((s) => s.startsWith('lf1=')) ?? '';
    const ok = centred('b', 10, 6);
    // one section
    expect(msg(build(sketch('s1', front, centred('a', 10, 6)), loft(['s1'])))).toContain('至少要兩個截面');
    // two outlines in a section
    expect(msg(two({ entities: [...centred('a', 10, 6).entities, ...centred('q', 3, 3).entities].map((e) => ({ ...e, ...(e.id.startsWith('q') && 'x' in e ? { x: (e as { x: number }).x + 20 } : {}) })) as SketchParts['entities'], constraints: [] }, ok))).toContain('剛好一個封閉輪廓');
    // a hole in a section
    expect(msg(two({ entities: [...centred('a', 10, 6).entities, ...circle('h', 0, 0, 1).entities], constraints: [] }, ok))).toContain('有洞');
    // an open section
    expect(msg(two({ entities: [{ id: 'p', type: 'point', x: 0, y: 0 }, { id: 'q', type: 'point', x: 5, y: 0 }, { id: 'l', type: 'line', p1: 'p', p2: 'q' }], constraints: [] }, ok))).toContain('草圖不能用於特徵');
    // two sections in the same place: nothing between them
    expect(msg(build(sketch('s1', front, centred('a', 10, 6)), sketch('s2', front, centred('b', 10, 6)), loft(['s1', 's2'])))).toContain('不是有效的實體');
    // a section sketch that is gone
    expect(msg(applyCommand(two(centred('a', 10, 6), ok), { type: 'setSuppressed', featureIds: ['s2'], value: true }))).toContain('截面草圖');
  });

  it('commands: sections are different sketches before the feature, added, ordered and removed one by one', () => {
    const doc = build(plane('pl1', 10), plane('pl2', 20), sketch('s1', front, centred('a', 10, 6)), sketch('s2', on('pl1'), centred('b', 8, 6)), sketch('s3', on('pl2'), centred('c', 6, 6)), loft(['s1', 's2']));
    expect(() => applyCommand(doc, { type: 'setLoftSections', featureId: 'lf1', sections: ['s1', 's1'] })).toThrow('同一張草圖');
    expect(() => applyCommand(doc, { type: 'setLoftSections', featureId: 'lf1', sections: ['s1', 'nope'] })).toThrow('草圖');
    expect(() => applyCommand(doc, { type: 'setLoftSections', featureId: 's1', sections: ['s2'] })).toThrow('只有疊層拉伸');
    const three = applyCommand(doc, { type: 'setLoftSections', featureId: 'lf1', sections: ['s1', 's2', 's3'] });
    expect(failures(rebuild(three))).toEqual([]);
    const reordered = applyCommand(three, { type: 'setLoftSections', featureId: 'lf1', sections: ['s3', 's2', 's1'] });
    expect(failures(rebuild(reordered))).toEqual([]);
    expect(volume(rebuild(reordered))).toBeCloseTo(volume(rebuild(three)), 4);
  });
});
