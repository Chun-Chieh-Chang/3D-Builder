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

it('100 signed pointer configurations reverse construction explicitly and ignore perpendicular motion',async()=>{
 const {draggedExtrusion}=await import('../src/state/instantDepth');
 for(let i=0;i<100;i++){const a=(i*137.508)*Math.PI/180,axis=[Math.cos(a)*2,Math.sin(a)*2],initial=3+i/10,delta=i%2===0?5:-initial-4;
 const from=[110,210],to=[from[0]!+axis[0]!*delta-axis[1]!*7,from[1]!+axis[1]!*delta+axis[0]!*7];expect(draggedExtrusion(initial,from,to,axis)).toBeCloseTo(initial+delta,10);}
 expect(()=>draggedExtrusion(3,[0,0],[-3,0],[1,0])).toThrow();expect(()=>draggedExtrusion(NaN,[0,0],[1,0],[1,0])).toThrow();expect(()=>draggedExtrusion(3,[0,0],[1,0],[0,0])).toThrow();
});
