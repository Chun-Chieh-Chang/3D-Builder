/** Large sketches whose solution is known, for the solver's memory tests (2026-10-30). */
import { SKETCH_AXIS_H, SKETCH_ORIGIN, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import type { PlaneGcsSolver } from '../src/index';

export type Truth = Map<string, [number, number]>;

export interface Built {
  sketch: SketchFeature;
  /** Where every point must end up. */
  truth: Truth;
  /** Circle radii it must end up with. */
  radii: Map<string, number>;
  /** Degrees of freedom left. */
  dof: number;
}

export const sketchOf = (entities: SketchEntity[], constraints: SketchConstraint[]): SketchFeature => ({
  id: 's',
  type: 'sketch',
  name: 's',
  suppressed: false,
  plane: { kind: 'datum', name: 'plane:front' },
  entities,
  constraints,
});

/**
 * A rectangle of `w` × `h` with its first corner at (x, y): horizontal and vertical sides, the width on side 0 and the height on side 1, drawn `off` away from
 * its true size. `anchor` places the first corner from the origin as well (it is then fully defined), or on the sketch's horizontal axis (y must be 0).
 */
export function rectangle(into: Built, i: number, x: number, y: number, w: number, h: number, off: number, anchor: 'none' | 'origin' | 'axis'): void {
  const { entities, constraints } = into.sketch;
  const p = [0, 1, 2, 3].map((k) => `p${i}_${k}`);
  const corners: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  // drawn wrong: wider and lower than it is to be, so that the solver has to move every corner
  const drawn: [number, number][] = [[x, y], [x + w + off, y], [x + w + off, y + h - off], [x, y + h - off]];
  p.forEach((id, k) => entities.push({ id, type: 'point', x: drawn[k]![0], y: drawn[k]![1] }));
  const l = [0, 1, 2, 3].map((k) => `l${i}_${k}`);
  l.forEach((id, k) => entities.push({ id, type: 'line', p1: p[k]!, p2: p[(k + 1) % 4]! }));
  constraints.push(
    { id: `h${i}a`, type: 'horizontal', a: l[0]! },
    { id: `h${i}b`, type: 'horizontal', a: l[2]! },
    { id: `v${i}a`, type: 'vertical', a: l[1]! },
    { id: `v${i}b`, type: 'vertical', a: l[3]! },
    { id: `w${i}`, type: 'distance', a: l[0]!, value: String(w) },
    { id: `t${i}`, type: 'distance', a: l[1]!, value: String(h) },
  );
  if (anchor === 'origin') {
    constraints.push({ id: `x${i}`, type: 'distanceX', a: SKETCH_ORIGIN, b: p[0]!, value: String(Math.abs(x)) }, { id: `y${i}`, type: 'distanceY', a: SKETCH_ORIGIN, b: p[0]!, value: String(Math.abs(y)) });
  } else if (anchor === 'axis') {
    if (y !== 0) throw new Error('a rectangle on the axis starts at y = 0');
    constraints.push({ id: `x${i}`, type: 'distanceX', a: SKETCH_ORIGIN, b: p[0]!, value: String(Math.abs(x)) }, { id: `y${i}`, type: 'pointOnCurve', point: p[0]!, curve: SKETCH_AXIS_H });
  }
  if (anchor === 'none') into.dof += 2;
  else p.forEach((id, k) => into.truth.set(id, corners[k]!));
}

/** A circle of radius `r` about (x, y), drawn `off` too large, its center placed from the origin. */
export function circle(into: Built, i: number, x: number, y: number, r: number, off: number): void {
  const c = `c${i}`;
  into.sketch.entities.push({ id: `${c}.o`, type: 'point', x, y }, { id: c, type: 'circle', center: `${c}.o`, radius: r + off });
  into.sketch.constraints.push(
    { id: `${c}.r`, type: 'radius', circle: c, value: String(r) },
    { id: `${c}.x`, type: 'distanceX', a: SKETCH_ORIGIN, b: `${c}.o`, value: String(Math.abs(x)) },
    { id: `${c}.y`, type: 'distanceY', a: SKETCH_ORIGIN, b: `${c}.o`, value: String(Math.abs(y)) },
  );
  into.truth.set(`${c}.o`, [x, y]);
  into.radii.set(c, r);
}

export const empty = (): Built => ({ sketch: sketchOf([], []), truth: new Map(), radii: new Map(), dof: 0 });

/** `n` dimensioned rectangles side by side, 20 a row: free to move (dof 2 each) or placed from the origin. */
export function rectangles(n: number, anchor: 'none' | 'origin'): Built {
  const out = empty();
  for (let i = 0; i < n; i++) rectangle(out, i, (i % 20) * 30, Math.floor(i / 20) * 30, 20, 10, 1, anchor);
  return out;
}

/** `k` points in one connected chain, each `3` to the right of the one before on the same horizontal: one part of 2k unknowns and 2(k − 1) equations. */
export function chain(k: number): SketchFeature {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  for (let i = 0; i < k; i++) entities.push({ id: `q${i}`, type: 'point', x: i * 3, y: (i % 2) * 0.01 });
  for (let i = 1; i < k; i++) {
    constraints.push({ id: `qh${i}`, type: 'horizontal', a: `q${i - 1}`, b: `q${i}` }, { id: `qx${i}`, type: 'distanceX', a: `q${i - 1}`, b: `q${i}`, value: '3' });
  }
  return sketchOf(entities, constraints);
}

/**
 * The solver module's memory, by the one path to it: planegcs does not export `wasmMemory`; its `HEAP8` is a view of the module's exported memory. Asserted
 * > 0 by the caller (AGENTS.md §3.1).
 */
export const heapBytes = (solver: PlaneGcsSolver): number => (solver as unknown as { w: { module: { HEAP8: Int8Array } } }).w.module.HEAP8.buffer.byteLength;
