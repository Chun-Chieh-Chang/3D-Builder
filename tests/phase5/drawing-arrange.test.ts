/**
 * D-I4 (ADR 0139): dimensions laid out tidily. The golden locating plate's top view is dimensioned (its size, its holes and where they are), the dimensions'
 * lines and texts thrown about at random, and arranged again: no text of a linear dimension lies over another's, no number has changed, and arranging again
 * changes nothing. Aligned collinear, the dimensions chosen take the first one's line.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { viewVectors, type Dimension, type PartDoc, dimensionRefs } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { elementFacts, Regenerator, viewFeatures } from '@3db/regen';
import { alignCollinear, arrangeDimensions, autoDimensions, evaluateDimension, overlappingDimensions, type DimensionOutcome, type ElementsResult, type PlacedView, type SceneItem } from '@3db/drawing';

let kernel: Kernel;
let regen: Regenerator;
let doc: PartDoc;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  doc = (await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))))).doc;
});
afterAll(() => regen.dispose());

const top = viewVectors('top');
const placed: PlacedView = { id: 'view1', at: [200, 150], scale: 1, w: 120, h: 80, centre: [0, 0] };

function setup() {
  const body = regen.rebuild(doc).body!;
  const drafts = autoDimensions(viewFeatures(body.topology, body.names, top), { overall: true, holes: true, positions: true });
  const dims = drafts.map((d, i) => ({ ...d, id: `dim${i + 1}`, view: 'view1' }) as Dimension);
  const resolved = new Map<string, ElementsResult>();
  for (const d of dims) {
    const refs = dimensionRefs(d);
    resolved.set(d.id, { elements: refs.map((r) => elementFacts(body.topology, body.names, r)) as never });
  }
  return { dims, resolved };
}
function draw(dims: Dimension[], resolved: Map<string, ElementsResult>) {
  const outcomes = new Map<string, DimensionOutcome>(dims.map((d) => [d.id, evaluateDimension(d, resolved.get(d.id), top, placed)]));
  const items: SceneItem[] = dims.flatMap((d) => {
    const o = outcomes.get(d.id)!;
    return 'error' in o ? [] : o.items.map((i) => ({ ...i, group: d.id }));
  });
  return { outcomes, items };
}
const apply = (dims: Dimension[], changes: { id: string; patch: Record<string, unknown> }[]) =>
  dims.map((d) => {
    const c = changes.find((x) => x.id === d.id);
    if (!c) return d;
    const next = { ...d, ...c.patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(c.patch)) if (v === null) delete next[k];
    return next as unknown as Dimension;
  });

describe('arranging the dimensions of a view', () => {
  it('thrown about at random 100 times and arranged: no text of a linear dimension over another, every number as it was, and arranging again changes nothing', () => {
    const { dims, resolved } = setup();
    const linear = dims.filter((d) => d.kind === 'linear');
    expect(linear.length).toBeGreaterThan(5);
    const values = (ds: Dimension[]) => ds.map((d) => (draw(ds, resolved).outcomes.get(d.id) as { value: number }).value);
    const truth = values(dims);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let overlappedBefore = 0;
    for (let k = 0; k < 100; k++) {
      // each linear dimension's line anywhere from 4 to 40 mm off the view, on the side it was, and its text slid up to 30 mm
      const thrown = dims.map((d) => (d.kind === 'linear' ? ({ ...d, offset: Math.sign(d.offset) * (4 + rnd() * 36), slide: (rnd() - 0.5) * 60 } as Dimension) : d));
      const ids = new Set(linear.map((d) => d.id));
      const before = draw(thrown, resolved);
      overlappedBefore += overlappingDimensions(before.items, ids) > 0 ? 1 : 0;
      const arranged = apply(thrown, arrangeDimensions(thrown, before.outcomes, new Set(dims.map((d) => d.id))));
      const after = draw(arranged, resolved);
      expect(overlappingDimensions(after.items, ids), `run ${k}`).toBe(0);
      expect(values(arranged)).toEqual(truth);
      // a second arranging is the first
      expect(arrangeDimensions(arranged, after.outcomes, new Set(dims.map((d) => d.id)))).toEqual([]);
    }
    // the random layouts did overlap, so the arranging had something to do (measured: 25 of the 100 with this seed; the guard is that it is not none)
    expect(overlappedBefore).toBeGreaterThan(10);
  });

  it('the shortest nearest the view: on each side the rows go out in the order of their spans', () => {
    const { dims, resolved } = setup();
    const { outcomes } = draw(dims, resolved);
    const arranged = apply(dims, arrangeDimensions(dims, outcomes, new Set(dims.map((d) => d.id))));
    const after = draw(arranged, resolved);
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const rows = arranged
        .filter((d): d is Extract<Dimension, { kind: 'linear' }> => d.kind === 'linear' && d.orientation === orientation)
        .map((d) => ({ off: Math.abs(d.offset), value: (after.outcomes.get(d.id) as { value: number }).value }))
        .sort((a, b) => a.off - b.off);
      for (let i = 1; i < rows.length; i++) expect(rows[i]!.value).toBeGreaterThanOrEqual(rows[i - 1]!.value);
    }
  });

  it("aligned collinear: the dimensions of the same view, way and side take the first one's line; the others are named as left alone", () => {
    const { dims } = setup();
    const h = dims.filter((d): d is Extract<Dimension, { kind: 'linear' }> => d.kind === 'linear' && d.orientation === 'horizontal');
    const v = dims.find((d) => d.kind === 'linear' && d.orientation === 'vertical')!;
    const round = dims.find((d) => d.kind === 'diameter')!;
    const { changes, skipped } = alignCollinear(dims, [h[0]!.id, h[1]!.id, h[2]!.id, v.id, round.id]);
    expect(changes.map((c) => c.id)).toEqual([h[1]!.id, h[2]!.id].filter((id) => dims.find((d) => d.id === id)!.kind === 'linear' && (dims.find((d) => d.id === id) as { offset: number }).offset !== h[0]!.offset));
    expect(changes.every((c) => c.patch.offset === h[0]!.offset)).toBe(true);
    expect(skipped.sort()).toEqual([v.id, round.id].sort());
  });
});
