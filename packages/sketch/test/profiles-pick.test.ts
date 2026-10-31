/**
 * G10 (P3): the closed regions a boss or cut can be made from are outlined on the sketch plane — for filling them and for
 * deciding what the cursor is over (a hole is not the region) — and a click chooses them the way the list does.
 */
import { describe, expect, it } from 'vitest';
import type { SketchEntity, SketchFeature } from '@3db/model';
import { contourChoices, findProfiles, outlineContains, pickContourSelection, regionOutline, sameContour, type ContourChoice, type SolvedGeometry } from '../src/index';

const sketchOf = (entities: SketchEntity[]): SketchFeature => ({
  id: 's',
  type: 'sketch',
  name: 's',
  suppressed: false,
  plane: { kind: 'datum', name: 'plane:top' },
  entities,
  constraints: [],
});

const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string): SketchEntity => ({ id, type: 'line', p1, p2 });

/** A rectangle with four points and four lines, named `<name>p0..3` and `<name>l0..3`. */
function rectangle(name: string, x: number, y: number, w: number, h: number): SketchEntity[] {
  return [
    point(`${name}p0`, x, y),
    point(`${name}p1`, x + w, y),
    point(`${name}p2`, x + w, y + h),
    point(`${name}p3`, x, y + h),
    line(`${name}l0`, `${name}p0`, `${name}p1`),
    line(`${name}l1`, `${name}p1`, `${name}p2`),
    line(`${name}l2`, `${name}p2`, `${name}p3`),
    line(`${name}l3`, `${name}p3`, `${name}p0`),
  ];
}

/** The solved geometry of these entities, as the solver would hand it to `findProfiles`. */
function solvedOf(entities: SketchEntity[]): Map<string, SolvedGeometry> {
  const at = new Map<string, [number, number]>();
  for (const e of entities) if (e.type === 'point') at.set(e.id, [e.x, e.y]);
  const g = new Map<string, SolvedGeometry>();
  const pointOf = (id: string): [number, number] => at.get(id) ?? [0, 0];
  for (const e of entities) {
    if (e.type === 'point') g.set(e.id, { type: 'point', p: [e.x, e.y] });
    else if (e.type === 'line') g.set(e.id, { type: 'line', a: pointOf(e.p1), b: pointOf(e.p2), p1: e.p1, p2: e.p2, construction: false });
    else if (e.type === 'circle') g.set(e.id, { type: 'circle', c: pointOf(e.center), r: e.radius, center: e.center, construction: false });
    else throw new Error(`no geometry for ${e.type}`);
  }
  return g;
}

/** A 40 × 20 rectangle with a Ø10 circle inside it, and two separate 10 × 10 rectangles: three regions to choose from. */
function sheet(): SketchEntity[] {
  return [
    ...rectangle('a', 0, 0, 40, 20),
    point('ac', 20, 10),
    { id: 'hole', type: 'circle', center: 'ac', radius: 5 },
    ...rectangle('b', 50, 0, 10, 10),
    ...rectangle('c', 50, 20, 10, 10),
  ];
}

const regionsOf = () => findProfiles(sketchOf(sheet()), { geometry: solvedOf(sheet()) }).regions;

describe('the outline of a region (G10)', () => {
  it('is the outer boundary and its holes, and a point in a hole is not in the region', () => {
    const regions = regionsOf();
    expect(regions).toHaveLength(3);
    const withHole = regions.find((r) => r.holes.length === 1)!;
    const outline = regionOutline(withHole);
    expect(outline.holes).toHaveLength(1);
    // area of the region: 40 × 20 less the circle
    const choice = contourChoices([withHole])[0]!;
    expect(choice.area).toBeCloseTo(800 - 25 * Math.PI, 6);
    expect(choice.holes).toBe(1);
    // inside the rectangle, clear of the hole
    expect(outlineContains(outline, [5, 5])).toBe(true);
    expect(outlineContains(outline, [35, 15])).toBe(true);
    // the middle of the hole is not part of the region
    expect(outlineContains(outline, [20, 10])).toBe(false);
    // just outside the circle is back in the region
    expect(outlineContains(outline, [20, 16])).toBe(true);
    // outside the rectangle altogether
    expect(outlineContains(outline, [-1, 10])).toBe(false);
    expect(outlineContains(outline, [60, 10])).toBe(false);
  });

  it('covers every region of the sketch, each with its own outline', () => {
    const regions = regionsOf();
    const outlines = regions.map(regionOutline);
    const picks = outlines.map((o) => outlineContains(o, [55, 5]) || outlineContains(o, [55, 25]) || outlineContains(o, [20, 2]));
    expect(picks.filter(Boolean)).toHaveLength(3); // one point in each region is in exactly one outline
    // a point in one region is not in the others
    expect(outlines.filter((o) => outlineContains(o, [55, 5]))).toHaveLength(1);
    expect(outlines.filter((o) => outlineContains(o, [55, 25]))).toHaveLength(1);
    expect(outlines.filter((o) => outlineContains(o, [20, 2]))).toHaveLength(1);
  });
});

describe('choosing a contour (G10)', () => {
  const same = sameContour;
  const choices = (ids: string[][]): ContourChoice[] => ids.map((id) => ({ ids: id, area: 1, center: [0, 0], holes: 0 }));
  const three = choices([['a'], ['b'], ['c']]);

  it('a plain click takes only the one clicked', () => {
    expect(pickContourSelection(three, null, 1, false)).toEqual([['b']]);
    expect(pickContourSelection(three, [['a'], ['c']], 0, false)).toEqual([['a']]);
  });

  it('Ctrl adds and removes, and never leaves none chosen', () => {
    expect(pickContourSelection(three, [['b']], 2, true)).toEqual([['b'], ['c']]);
    expect(pickContourSelection(three, [['b'], ['c']], 1, true)).toEqual([['c']]);
    expect(pickContourSelection(three, [['c']], 2, true)).toEqual([['c']]); // the only one stays
    expect(pickContourSelection(three, null, 2, true)).toEqual([['a'], ['b']]); // "all" less the one clicked
    expect(pickContourSelection(three, [['a'], ['b']], 2, true)).toBeNull(); // all of them: the same as none remembered
  });

  it('names the same contour by what it shares, as the list does', () => {
    expect(same(['a', 'b', 'c', 'd'], ['a', 'b'])).toBe(true);
    expect(same(['a', 'b', 'c', 'd'], ['a', 'x', 'y', 'z'])).toBe(false);
    expect(same(['a'], ['b'])).toBe(false);
    expect(same([], [])).toBe(false);
  });
});