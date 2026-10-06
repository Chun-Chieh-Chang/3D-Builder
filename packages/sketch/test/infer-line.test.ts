import { describe, expect, it } from 'vitest';
import type { Id } from '@3db/model';
import { cross, dist, dot, inferLine, sub, unit } from '../src/interact';
import type { SolvedGeometry } from '../src/types';

const line = (a: [number, number], b: [number, number]): SolvedGeometry => ({ type: 'line', a, b, p1: 'x', p2: 'y', construction: false });
/** One slanted line l1 from (0, 0) to (10, 5): direction (2, 1)/√5. */
const one = () => new Map<Id, SolvedGeometry>([['l1', line([0, 0], [10, 5])]]);
const DEG = Math.PI / 180;
const infer = (g: Map<Id, SolvedGeometry>, a: [number, number], b: [number, number], distTol = 0.25, exclude: ReadonlySet<Id> = new Set()) => inferLine(g, a, b, exclude, 3 * DEG, distTol, 0.5);
const ang = (p: [number, number], q: [number, number]) => Math.abs(cross(unit(sub(q, p)), unit([2, 1])));

describe('collinear, parallel and perpendicular inference (D5.3a)', () => {
  it('makes a line leaving at nearly the same slope parallel, exactly', () => {
    const r = infer(one(), [0, 20], [20, 30.3])!;
    expect(r).toMatchObject({ kind: 'parallel', line: 'l1' });
    expect(ang([0, 20], r.b)).toBeCloseTo(0, 12);
  });

  it('makes a line leaving a quarter turn away perpendicular, exactly', () => {
    const r = infer(one(), [30, 0], [28, 4.1])!;
    expect(r).toMatchObject({ kind: 'perpendicular', line: 'l1' });
    expect(Math.abs(dot(unit(sub(r.b, [30, 0])), [2 / Math.sqrt(5), 1 / Math.sqrt(5)]))).toBeLessThan(1e-12);
  });

  it('calls it collinear when the start is on the line (here at its end), and moves the end onto that line', () => {
    const r = infer(one(), [10, 5], [30, 15.3])!;
    expect(r).toMatchObject({ kind: 'collinear', line: 'l1' });
    expect(Math.abs(r.b[1] - 5 - (r.b[0] - 10) / 2)).toBeLessThan(1e-12);
  });

  it('is collinear on the extension at the other end too, and for a line drawn back along it', () => {
    expect(infer(one(), [0, 0], [-20, -10.2])).toMatchObject({ kind: 'collinear' });
    expect(infer(one(), [10, 5], [-10, -5.3])).toMatchObject({ kind: 'collinear' });
  });

  it('is only parallel when the start is off the line by more than the tolerance', () => {
    expect(infer(one(), [10, 5.5], [30, 15.8], 0.2)).toMatchObject({ kind: 'parallel' });
    expect(infer(one(), [10, 5.5], [30, 15.8], 1)).toMatchObject({ kind: 'collinear' });
  });

  it('infers nothing outside the angle, for a line too short, or for a line it is told to leave out', () => {
    expect(infer(one(), [0, 20], [20, 33])).toBeNull(); // about 7° off
    expect(infer(one(), [0, 20], [0.2, 20.1])).toBeNull(); // 0.22 long
    expect(infer(one(), [0, 20], [20, 30.3], 0.25, new Set(['l1']))).toBeNull();
  });

  it('takes the line whose direction is closest', () => {
    const g = new Map<Id, SolvedGeometry>([
      ['l1', line([0, 0], [10, 5])], // slope 0.5
      ['l2', line([0, 40], [10, 45.4])], // slope 0.54
    ]);
    expect(infer(g, [0, 20], [20, 30.7])).toMatchObject({ line: 'l2' }); // slope 0.535
    expect(infer(g, [0, 20], [20, 30.1])).toMatchObject({ line: 'l1' }); // slope 0.505
  });

  it('prefers collinear to parallel when two lines have the same direction', () => {
    const g = new Map<Id, SolvedGeometry>([
      ['far', line([0, 30], [10, 35])],
      ['near', line([0, 0], [10, 5])],
    ]);
    expect(infer(g, [10, 5], [30, 15])).toMatchObject({ kind: 'collinear', line: 'near' });
  });

  it('keeps the length that was drawn along the direction', () => {
    const r = infer(one(), [0, 20], [20, 30.3])!;
    expect(dist([0, 20], r.b)).toBeCloseTo(dot(sub([20, 30.3], [0, 20]), unit([2, 1])), 12);
  });

  it('skips lines without a length', () => {
    const g = new Map<Id, SolvedGeometry>([['dot', line([3, 3], [3, 3])]]);
    expect(infer(g, [0, 0], [10, 0.1])).toBeNull();
  });

  it('does not look at circles and points', () => {
    const g = new Map<Id, SolvedGeometry>([
      ['c', { type: 'circle', c: [0, 0], r: 5, center: 'p', construction: false }],
      ['p', { type: 'point', p: [1, 1] }],
    ]);
    expect(infer(g, [0, 20], [20, 30.3])).toBeNull();
  });

  it('works with a construction line as the reference', () => {
    const g = new Map<Id, SolvedGeometry>([['k', { ...line([0, 0], [10, 5]), construction: true } as SolvedGeometry]]);
    expect(infer(g, [0, 20], [20, 30.3])).toMatchObject({ kind: 'parallel', line: 'k' });
  });
});
