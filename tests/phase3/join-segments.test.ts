import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { joinSegments, sliceMeshByPlane } from '@3db/render';

// The viewer gathers the section outline and the silhouettes of every solid into one line geometry. It did that with `segs.push(...s)`,
// which passes every number as an argument: past about 120 000 numbers V8 throws a RangeError and the frame is lost.
describe('joinSegments (section outline and silhouettes of many segments)', () => {
  it('joins a slice too large for push(...s) — the size really breaks the spread', () => {
    // A strip of 30 000 columns (60 000 triangles) in the XY plane, cut across by Y = 0.1: every triangle gives one segment.
    const strip = new THREE.PlaneGeometry(300, 1, 30_000, 1);
    const s = sliceMeshByPlane(strip, new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1));
    expect(s.length).toBe(60_000 * 6);

    // Ground truth that this size is past the limit: the old way throws on it.
    expect(() => [].push(...(s as never[]))).toThrow(RangeError);

    const small = sliceMeshByPlane(new THREE.BoxGeometry(20, 20, 20), new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1));
    expect(small.length).toBeGreaterThan(0);
    const out = joinSegments([s, small]);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(s.length + small.length);
    // In order, each part where it was: the first and last number of each.
    expect(out[0]).toBeCloseTo(s[0]!, 4);
    expect(out[s.length - 1]).toBeCloseTo(s[s.length - 1]!, 4);
    expect(out[s.length]).toBeCloseTo(small[0]!, 4);
    expect(out[out.length - 1]).toBeCloseTo(small[small.length - 1]!, 4);
  });

  it('nothing, and parts that are empty, give an empty array', () => {
    expect(joinSegments([]).length).toBe(0);
    expect(joinSegments([[], []]).length).toBe(0);
  });
});
