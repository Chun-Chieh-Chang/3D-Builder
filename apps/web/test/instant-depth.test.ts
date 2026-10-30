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

it('the value axis follows the real growth of boss and cut alike: dragging along it deepens, the arrow points the way it grows, and crossing the plane reverses',async()=>{
 const {draggedExtrusion,extrusionGrowSign,previewArrowUnit}=await import('../src/state/instantDepth');
 // a fake screen where the unit sketch normal maps to 20 px, straight up the screen (screen y grows downwards)
 const normalImg=[0,-20] as const;
 for(const op of ['boss','cut'] as const)for(const reverse of [false,true]){
  const grow=extrusionGrowSign(op),axis=[normalImg[0]*grow,normalImg[1]*grow],depth=4,signed=reverse?-depth:depth;
  // the way the feature grows right now, as the engine builds it: the value axis, flipped by the stored reverse (C4.1 dirOf)
  const stateSign=grow*(reverse?-1:1);
  const growth=[normalImg[0]*stateSign,normalImg[1]*stateSign];
  // dragging along the growth direction must deepen it, on both sides of the sketch plane
  let value=draggedExtrusion(signed,[500,300],[500+growth[0]!*3,300+growth[1]!*3],axis);
  expect(Math.abs(value)).toBeCloseTo(depth+3,10);
  expect(value<0).toBe(reverse);
  // the arrow and the handle mounted on it point the way it actually grows (the component maps the document state, which the throttled drag keeps current)
  const unit=previewArrowUnit(axis,signed);
  expect(Math.abs(unit[0]!*growth[1]!-unit[1]!*growth[0]!)).toBeCloseTo(0,10); // parallel
  expect(unit[0]!*growth[0]!+unit[1]!*growth[1]!).toBeGreaterThan(0); // the same way round
  // pulling the handle back through the sketch plane flips: the pointer keeps moving one way and the value crosses zero
  const crossed=draggedExtrusion(signed,[500,300],[500-growth[0]!*(depth+2),300-growth[1]!*(depth+2)],axis);
  expect(crossed<0).toBe(!reverse);
  expect(Math.abs(crossed)).toBeCloseTo(2,10);
 }
});
