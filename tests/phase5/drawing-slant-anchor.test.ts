/**
 * A slanted face is measured against a plane its line meets near the view (AutoCoder, 2026-11-22).
 *
 * Why: a 1°–8° slant meets a nearly parallel plane far outside the view; the arc centre then lands far away and `dimensionAll`
 * drops the angle (its guard: centre more than 8 mm outside the view box). The planner therefore prefers, among the planes of the
 * same axis, the one whose line meets the slant nearest the view. This pins that choice, so it cannot silently go back.
 */
import { describe, expect, it } from 'vitest';
import { viewVectors } from '@3db/model';
import { planDrawingDimensions, type ViewToDimension } from '@3db/drawing';

const ref = (name: string) => ({ kind: 'face' as const, name });
const slant = (dir: [number, number], at: [number, number] = [0, 0]) => ({ type: 'slant' as const, ref: ref('s1'), at, dir, area: 120 });
const plane = (name: string, axis: 'x' | 'y', coord: number) => ({ type: 'plane' as const, ref: ref(name), axis, coord, area: 60 });
const views = (features: ReturnType<typeof slant | typeof plane>[]): ViewToDimension[] => [{ viewId: 'v', axes: viewVectors('front'), features } as unknown as ViewToDimension];

describe('the anchor plane of a slanted face', () => {
  it('takes the same-axis plane whose line meets the slant nearest the view, not the first one', () => {
    // 5° from vertical: its line crosses a vertical plane (axis x) far away; the near plane must win over the far one
    const planned = planDrawingDimensions(views([slant([0.087, 0.996]), plane('far', 'x', 220), plane('near', 'x', 4)]), [], {});
    const angle = planned.find((p) => (p.draft as { kind: string }).kind === 'angle');
    expect(angle, JSON.stringify(planned.map((p) => p.draft))).toBeTruthy();
    expect((angle!.draft as unknown as { b: { name: string } }).b.name).toBe('near');
  });

  it('still prefers a plane of the same axis over a nearer one of the other axis (a draft wall is not measured at ~89°)', () => {
    const planned = planDrawingDimensions(views([slant([0.087, 0.996]), plane('farSameAxis', 'x', 220), plane('nearOtherAxis', 'y', 2)]), [], {});
    const angle = planned.find((p) => (p.draft as { kind: string }).kind === 'angle');
    expect(angle, JSON.stringify(planned.map((p) => p.draft))).toBeTruthy();
    expect((angle!.draft as unknown as { b: { name: string } }).b.name).toBe('farSameAxis');
  });
});
