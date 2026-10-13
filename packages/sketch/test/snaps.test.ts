import { describe, expect, it } from 'vitest';
import type { Id } from '@3db/model';
import { angleStep, DEFAULT_SNAPS, extensionSnap, GRID_MIN_PX, gridPoint, intersectionSnap, lengthStep, parseSnapSettings, perpendicularSnap, quadrantSnap, quickSettings, SNAP_ITEMS, tangentSnap, visibleGridSpacing } from '../src/snaps';
import type { P2, SolvedGeometry } from '../src/types';

const line = (a: P2, b: P2): SolvedGeometry => ({ type: 'line', a, b, p1: 'x', p2: 'y', construction: false });
const circle = (c: P2, r: number): SolvedGeometry => ({ type: 'circle', c, r, center: 'cc', construction: false });
const arc = (c: P2, r: number, a0: number, a1: number): SolvedGeometry => ({ type: 'arc', c, r, a0, a1, center: 'ac', start: 's', end: 'e', construction: false });
const geometry = (entries: [Id, SolvedGeometry][]) => new Map<Id, SolvedGeometry>(entries);

describe('the crossing of two curves (交點)', () => {
  const g = geometry([
    ['h', line([0, 0], [20, 0])],
    ['v', line([10, -5], [10, 5])],
    ['c', circle([30, 0], 5)],
  ]);

  it('is found for two lines, with the two of them', () => {
    expect(intersectionSnap(g, [10.2, 0.2], 0.5)).toEqual({ p: [10, 0], a: 'h', b: 'v' });
  });

  it('is found for a line and a circle: the nearer of the two places', () => {
    const lc = geometry([['h', line([20, 0], [40, 0])], ['c', circle([30, 0], 5)]]);
    expect(intersectionSnap(lc, [35.1, 0.1], 0.5)).toMatchObject({ p: [35, 0] });
    expect(intersectionSnap(lc, [24.9, 0.1], 0.5)).toMatchObject({ p: [25, 0] });
  });

  it('is found for two circles', () => {
    const cc = geometry([['a', circle([0, 0], 5)], ['b', circle([6, 0], 5)]]);
    const q = intersectionSnap(cc, [3, 4.01], 0.5)!;
    expect(q.p[0]).toBeCloseTo(3, 9);
    expect(q.p[1]).toBeCloseTo(4, 9);
  });

  it('is not made where the lines would meet beyond their ends, nor far from the cursor', () => {
    const t = geometry([['h', line([0, 0], [8, 0])], ['v', line([10, -5], [10, 5])]]);
    expect(intersectionSnap(t, [10, 0.1], 0.5)).toBeNull(); // the horizontal stops at 8
    expect(intersectionSnap(g, [14, 3], 0.5)).toBeNull();
  });

  it('leaves out the curves it is told to (the one being drawn)', () => {
    expect(intersectionSnap(g, [10, 0], 0.5, new Set(['v']))).toBeNull();
  });

  it('takes the end of an arc only where the arc really is', () => {
    const a = geometry([['a', arc([0, 0], 5, 0, Math.PI / 2)], ['h', line([-10, -5], [10, -5])], ['v', line([0, -10], [0, 10])]]);
    expect(intersectionSnap(a, [0, 5.1], 0.5)).toMatchObject({ p: [0, 5] }); // the arc's top and the vertical line
    expect(intersectionSnap(a, [0, -5], 0.5)).toMatchObject({ p: [0, -5] }); // the two lines
    expect(intersectionSnap(a, [-5, 0.1], 0.5)).toBeNull(); // the circle's left is not in the arc
  });
});

describe('the quarter points of a circle or arc (四分之一點)', () => {
  it('are the four points of a circle, level or plumb with its center', () => {
    const g = geometry([['c', circle([10, 5], 4)]]);
    expect(quadrantSnap(g, [14.1, 5.1], 0.5)).toMatchObject({ p: [14, 5], curve: 'c', center: 'cc', axis: 'horizontal' });
    expect(quadrantSnap(g, [10.1, 9.1], 0.5)).toMatchObject({ p: [10, 9], axis: 'vertical' });
    expect(quadrantSnap(g, [6, 4.9], 0.5)).toMatchObject({ p: [6, 5], axis: 'horizontal' });
    expect(quadrantSnap(g, [10, 0.9], 0.5)).toMatchObject({ p: [10, 1], axis: 'vertical' });
  });

  it('are only those an arc has inside its sweep, not at its ends', () => {
    const g = geometry([['a', arc([0, 0], 5, 0.1, Math.PI + 0.1)]]); // from just past 0° to just past 180°
    expect(quadrantSnap(g, [0, 5], 0.5)).toMatchObject({ p: [0, 5], axis: 'vertical' });
    expect(quadrantSnap(g, [-5, 0], 0.5)).toMatchObject({ p: [-5, 0] }); // 180° is inside
    expect(quadrantSnap(g, [5, 0], 0.5)).toBeNull(); // 0° is before the start
    expect(quadrantSnap(g, [0, -5], 0.5)).toBeNull();
  });

  it('are nothing away from the cursor, nor of a curve that is left out', () => {
    const g = geometry([['c', circle([0, 0], 4)]]);
    expect(quadrantSnap(g, [2, 2], 0.5)).toBeNull();
    expect(quadrantSnap(g, [4, 0], 0.5, new Set(['c']))).toBeNull();
  });
});

describe('where a line from a point touches a circle (相切)', () => {
  it('are the two places the tangents from the point touch it', () => {
    const g = geometry([['c', circle([0, 0], 5)]]);
    // from (13, 0): the tangent points are at x = 25/13, y = ±5·12/13
    const x = 25 / 13;
    const y = (5 * 12) / 13;
    expect(tangentSnap(g, [13, 0], [x + 0.1, y - 0.1], 0.5)).toMatchObject({ curve: 'c' });
    const a = tangentSnap(g, [13, 0], [x, y], 0.5)!;
    expect(a.p[0]).toBeCloseTo(x, 9);
    expect(a.p[1]).toBeCloseTo(y, 9);
    const b = tangentSnap(g, [13, 0], [x, -y], 0.5)!;
    expect(b.p[1]).toBeCloseTo(-y, 9);
  });

  it('the line there is square to the radius: the dot product is zero', () => {
    const g = geometry([['c', circle([3, 4], 2)]]);
    const q = tangentSnap(g, [10, 4], [3.5, 5.9], 3)!;
    const radius = [q.p[0] - 3, q.p[1] - 4];
    const direction = [q.p[0] - 10, q.p[1] - 4];
    expect(Math.abs(radius[0]! * direction[0]! + radius[1]! * direction[1]!)).toBeLessThan(1e-9);
  });

  it('are not there from inside or on the circle, and not on an arc beyond its sweep', () => {
    const g = geometry([['c', circle([0, 0], 5)]]);
    expect(tangentSnap(g, [1, 1], [0, 5], 5)).toBeNull();
    expect(tangentSnap(g, [5, 0], [5, 0], 5)).toBeNull();
    const a = geometry([['a', arc([0, 0], 5, 0, 0.3)]]); // a short arc at the right
    const x = 25 / 13;
    expect(tangentSnap(a, [13, 0], [x, (5 * 12) / 13], 0.5)).toBeNull(); // that touch is at 67°
  });

  it('leaves out the curve the line starts on', () => {
    const g = geometry([['c', circle([0, 0], 5)]]);
    expect(tangentSnap(g, [13, 0], [25 / 13, 60 / 13], 0.5, new Set(['c']))).toBeNull();
  });
});

describe('the foot of the perpendicular from a point onto a line (垂直)', () => {
  const g = geometry([['l', line([0, 0], [20, 0])], ['m', line([0, 10], [20, 14])]]);

  it('is straight below the point for a horizontal line, and on the slanted one square to it', () => {
    expect(perpendicularSnap(g, [5, 8], [5.1, 0.1], 0.5, new Set(['m']))).toEqual({ p: [5, 0], line: 'l' });
    const f = perpendicularSnap(g, [5, 0], [2.9, 10.6], 0.5, new Set(['l']))!;
    expect(f.line).toBe('m');
    expect((f.p[0] - 5) * 20 + (f.p[1] - 0) * 4).toBeCloseTo(0, 9);
  });

  it('is not there when it would be past the end of the line, or when the line goes through the point', () => {
    expect(perpendicularSnap(g, [25, 8], [25, 0], 0.5, new Set(['m']))).toBeNull();
    expect(perpendicularSnap(g, [5, 0], [5, 0.1], 0.5, new Set(['m']))).toBeNull();
  });

  it('is not for a circle, and leaves out the lines it is told to', () => {
    const c = geometry([['c', circle([0, 0], 5)]]);
    expect(perpendicularSnap(c, [8, 0], [5, 0], 0.5)).toBeNull();
    expect(perpendicularSnap(g, [5, 8], [5, 0], 0.5, new Set(['l', 'm']))).toBeNull();
  });
});

describe('the grid, the angle and the length', () => {
  it('put a free point on the nearest grid point', () => {
    expect(gridPoint([12.4, -7.6], 5)).toEqual([10, -10]);
    expect(gridPoint([0.24, 0.26], 0.5)).toEqual([0, 0.5]);
  });

  it('turn a line onto the nearest multiple of the angle step when it is within three degrees', () => {
    const q = angleStep([0, 0], [10, 2.7], 15)!; // 15.1°
    expect(Math.atan2(q[1], q[0])).toBeCloseTo((15 * Math.PI) / 180, 12);
    expect(Math.hypot(...q)).toBeCloseTo(Math.hypot(10, 2.7), 12);
    expect(angleStep([0, 0], [10, 1.2], 15)).toEqual([10, 1.2]); // 6.8° is 6.8° from 0 and 8.2° from 15: left alone
  });

  it('round the length to a multiple of the spacing, in the direction it had', () => {
    const q = lengthStep([1, 1], [1 + 7.2, 1 + 0], 5);
    expect(q[0]).toBeCloseTo(1 + 5, 12);
    expect(q[1]).toBeCloseTo(1, 12);
    const d = lengthStep([0, 0], [3, 4], 2); // length 5 → 6
    expect(Math.hypot(...d)).toBeCloseTo(6, 12);
    expect(d[0] / d[1]).toBeCloseTo(0.75, 12);
  });

  it('never make a line shorter than one step', () => {
    expect(Math.hypot(...lengthStep([0, 0], [0.3, 0], 5))).toBeCloseTo(5, 12);
  });
});

describe('the settings', () => {
  it('start with everything on except the grid and the angle', () => {
    expect(DEFAULT_SNAPS.enabled).toBe(true);
    for (const k of SNAP_ITEMS) expect(DEFAULT_SNAPS[k], k).toBe(true);
    expect(DEFAULT_SNAPS.grid).toBe(false);
    expect(DEFAULT_SNAPS.angle).toBe(false);
  });

  it('keep what was stored where it can be trusted, and the default for the rest', () => {
    const s = parseSnapSettings({ enabled: false, tangent: false, gridSpacing: 2.5, angleStep: 'x', model: 'yes' });
    expect(s).toMatchObject({ enabled: false, tangent: false, gridSpacing: 2.5, angleStep: 15, model: true, point: true });
    expect(parseSnapSettings(null)).toEqual(DEFAULT_SNAPS);
    expect(parseSnapSettings({ gridSpacing: -3, angleStep: 500 })).toMatchObject({ gridSpacing: 0.1, angleStep: 90 });
  });

  it('leave one snap on for a quick snap, the others and the grid and angle off', () => {
    const q = quickSettings('quadrant');
    expect(q.enabled).toBe(true);
    expect(SNAP_ITEMS.filter((k) => q[k])).toEqual(['quadrant']);
    expect(q.grid).toBe(false);
    expect(q.angle).toBe(false);
  });
});

describe('the grid as drawn and snapped to (FreeCAD grid auto spacing)', () => {
  it('is the set spacing while its lines are far enough apart, then 2, 5, 10, 20 … times it, always a whole multiple', () => {
    expect(visibleGridSpacing(5, 0.05)).toBe(5); // 100 px apart
    expect(visibleGridSpacing(5, 5 / GRID_MIN_PX)).toBe(5); // exactly GRID_MIN_PX apart
    expect(visibleGridSpacing(5, 1)).toBe(10); // 5 px apart: twice is 10 px
    expect(visibleGridSpacing(5, 3)).toBe(25); // 10 is 3.3 px, 25 is 8.3 px
    expect(visibleGridSpacing(5, 10)).toBe(100);
    expect(visibleGridSpacing(0.5, 7)).toBe(100);
    for (const px of [0.001, 0.37, 2.2, 61, 4000]) {
      const s = visibleGridSpacing(5, px);
      expect(s / px).toBeGreaterThanOrEqual(GRID_MIN_PX);
      expect(Number.isInteger(Math.round((s / 5) * 1e9) / 1e9)).toBe(true);
    }
  });

  it('leaves a spacing it cannot step as it is: zero, negative, NaN, or no pixel size', () => {
    expect(visibleGridSpacing(0, 1)).toBe(0);
    expect(visibleGridSpacing(-5, 1)).toBe(-5);
    expect(visibleGridSpacing(5, 0)).toBe(5);
    expect(visibleGridSpacing(5, Infinity)).toBe(5);
    expect(visibleGridSpacing(5, NaN)).toBe(5);
  });
});

describe('the extension of a line (FreeCAD line extension)', () => {
  const g = geometry([['l', line([0, 0], [10, 0])], ['s', line([3, 3], [3, 3])]]);

  it('the foot past either end within the tolerance, with the end the guide starts from', () => {
    expect(extensionSnap(g, [15, 0.1], 0.25)).toEqual({ p: [15, 0], line: 'l', from: [10, 0] });
    expect(extensionSnap(g, [-4, -0.2], 0.25)).toEqual({ p: [-4, 0], line: 'l', from: [0, 0] });
  });

  it('nothing on the line, at an end, too far from it, on a line of no length, or on an excluded line', () => {
    expect(extensionSnap(g, [5, 0.1], 0.25)).toBeNull(); // on the line
    expect(extensionSnap(g, [10.2, 0.1], 0.25)).toBeNull(); // at its end (within the tolerance of it)
    expect(extensionSnap(g, [15, 0.3], 0.25)).toBeNull(); // too far from the extension
    expect(extensionSnap(geometry([['s', line([3, 3], [3, 3])]]), [3, 8], 0.25)).toBeNull();
    expect(extensionSnap(g, [15, 0.1], 0.25, new Set(['l']))).toBeNull();
  });
});