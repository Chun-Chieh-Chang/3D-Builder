/**
 * Phase 3a-8b (C14.2, F1.3): colors of the part, a body, a feature or a face; the narrower one wins; they go into the STEP file (ADR 0038).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { exportFaces, faceColors, Regenerator } from '@3db/regen';
import { exportPartStep } from '@3db/io';
import { build, circle, extrude, face, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const RED = '#ff0000';
const GREEN = '#00ff00';
const BLUE = '#0000ff';
const YELLOW = '#ffff00';

/** A plate 60 × 20 × 5 with a post of radius 2 and height 5 on it (extrude 2), and a block of its own beside it (extrude 3, a body of its own). */
const parts = (): Feature[] => [
  sketch('s1', front, rectangle('p', 0, 0, 60, 20)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
  sketch('s2', face('e1:cap:end'), circle('k', 5, 10, 2)),
  extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }),
  sketch('s3', front, rectangle('q', 100, 0, 10, 10)),
  { ...extrude('e3', 's3', 'boss', { type: 'blind', depth: '5' }), merge: false } as Feature,
];
const paint = (doc: PartDoc, ...choices: Parameters<typeof applyCommand>[1][]) => choices.reduce((d, c) => applyCommand(d, c), doc);
const named = (r: ReturnType<typeof rebuild>, colors: (string | null)[]) => Object.fromEntries(r.body!.names.faces.map((n, i) => [n, colors[i]]));

describe('appearance (C14.2)', () => {
  it('nothing chosen: no face has a color', () => {
    const r = rebuild(build(...parts()));
    expect(faceColors(build(...parts()), r).every((c) => c === null)).toBe(true);
  });

  it('the whole part, then a body over it, then a feature over that, then a face over that: the narrower one wins', () => {
    const doc = paint(
      build(...parts()),
      { type: 'setAppearance', target: { kind: 'part' }, color: RED },
      { type: 'setAppearance', target: { kind: 'body', id: 'e3' }, color: GREEN },
      { type: 'setAppearance', target: { kind: 'feature', id: 'e2' }, color: BLUE },
      { type: 'setAppearance', target: { kind: 'face', ref: { kind: 'face', name: 'e2:cap:end' } }, color: YELLOW },
    );
    const r = rebuild(doc);
    const c = named(r, faceColors(doc, r));
    expect(c['e1:cap:start']).toBe(RED); // the plate: the part's
    expect(c['e1:side:s1.pl0']).toBe(RED);
    expect(c['e2:side:s2.k']).toBe(BLUE); // the post's wall: its feature's
    expect(c['e2:cap:end']).toBe(YELLOW); // the top of the post: its own
    expect(c['e3:cap:end']).toBe(GREEN); // the block: its body's, over the part's
  });

  it('a color replaces the color of the same target and can be taken away; a target that is gone does nothing', () => {
    let doc = build(...parts());
    doc = paint(doc, { type: 'setAppearance', target: { kind: 'feature', id: 'e2' }, color: RED }, { type: 'setAppearance', target: { kind: 'feature', id: 'e2' }, color: '#ABCDEF' });
    expect(doc.appearances).toEqual([{ target: { kind: 'feature', id: 'e2' }, color: '#abcdef' }]);
    const gone = paint(doc, { type: 'setAppearance', target: { kind: 'body', id: 'nope' }, color: RED });
    const r = rebuild(gone);
    expect(faceColors(gone, r).filter(Boolean).length).toBe(r.body!.names.faces.filter((n) => n.startsWith('e2:')).length);
    expect(paint(gone, { type: 'setAppearance', target: { kind: 'feature', id: 'e2' }, color: null }).appearances).toEqual([{ target: { kind: 'body', id: 'nope' }, color: RED }]);
  });

  it('the color of a feature goes to the faces its patterns and mirrors make too', () => {
    const doc = paint(
      build(...parts().slice(0, 4), { id: 'pat1', type: 'pattern', name: 'pat1', suppressed: false, seeds: ['e2'], def: { mode: 'linear', dir1: { ref: { kind: 'datum', name: 'plane:right' }, spacing: '10', count: '3' } } }),
      { type: 'setAppearance', target: { kind: 'feature', id: 'pat1' }, color: GREEN },
    );
    const r = rebuild(doc);
    const c = named(r, faceColors(doc, r));
    expect(c['pat1:inst2:e2:side:s2.k']).toBe(GREEN);
    expect(c['e2:side:s2.k']).toBeNull();
  });

  it('the commands refuse what is not a color, a feature that is not there, and a face that is not a face', () => {
    const doc = build(...parts());
    expect(() => paint(doc, { type: 'setAppearance', target: { kind: 'part' }, color: 'red' })).toThrow('#rrggbb');
    expect(() => paint(doc, { type: 'setAppearance', target: { kind: 'feature', id: 'zzz' }, color: RED })).toThrow('特徵不存在');
    expect(() => paint(doc, { type: 'setAppearance', target: { kind: 'face', ref: { kind: 'edge', name: 'x' } }, color: RED })).toThrow('必須是模型的面');
  });
});

describe('colors in the STEP file (F1.3)', () => {
  it('the faces of a body that count are written with their colors, in the order of the file; a reference body is left out with its colors', () => {
    const doc = paint(
      build(...parts()),
      { type: 'setBody', bodyId: 'e3', reference: true },
      { type: 'setAppearance', target: { kind: 'feature', id: 'e2' }, color: '#3366cc' },
      { type: 'setAppearance', target: { kind: 'body', id: 'e3' }, color: GREEN },
    );
    const r = rebuild(doc);
    const { shapes, colors } = exportFaces(doc, r);
    expect(shapes).toHaveLength(1); // the block is a reference body
    expect(colors).toHaveLength(r.bodies[0]!.faces);
    const step = exportPartStep(kernel, shapes, 'plate', { faceColors: colors });
    const rgb = step.split('\n').filter((l) => l.includes('COLOUR_RGB')).map((l) => /COLOUR_RGB\('',([\d.e+-]+),([\d.e+-]+),([\d.e+-]+)\)/.exec(l)!.slice(1).map(Number));
    expect(rgb).toHaveLength(1);
    expect(rgb[0]!.map((v) => Math.round(v * 255))).toEqual([0x33, 0x66, 0xcc]);
    expect(step).not.toContain("'green'"); // the reference body's color did not travel
    // without colors the file has none, and it holds the same solid
    const plain = exportPartStep(kernel, shapes, 'plate');
    expect(plain).not.toContain('COLOUR_RGB');
    const back = kernel.importStep(step);
    expect(kernel.massProps(back.shape).volume).toBeCloseTo(kernel.massProps(shapes[0]!).volume, 6);
    kernel.release(back.shape);
  });

  it('two bodies that count go into one file, the colors of the second after those of the first', () => {
    const doc = paint(build(...parts()), { type: 'setAppearance', target: { kind: 'body', id: 'e3' }, color: '#3366cc' });
    const r = rebuild(doc);
    const { shapes, colors } = exportFaces(doc, r);
    expect(shapes).toHaveLength(2);
    expect(colors.slice(0, r.bodies[0]!.faces).every((c) => c === null)).toBe(true);
    expect(colors.slice(r.bodies[0]!.faces).every((c) => c === '#3366cc')).toBe(true);
    const step = exportPartStep(kernel, shapes, 'two', { faceColors: colors });
    expect(step.split('\n').filter((l) => l.includes('STYLED_ITEM')).length).toBeGreaterThan(0);
  });
});
