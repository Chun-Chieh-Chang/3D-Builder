/**
 * D-I5 slice 1: a section line at any angle. The cut of a 40 × 30 × 12 block seen in its front view, through a slanted line in that view, is a rectangle
 * whose width is the length of the line inside the 40 × 30 face and whose height is the 12 of depth; its area is worked out by hand and compared to the
 * outline of the faces the kernel's section made (shoelace, not hatching). A line that misses the block cuts nothing, and that is said.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sectionLookAxes, sectionPlane, viewVectors, type SectionDrawingView } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { lineAcrossBox, sectionMissed } from '@3db/drawing';
import { build, extrude, front as frontPlane, rectangle, sketch } from '../phase1/builders';

const front = viewVectors('front');
const section = (line: SectionDrawingView['line']): SectionDrawingView => ({ id: 's', kind: 'section', name: 'A', parent: 'p', line, label: 'A' });

/**
 * The area inside the outlines of a section's cut. The kernel gives one polyline per edge (flat [x, y, x, y, …]), each in its edge's own direction: they are
 * chained end to end into closed loops (turned round where needed), and each loop's area is the shoelace's. A loop that does not close fails the test.
 */
const loopsArea = (pieces: number[][]): number => {
  const pts = (l: number[]) => Array.from({ length: l.length / 2 }, (_, i) => [l[2 * i]!, l[2 * i + 1]!] as [number, number]);
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
  const left = pieces.map(pts);
  let total = 0;
  while (left.length > 0) {
    const loop = left.shift()!;
    while (!near(loop[0]!, loop[loop.length - 1]!)) {
      const end = loop[loop.length - 1]!;
      const i = left.findIndex((p) => near(p[0]!, end) || near(p[p.length - 1]!, end));
      expect(i, 'the outline of the cut closes').toBeGreaterThanOrEqual(0);
      const next = left.splice(i, 1)[0]!;
      loop.push(...(near(next[0]!, end) ? next : [...next].reverse()).slice(1));
    }
    let a = 0;
    for (let i = 0; i + 1 < loop.length; i++) a += loop[i]![0] * loop[i + 1]![1] - loop[i + 1]![0] * loop[i]![1];
    total += Math.abs(a) / 2;
  }
  return total;
};

describe('a slanted cutting line across a view (lineAcrossBox)', () => {
  const box = { min: [0, 0] as const, max: [10, 5] as const };
  it('runs the line through the first point along the second across the box, grown by the pad', () => {
    expect(lineAcrossBox([0, 0], [1, 1], box, 0)).toEqual([[0, 0], [5, 5]]);
    expect(lineAcrossBox([2, 3], [3, 3], box, 0)).toEqual([[0, 3], [10, 3]]);
    expect(lineAcrossBox([2, 3], [2, 4], box, 1)).toEqual([[2, -1], [2, 6]]);
  });
  it('is null for the same point twice, a line outside the box, or numbers that are not', () => {
    expect(lineAcrossBox([2, 3], [2, 3], box, 0)).toBeNull();
    expect(lineAcrossBox([20, 20], [21, 20], box, 0)).toBeNull();
    expect(lineAcrossBox([2, NaN], [3, 3], box, 0)).toBeNull();
    expect(lineAcrossBox([2, 3], [3, 3], box, Infinity)).toBeNull();
  });
});

describe('the section of a block through a slanted line (D-I5)', () => {
  let kernel: Kernel;
  let regen: Regenerator;
  let block: ShapeId;
  beforeAll(async () => {
    kernel = await Kernel.load();
    regen = new Regenerator(kernel, await PlaneGcsSolver.create());
    block = regen.rebuild(build(sketch('s1', frontPlane, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '12' }))).body!.shape;
  });
  afterAll(() => regen.dispose());

  const cutArea = (line: SectionDrawingView['line']) => {
    const v = section(line);
    const r = kernel.sectionView(block, sectionPlane(front, v), sectionLookAxes(front, v).up);
    return { area: loopsArea(r.cut ?? []), lines: r };
  };

  it('along the diagonal: 50 × 12 = 600', () => {
    const { area, lines } = cutArea([[0, 0], [40, 30]]);
    expect(sectionMissed(lines)).toBe(false);
    expect(Math.abs(area - 600) / 600).toBeLessThan(1e-3);
  });

  it('at 30° from a corner: 40 / cos 30° × 12', () => {
    const t = Math.PI / 6;
    const expected = (40 / Math.cos(t)) * 12;
    const { area } = cutArea([[0, 0], [40, 40 * Math.tan(t)]]);
    expect(Math.abs(area - expected) / expected).toBeLessThan(1e-3);
  });

  it('100 random slanted lines through the face: the area is the length inside the 40 × 30 face times 12, every time', () => {
    // a fixed seed, so that a failure can be seen again
    let seed = 20261015;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 100; i++) {
      const at: [number, number] = [2 + rand() * 36, 2 + rand() * 26];
      // keep off the axes (those are the horizontal and vertical lines, already tested) by at least 2°
      const t = ((2 + rand() * 86) * Math.PI) / 180 + (rand() < 0.5 ? Math.PI / 2 : 0);
      const toward: [number, number] = [at[0] + Math.cos(t), at[1] + Math.sin(t)];
      const chord = lineAcrossBox(at, toward, { min: [0, 0], max: [40, 30] }, 0)!;
      const expected = Math.hypot(chord[1][0] - chord[0][0], chord[1][1] - chord[0][1]) * 12;
      const { area } = cutArea([at, toward]);
      expect(Math.abs(area - expected) / expected, `line ${i}: through ${at} at ${((t * 180) / Math.PI).toFixed(2)}°`).toBeLessThan(1e-3);
    }
  });

  it('a slanted line that misses the block cuts nothing, and that is said', () => {
    const { area, lines } = cutArea([[100, 0], [110, 10]]);
    expect(area).toBe(0);
    expect(sectionMissed(lines)).toBe(true);
    // lines that are not a section's are not a missed section
    expect(sectionMissed({})).toBe(false);
  });
});
