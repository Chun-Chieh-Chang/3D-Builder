/**
 * 4b-4 (docs/phase4b-plan.md): the features that edit a surface body — knit, fill surface, flat surface, trim surface and extend surface (C9.2, C9.3) — on a surface made by
 * offsetting the side of a cylinder: its areas and volumes are worked out by hand, the names follow the model, and what cannot be done says why.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, SCHEMA_VERSION, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const status = (r: RebuildResult, id: string) => r.features.find((f) => f.id === id)!;
const area = (r: RebuildResult, id: string) => kernel.topology(r.bodies.find((b) => b.id === id)!.shape).faces.reduce((a, f) => a + f.area, 0);
const faces = (r: RebuildResult, id: string) => kernel.topology(r.bodies.find((b) => b.id === id)!.shape).faces.length;

const SIDE = 'e1:side:s1.c';
const on = (id: string): Ref => ({ kind: 'datum', name: id });
const offset = (): Feature => ({ id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: [{ kind: 'face', name: SIDE }], distance: '3' }) as Feature;
/** A cylinder R10 and 20 long, growing to −z (z from −20 to 0), and the side of it offset by 3: a surface of R13. */
const cylinder = (...more: Feature[]): PartDoc => build(sketch('s1', front, circle('c', 0, 0, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20', reverse: true }), offset(), ...more);
/** The edges of a body of the result, as references, that satisfy `pick` (given the middle of the edge). */
const edgesOf = (r: RebuildResult, id: string, pick: (mid: [number, number, number]) => boolean): Ref[] => {
  const b = r.bodies.find((x) => x.id === id)!;
  const out: Ref[] = [];
  for (let k = b.edge0; k < b.edge0 + b.edges; k++) if (pick(r.body!.topology.edges[k]!.mid)) out.push({ kind: 'edge', name: r.body!.names.edges[k]! });
  return out;
};
const atZ = (z: number) => (mid: [number, number, number]) => Math.abs(mid[2] - z) < 1e-6;
const topEdge = (r: RebuildResult, id = 'os1') => edgesOf(r, id, (m) => atZ(0)(m) && Math.hypot(m[0], m[1]) > 1);
const bottomEdge = (r: RebuildResult, id = 'os1') => edgesOf(r, id, (m) => atZ(-20)(m) && Math.hypot(m[0], m[1]) > 1);

const flat = (id: string, edges: Ref[]): Feature => ({ id, type: 'flatSurface', name: id, suppressed: false, edges }) as Feature;
const knit = (bodies: string[], extra: Partial<Feature> = {}): Feature => ({ id: 'kn1', type: 'knit', name: 'kn1', suppressed: false, bodies: bodies.map((name) => ({ kind: 'body', name })), ...extra }) as Feature;
const insert = (doc: PartDoc, feature: Feature): PartDoc => applyCommand(doc, { type: 'insertFeature', feature, index: doc.features.length } as never);

describe('flat surface and knit (C9.2, C9.3)', () => {
  it('a flat surface over the top circle of the surface R13 is a disc of π·13²', () => {
    const base = rebuild(cylinder());
    const r = rebuild(insert(cylinder(), flat('fl1', topEdge(base))));
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', true], ['fl1', true]]);
    expect(area(r, 'fl1')).toBeCloseTo(Math.PI * 169, 6);
  });

  it('the side and a disc over each end, knit, close into the solid cylinder R13 × 20: π·13²·20, a solid body whose faces keep their names', () => {
    let doc = cylinder();
    const base = rebuild(doc);
    doc = insert(doc, flat('fl1', topEdge(base)));
    doc = insert(doc, flat('fl2', bottomEdge(base)));
    doc = insert(doc, knit(['os1', 'fl1', 'fl2']));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', false]]);
    expect(kernel.solidCount(r.bodies[1]!.shape)).toBe(1);
    expect(kernel.massProps(r.bodies[1]!.shape).volume).toBeCloseTo(Math.PI * 169 * 20, 4);
    expect(status(r, 'kn1').info).toMatch(/實體/);
    // the side face keeps its name; the discs keep theirs
    const names = r.body!.names.faces;
    expect(names).toContain(`os1:offset:${SIDE}`);
    expect(names.filter((n) => n.startsWith('fl1:flat') || n.startsWith('fl2:flat'))).toHaveLength(2);
  });

  it('with one end left open it stays a surface, and says one edge is free; with solid off a closed one stays a shell too', () => {
    let doc = cylinder();
    const base = rebuild(doc);
    doc = insert(doc, flat('fl1', topEdge(base)));
    const open = rebuild(insert(doc, knit(['os1', 'fl1'])));
    expect(failures(open)).toEqual([]);
    expect(open.bodies.find((b) => b.id === 'os1')!.surface).toBe(true);
    expect(status(open, 'kn1').info).toMatch(/自由邊 1 條/);
    doc = insert(doc, flat('fl2', bottomEdge(base)));
    const shell = rebuild(insert(doc, knit(['os1', 'fl1', 'fl2'], { solid: false })));
    expect(shell.bodies.find((b) => b.id === 'os1')!.surface).toBe(true);
    expect(kernel.solidCount(shell.bodies.find((b) => b.id === 'os1')!.shape)).toBe(0);
  });

  it('says why when it cannot: a solid body, a body that is gone, nothing picked, edges that are not a loop in a plane', () => {
    const solid = rebuild(insert(cylinder(), knit(['e1', 'os1'])));
    expect(status(solid, 'kn1')).toMatchObject({ status: 'error', message: expect.stringContaining('實體') });
    const gone = rebuild(insert(cylinder(), knit(['os1', 'nothing'])));
    expect(status(gone, 'kn1')).toMatchObject({ status: 'error', message: expect.stringContaining('找不到') });
    expect(status(rebuild(insert(cylinder(), knit([]))), 'kn1').status).toBe('error');
    const base = rebuild(cylinder());
    const seam = edgesOf(base, 'os1', (m) => Math.hypot(m[0], m[1]) > 1 && Math.abs(m[2] + 10) < 1e-6);
    expect(status(rebuild(insert(cylinder(), flat('fl1', seam))), 'fl1').status).toBe('error');
    expect(() => insert(cylinder(), { ...knit(['os1']), bodies: [{ kind: 'face', name: 'x' }] } as Feature)).toThrow();
  });

  it('the version is 30, and the commands change them', () => {
    let doc = insert(cylinder(), knit(['os1']));
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    doc = applyCommand(doc, { type: 'setKnit', featureId: 'kn1', bodies: [{ kind: 'body', name: 'os1' }], tolerance: '0.1', solid: false });
    expect(doc.features.find((f) => f.id === 'kn1')).toMatchObject({ tolerance: '0.1', solid: false });
    expect(() => applyCommand(doc, { type: 'setKnit', featureId: 'kn1', bodies: [{ kind: 'edge', name: 'x' }] })).toThrow();
  });
});

describe('fill surface (C9.2)', () => {
  it('a patch over the top circle of the surface R13, touching only, is a disc to within 0.5%: and says how far it is from the edge', () => {
    const base = rebuild(cylinder());
    const fill = (continuity?: 'contact'): Feature => ({ id: 'fi1', type: 'fillSurface', name: 'fi1', suppressed: false, edges: topEdge(base), ...(continuity ? { continuity } : {}) }) as Feature;
    const r = rebuild(insert(cylinder(), fill('contact')));
    expect(failures(r)).toEqual([]);
    expect(area(r, 'fi1')).toBeGreaterThan(Math.PI * 169 * 0.995);
    expect(area(r, 'fi1')).toBeLessThan(Math.PI * 169 * 1.005);
    expect(status(r, 'fi1').info).toMatch(/離邊線最遠/);
    expect(r.body!.names.faces.some((n) => n.startsWith('fi1:fill:'))).toBe(true);
    // tangent to the wall (the default) a disc cannot be: the wall is vertical. It is refused with the angle, not passed off as tangent
    const tangent = status(rebuild(insert(cylinder(), fill())), 'fi1');
    expect(tangent).toMatchObject({ status: 'error', message: expect.stringContaining('切線差 90.0°') });
  });

  it('tangent, a hole in a flat surface is closed by a disc: the tangent is that of the plane itself (0°), π·5², named after the edge', () => {
    // the disc R13 over the top circle, with a hole of R5 cut in it (a circle drawn above it and projected down), and the hole filled
    const disc = (more: Feature[] = []): PartDoc => {
      const base = rebuild(cylinder());
      const doc = insert(cylinder(), flat('fl1', topEdge(base)));
      const names = rebuild(doc);
      const b = names.bodies.find((x) => x.id === 'fl1')!;
      const face = names.body!.names.faces[b.face0]!;
      const plane = { id: 'up', type: 'refPlane', name: 'up', suppressed: false, def: { mode: 'offset', plane: front, distance: '5' } } as Feature;
      const trim = { id: 'tr1', type: 'trimSurface', name: 'tr1', suppressed: false, sketch: 's2', face: { kind: 'face', name: face }, keep: 'outside', reverse: true } as Feature;
      return [plane, sketch('s2', on('up'), circle('h', 0, 0, 5)), trim, ...more].reduce(insert, doc);
    };
    const holeEdge = (r: RebuildResult) => edgesOf(r, 'fl1', (m) => Math.abs(Math.hypot(m[0], m[1]) - 5) < 1e-6);
    const holed = rebuild(disc());
    expect(failures(holed)).toEqual([]);
    expect(area(holed, 'fl1')).toBeCloseTo(Math.PI * (169 - 25), 4);
    const edge = holeEdge(holed);
    expect(edge).toHaveLength(1);
    const r = rebuild(disc([{ id: 'fi1', type: 'fillSurface', name: 'fi1', suppressed: false, edges: edge } as Feature]));
    expect(failures(r)).toEqual([]);
    expect(area(r, 'fi1')).toBeCloseTo(Math.PI * 25, 2);
    expect(status(r, 'fi1').info).toMatch(/切線差 0\.000°/);
  });

  it('nothing picked, and edges that are gone, are said', () => {
    const none = rebuild(insert(cylinder(), { id: 'fi1', type: 'fillSurface', name: 'fi1', suppressed: false, edges: [] } as Feature));
    expect(status(none, 'fi1').status).toBe('error');
    const gone = rebuild(insert(cylinder(), { id: 'fi1', type: 'fillSurface', name: 'fi1', suppressed: false, edges: [{ kind: 'edge', name: 'nope' }] } as Feature));
    expect(status(gone, 'fi1')).toMatchObject({ status: 'error', message: expect.stringContaining('找不到') });
  });
});

describe('trim surface (C9.3)', () => {
  /** A rectangle beside the surface, on the plane x = 40, projected toward it: z from −15 to −5 (the sketch x runs along −z), y from 2 to 12 (not 0: the seam). */
  const outline = (): Feature[] => [
    { id: 'rpl', type: 'refPlane', name: 'rpl', suppressed: false, def: { mode: 'offset', plane: on('plane:right'), distance: '40' } } as Feature,
    sketch('s2', on('rpl'), rectangle('r', 5, 2, 10, 10)),
  ];
  const trim = (extra: Partial<Feature> = {}): Feature => ({ id: 'tr1', type: 'trimSurface', name: 'tr1', suppressed: false, sketch: 's2', face: { kind: 'face', name: `os1:offset:${SIDE}` }, reverse: true, ...extra }) as Feature;
  // by hand: z span 10, on R13 from y = 2 to y = 12 (the angle round the axis from asin(2/13) to asin(12/13))
  const region = 10 * 13 * (Math.asin(12 / 13) - Math.asin(2 / 13));
  const whole = 2 * Math.PI * 13 * 20;

  it('keeps what is inside the outline: one face of the area worked out by hand, named after the sketch', () => {
    const r = rebuild(insert(cylinder(...outline()), trim()));
    expect(failures(r)).toEqual([]);
    const os = r.bodies.find((b) => b.id === 'os1')!;
    expect(os.surface).toBe(true);
    expect(faces(r, 'os1')).toBe(1);
    expect(area(r, 'os1')).toBeCloseTo(region, 2);
    expect(r.body!.names.faces).toContain('tr1:side:s2.rl0');
  });

  it('keep outside: what is left of the face after the outline is cut away', () => {
    const r = rebuild(insert(cylinder(...outline()), trim({ keep: 'outside' })));
    expect(failures(r)).toEqual([]);
    expect(faces(r, 'os1')).toBe(1);
    expect(area(r, 'os1')).toBeCloseTo(whole - region, 2);
    expect(r.body!.names.faces).toContain(`os1:offset:${SIDE}`);
  });

  it('follows the sketch: the rectangle made 8 high from y = 2, the kept area is the new one, and the name is the same', () => {
    let doc = insert(cylinder(...outline()), trim());
    doc = applyCommand(doc, { type: 'setDimension', featureId: 's2', constraintId: 'rd', value: '8' });
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(area(r, 'os1')).toBeCloseTo(10 * 13 * (Math.asin(10 / 13) - Math.asin(2 / 13)), 2);
    expect(r.body!.names.faces).toContain('tr1:side:s2.rl0');
  });

  it('says why when it cannot: a solid body, the wrong way round, a face that is gone', () => {
    const solid = rebuild(insert(cylinder(...outline()), trim({ face: { kind: 'face', name: SIDE } })));
    expect(status(solid, 'tr1')).toMatchObject({ status: 'error', message: expect.stringContaining('曲面本體') });
    const away = rebuild(insert(cylinder(...outline()), trim({ reverse: false })));
    expect(status(away, 'tr1')).toMatchObject({ status: 'error', message: expect.stringContaining('投影不到') });
    const gone = rebuild(insert(cylinder(...outline()), trim({ face: { kind: 'face', name: 'no:face' } })));
    expect(status(gone, 'tr1').status).toBe('error');
  });
});

describe('extend surface (C9.3)', () => {
  const extend = (edges: Ref[], distance = '5'): Feature => ({ id: 'ex1', type: 'extendSurface', name: 'ex1', suppressed: false, edges, distance }) as Feature;

  it('the surface R13 × 20 extended past its top circle by 5 is 2π·13·25; it follows the offset distance; the face keeps its name', () => {
    const base = rebuild(cylinder());
    let doc = insert(cylinder(), extend(topEdge(base)));
    let r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(area(r, 'os1')).toBeCloseTo(2 * Math.PI * 13 * 25, 5);
    expect(r.body!.names.faces).toContain(`os1:offset:${SIDE}`);
    doc = applyCommand(doc, { type: 'setOffsetSurface', featureId: 'os1', faces: [{ kind: 'face', name: SIDE }], distance: '5' });
    r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(area(r, 'os1')).toBeCloseTo(2 * Math.PI * 15 * 25, 5);
  });

  it('both ends: past the top and the bottom circle, 2π·13·30', () => {
    const base = rebuild(cylinder());
    const r = rebuild(insert(cylinder(), extend([...topEdge(base), ...bottomEdge(base)])));
    expect(failures(r)).toEqual([]);
    expect(area(r, 'os1')).toBeCloseTo(2 * Math.PI * 13 * 30, 5);
  });

  it('says why when it cannot: the seam, a solid body, a body of several faces, a distance that is not positive', () => {
    const base = rebuild(cylinder());
    const seam = edgesOf(base, 'os1', (m) => Math.hypot(m[0], m[1]) > 1 && Math.abs(m[2] + 10) < 1e-6);
    expect(status(rebuild(insert(cylinder(), extend(seam))), 'ex1')).toMatchObject({ status: 'error', message: expect.stringContaining('可以延伸') });
    const solidEdge = edgesOf(base, 'e1', atZ(0));
    expect(status(rebuild(insert(cylinder(), extend(solidEdge))), 'ex1')).toMatchObject({ status: 'error', message: expect.stringContaining('曲面') });
    expect(() => insert(cylinder(), extend(topEdge(base), '0'))).toThrow();
  });
});
