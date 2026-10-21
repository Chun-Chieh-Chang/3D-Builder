/**
 * ADR 0180: how the result of 「干涉檢查」 is looked at. The overlaps put together by pair (the volume-weighted centre, the box round them), the list as shown
 * with pairs set aside, ↑／↓ through it, what the list says of where a pair is, and the view taken to a box (fitBoxView) and back (「上一個視角」).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MeshData } from '@3db/kernel';
import type { Vec3 } from '@3db/model';
import { FIT_BOX_FRACTION, fitBoxView, restoreView, viewState } from '@3db/render';
import { groupOverlaps, pairKey, pairPlace, shownPairs, stepPair, type InterferencePair, type OverlapFound } from '../../apps/web/src/state/interferenceView';

const mesh = {} as MeshData;
const overlap = (a: string, b: string, volume: number, center: Vec3, min: Vec3, max: Vec3): OverlapFound => ({ a, b, volume, center, min, max, mesh });
const names = new Map([['a', 'A<1>'], ['b', 'B<1>'], ['c', 'C<1>']]);
const tops = new Map([['a', 'a'], ['b', 'b'], ['c', 'c']]);

describe('the overlaps put together by pair', () => {
  it('two overlaps of one pair: the volumes add up, the centre is weighted by volume, the box is round both', () => {
    const pairs = groupOverlaps(
      [overlap('a', 'b', 1, [0, 0, 0], [-1, -1, -1], [1, 1, 1]), overlap('a', 'b', 3, [4, 0, 8], [3, -2, 7], [5, 2, 9]), overlap('a', 'c', 10, [50, 50, 50], [49, 49, 49], [51, 51, 51])],
      names,
      tops,
    );
    expect(pairs.map(pairKey)).toEqual(['a|c', 'a|b']); // the biggest first
    const ab = pairs[1]!;
    expect(ab.volume).toBe(4);
    expect(ab.center).toEqual([3, 0, 6]); // (1·0 + 3·4) / 4, 0, (1·0 + 3·8) / 4
    expect(ab.min).toEqual([-1, -2, -1]);
    expect(ab.max).toEqual([5, 2, 9]);
    expect(ab.overlaps).toHaveLength(2);
    expect([ab.aName, ab.bName, ab.aTop, ab.bTop]).toEqual(['A<1>', 'B<1>', 'a', 'b']);
  });

  it('a component not named is called by its id; the overlaps given are not changed', () => {
    const given = overlap('x', 'y', 2, [1, 2, 3], [0, 0, 0], [2, 4, 6]);
    const [p] = groupOverlaps([given], names, tops);
    expect([p!.aName, p!.bName, p!.aTop]).toEqual(['x', 'y', 'x']);
    expect(given.min).toEqual([0, 0, 0]); // the pair's box is its own copy
    expect(groupOverlaps([], names, tops)).toEqual([]);
  });
});

const pairs = groupOverlaps(
  [overlap('a', 'b', 3, [0, 0, 0], [0, 0, 0], [1, 1, 1]), overlap('a', 'c', 2, [0, 0, 0], [0, 0, 0], [1, 1, 1]), overlap('b', 'c', 1, [0, 0, 0], [0, 0, 0], [1, 1, 1])],
  names,
  tops,
) as InterferencePair[];

describe('the list as shown, and ↑／↓ through it', () => {
  it('a pair set aside is left out unless the ones set aside are shown', () => {
    expect(shownPairs(pairs, [], false)).toEqual([0, 1, 2]);
    expect(shownPairs(pairs, ['a|c'], false)).toEqual([0, 2]);
    expect(shownPairs(pairs, ['a|c'], true)).toEqual([0, 1, 2]);
    expect(shownPairs(pairs, ['a|b', 'a|c', 'b|c'], false)).toEqual([]);
  });

  it('down from none is the first, up from none the last; round from the end to the start; what is set aside is stepped over', () => {
    expect(stepPair(pairs, [], false, null, 1)).toBe(0);
    expect(stepPair(pairs, [], false, null, -1)).toBe(2);
    expect(stepPair(pairs, [], false, 0, 1)).toBe(1);
    expect(stepPair(pairs, [], false, 2, 1)).toBe(0);
    expect(stepPair(pairs, [], false, 0, -1)).toBe(2);
    expect(stepPair(pairs, ['a|c'], false, 0, 1)).toBe(2);
    expect(stepPair(pairs, ['a|c'], true, 0, 1)).toBe(1);
    // the chosen one set aside since: the step starts again from the end it goes from
    expect(stepPair(pairs, ['a|b'], false, 0, 1)).toBe(1);
    expect(stepPair(pairs, ['a|b', 'a|c', 'b|c'], false, null, 1)).toBeNull();
  });

  it('what the list says of where a pair is: the centre and the size of the box, to two places', () => {
    // (9.995 itself is a tie that binary floating point holds a little under: it rounds to 9.99, as toFixed does)
    expect(pairPlace({ center: [9.996, 10, 29.8], min: [9.99, 0, 29.6], max: [10, 20, 30] })).toEqual({ center: '10.00, 10.00, 29.80', size: '0.01 × 20.00 × 0.40' });
    expect(pairPlace({ center: [-0.001, 0, 0], min: [0, 0, 0], max: [0, 0, 0] }).center).toBe('0.00, 0.00, 0.00'); // no "-0.00"
  });
});

describe('the view taken to a box (fitBoxView)', () => {
  /** A camera as 「全部顯示」 leaves it on a model 200 mm across, looking from an isometric direction. */
  const fitted = (aspect: number) => {
    const camera = new THREE.OrthographicCamera(-100 * aspect, 100 * aspect, 100, -100, -1e5, 1e5);
    const target = new THREE.Vector3(100, 100, 100);
    camera.position.set(1, 1, 1).normalize().multiplyScalar(2000).add(target);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return { camera, target };
  };
  /** How much of the view the box takes on the screen: the larger of its part of the height and its part of the width. */
  const filled = (camera: THREE.OrthographicCamera, min: Vec3, max: Vec3) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]).project(camera);
      xs.push(p.x);
      ys.push(p.y);
    }
    return { fraction: Math.max((Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2), middle: [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2] };
  };

  for (const [what, min, max] of [
    ['the small overlap of the report (0.01 × 20 × 0.4 mm)', [9.99, 0, 29.6], [10, 20, 30]],
    ['an overlap 0.4 mm each way in a model of 200 mm', [150, 20, 80], [150.4, 20.4, 80.4]],
    ['a plate the size of the model', [0, 0, 0], [200, 10, 150]],
  ] as [string, Vec3, Vec3][]) {
    for (const aspect of [16 / 9, 1, 0.5]) {
      it(`${what}, view ${aspect.toFixed(2)} wide to high: in the middle, between 20 % and 40 % of the view (${FIT_BOX_FRACTION * 100} %)`, () => {
        const { camera, target } = fitted(aspect);
        const look = camera.position.clone().sub(target).normalize();
        fitBoxView(camera, target, { min, max }, aspect);
        const f = filled(camera, min, max);
        expect(f.fraction).toBeGreaterThanOrEqual(0.2);
        expect(f.fraction).toBeLessThanOrEqual(0.4);
        expect(f.fraction).toBeCloseTo(FIT_BOX_FRACTION, 9);
        expect(Math.abs(f.middle[0]!)).toBeLessThan(1e-9);
        expect(Math.abs(f.middle[1]!)).toBeLessThan(1e-9);
        expect(target.toArray()).toEqual([0, 1, 2].map((k) => (min[k]! + max[k]!) / 2));
        expect(camera.position.clone().sub(target).normalize().distanceTo(look)).toBeLessThan(1e-12); // seen from where it was
        expect(camera.zoom).toBe(1);
      });
    }
  }

  it('「上一個視角」 brings back the view before, exactly', () => {
    const { camera, target } = fitted(16 / 9);
    camera.zoom = 2.5;
    camera.updateProjectionMatrix();
    const before = viewState(camera, target);
    fitBoxView(camera, target, { min: [1, 2, 3], max: [1.2, 2.2, 3.2] }, 16 / 9);
    restoreView(camera, target, before);
    const after = viewState(camera, target);
    expect(after.position.distanceTo(before.position)).toBe(0);
    expect(after.target.distanceTo(before.target)).toBe(0);
    expect(after.zoom).toBe(2.5);
    expect(after.frustum).toEqual(before.frustum);
  });

  it('a point is looked at as a box of the least size; what is not a box, a view or a part of it is refused, and the camera is left as it was', () => {
    const { camera, target } = fitted(1);
    fitBoxView(camera, target, { min: [5, 5, 5], max: [5, 5, 5] }, 1);
    expect(camera.top).toBeCloseTo(1e-3 / (2 * FIT_BOX_FRACTION), 12);
    const kept = viewState(camera, target);
    for (const bad of [
      () => fitBoxView(camera, target, { min: [0, 0, NaN], max: [1, 1, 1] }, 1),
      () => fitBoxView(camera, target, { min: [0, 0, 0], max: [1, 1, Infinity] }, 1),
      () => fitBoxView(camera, target, { min: [2, 0, 0], max: [1, 1, 1] }, 1),
      () => fitBoxView(camera, target, { min: [0, 0, 0], max: [1, 1, 1] }, 0),
      () => fitBoxView(camera, target, { min: [0, 0, 0], max: [1, 1, 1] }, -1),
      () => fitBoxView(camera, target, { min: [0, 0, 0], max: [1, 1, 1] }, NaN),
      () => fitBoxView(camera, target, { min: [0, 0, 0], max: [1, 1, 1] }, 1, 0),
      () => fitBoxView(camera, target, { min: [0, 0, 0], max: [1, 1, 1] }, 1, 1.5),
    ]) expect(bad).toThrow();
    const now = viewState(camera, target);
    expect(now.position.distanceTo(kept.position)).toBe(0);
    expect(now.frustum).toEqual(kept.frustum);
  });
});
