import { describe, expect, it } from 'vitest';
import { closerAlignment, currentValue, defaultType, hasAlignment, supportedTypes, type MateGeometry } from '../src';

const plane = (origin: [number, number, number], normal: [number, number, number]): MateGeometry => ({ kind: 'plane', origin, normal });
const cylinder = (radius: number, convex = true, origin: [number, number, number] = [0, 0, 0]): MateGeometry => ({ kind: 'cylinder', origin, axis: [0, 0, 1], radius, convex });
const line: MateGeometry = { kind: 'line', origin: [0, 0, 0], dir: [1, 0, 0] };
const point: MateGeometry = { kind: 'point', point: [3, 4, 12] };
const TOP = plane([0, 0, 0], [0, 0, 1]);
const UNDER = plane([0, 0, 7], [0, 0, -1]);

describe('what the mate PropertyManager offers (C15.8)', () => {
  it('offers the mates that can join the two elements', () => {
    expect(supportedTypes(TOP, UNDER)).toEqual(['coincident', 'parallel', 'perpendicular', 'lock', 'distance', 'angle']);
    expect(supportedTypes(cylinder(4, false), cylinder(5))).toEqual(['parallel', 'perpendicular', 'tangent', 'concentric', 'lock', 'distance', 'angle']);
    expect(supportedTypes(TOP, point)).toEqual(['coincident', 'lock', 'distance']);
    // Locking needs two components; the assembly's own planes cannot be locked to.
    expect(supportedTypes(TOP, UNDER, false)).not.toContain('lock');
  });

  it('suggests the mate SolidWorks picks first', () => {
    expect(defaultType(TOP, UNDER)).toBe('coincident');
    expect(defaultType(cylinder(4, false), cylinder(5))).toBe('concentric');
    expect(defaultType(TOP, cylinder(5))).toBe('tangent');
    expect(defaultType(cylinder(5), line)).toBe('concentric');
    expect(defaultType(point, TOP)).toBe('coincident');
  });

  it('takes the alignment the elements are closer to, where one means something', () => {
    expect(closerAlignment(TOP, UNDER)).toBe('antiAligned');
    expect(closerAlignment(TOP, plane([0, 0, 0], [0, 0.1, 1]))).toBe('aligned');
    expect(hasAlignment('coincident', TOP, UNDER)).toBe(true);
    expect(hasAlignment('concentric', cylinder(4), cylinder(5))).toBe(true);
    expect(hasAlignment('coincident', TOP, point)).toBe(false);
    expect(hasAlignment('perpendicular', TOP, UNDER)).toBe(false);
  });

  it('measures the distance or angle as it is now, on the side the solver means', () => {
    expect(currentValue('distance', TOP, UNDER)).toEqual({ value: 7, flip: false });
    // From UNDER, whose normal points down, TOP lies ahead of it: not flipped.
    expect(currentValue('distance', UNDER, TOP)).toEqual({ value: 7, flip: false });
    expect(currentValue('distance', TOP, plane([0, 0, -7], [0, 0, 1]))).toEqual({ value: 7, flip: true });
    expect(currentValue('distance', point, TOP)).toEqual({ value: 12, flip: false });
    expect(currentValue('distance', cylinder(4), cylinder(5, true, [3, 4, 9]))).toEqual({ value: 5, flip: false });
    expect(currentValue('angle', TOP, UNDER)!.value).toBeCloseTo(Math.PI, 12);
    expect(currentValue('angle', TOP, plane([0, 0, 0], [0, Math.SQRT1_2, Math.SQRT1_2]))!.value).toBeCloseTo(Math.PI / 4, 12);
    expect(currentValue('coincident', TOP, UNDER)).toBeNull();
    // Faces a solve made coincident lie a rounding error apart: no side to keep, so not flipped.
    expect(currentValue('distance', TOP, plane([0, 0, -3e-9], [0, 0, 1]))!.flip).toBe(false);
  });
});
