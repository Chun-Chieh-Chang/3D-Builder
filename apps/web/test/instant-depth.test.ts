import { expect, it } from 'vitest';
import { draggedDepth } from '../src/state/instantDepth';
it('projects a pointer onto the actual screen image of the extrusion axis',()=>{
  expect(draggedDepth(10,[100,100],[110,80],[1,-2])).toBe(20);
  expect(draggedDepth(10,[100,100],[80,90],[1,-2])).toBe(10);
});
it('rejects impossible values instead of clamping or rounding them',()=>{
  expect(()=>draggedDepth(10,[0,0],[0,0],[0,0])).toThrow();
  expect(()=>draggedDepth(10,[0,0],[-20,0],[1,0])).toThrow();
  expect(()=>draggedDepth(10,[0,0],[NaN,0],[1,0])).toThrow();
});
