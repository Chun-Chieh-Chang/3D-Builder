/**
 * D-I5 (ADR 0143): stepped and aligned sections. What a stepped or aligned line is allowed to be, the region the kernel takes away, the turn of an aligned
 * section, and the cut of a 40 × 30 × 12 block with two Ø6 holes through it (at (10, 10) and (30, 20) in its front view), compared with the area worked out by
 * hand: the length of each cut inside the block, less the holes it crosses, times the 12 of depth. A stepped line through both holes' middles cuts 2 × 14 × 12
 * = 336 where a straight one at y = 10 cuts 34 × 12 = 408, so the area says which was done. The area of the outlines is found by an exact even-odd scan, not by
 * hatching. Random stepped and aligned lines (100 each) are checked the same way.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, sectionCut, sectionLookAxes, viewVectors, type DrawingView, type SectionDrawingView, page } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, planSectionPath, rightOfPolyline, turnRows, type ShapeId, type Vec3 } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { alignedTo, buildScene, finishSectionLine, firstCutTo, sectionMissed, stepTo, type ViewLines } from '@3db/drawing';
import { build, circle, extrude, front as frontPlane, rectangle, sketch } from '../phase1/builders';

type P = [number, number];
const front = viewVectors('front');
const HOLES: { c: P; r: number }[] = [
  { c: [10, 10], r: 3 },
  { c: [30, 20], r: 3 },
];
const section = (line: P[], extra: Partial<SectionDrawingView> = {}): SectionDrawingView => ({ id: 's', kind: 'section', name: 'A', parent: 'p', line: line as SectionDrawingView['line'], label: 'A', ...extra });

/** Whether a point is inside a closed polygon (even-odd). */
const inside = (poly: P[], p: P): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/**
 * The area inside polylines (flat [x, y, …] lists, in any order and direction, together making closed outlines), even-odd: the length inside along a level
 * line is piecewise linear in its height between the heights of the points, so taking it at the middle of each band is exact.
 */
const evenOddArea = (pieces: number[][]): number => {
  const segs: [number, number, number, number][] = [];
  for (const l of pieces) for (let i = 0; i + 3 < l.length; i += 2) segs.push([l[i]!, l[i + 1]!, l[i + 2]!, l[i + 3]!]);
  const ys = [...new Set(segs.flatMap((s) => [s[1], s[3]]))].sort((a, b) => a - b);
  let area = 0;
  for (let k = 0; k + 1 < ys.length; k++) {
    const y = (ys[k]! + ys[k + 1]!) / 2;
    const xs = segs.flatMap(([x0, y0, x1, y1]) => ((y0 > y) !== (y1 > y) ? [x0 + ((y - y0) * (x1 - x0)) / (y1 - y0)] : [])).sort((a, b) => a - b);
    let len = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) len += xs[i + 1]! - xs[i]!;
    area += len * (ys[k + 1]! - ys[k]!);
  }
  return area;
};

/** The length of a segment (or ray, when `ray`) inside the 40 × 30 face, less what lies in the holes. */
function solidLength(a: P, b: P, opts: { backward?: boolean; forward?: boolean } = {}): number {
  const d: P = [b[0] - a[0], b[1] - a[1]];
  let lo = opts.backward ? -1e6 : 0;
  let hi = opts.forward ? 1e6 : 1;
  for (const [k, min, max] of [[0, 0, 40], [1, 0, 30]] as const) {
    if (Math.abs(d[k]) < 1e-15) {
      if (a[k] < min || a[k] > max) return 0;
      continue;
    }
    const t1 = (min - a[k]) / d[k];
    const t2 = (max - a[k]) / d[k];
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
  }
  if (hi <= lo) return 0;
  const L = Math.hypot(d[0], d[1]);
  let len = (hi - lo) * L;
  for (const h of HOLES) {
    // |a + t d − c|² = r²
    const fx = a[0] - h.c[0];
    const fy = a[1] - h.c[1];
    const A = d[0] * d[0] + d[1] * d[1];
    const B = 2 * (fx * d[0] + fy * d[1]);
    const C = fx * fx + fy * fy - h.r * h.r;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) continue;
    const s1 = (-B - Math.sqrt(disc)) / (2 * A);
    const s2 = (-B + Math.sqrt(disc)) / (2 * A);
    len -= Math.max(0, Math.min(hi, s2) - Math.max(lo, s1)) * L;
  }
  return len;
}

describe('what a stepped or aligned line may be (D-I5)', () => {
  const base = () => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: 'f', source: 'a.3dbx', direction: 'front' }] });
  const insert = (line: P[], extra: Partial<SectionDrawingView> = {}) =>
    applyDrawingCommand(base(), { type: 'insertViews', views: [{ id: 'view2', name: 'A', kind: 'section', parent: 'view1', line: line as SectionDrawingView['line'], label: 'A', ...extra } as DrawingView] });
  it('a stepped line: cuts along the first segment, jogs square to it, a cut first and last', () => {
    expect(page(insert([[0, 10], [20, 10], [20, 20], [40, 20]])).views).toHaveLength(2);
    expect(page(insert([[0, 10], [20, 10], [20, 0], [30, 0], [30, 25], [40, 25]])).views).toHaveLength(2);
    // ends with a jog
    expect(() => insert([[0, 10], [20, 10], [20, 20]])).toThrow(/奇數/);
    // a jog not square, a cut going back, a cut not parallel
    expect(() => insert([[0, 10], [20, 10], [21, 20], [40, 20]])).toThrow(/第 2 段/);
    expect(() => insert([[0, 10], [20, 10], [20, 20], [5, 20]])).toThrow(/第 3 段/);
    expect(() => insert([[0, 10], [20, 10], [20, 20], [40, 21]])).toThrow(/第 3 段/);
    // two points in a row the same; a number that is not
    expect(() => insert([[0, 10], [20, 10], [20, 10], [40, 10]])).toThrow(/重合/);
    expect(() => insert([[0, 10], [20, NaN], [20, 20], [40, 20]])).toThrow(/數字/);
  });
  it('an aligned line: three points that bend', () => {
    expect(page(insert([[0, 10], [20, 10], [40, 30]], { aligned: true })).views[1]).toMatchObject({ aligned: true });
    expect(() => insert([[0, 10], [20, 10]], { aligned: true })).toThrow(/三個點/);
    expect(() => insert([[0, 10], [20, 10], [40, 30], [50, 30]], { aligned: true })).toThrow(/三個點/);
    expect(() => insert([[0, 10], [20, 10], [40, 10.0001]], { aligned: true })).toThrow(/同一直線/);
    expect(() => insert([[0, 10], [20, 10], [0, 10.0001]], { aligned: true })).toThrow(/同一直線/);
  });
  it('setView takes `aligned` on and off for a section only, checking the line again', () => {
    // a straight line may be made aligned only with a third point; the aligned line, not aligned, is no stepped line (two segments): refused
    const straight = insert([[0, 10], [40, 10]]);
    expect(() => applyDrawingCommand(straight, { type: 'setView', viewId: 'view2', patch: { aligned: true } })).toThrow(/三個點/);
    const d = insert([[0, 10], [20, 10], [40, 30]], { aligned: true });
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'view2', patch: { aligned: null } })).toThrow(/奇數/);
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'view1', patch: { aligned: true } })).toThrow(/不屬於/);
    // taking it off with a line that is a stepped one: kept off
    const stepped = applyDrawingCommand(d, { type: 'setView', viewId: 'view2', patch: { aligned: null, line: [[0, 10], [20, 10], [20, 20], [40, 20]] } });
    expect(page(stepped).views[1]).not.toHaveProperty('aligned');
    expect(page(applyDrawingCommand(stepped, { type: 'setView', viewId: 'view2', patch: { aligned: false } })).views[1]).not.toHaveProperty('aligned');
  });
  it('on the parent the whole line is drawn, an arrow at each end square to its own segment (an aligned line\'s two differ)', () => {
    const lines = (w: number, h: number): ViewLines => ({ visible: [[0, 0, w, 0, w, h, 0, h, 0, 0]], hidden: [], box: { min: [0, 0], max: [w, h] } });
    const cut = [[0, 0, 40, 0, 40, 12, 0, 12, 0, 0]];
    const d = insert([[-5, 10], [20, 10], [45, 35]], { aligned: true });
    const { scene } = buildScene(d, new Map([['view1', lines(40, 30)], ['view2', { ...lines(48, 12), cut }]]));
    const centre = scene.items.filter((i) => i.kind === 'polyline' && i.style === 'center');
    expect(centre).toHaveLength(1);
    const pts = (centre[0] as { points: number[] }).points;
    expect(pts).toHaveLength(6); // three points
    // the two arrow shafts: 8 mm from each end, square to their own segment (down at the first, down-right at the last)
    const shafts = scene.items.filter((i) => i.kind === 'polyline' && i.style === 'visible' && (i as { points: number[] }).points.length === 4).map((i) => (i as { points: number[] }).points);
    const ways = shafts.slice(0, 2).map((s) => [(s[2]! - s[0]!) / 8, (s[3]! - s[1]!) / 8]);
    ways[0]!.forEach((v, i) => expect(v).toBeCloseTo([0, -1][i]!, 9));
    ways[1]!.forEach((v, i) => expect(v).toBeCloseTo([Math.SQRT1_2, -Math.SQRT1_2][i]!, 9));
  });
  it('the cut asked of the kernel: the first segment\'s plane, and the whole line in the model\'s axes when it has more than two points', () => {
    expect(sectionCut(front, section([[0, 10], [40, 10]]))).not.toHaveProperty('path');
    const c = sectionCut(front, section([[0, 10], [20, 10], [20, 20], [40, 20]]));
    expect(c.path).toEqual([[0, 10, 0], [20, 10, 0], [20, 20, 0], [40, 20, 0]]);
    expect(c.normal.map((x) => x + 0)).toEqual([0, 1, 0]); // the arrows point down (−y): the side taken away is +y
    expect(sectionCut(front, section([[0, 10], [20, 10], [40, 30]], { aligned: true }))).toMatchObject({ aligned: true });
  });
});

describe('a stepped or aligned line clicked out on a view (sectionLine)', () => {
  const box = { min: [0, 0] as const, max: [40, 30] as const };
  it('the first cut snaps to the sheet\'s axes within 3°, and not past it', () => {
    expect(firstCutTo([5, 10], [20, 10.5])).toEqual([20, 10]); // 1.9°
    expect(firstCutTo([5, 10], [5.5, 25])).toEqual([5, 25]);
    expect(firstCutTo([5, 10], [20, 11])).toEqual([20, 11]); // 3.8°: slanted
    expect(firstCutTo([5, 10], [5, 10])).toBeNull();
  });
  it('each further click adds a jog square to the first cut and a cut along it; a click not on past the end, or not off the line, adds nothing', () => {
    expect(stepTo([[0, 10], [20, 10]], [30, 20])).toEqual([[0, 10], [20, 10], [20, 20], [30, 20]]);
    expect(stepTo([[0, 10], [20, 10]], [10, 20])).toBeNull(); // back along the cut
    expect(stepTo([[0, 10], [20, 10]], [30, 10])).toBeNull(); // no jog
    // slanted: the jog is square to the cut and the cut parallel, exactly enough for the document's check
    const s = Math.SQRT1_2;
    const pts = stepTo([[0, 0], [10 * s, 10 * s]], [20, 0])!;
    const t = [s, s];
    const jog = [pts[2]![0] - pts[1]![0], pts[2]![1] - pts[1]![1]];
    const cut = [pts[3]![0] - pts[2]![0], pts[3]![1] - pts[2]![1]];
    expect(Math.abs(jog[0]! * t[0]! + jog[1]! * t[1]!) / Math.hypot(jog[0]!, jog[1]!)).toBeLessThan(1e-12);
    expect((cut[0]! * t[0]! + cut[1]! * t[1]!) / Math.hypot(cut[0]!, cut[1]!)).toBeGreaterThan(1 - 1e-12);
  });
  it('an aligned line takes a third point that bends', () => {
    expect(alignedTo([[0, 10], [20, 10]], [40, 30])).toEqual([[0, 10], [20, 10], [40, 30]]);
    expect(alignedTo([[0, 10], [20, 10]], [40, 10.1])).toBeNull();
    expect(alignedTo([[0, 10], [20, 10]], [20, 10])).toBeNull();
  });
  it('finished, the line is carried back and on across the view grown by the pad, put on the 0.01 grid when along the axes', () => {
    expect(finishSectionLine([[10, 10.004], [20, 10.004], [20, 20], [30, 20]], box, 5)).toEqual([[-5, 10], [20, 10], [20, 20], [45, 20]]);
    // an end already outside is left where it is
    expect(finishSectionLine([[-20, 10], [20, 10]], box, 5)).toEqual([[-20, 10], [45, 10]]);
    // aligned: each end along its own segment
    const a = finishSectionLine([[10, 10], [20, 10], [25, 15]], box, 5);
    expect(a[0]).toEqual([-5, 10]);
    // from (20, 10) at 45° the grown box (x ≤ 45, y ≤ 35) is left at its corner
    expect(a[2]![0]).toBeCloseTo(45, 9);
    expect(a[2]![1]).toBeCloseTo(35, 9);
  });
});

describe('the region taken away and the turn (sectionPath)', () => {
  it('the region is on the right of the way the line goes, for a straight line, a step, a turn to the right and to the left', () => {
    const straight = rightOfPolyline([[0, 0], [10, 0]], 100);
    expect(inside(straight, [5, -1])).toBe(true);
    expect(inside(straight, [5, 1])).toBe(false);
    const step = rightOfPolyline([[0, 0], [10, 0], [10, 5], [20, 5]], 100);
    expect(inside(step, [5, 2])).toBe(false);
    expect(inside(step, [15, 2])).toBe(true);
    expect(inside(step, [5, -1])).toBe(true);
    // a turn to the right (along x, then down): the corner inside the turn is the right side
    const right = rightOfPolyline([[-10, 0], [0, 0], [0, -10]], 100);
    expect(inside(right, [-5, -5])).toBe(true);
    expect(inside(right, [5, 5])).toBe(false);
    expect(inside(right, [5, -5])).toBe(false);
    // a turn to the left: three quarters are on the right
    const left = rightOfPolyline([[-10, 0], [0, 0], [0, 10]], 100);
    expect(inside(left, [-5, 5])).toBe(false);
    expect(inside(left, [5, 5])).toBe(true);
    expect(inside(left, [5, -5])).toBe(true);
    expect(inside(left, [-5, -5])).toBe(true);
  });
  it('a turn: about the line through the point, right-handed', () => {
    const rows = turnRows([1, 1, 0], [0, 0, 1], Math.PI / 2);
    const at = (p: Vec3): Vec3 => [0, 1, 2].map((i) => rows[4 * i]! * p[0] + rows[4 * i + 1]! * p[1] + rows[4 * i + 2]! * p[2] + rows[4 * i + 3]!) as Vec3;
    at([2, 1, 0]).forEach((v, i) => expect(v).toBeCloseTo([1, 2, 0][i]!, 12));
    at([1, 1, 5]).forEach((v, i) => expect(v).toBeCloseTo([1, 1, 5][i]!, 12));
  });
  it('an aligned plan turns the second segment\'s way into the first\'s, and splits what is behind it at the bisector of what is kept', () => {
    const plan = planSectionPath([[0, 10, 0], [20, 10, 0], [40, 30, 0]], [0, 1, 0], true, 1000);
    const rows = plan.turn!.rows;
    const at = (p: Vec3): Vec3 => [0, 1, 2].map((i) => rows[4 * i]! * p[0] + rows[4 * i + 1]! * p[1] + rows[4 * i + 2]! * p[2] + rows[4 * i + 3]!) as Vec3;
    // (40, 30) is 20√2 from the bend along 45°: it goes to 20√2 along +x
    at([40, 30, 0]).forEach((v, i) => expect(v).toBeCloseTo([20 + 20 * Math.SQRT2, 10, 0][i]!, 9));
    // the split: its normal points to the second segment, and the kept side straight down from the bend is on the first segment's side or on the plane
    const s = plan.turn!.split;
    expect(s.normal[0] * 1 + s.normal[1] * 1).toBeGreaterThan(0);
    expect(plan.cuts).toHaveLength(1);
  });
});

describe('the section of a block with two holes, stepped and aligned (D-I5)', () => {
  let kernel: Kernel;
  let regen: Regenerator;
  let block: ShapeId;
  let plain: ShapeId;
  let other: Regenerator;
  beforeAll(async () => {
    kernel = await Kernel.load();
    other = new Regenerator(kernel, await PlaneGcsSolver.create());
    plain = other.rebuild(build(sketch('s1', frontPlane, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '12' }))).body!.shape;
    regen = new Regenerator(kernel, await PlaneGcsSolver.create());
    const r = regen.rebuild(
      build(
        sketch('s1', frontPlane, rectangle('a', 0, 0, 40, 30)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '12' }),
        sketch('s2', frontPlane, circle('h1', 10, 10, 3), circle('h2', 30, 20, 3)),
        extrude('e2', 's2', 'cut', { type: 'throughAll', reverse: true }),
      ),
    );
    block = r.body!.shape;
    // the block is as drawn: 40 × 30 × 12 less two Ø6 through holes
    expect(kernel.massProps(block).volume).toBeCloseTo(40 * 30 * 12 - 2 * Math.PI * 9 * 12, 3);
  });
  afterAll(() => {
    regen.dispose();
    other.dispose();
  });

  const cut = (v: SectionDrawingView) => kernel.sectionViewPath(block, { ...sectionCut(front, v), path: sectionCut(front, v).path! }, sectionLookAxes(front, v).up);
  const close = (area: number, want: number, what = '') => expect(Math.abs(area - want) / want, `${what} ${area} vs ${want}`).toBeLessThan(1e-3);

  it('stepped through both holes\' middles: 2 × 14 × 12 = 336 (a straight line at y = 10 would cut 408)', () => {
    const r = cut(section([[-5, 10], [20, 10], [20, 20], [45, 20]]));
    close(evenOddArea(r.cut!), 336);
    expect(sectionMissed(r)).toBe(false);
    // looking down (along −y), the view's x is the model's x: the jog at x = 20 is not drawn as a line, though the cut either side of it meets there
    const onJog = (l: number[]) => l.length >= 4 && Array.from({ length: l.length / 2 }, (_, i) => l[2 * i]!).every((x) => Math.abs(x - 20) < 1e-6);
    expect(r.cut!.some(onJog)).toBe(true);
    expect(r.visible.some(onJog)).toBe(false);
  });

  it('aligned through both holes: 14 along the first segment and 20√2 − 6 along the second, turned into one plane, times 12', () => {
    const r = cut(section([[-5, 10], [20, 10], [40, 30]], { aligned: true }));
    close(evenOddArea(r.cut!), (14 + 20 * Math.SQRT2 - 6) * 12);
    // the second cut, turned, lies past the bend along the first: the cut reaches x = 20 + 20√2
    const xs = r.cut!.flatMap((l) => Array.from({ length: l.length / 2 }, (_, i) => l[2 * i]!));
    expect(Math.max(...xs)).toBeCloseTo(20 + 20 * Math.SQRT2, 3);
  });

  it('a stepped line that misses the block cuts nothing, and says so', () => {
    const r = cut(section([[100, 100], [120, 100], [120, 110], [140, 110]]));
    expect(sectionMissed(r)).toBe(true);
  });

  // a fixed seed, so that a failure can be seen again
  let seed = 20261015;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

  it('100 random stepped lines: the area is the sum over the cuts of their length in the block less the holes, times 12', () => {
    let missed = 0;
    for (let i = 0; i < 100; i++) {
      const a = rand() * 2 * Math.PI;
      const t: P = [Math.cos(a), Math.sin(a)];
      const n: P = [-t[1], t[0]];
      const cuts = 2 + Math.floor(rand() * 2);
      const pts: P[] = [[4 + rand() * 32, 4 + rand() * 22]];
      for (let k = 0; k < cuts; k++) {
        const last = pts.at(-1)!;
        const len = 4 + rand() * 12;
        pts.push([last[0] + t[0] * len, last[1] + t[1] * len]);
        if (k < cuts - 1) {
          const jog = (rand() < 0.5 ? -1 : 1) * (3 + rand() * 9);
          const p = pts.at(-1)!;
          pts.push([p[0] + n[0] * jog, p[1] + n[1] * jog]);
        }
      }
      // the first cut reaches back without end, the last forward
      let want = 0;
      for (let s = 0; s + 1 < pts.length; s += 2) want += solidLength(pts[s]!, pts[s + 1]!, { backward: s === 0, forward: s + 2 === pts.length - 1 + 1 }) * 12;
      const r = cut(section(pts));
      const area = evenOddArea(r.cut!);
      if (want < 1e-6) {
        missed++;
        expect(sectionMissed(r), `line ${i}`).toBe(true);
        continue;
      }
      close(area, want, `stepped ${i}: ${JSON.stringify(pts.map((p) => p.map((x) => +x.toFixed(3))))}`);
    }
    expect(missed).toBeLessThan(50);
  });

  it('every shape a stepped or aligned section makes is released (shape handles only: this is not a claim about the heap, see below)', () => {
    // The Emscripten heap is NOT flat over repeated sections, and that is OCCT's (measured 2026-10-15, AGENTS.md §3.5, each case alone in a fresh heap, 1000
    // calls): a bare BRepAlgoAPI_Cut by a half-space box ~0.14 MiB a call; the existing straight `sectionView` ~0.25; a stepped one ~0.42 (one cut by a larger
    // tool); an aligned one ~1.0 (three booleans). `topology` and `projectView` alone: 0. The worker's high-water restart (ADR 0126) is what bounds it.
    const live = kernel.liveShapes;
    for (let k = 0; k < 20; k++) {
      const y = 5 + k;
      for (const v of [section([[-5, y], [20, y], [20, y + 5], [45, y + 5]]), section([[-5, y], [20, y], [40, y + 15]], { aligned: true }), section([[100, 100], [120, 100], [120, 110], [140, 110]])]) {
        kernel.sectionViewPath(plain, { ...sectionCut(front, v), path: sectionCut(front, v).path! }, sectionLookAxes(front, v).up);
      }
    }
    expect(live).toBeGreaterThan(0);
    expect(kernel.liveShapes).toBe(live);
  });

  it('100 random aligned lines: the area is the first cut back from the bend and the second on from it, in the block less the holes, times 12', () => {
    for (let i = 0; i < 100; i++) {
      const bend: P = [4 + rand() * 32, 4 + rand() * 22];
      const a = rand() * 2 * Math.PI;
      // the second segment turns 10° to 170° either way
      const turn = (rand() < 0.5 ? -1 : 1) * ((10 + rand() * 160) * Math.PI) / 180;
      const p0: P = [bend[0] - 5 * Math.cos(a), bend[1] - 5 * Math.sin(a)];
      const p2: P = [bend[0] + 5 * Math.cos(a + turn), bend[1] + 5 * Math.sin(a + turn)];
      const want = (solidLength(p0, bend, { backward: true }) + solidLength(bend, p2, { forward: true })) * 12;
      const r = cut(section([p0, bend, p2], { aligned: true }));
      close(evenOddArea(r.cut!), want, `aligned ${i}: ${JSON.stringify([p0, bend, p2].map((p) => p.map((x) => +x.toFixed(3))))}`);
    }
  });
});
