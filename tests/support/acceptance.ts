/**
 * Tools of the 3a acceptance (docs/phase3-plan.md §5): how close a rebuilt part is to a reference shape, and whether a part survives its key dimensions being
 * changed. They work on shapes and documents, so the same code serves the golden parts and the parts the user brings (a reference STEP, a `.3dbx`, and the
 * dimensions that matter).
 */
import { expect } from 'vitest';
import { applyCommand, type Command, type PartDoc, type SketchConstraint } from '@3db/model';
import type { Kernel, ShapeId } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import type { PlaneGcsSolver } from '@3db/sketch';

/** The volume of what only one of the two has: |A \ B| + |B \ A| (§5 ①: the symmetric difference). */
export function symmetricDifference(kernel: Kernel, a: ShapeId, b: ShapeId): number {
  let total = 0;
  for (const [x, y] of [[a, b], [b, a]] as const) {
    const part = kernel.boolean('cut', x, y);
    try {
      total += kernel.massProps(part.shape).volume;
    } finally {
      kernel.release(part.shape);
    }
  }
  return total;
}

export interface ReferenceComparison {
  /** Symmetric difference ÷ volume of the reference. */
  symmetricDifference: number;
  /** Relative differences of volume and surface area. */
  volume: number;
  area: number;
  /** Distance between the centres of mass, mm. */
  centroid: number;
}

/** §5 ① and ②: how a rebuilt part differs from the reference shape. */
export function compareToReference(kernel: Kernel, built: ShapeId, reference: ShapeId): ReferenceComparison {
  const p = kernel.massProps(built);
  const q = kernel.massProps(reference);
  return {
    symmetricDifference: symmetricDifference(kernel, built, reference) / q.volume,
    volume: Math.abs(p.volume - q.volume) / q.volume,
    area: Math.abs(p.area - q.area) / q.area,
    centroid: Math.hypot(p.center[0] - q.center[0], p.center[1] - q.center[1], p.center[2] - q.center[2]),
  };
}

/** The limits of §5 ①. */
export const REFERENCE_LIMITS = { symmetricDifference: 1e-6, volume: 1e-4, area: 1e-4, centroid: 0.01 } as const;

/** §5 ②: the values tried for a key dimension, as fractions of its nominal value (between 50% and 200%). */
export const SWEEP_FACTORS = [0.5, 0.75, 1.25, 1.5, 2] as const;

/** A dimension the user named as a key one: how to change it, and (where the shape has a closed form) what the volume must then be. */
export interface KeyDimension {
  name: string;
  nominal: number;
  set(doc: PartDoc, value: number): PartDoc;
  /** The hand-calculated volume with this dimension at `value`, the others nominal. */
  volume?(value: number): number;
}

/** Sets the sketch dimension of `type` whose value is `from` (the ids a UI session made are not assumed) to `to`. */
export function setSketchDimension(doc: PartDoc, sketch: string, type: SketchConstraint['type'], from: string, to: number): PartDoc {
  const s = doc.features.find((f) => f.name === sketch);
  if (s?.type !== 'sketch') throw new Error(`no sketch ${sketch}`);
  const hits = s.constraints.filter((x) => x.type === type && 'value' in x && x.value === from);
  if (hits.length === 0) throw new Error(`no ${type} = ${from} in ${sketch}`);
  return hits.reduce((d, x) => applyCommand(d, { type: 'setDimension', featureId: s.id, constraintId: x.id, value: String(to) }), doc);
}

export const runCommand = (doc: PartDoc, cmd: Command) => applyCommand(doc, cmd);
export const featureIdOf = (doc: PartDoc, name: string) => {
  const f = doc.features.find((x) => x.name === name);
  if (!f) throw new Error(`no feature ${name}`);
  return f.id;
};

/** What went wrong in a rebuild, as a list of words: failed features, warnings, references that were not found. */
export function problemsOf(r: RebuildResult): string[] {
  return r.features.flatMap((f) => [
    ...(f.status !== 'ok' ? [`${f.id}=${f.status} ${f.message ?? ''}`] : []),
    ...(f.warnings ?? []).map((w) => `${f.id}: ${w}`),
    ...(f.unresolved ?? []).map((u) => `${f.id}: lost ${u.ref.name}`),
  ]);
}

export interface SweepRow {
  dimension: string;
  value: number;
  problems: string[];
  valid: boolean;
  volume: number;
  /** Against the hand-calculated volume, when there is one. */
  expected?: number;
  /** Symmetric difference ÷ volume against the same value built from nothing. */
  fromScratch: number;
}

/**
 * §5 ②: each key dimension in turn takes its values in an editing session (one change after the other on the same document, a long-lived `Regenerator`),
 * and every result is compared with the part built from nothing at that value (the nominal document with only that change, a new `Regenerator`).
 */
export function sweepKeyDimensions(kernel: Kernel, solver: PlaneGcsSolver, nominal: PartDoc, dimensions: KeyDimension[]): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const dim of dimensions) {
    const session = new Regenerator(kernel, solver);
    let doc = nominal;
    for (const factor of SWEEP_FACTORS) {
      const value = dim.nominal * factor;
      doc = dim.set(doc, value);
      const edited = session.rebuild(doc);
      const scratch = new Regenerator(kernel, solver);
      const fresh = scratch.rebuild(dim.set(nominal, value));
      rows.push({
        dimension: dim.name,
        value,
        problems: [...problemsOf(edited), ...problemsOf(fresh)],
        valid: !!edited.body && kernel.isValid(edited.body.shape),
        volume: edited.body ? kernel.massProps(edited.body.shape).volume : NaN,
        ...(dim.volume ? { expected: dim.volume(value) } : {}),
        fromScratch: edited.body && fresh.body ? symmetricDifference(kernel, edited.body.shape, fresh.body.shape) / kernel.massProps(fresh.body.shape).volume : NaN,
      });
      scratch.dispose();
    }
    session.dispose();
  }
  return rows;
}

/** Checks the rows of a sweep against §5 ②; returns nothing, fails the test with the row that broke. */
export function expectSweepPasses(rows: SweepRow[]): void {
  for (const r of rows) {
    const where = `${r.dimension} = ${r.value}`;
    expect(r.problems, where).toEqual([]);
    expect(r.valid, where).toBe(true);
    expect(r.fromScratch, where).toBeLessThan(1e-6);
    if (r.expected !== undefined) expect(Math.abs(r.volume - r.expected) / r.expected, where).toBeLessThan(1e-9);
  }
}
