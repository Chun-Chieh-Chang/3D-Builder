/**
 * Candidate holding (G04, ADR 0223). Two layers: the rules themselves (`snapHold`, pure), and the controller with a hand tremor on a tie — the same paths
 * the P4-4 measurement used, where the raw snap flipped 8 times in 200 moves between two points 0.15 mm apart, 40 times between two parallel lines and 7
 * times between two concentric circles.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type Command, type PartDoc, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver } from '@3db/sketch';
import { snap } from '@3db/sketch/interact';
import { HOLD_HANDOVER, snapHold } from '../src/sketcher/snap-hold';
import { SketchController, type PointerInput, type SketchHost } from '../src/sketcher/controller';
import type { SketchSolvePayload } from '../src/worker/protocol';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EMPTY_SKETCH: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 'sketch1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};

class Host implements SketchHost {
  readonly featureId = 'sketch1';
  readonly history: DocHistory;
  last: SketchSolvePayload | null = null;
  constructor(doc: PartDoc) {
    this.history = new DocHistory(doc);
    this.resolve();
  }
  sketch(): SketchFeature {
    return this.history.doc.features.find((f) => f.id === this.featureId) as SketchFeature;
  }
  private payload(s: SketchFeature, doc: PartDoc = this.history.doc): SketchSolvePayload {
    const r = solver.solve(resolveSketch(s, doc), {});
    return { seq: 0, ...r, problems: r.status === 'failed' ? [] : findProfiles(s, r).problems, ms: 0 };
  }
  resolve(): void {
    this.last = this.payload(this.sketch());
  }
  doc = () => this.history.doc;
  solved = () => this.last;
  execute = (cmd: Command) => {
    this.history.execute(cmd);
    this.resolve();
    return true;
  };
  dragPreview: SketchHost['dragPreview'] = () => this.resolve();
  trial = async (s: SketchFeature, doc?: PartDoc) => this.payload(s, doc);
  notify = () => undefined;
  editDimension = () => undefined;
}

/** A sketch with the geometry of one measured case: two points 0.15 mm apart, two parallel lines 0.2 mm apart, or two circles 0.2 mm apart in radius. */
function sketchOf(entities: SketchFeature['entities']): PartDoc {
  return applyCommand(applyCommand(createEmptyPart(), EMPTY_SKETCH), { type: 'addSketchItems', featureId: 'sketch1', entities, constraints: [] });
}

const twoPoints: SketchFeature['entities'] = [
  { id: 'p1', type: 'point', x: 10.15, y: 0 },
  { id: 'p2', type: 'point', x: 10.3, y: 0 },
];
const twoLines: SketchFeature['entities'] = [
  { id: 'a1', type: 'point', x: 0, y: 10 },
  { id: 'a2', type: 'point', x: 30, y: 10 },
  { id: 'b1', type: 'point', x: 0, y: 10.2 },
  { id: 'b2', type: 'point', x: 30, y: 10.2 },
  { id: 'la', type: 'line', p1: 'a1', p2: 'a2' },
  { id: 'lb', type: 'line', p1: 'b1', p2: 'b2' },
];
const twoCircles: SketchFeature['entities'] = [
  { id: 'c1', type: 'point', x: 20, y: 0 },
  { id: 'c2', type: 'point', x: 20, y: 0 },
  { id: 'ka', type: 'circle', center: 'c1', radius: 5.2 },
  { id: 'kb', type: 'circle', center: 'c2', radius: 5.4 },
];

/** The same hand tremor as the measurement: 200 moves around the tie, deterministic. */
const tremor = (at: [number, number], i: number): [number, number] => [
  at[0] + 0.002 * Math.sin((i * Math.PI) / 3) + 0.01 * Math.sin(i / 40),
  at[1] + 0.002 * Math.cos((i * Math.PI) / 5),
];

const at = (p: [number, number], mods: Partial<PointerInput> = {}): PointerInput => ({ p, px: 0.05, ctrl: false, shift: false, ...mods });

/** What the snap names, as a key to count changes of. */
const keyOf = (s: { kind: string; id?: string; line?: string } | null): string =>
  !s ? 'free' : s.kind === 'point' ? `point:${s.id}` : s.kind === 'midpoint' ? `mid:${s.line}` : s.kind === 'curve' ? `curve:${s.id}` : s.kind;

const changes = (keys: string[]) => keys.filter((k, i) => i > 0 && k !== keys[i - 1]).length;

describe('the rules of holding (G04)', () => {
  const held = { kind: 'point' as const, id: 'p1', d: 0.1 };
  it('holds a candidate while the cursor is within reach of it', () => {
    expect(snapHold(null, held, 1)).toBe('release');
    expect(snapHold(held, null, 1)).toBe('hold'); // nothing else found: the held one is still there
    expect(snapHold({ ...held, d: 1.01 }, null, 1)).toBe('release');
    expect(snapHold({ ...held, d: Number.NaN }, null, 1)).toBe('release'); // a missing place is not a hold
  });

  it('does not flicker at a tie, and still hands over when another is clearly nearer', () => {
    const other = { kind: 'point' as const, id: 'p2' };
    expect(snapHold(held, { ...other, d: 0.1 }, 1)).toBe('hold');
    expect(snapHold(held, { ...other, d: 0.1 * HOLD_HANDOVER + 1e-9 }, 1)).toBe('hold');
    expect(snapHold(held, { ...other, d: 0.1 * HOLD_HANDOVER - 1e-9 }, 1)).toBe('adopt');
    expect(snapHold({ ...held, d: 0 }, { ...other, d: 0 }, 1)).toBe('hold'); // the cursor is on the held one
  });

  it('takes a candidate of a higher class at once and keeps the held one against a lower class', () => {
    const curve = { kind: 'curve' as const, id: 'l1', d: 0.05 };
    const mid = { kind: 'midpoint' as const, id: 'l1', d: 0.05 };
    expect(snapHold(curve, mid, 1)).toBe('adopt'); // a midpoint over anywhere on a curve
    expect(snapHold(curve, held, 1)).toBe('adopt'); // a point over both
    expect(snapHold(mid, curve, 1)).toBe('hold');
    expect(snapHold(held, curve, 1)).toBe('hold');
    // a crossing is never held, and it beats a held stretch of curve but not a held point or midpoint
    expect(snapHold(curve, { kind: 'other' }, 1)).toBe('adopt');
    expect(snapHold(mid, { kind: 'other' }, 1)).toBe('hold');
    expect(snapHold(held, { kind: 'other' }, 1)).toBe('hold');
  });
});

describe('holding while drawing (G04)', () => {
  it('stops the candidate flickering under a tremor between two points 0.15 mm apart', () => {
    const h = new Host(sketchOf(twoPoints));
    const c = new SketchController(h);
    c.setTool('line');
    const raw: string[] = [];
    const shown: string[] = [];
    for (let i = 0; i < 200; i++) {
      const p = tremor([10.225, 0], i);
      raw.push(keyOf(snap(h.last!.geometry, p, 7 * 0.05)));
      c.pointerMove(at(p), false);
      shown.push(keyOf(c.getView().snap));
    }
    // the path really is a tie: without holding it flips several times, exactly as measured
    expect(changes(raw)).toBeGreaterThanOrEqual(4);
    expect(changes(shown)).toBeLessThanOrEqual(1);
    // and where the other point is under the cursor while the first is shown, the hint says why
    c.pointerMove(at([10.24, 0]), false);
    expect(keyOf(c.getView().snap)).toBe('point:p1');
    expect(c.getView().hint).toContain('保持吸附');
  });

  it('stops the flicker between two parallel lines (the measured 40 flips) and between concentric circles (7)', () => {
    const lines = new Host(sketchOf(twoLines));
    const lc = new SketchController(lines);
    lc.setTool('line');
    const rawMid: string[] = [];
    const mid: string[] = [];
    for (let i = 0; i < 200; i++) {
      const p = tremor([15, 10.1], i);
      rawMid.push(keyOf(snap(lines.last!.geometry, p, 7 * 0.05)));
      lc.pointerMove(at(p), false);
      mid.push(keyOf(lc.getView().snap));
    }
    expect(new Set(rawMid).size).toBe(2); // both midpoints really are in reach
    expect(changes(rawMid)).toBeGreaterThanOrEqual(20);
    expect(changes(mid)).toBeLessThanOrEqual(1);

    const circles = new Host(sketchOf(twoCircles));
    const cc = new SketchController(circles);
    cc.setTool('line');
    const rawCurve: string[] = [];
    const curve: string[] = [];
    for (let i = 0; i < 200; i++) {
      const p = tremor([25.3, 0], i);
      rawCurve.push(keyOf(snap(circles.last!.geometry, p, 7 * 0.05)));
      cc.pointerMove(at(p), false);
      curve.push(keyOf(cc.getView().snap));
    }
    expect(new Set(rawCurve).size).toBe(2);
    expect(changes(rawCurve)).toBeGreaterThanOrEqual(4);
    expect(changes(curve)).toBeLessThanOrEqual(1);
  });

  it('still hands over while walking from one point to the next', () => {
    const h = new Host(sketchOf(twoPoints));
    const c = new SketchController(h);
    c.setTool('line');
    const seen: string[] = [];
    for (let i = 0; i <= 40; i++) {
      c.pointerMove(at([10.05 + (0.35 * i) / 40, 0]), false);
      const k = keyOf(c.getView().snap);
      if (seen[seen.length - 1] !== k) seen.push(k);
    }
    expect(seen).toEqual(['point:p1', 'point:p2']); // both, in order, once each
  });

  it('lets go on Ctrl, on Esc, and when the tool changes', () => {
    const h = new Host(sketchOf(twoPoints));
    const c = new SketchController(h);
    c.setTool('line');
    c.pointerMove(at([10.16, 0]), false); // takes p1
    c.pointerMove(at([10.24, 0]), false); // p2 is under the cursor, p1 is held
    expect(keyOf(c.getView().snap)).toBe('point:p1');
    expect(c.getView().hint).toContain('保持吸附');
    // Ctrl: no snap at all, and the hold ends with it
    c.pointerMove(at([10.24, 0], { ctrl: true }), false);
    expect(c.getView().snap).toMatchObject({ kind: 'free' });
    expect(c.getView().hint).not.toContain('保持吸附');
    c.pointerMove(at([10.16, 0]), false); // a fresh choice, p1 is nearest here
    c.pointerMove(at([10.24, 0]), false);
    expect(keyOf(c.getView().snap)).toBe('point:p1');

    // Esc releases the hold without ending the tool when a segment is in progress: start one, hold, then press Esc
    c.pointerDown(at([0, 5]));
    c.pointerUp(at([0, 5]));
    c.pointerMove(at([10.16, 0]), false);
    c.pointerMove(at([10.24, 0]), false);
    expect(keyOf(c.getView().snap)).toBe('point:p1');
    c.escape();
    c.pointerMove(at([10.24, 0]), false); // after Esc the nearest one is taken again: no hold carried over
    expect(c.getView().tool).toBe('line');
    expect(keyOf(c.getView().snap)).toBe('point:p2');
    expect(c.getView().hint).not.toContain('保持吸附');

    // a new tool starts without a hold: the nearest point is taken, rather than the one the line tool was holding
    c.pointerMove(at([10.16, 0]), false);
    c.setTool('circle');
    c.pointerMove(at([10.24, 0]), false);
    expect(keyOf(c.getView().snap)).toBe('point:p2');
  });

  it('lets go when the sketch changes, so a new document is never snapped against an old hold', () => {
    // Two identical sketches; in one of them the document changes between the two moves. The second move is only 40 % nearer the other point, which the
    // hold would keep without the change.
    const build = () => {
      const h = new Host(sketchOf(twoPoints));
      const c = new SketchController(h);
      c.setTool('line');
      c.pointerMove(at([10.16, 0]), false); // holds p1
      return { h, c };
    };
    const withoutChange = build();
    withoutChange.c.pointerMove(at([10.23, 0]), false);
    expect(keyOf(withoutChange.c.getView().snap)).toBe('point:p1');

    const withChange = build();
    withChange.h.execute({ type: 'addSketchItems', featureId: 'sketch1', entities: [{ id: 'far', type: 'point', x: 100, y: 100 }], constraints: [] });
    withChange.c.pointerMove(at([10.23, 0]), false);
    expect(keyOf(withChange.c.getView().snap)).toBe('point:p2');
  });

  it('lets go when the held element is gone', () => {
    const h = new Host(sketchOf(twoPoints));
    const c = new SketchController(h);
    c.setTool('line');
    c.pointerMove(at([10.16, 0]), false);
    expect(keyOf(c.getView().snap)).toBe('point:p1');
    h.execute({ type: 'removeSketchItems', featureId: 'sketch1', ids: ['p1'] });
    c.pointerMove(at([10.16, 0]), false);
    expect(keyOf(c.getView().snap)).toBe('point:p2');
  });
});
