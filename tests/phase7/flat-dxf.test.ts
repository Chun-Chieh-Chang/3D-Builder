/**
 * 7-6 (docs/phase7-plan.md): the flat pattern as a DXF (C11.3, F3.1) read back with the reader and the checker of the drawing's DXF: the outline as true lines, arcs and circles
 * on OUTLINE, the bend lines on BEND, the notes, and the sizes of what is drawn against what the pattern is by hand. Plate 100 × 50 × 1.5, inside radius 2, K 0.5.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDxf, flatPatternDxf, readDxf, type DxfArc, type DxfCircle, type DxfLine, type DxfText, type FlatDxfInput } from '@3db/drawing';
import { type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const T = 1.5;
const Ro = 3.5;
const BA = (Math.PI / 2) * 2.75;
const base: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature];
let topEdge: Ref;
beforeAll(() => {
  const r = rebuild(build(...base));
  const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - 100, e.mid[1] - 25, e.mid[2] - T) < 1e-6);
  topEdge = { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
});
const flange = (extra: Record<string, unknown> = {}): Feature => ({ id: 'ef', type: 'edgeFlange', name: 'ef', suppressed: false, edge: topEdge, length: '30', ...extra }) as Feature;

/** The DXF of the pattern of a part, and the pattern. */
function dxfOf(features: Feature[]) {
  const result = rebuild(build(...features));
  expect(statuses(result).filter((s) => !s.endsWith('=ok'))).toEqual([]);
  const pattern = flatPattern(kernel, result.sheet!);
  kernel.release(pattern.shape);
  const text = flatPatternDxf(pattern);
  return { text, doc: readDxf(text), pattern };
}
const lines = (doc: ReturnType<typeof readDxf>, layer: string) => doc.entities.filter((e): e is DxfLine => e.type === 'LINE' && e.layer === layer);
const near = (a: number, b: number, digits = 4) => expect(a).toBeCloseTo(b, digits);

describe('the DXF of a flat pattern', () => {
  it('a 90° flange: a file the checker has nothing to say of, the outline four lines on OUTLINE — 127.3197 × 50 from the origin — and one bend line on BEND at x = 96.5 + BA/2 from y 0 to 50', () => {
    const { text, doc } = dxfOf([...base, flange()]);
    expect(checkDxf(doc)).toEqual([]);
    expect(doc.version).toBe('AC1015');
    const outline = lines(doc, 'OUTLINE');
    expect(outline).toHaveLength(4);
    const xs = outline.flatMap((l) => [l.a[0], l.b[0]]);
    const ys = outline.flatMap((l) => [l.a[1], l.b[1]]);
    near(Math.min(...xs), 0);
    near(Math.max(...xs), 100 - 2 * Ro + 30 + BA);
    near(Math.min(...ys), 0);
    near(Math.max(...ys), 50);
    const bend = lines(doc, 'BEND');
    expect(bend).toHaveLength(1);
    near(bend[0]!.a[0], 100 - Ro + BA / 2);
    near(bend[0]!.b[0], 100 - Ro + BA / 2);
    near(Math.abs(bend[0]!.b[1] - bend[0]!.a[1]), 50);
    // the layers: the two of the pattern, the linetype of the bend dashed
    const layers = doc.tables.get('LAYER')!.entries.map((e) => e.name);
    expect(layers).toEqual(expect.arrayContaining(['OUTLINE', 'BEND', 'TEXT']));
    expect(layers).not.toContain('VISIBLE');
    expect(text).toContain('DASHED');
    // the header's extent covers the pattern
    const max = doc.header.get('$EXTMAX')!;
    near(Number(max[0]![1]), 100 - 2 * Ro + 30 + BA);
  });

  it('the notes: the bend says which way, how far and the radius, the pattern says the thickness and K — with the degree sign written so that every reader knows it', () => {
    const { text, doc } = dxfOf([...base, flange()]);
    const notes = doc.entities.filter((e): e is DxfText => e.type === 'TEXT').map((e) => e.text);
    expect(notes).toContain('UP 90° R2');
    expect(notes).toContain('T=1.5  K=0.5');
    expect(text).toContain('\\U+00B0');
    const down = dxfOf([...base, flange({ flip: true })]);
    expect(down.doc.entities.filter((e): e is DxfText => e.type === 'TEXT').map((e) => e.text)).toContain('DOWN 90° R2');
  });

  it('the note of a bend is never upside down: a bend line that runs to the left is read from the other end (the angle stays within -90 to 90 degrees), a vertical one reads upward', () => {
    const outline = [{ kind: 'line' as const, a: [0, 0] as [number, number], b: [10, 0] as [number, number] }];
    const angleOf = (a: [number, number], b: [number, number]) => {
      const doc = readDxf(flatPatternDxf({ outline, bends: [{ a, b, angle: Math.PI / 2, radius: 2, direction: 'up', kFactor: 0.5 }], min: [0, 0], max: [10, 10], width: 10, height: 10, thickness: 1.5 }));
      return doc.entities.filter((e): e is DxfText => e.type === 'TEXT').find((e) => e.text.startsWith('UP'))!.angle;
    };
    const upright = (v: number) => v <= 90 + 1e-6 || v >= 270 - 1e-6;
    for (const [a, b] of [[[0, 0], [10, 0]], [[10, 0], [0, 0]], [[0, 0], [0, 10]], [[0, 10], [0, 0]], [[0, 0], [10, 10]], [[10, 10], [0, 0]], [[0, 0], [-10, 5]], [[0, 0], [-10, -5]]] as [[number, number], [number, number]][]) {
      expect(upright(angleOf(a, b)), `${a} to ${b}`).toBe(true);
    }
    expect(angleOf([10, 0], [0, 0])).toBeCloseTo(0, 6);
    expect(angleOf([0, 10], [0, 0])).toBeCloseTo(90, 6);
  });

  it('a flange that stops short with its relief: every line of the outline is a LINE, with the same end points as the pattern, shifted to the origin', () => {
    const { doc, pattern } = dxfOf([...base, flange({ inset: { start: '10', end: '5' }, relief: { width: '1.5', depth: '1.5' } })]);
    expect(checkDxf(doc)).toEqual([]);
    const outline = lines(doc, 'OUTLINE');
    const lineSegments = pattern.outline.filter((s) => s.kind === 'line');
    expect(outline).toHaveLength(lineSegments.length);
    const key = (p: [number, number]) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    const want = new Set(lineSegments.flatMap((s) => (s.kind === 'line' ? [key([s.a[0] - pattern.min[0], s.a[1] - pattern.min[1]]), key([s.b[0] - pattern.min[0], s.b[1] - pattern.min[1]])] : [])));
    const got = new Set(outline.flatMap((l) => [key(l.a), key(l.b)]));
    expect(got).toEqual(want);
    expect(outline.length).toBeGreaterThan(8);
  });

  it('a hole in the plate is a CIRCLE of its radius at its place', () => {
    const { doc } = dxfOf([sketch('sk', front, rectangle('r', 0, 0, 100, 50), circle('c', 15, 20, 5)), base[1]!]);
    const circles = doc.entities.filter((e): e is DxfCircle => e.type === 'CIRCLE');
    expect(circles).toHaveLength(1);
    expect(circles[0]!.layer).toBe('OUTLINE');
    near(circles[0]!.r, 5);
    near(circles[0]!.c[0], 15);
    near(circles[0]!.c[1], 20);
    expect(lines(doc, 'OUTLINE')).toHaveLength(4);
  });

  it('the unrolled U channel: 94.639 × 40, two bend lines on BEND at 16.5 + BA/2 and 16.5 + BA + 53 + BA/2, both DOWN', () => {
    const U = { ...sketch('sk', front), entities: [[0, 20], [0, 0], [60, 0], [60, 20]].flatMap(([x, y], i) => [{ id: `p${i}`, type: 'point', x, y }, ...(i > 0 ? [{ id: String.fromCharCode(96 + i), type: 'line', p1: `p${i - 1}`, p2: `p${i}` }] : [])]) } as Feature;
    const channel = { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', depth: '40' } as Feature;
    const { doc } = dxfOf([U, channel]);
    expect(checkDxf(doc)).toEqual([]);
    const bends = lines(doc, 'BEND').sort((a, b) => a.a[0] - b.a[0]);
    expect(bends.map((l) => l.a[0])).toEqual([expect.closeTo(16.5 + BA / 2, 4), expect.closeTo(16.5 + BA + 53 + BA / 2, 4)]);
    expect(doc.entities.filter((e): e is DxfText => e.type === 'TEXT').filter((e) => e.text.startsWith('DOWN'))).toHaveLength(2);
  });
});

describe('arcs are written as ARC, counter-clockwise from the start to the end whichever way the pattern goes round', () => {
  const quarter = (from: [number, number], to: [number, number]): FlatDxfInput => ({
    outline: [{ kind: 'arc', c: [0, 0], r: 10, from, to, mid: [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10] }],
    bends: [],
    min: [0, 0],
    max: [10, 10],
    width: 10,
    height: 10,
    thickness: 1.5,
  });

  it('the quarter circle from (10, 0) to (0, 10) round the origin goes counter-clockwise: from 0° to 90°; from (0, 10) to (10, 0) it goes the other way and is the same ARC', () => {
    for (const [from, to] of [[[10, 0], [0, 10]], [[0, 10], [10, 0]]] as [[number, number], [number, number]][]) {
      const doc = readDxf(flatPatternDxf(quarter(from, to)));
      expect(checkDxf(doc)).toEqual([]);
      const arcs = doc.entities.filter((e): e is DxfArc => e.type === 'ARC');
      expect(arcs).toHaveLength(1);
      near(arcs[0]!.r, 10);
      near(arcs[0]!.start, 0, 6);
      near(arcs[0]!.end, 90, 6);
    }
  });
});
