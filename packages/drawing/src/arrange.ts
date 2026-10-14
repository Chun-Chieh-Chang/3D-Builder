import type { Dimension, DimensionPatch, Id } from '@3db/model';
import { FIRST_OFFSET, OFFSET_STEP } from './autoDimension';
import type { DimensionOutcome } from './dimension';

/**
 * Laying dimensions out tidily (D-I4, ADR 0139), as SolidWorks's Auto Arrange and Align do. Only where a dimension is drawn changes — how far its line is from
 * the view (`offset`) and where its text is along it (`slide`) — never what it measures, so no number can change. Each returns the changes to make; the caller
 * makes them as one step.
 */

type Linear = Extract<Dimension, { kind: 'linear' }>;

/** How long a linear dimension is on the sheet, along the way it measures: the shorter ones go nearest the view, so that no dimension line crosses another's extension lines. */
function span(d: Linear, outcome: DimensionOutcome | undefined): number | null {
  if (!outcome || 'error' in outcome || outcome.handle?.kind !== 'linear') return null;
  const { a, b } = outcome.handle;
  return d.orientation === 'horizontal' ? Math.abs(b[0] - a[0]) : d.orientation === 'vertical' ? Math.abs(b[1] - a[1]) : Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Stacks the horizontal and vertical linear dimensions in `ids` outward from their views, one row each: on each side of each view the shortest nearest, every
 * row `OFFSET_STEP` beyond the last from `FIRST_OFFSET`, and the text back in the middle. A dimension that cannot be drawn (its elements gone) is left where it is.
 */
export function arrangeDimensions(dimensions: readonly Dimension[], outcomes: ReadonlyMap<Id, DimensionOutcome>, ids: ReadonlySet<Id>): { id: Id; patch: DimensionPatch }[] {
  const groups = new Map<string, { d: Linear; span: number }[]>();
  for (const d of dimensions) {
    if (d.kind !== 'linear' || !ids.has(d.id) || d.orientation === 'aligned') continue;
    const s = span(d, outcomes.get(d.id));
    if (s === null) continue;
    const key = `${d.view}|${d.orientation}|${Math.sign(d.offset)}`;
    const list = groups.get(key);
    if (list) list.push({ d, span: s });
    else groups.set(key, [{ d, span: s }]);
  }
  const out: { id: Id; patch: DimensionPatch }[] = [];
  for (const list of groups.values()) {
    // the shortest nearest; of equal ones the one that was nearer stays nearer, so that a second arranging changes nothing
    list.sort((x, y) => x.span - y.span || Math.abs(x.d.offset) - Math.abs(y.d.offset) || (x.d.id < y.d.id ? -1 : 1));
    list.forEach(({ d }, i) => {
      const offset = Math.sign(d.offset) * (FIRST_OFFSET + i * OFFSET_STEP);
      if (offset !== d.offset || (d.slide ?? 0) !== 0) out.push({ id: d.id, patch: { offset, slide: null } });
    });
  }
  return out;
}

/**
 * Puts the linear dimensions in `ids` on one line, as the first of them is (SolidWorks's Align Collinear): those of its view, its way of measuring and its side
 * take its offset. The others are left as they are and named in `skipped`, so that the caller can say why they did not move.
 */
export function alignCollinear(dimensions: readonly Dimension[], ids: readonly Id[]): { changes: { id: Id; patch: DimensionPatch }[]; skipped: Id[] } {
  const chosen = ids.map((id) => dimensions.find((d) => d.id === id)).filter((d): d is Dimension => !!d);
  const first = chosen.find((d): d is Linear => d.kind === 'linear');
  if (!first) return { changes: [], skipped: chosen.map((d) => d.id) };
  const changes: { id: Id; patch: DimensionPatch }[] = [];
  const skipped: Id[] = [];
  for (const d of chosen) {
    if (d === first) continue;
    if (d.kind !== 'linear' || d.view !== first.view || d.orientation !== first.orientation || Math.sign(d.offset) !== Math.sign(first.offset)) skipped.push(d.id);
    else if (d.offset !== first.offset) changes.push({ id: d.id, patch: { offset: first.offset } });
  }
  return { changes, skipped };
}
