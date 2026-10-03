/**
 * 4b-1 (docs/phase4b-plan.md): the offset surface feature (C9.2) and the surface bodies it makes — a body with no solid, which is not a part: solid features leave it
 * alone, it is named by the faces it came from and follows them when the model changes, and an offset the surface cannot bear is an error that says how far out it was.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, extrude, face, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const area = (shape: ShapeId) => kernel.topology(shape).faces.reduce((a, f) => a + f.area, 0);

const offset = (faces: string[], distance: string, extra: Partial<Feature> = {}): Feature =>
  ({ id: 'os1', type: 'offsetSurface', name: 'os1', suppressed: false, faces: faces.map((name) => ({ kind: 'face', name })), distance, ...extra }) as Feature;
const SIDE = 'e1:side:s1.c';
/** A cylinder of radius 10 and height 20 (the face names are those of the extrusion of the circle `c`), and an offset surface of its side by `distance`. */
const cylinder = (distance = '3', radius = 10): PartDoc => build(sketch('s1', front, circle('c', 0, 0, radius)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), offset([SIDE], distance));
const lastBody = (r: RebuildResult) => r.bodies[r.bodies.length - 1]!;

describe('the offset surface feature (C9.2)', () => {
  it('makes a surface body beside the solid: the side of the cylinder R10 offset by 3 is a cylinder R13 of area 2π·13·20, and the cylinder itself is as it was', () => {
    const r = rebuild(cylinder());
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', true]]);
    const solid = r.bodies[0]!;
    expect(kernel.massProps(solid.shape).volume).toBeCloseTo(Math.PI * 100 * 20, 6);
    const surface = lastBody(r);
    expect(kernel.solidCount(surface.shape)).toBe(0);
    expect(area(surface.shape)).toBeCloseTo(2 * Math.PI * 13 * 20, 6);
    // the faces of the surface are named by the face they were offset from
    expect(r.body!.names.faces).toContain(`os1:offset:${SIDE}`);
  });

  it('follows the model: the radius made 12 and the offset 5, the surface is a cylinder of R17', () => {
    let doc = cylinder();
    const s = doc.features.find((f) => f.id === 's1');
    expect(s?.type).toBe('sketch');
    const radius = s?.type === 'sketch' ? s.constraints.find((c) => c.type === 'radius' || c.type === 'diameter') : undefined;
    expect(radius).toBeDefined();
    doc = applyCommand(doc, { type: 'setDimension', featureId: 's1', constraintId: radius!.id, value: radius!.type === 'radius' ? '12' : '24' });
    doc = applyCommand(doc, { type: 'setOffsetSurface', featureId: 'os1', faces: [{ kind: 'face', name: SIDE }], distance: '5' });
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(area(lastBody(r).shape)).toBeCloseTo(2 * Math.PI * 17 * 20, 6);
  });

  it('solid features leave it alone: a cut and a boss that join the cylinder do not touch the surface body', () => {
    const doc = build(
      sketch('s1', front, circle('c', 0, 0, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      offset([SIDE], '3'),
      sketch('s2', face('e1:cap:end'), rectangle('r', -4, -4, 8, 8)),
      extrude('x1', 's2', 'cut', { type: 'throughAll' }),
    );
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', true]]);
    // the cylinder has the hole, the surface is whole
    expect(kernel.massProps(r.bodies[0]!.shape).volume).toBeCloseTo(Math.PI * 100 * 20 - 64 * 20, 4);
    expect(area(lastBody(r).shape)).toBeCloseTo(2 * Math.PI * 13 * 20, 6);
  });

  it('an offset by 3 of the top and side together (a region) makes the three faces, named by their origins (the join round the edge by the edge)', () => {
    const top = 'e1:cap:end';
    const doc = build(sketch('s1', front, circle('c', 0, 0, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), offset([SIDE, top], '3'));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    const names = r.body!.names.faces.filter((n) => n.startsWith('os1:'));
    expect(names).toHaveLength(3);
    expect(names).toEqual(expect.arrayContaining([`os1:offset:${SIDE}`, `os1:offset:${top}`]));
    expect(names.some((n) => n.startsWith('os1:offset:{'))).toBe(true); // the join, named by the edge it goes round
  });

  it('says what is wrong: nothing picked, a face that is gone, faces of two bodies, a distance of 0', () => {
    const base = (faces: string[], distance = '3') => build(sketch('s1', front, circle('c', 0, 0, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }), offset(faces, distance));
    expect(failures(rebuild(base([])))).toEqual([expect.stringContaining('os1=error')]);
    const gone = rebuild(base(['no:such:face']));
    expect(gone.features.find((f) => f.id === 'os1')).toMatchObject({ status: 'error', message: expect.stringContaining('找不到') });
    expect(gone.features.find((f) => f.id === 'os1')!.unresolved).toHaveLength(1);
    expect(() => base([SIDE], '0')).toThrow(/不能是 0/); // refused when it is typed
    // two bodies: a second cylinder apart from the first, one face of each
    const two = build(
      sketch('s1', front, circle('c', 0, 0, 10)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
      sketch('s2', front, circle('d', 50, 0, 5)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '20' }),
      offset([SIDE, 'e2:side:s2.d'], '3'),
    );
    const r = rebuild(two);
    expect(r.features.find((f) => f.id === 'os1')).toMatchObject({ status: 'error', message: expect.stringContaining('同一個本體') });
  });

  it('refuses an offset the surface cannot bear, saying how far out it was: the side of a waist of Ø8 in by 5', () => {
    const plane = (id: string, z: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z) } }) as Feature;
    const on = (id: string) => ({ kind: 'datum', name: id }) as const;
    const doc = build(
      sketch('s0', front, circle('c0', 0, 0, 25)),
      plane('pl1', 30),
      sketch('s1', on('pl1'), circle('c1', 0, 0, 4)),
      plane('pl2', 60),
      sketch('s2', on('pl2'), circle('c2', 0, 0, 22)),
      { id: 'lf1', type: 'loft', name: 'lf1', suppressed: false, sections: ['s0', 's1', 's2'], op: 'boss' } as Feature,
    );
    const solid = rebuild(doc);
    const side = solid.body!.names.faces[kernel.topology(solid.body!.shape).faces.findIndex((f) => f.surface === 'bsplinesurface')]!;
    const bad = rebuild(applyCommand(doc, { type: 'insertFeature', feature: offset([side], '-5'), index: doc.features.length } as never));
    const result = bad.features.find((f) => f.id === 'os1')!;
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/差了 [0-9.]+ mm/);
    // and a distance it can bear is made
    const good = rebuild(applyCommand(doc, { type: 'insertFeature', feature: offset([side], '2'), index: doc.features.length } as never));
    expect(good.features.find((f) => f.id === 'os1')!.status).toBe('ok');
  });

  it('the surface body goes out in a STEP file as a shell: the faces are there, and it is a surface model', () => {
    const r = rebuild(cylinder());
    const step = kernel.exportStep(lastBody(r).shape, 'form');
    expect(step).toContain('ADVANCED_FACE');
    expect(step).toMatch(/SHELL_BASED_SURFACE_MODEL|OPEN_SHELL/);
    expect(step).not.toContain('MANIFOLD_SOLID_BREP');
  });
});
