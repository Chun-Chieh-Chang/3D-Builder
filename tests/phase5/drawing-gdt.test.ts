/**
 * D-I3 (ADR 0132): the annotations of a drawing — notes, datum symbols (ISO 5459), feature control frames (ISO 1101), centre lines and marks put by hand. What
 * the commands refuse is what the standards forbid; a frame can only refer to a datum the drawing shows, renaming a datum renames it in every frame, and a
 * datum still referred to cannot be deleted, not even with its view. The file keeps them, and an older file reads with none.
 */
import { describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  CHARACTERISTIC_RULES,
  CommandError,
  createEmptyDrawing,
  DRAWING_SCHEMA_VERSION,
  GEOMETRIC_CHARACTERISTICS,
  noteText,
  parseDrawing,
  serializeDrawing,
  type Annotation,
  type DrawingDoc,
  type ToleranceFrameAnnotation,
} from '@3db/model';
import { annotationItems, threadItems, threadMajor } from '@3db/drawing';

function drawing(): DrawingDoc {
  let doc = createEmptyDrawing();
  doc = applyDrawingCommand(doc, {
    type: 'insertViews',
    views: [
      { id: 'view1', name: 'Front', source: 'plate.3dbx', direction: 'front' },
      { id: 'view2', name: 'Top', source: 'plate.3dbx', direction: 'top' },
    ],
  });
  return doc;
}
const datum = (id: string, label: string, view = 'view1'): Annotation => ({ id, kind: 'datum', view, at: [0, -7.5], label });
const frame = (id: string, patch: Partial<ToleranceFrameAnnotation> = {}): ToleranceFrameAnnotation => ({ id, kind: 'fcf', view: 'view2', at: [70, 20], characteristic: 'position', tolerance: 0.05, datums: [], ...patch });
const insert = (doc: DrawingDoc, ...annotations: Annotation[]) => applyDrawingCommand(doc, { type: 'insertAnnotations', annotations });

describe('what ISO 1101 allows a characteristic', () => {
  const withDatums = insert(drawing(), datum('ann1', 'A'), datum('ann2', 'B'));
  it('each of the 14: datums none / optional / required, Ø, Ⓜ — accepted where allowed and refused, with the reason, where not', () => {
    expect(GEOMETRIC_CHARACTERISTICS.length).toBe(14);
    for (const c of GEOMETRIC_CHARACTERISTICS) {
      const rules = CHARACTERISTIC_RULES[c];
      const ok = (patch: Partial<ToleranceFrameAnnotation>) => () => insert(withDatums, frame('ann9', { characteristic: c, ...patch }));
      // datums
      if (rules.datums === 'none') {
        expect(ok({}), c).not.toThrow();
        expect(ok({ datums: [{ label: 'A' }] }), c).toThrow(CommandError);
      } else if (rules.datums === 'required') {
        expect(ok({}), c).toThrow(CommandError);
        expect(ok({ datums: [{ label: 'A' }] }), c).not.toThrow();
      } else {
        expect(ok({}), c).not.toThrow();
        expect(ok({ datums: [{ label: 'A' }, { label: 'B' }] }), c).not.toThrow();
      }
      const datums = rules.datums === 'required' ? [{ label: 'A' }] : [];
      if (rules.diameter) expect(ok({ datums, diameter: true }), c).not.toThrow();
      else expect(ok({ datums, diameter: true }), c).toThrow(CommandError);
      if (rules.material) expect(ok({ datums, material: 'M' }), c).not.toThrow();
      else expect(ok({ datums, material: 'M' }), c).toThrow(CommandError);
    }
  });

  it('the tolerance is a number over 0; a datum is named once and at most three; only Ⓜ and Ⓛ', () => {
    for (const tolerance of [0, -0.1, Number.NaN, Infinity]) expect(() => insert(withDatums, frame('ann9', { tolerance }))).toThrow(CommandError);
    expect(() => insert(withDatums, frame('ann9', { datums: [{ label: 'A' }, { label: 'A' }] }))).toThrow(CommandError);
    expect(() => insert(withDatums, frame('ann9', { material: 'X' as 'M' }))).toThrow(CommandError);
    const four = insert(withDatums, datum('ann3', 'C'), datum('ann4', 'D'));
    expect(() => insert(four, frame('ann9', { datums: ['A', 'B', 'C', 'D'].map((label) => ({ label })) }))).toThrow(CommandError);
    expect(() => insert(four, frame('ann9', { datums: ['A', 'B', 'C'].map((label) => ({ label })) }))).not.toThrow();
  });
});

describe('datums', () => {
  it('a letter is one or two capitals, not I, O or Q, and each is used once', () => {
    for (const label of ['A', 'B', 'AA', 'Z']) expect(() => insert(drawing(), datum('ann1', label))).not.toThrow();
    for (const label of ['I', 'O', 'Q', 'a', 'ABC', '', '1', 'A1']) expect(() => insert(drawing(), datum('ann1', label)), label).toThrow(CommandError);
    expect(() => insert(drawing(), datum('ann1', 'A'), datum('ann2', 'A'))).toThrow(CommandError);
  });

  it('a frame refers only to a datum the drawing shows (one added in the same command, before it, counts)', () => {
    expect(() => insert(drawing(), frame('ann2', { characteristic: 'parallelism', datums: [{ label: 'A' }] }))).toThrow(CommandError);
    expect(() => insert(drawing(), datum('ann1', 'A'), frame('ann2', { characteristic: 'parallelism', datums: [{ label: 'A' }] }))).not.toThrow();
  });

  it('renamed, it is renamed in every frame that refers to it; renamed to a letter in use, it is refused', () => {
    let doc = insert(drawing(), datum('ann1', 'A'), datum('ann2', 'B'), frame('ann3', { characteristic: 'parallelism', datums: [{ label: 'A' }] }), frame('ann4', { datums: [{ label: 'B' }, { label: 'A', material: 'M' }] }));
    doc = applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'ann1', patch: { label: 'C' } });
    const frames = doc.annotations.filter((a): a is ToleranceFrameAnnotation => a.kind === 'fcf');
    expect(frames.map((f) => f.datums.map((d) => d.label).join(''))).toEqual(['C', 'BC']);
    expect(frames[1]!.datums[1]!.material).toBe('M');
    expect(() => applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'ann1', patch: { label: 'B' } })).toThrow(CommandError);
  });

  it('one still referred to is not deleted, alone or with its view; deleted with the frames that use it, it goes', () => {
    const doc = insert(drawing(), datum('ann1', 'A'), frame('ann2', { characteristic: 'perpendicularity', datums: [{ label: 'A' }] }));
    expect(() => applyDrawingCommand(doc, { type: 'deleteAnnotations', annotationIds: ['ann1'] })).toThrow(CommandError);
    expect(() => applyDrawingCommand(doc, { type: 'deleteViews', viewIds: ['view1'] })).toThrow(CommandError);
    expect(applyDrawingCommand(doc, { type: 'deleteAnnotations', annotationIds: ['ann1', 'ann2'] }).annotations).toEqual([]);
    // the frame's view deleted: the frame goes, and then the datum may
    const without = applyDrawingCommand(doc, { type: 'deleteViews', viewIds: ['view2'] });
    expect(without.annotations.map((a) => a.id)).toEqual(['ann1']);
    expect(applyDrawingCommand(without, { type: 'deleteViews', viewIds: ['view1'] }).annotations).toEqual([]);
  });
});

describe('notes, centre lines and marks', () => {
  it('a note has text (500 at most), a height of 1.8 to 20 mm and finite places', () => {
    const note = (patch: object): Annotation => ({ id: 'ann1', kind: 'note', view: 'view1', at: [0, 20], text: '去毛邊', ...patch }) as Annotation;
    expect(() => insert(drawing(), note({}))).not.toThrow();
    expect(() => insert(drawing(), note({ text: '   ' }))).toThrow(CommandError);
    expect(() => insert(drawing(), note({ text: 'x'.repeat(501) }))).toThrow(CommandError);
    for (const height of [1, 25, Number.NaN]) expect(() => insert(drawing(), note({ height }))).toThrow(CommandError);
    expect(() => insert(drawing(), note({ at: [Number.NaN, 0] }))).toThrow(CommandError);
    expect(() => insert(drawing(), note({ leader: [1, Infinity] }))).toThrow(CommandError);
  });

  it('$PRP:key is replaced by what the drawing knows of it, and left as written when it knows nothing', () => {
    const lookup = (k: string) => ({ material: 'S45C', 硬度: 'HRC58' })[k];
    expect(noteText('材質 $PRP:material，熱處理 $PRP:硬度', lookup)).toBe('材質 S45C，熱處理 HRC58');
    expect(noteText('$PRP:nothing', lookup)).toBe('$PRP:nothing');
  });

  it('a centre line has two different ends, a centre mark a radius over 0', () => {
    expect(() => insert(drawing(), { id: 'ann1', kind: 'centreLine', view: 'view1', from: [1, 1], to: [1, 1] })).toThrow(CommandError);
    expect(() => insert(drawing(), { id: 'ann1', kind: 'centreLine', view: 'view1', from: [0, 0], to: [10, 0] })).not.toThrow();
    for (const radius of [0, -1, Number.NaN]) expect(() => insert(drawing(), { id: 'ann1', kind: 'centreMark', view: 'view1', at: [0, 0], radius })).toThrow(CommandError);
  });

  it('a field of another kind, or a required one taken away, is refused; an optional one taken away is gone', () => {
    const doc = insert(drawing(), { id: 'ann1', kind: 'note', view: 'view1', at: [0, 20], text: 'x', leader: [5, 5] });
    expect(() => applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'ann1', patch: { label: 'A' } })).toThrow(CommandError);
    expect(() => applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'ann1', patch: { text: null } })).toThrow(CommandError);
    const after = applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'ann1', patch: { leader: null } });
    expect('leader' in after.annotations[0]!).toBe(false);
  });
});

describe('the file', () => {
  it('keeps the annotations, and an older drawing (v11) reads with none', () => {
    const doc = insert(drawing(), datum('ann1', 'A'), frame('ann2', { characteristic: 'position', diameter: true, material: 'M', datums: [{ label: 'A' }] }), { id: 'ann3', kind: 'note', view: 'view1', at: [0, 30], text: '未註公差依 ISO 2768-m' });
    const back = parseDrawing(serializeDrawing(doc));
    expect(back.annotations).toEqual(doc.annotations);
    expect(DRAWING_SCHEMA_VERSION).toBe(18);
    const old = JSON.parse(serializeDrawing(drawing()));
    old.schemaVersion = 11;
    delete old.annotations;
    expect(parseDrawing(JSON.stringify(old)).annotations).toEqual([]);
    // the ids of annotations are counted, so a new one never takes an old one's id
    expect(back.idCounters.ann).toBeGreaterThanOrEqual(3);
  });
});

describe('what is drawn', () => {
  const placed = { id: 'view1', at: [100, 100] as [number, number], scale: 1, w: 120, h: 15, centre: [0, 0] as [number, number] };
  it('every characteristic draws its symbol in the first cell; the frame has a cell per datum; Ø and Ⓜ are written', () => {
    for (const c of GEOMETRIC_CHARACTERISTICS) {
      const items = annotationItems([frame('ann1', { characteristic: c, view: 'view1', datums: CHARACTERISTIC_RULES[c].datums === 'required' ? [{ label: 'A' }] : [] })], placed, () => undefined);
      expect(items.filter((i) => i.kind === 'polyline').length, c).toBeGreaterThan(2);
    }
    const items = annotationItems([frame('ann1', { view: 'view1', diameter: true, material: 'M', datums: [{ label: 'A' }, { label: 'B' }] })], placed, () => undefined);
    const texts = items.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);
    expect(texts).toEqual(expect.arrayContaining(['Ø0.05', 'A', 'B', 'M']));
  });
});

describe('the thread of a tapped hole seen end on (ISO 6410-1)', () => {
  const placed = { id: 'view1', at: [100, 100] as [number, number], scale: 2, w: 50, h: 50, centre: [0, 0] as [number, number] };
  const view = { id: 'view1', name: 'Top', source: 'p.3dbx', direction: 'top' as const };
  const hole = (size?: string, radius = 2.5) => ({ type: 'circle' as const, ref: { kind: 'face' as const, name: 'h' }, centre: [10, 0] as [number, number], radius, convex: false, full: true, outward: 0, hole: { through: true, depth: 10, thread: { ...(size ? { size } : {}) } } });
  it('the major diameter is read from the label, and a label that does not say it gives none', () => {
    expect(threadMajor('M6')).toBe(6);
    expect(threadMajor('M10x1.25')).toBe(10);
    expect(threadMajor(' m3.5 ')).toBe(3.5);
    expect(threadMajor('1/4-20 UNC')).toBeNull();
    expect(threadMajor(undefined)).toBeNull();
  });
  it('an M6 hole (Ø5 tap drill): a thin arc of three quarters at Ø6, open at the upper right; none for an unlabelled thread or a plain hole', () => {
    const items = threadItems(view, [hole('M6')], placed);
    expect(items.length).toBe(1);
    const pts = (items[0] as { points: number[] }).points;
    const at = Array.from({ length: pts.length / 2 }, (_, i) => [(pts[2 * i]! - 100) / 2 - 10, (pts[2 * i + 1]! - 100) / 2] as const);
    for (const [x, y] of at) expect(Math.hypot(x, y)).toBeCloseTo(3, 6);
    // the quarter it leaves open: no point strictly inside the upper right one
    expect(at.some(([x, y]) => x > 1e-6 && y > 1e-6)).toBe(false);
    expect((items[0] as { style: string }).style).toBe('thin');
    expect(threadItems(view, [hole()], placed)).toEqual([]);
    expect(threadItems(view, [{ ...hole('M6'), hole: { through: true, depth: 10 } }], placed)).toEqual([]);
  });
});
