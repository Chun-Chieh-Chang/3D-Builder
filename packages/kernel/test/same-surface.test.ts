/**
 * A face a boolean made only from the tool, lying on the surface of a body face it touches, is named after the body face (B3.1; B1 of 2026-10-14).
 * OCCT merges such pieces with the body's face most of the time but not always (it depends on the order it meets them in, which depends on memory),
 * and the names followed: 零件1's lugs lost their fillet on the first rebuild. Worked on a topology made by hand, so each case is exactly what it says.
 */
import { describe, expect, it } from 'vitest';
import { inheritBodySurface } from '../src/sameSurface';
import type { FaceOrigin, Topology } from '../src/types';

type Face = Topology['faces'][number];
const cyl = (radius: number, axis: [number, number, number] = [0, 1, 0], origin: [number, number, number] = [0, 0, 0]): Face => ({ surface: 'cylinder', area: 1, center: [0, 0, 0], normal: null, geometry: { type: 'cylinder', origin, axis, radius, convex: true } });
const plane = (normal: [number, number, number], origin: [number, number, number]): Face => ({ surface: 'plane', area: 1, center: origin, normal, geometry: { type: 'plane', origin, normal } });
/** Faces, and the pairs of them that share an edge. */
const topo = (faces: Face[], touching: [number, number][]): Topology => ({
  faces,
  edges: touching.map(([a, b]) => ({ curve: 'line', length: 1, mid: [0, 0, 0], dir: [0, 1, 0], faces: [a, b], vertices: [] })),
  vertices: [],
});
const body = (index: number): FaceOrigin => ({ rel: 'modified', kind: 'face', index });
/** The tool's faces come after the body's 10. */
const tool = (index: number): FaceOrigin => ({ rel: 'modified', kind: 'face', index: 10 + index });
const isBody = (o: FaceOrigin) => o.rel !== 'cap' && o.rel !== 'imported' && o.kind === 'face' && o.index < 10;

describe('a piece made by the tool on the surface of a body face it touches is named after it', () => {
  it('the case of 零件1: the cut\'s piece of the R 3.125 cylinder (its axis the other way) touches the revolve\'s; it gets the revolve\'s face too', () => {
    const t = topo([cyl(3.125), cyl(3.125, [0, -1, 0]), plane([1, 0, 0], [1.355, 0, 0])], [[0, 1], [1, 2]]);
    const out = inheritBodySurface([[body(6), tool(7)], [tool(3)], [tool(5)]], t, isBody);
    expect(out[1]).toEqual([tool(3), body(6)]);
    expect(out[0]).toEqual([body(6), tool(7)]); // a face with a body origin stays as it is
    expect(out[2]).toEqual([tool(5)]); // the plane is another surface
  });

  it('through other pieces of the tool on the same surface, as a merge would have taken them all', () => {
    const t = topo([cyl(3), cyl(3), cyl(3)], [[0, 1], [1, 2]]);
    expect(inheritBodySurface([[body(2)], [tool(1)], [tool(4)]], t, isBody)).toEqual([[body(2)], [tool(1), body(2)], [tool(4), body(2)]]);
  });

  it('not when the surfaces differ: another radius, an axis beside it, a plane parallel to it', () => {
    const t = topo([cyl(3), cyl(3.0001), cyl(3, [0, 1, 0], [0.001, 0, 0]), plane([0, 0, 1], [0, 0, 0]), plane([0, 0, 1], [0, 0, 0.5])], [[0, 1], [0, 2], [3, 4]]);
    const out = inheritBodySurface([[body(1)], [tool(1)], [tool(2)], [body(3)], [tool(3)]], t, isBody);
    expect(out).toEqual([[body(1)], [tool(1)], [tool(2)], [body(3)], [tool(3)]]);
  });

  it('not when it does not touch a body face on that surface: a pocket wall on the same cylinder elsewhere keeps the cut\'s name', () => {
    const t = topo([cyl(3), cyl(4), cyl(3)], [[0, 1], [1, 2]]);
    expect(inheritBodySurface([[body(1)], [body(2)], [tool(1)]], t, isBody)).toEqual([[body(1)], [body(2)], [tool(1)]]);
  });

  it('the same plane the other way round counts (a face of the tool facing the body\'s on one plane), and the body faces of all the pieces it touches, each once, in order', () => {
    const t = topo([plane([0, 0, 1], [0, 0, 2]), plane([0, 0, -1], [5, 5, 2]), plane([0, 0, 1], [9, 0, 2])], [[0, 1], [1, 2]]);
    expect(inheritBodySurface([[body(4)], [tool(0)], [body(1), body(4)]], t, isBody)[1]).toEqual([tool(0), body(1), body(4)]);
  });

  it('a seam (an edge between a face and itself) is not a neighbour', () => {
    const t = topo([cyl(3)], [[0, 0]]);
    expect(inheritBodySurface([[tool(1)]], t, isBody)).toEqual([[tool(1)]]);
  });
});
