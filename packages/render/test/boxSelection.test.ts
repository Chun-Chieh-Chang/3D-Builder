import { expect, it } from 'vitest';
import { geometryInRect, polygonInRect, selectionRect, segmentInRect } from '../src/boxSelection';

it('uses direction for window versus crossing and refuses nonfinite pointer coordinates',()=>{
  expect(selectionRect([0,0],[10,10]).crossing).toBe(false);
  expect(selectionRect([10,0],[0,10]).crossing).toBe(true);
  expect(()=>selectionRect([NaN,0],[0,10])).toThrow();
});
it('crosses actual polygon geometry, including a rectangle wholly inside a face',()=>{
  const rect=selectionRect([2,0],[0,2]);
  expect(polygonInRect([[-10,-10],[10,-10],[0,20]],rect)).toBe(true);
  // Extents overlap the rectangle, but the triangle itself does not.
  expect(polygonInRect([[1,4],[4,1],[4,4]],rect)).toBe(false);
  expect(segmentInRect([-5,1],[5,1],rect)).toBe(true);
  expect(segmentInRect([-5,3],[5,3],rect)).toBe(false);
});
it('requires every face fragment inside a window; a crossing only needs one',()=>{
  const polys=[[[1,1],[2,1],[1,2]],[[5,5],[6,5],[5,6]]] as const;
  expect(geometryInRect(polys,selectionRect([0,0],[3,3]))).toBe(false);
  expect(geometryInRect(polys,selectionRect([3,0],[0,3]))).toBe(true);
  expect(geometryInRect([],selectionRect([3,0],[0,3]))).toBe(false);
});
it('handles touching and degenerate segments without treating nearby geometry as selected',()=>{
  const r=selectionRect([0,0],[2,2]);
  expect(segmentInRect([2,2],[2,2],r)).toBe(true);
  expect(segmentInRect([2.001,2],[3,2],r)).toBe(false);
  expect(polygonInRect([[0,0],[2,0],[2,2]],r)).toBe(true);
});
