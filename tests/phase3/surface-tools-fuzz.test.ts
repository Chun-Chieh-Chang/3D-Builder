import { beforeAll, expect, it } from 'vitest';
import { Kernel, type Frame, type Segment } from '@3db/kernel';
let kernel:Kernel;beforeAll(async()=>{kernel=await Kernel.load();});
const frame:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
const segments=(w:number,h:number):Segment[]=>[{kind:'line',a:[0,0],b:[w,0],source:'a'},{kind:'line',a:[w,0],b:[w,h],source:'b'},{kind:'line',a:[w,h],b:[0,h],source:'c'},{kind:'line',a:[0,h],b:[0,0],source:'d'}];
let seed=18393;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
it('fuzzes 100 actual ruled and radiated surfaces against analytic areas',()=>{
 const initial=(kernel.oc as any).wasmMemory?.buffer?.byteLength;expect(initial).toBeGreaterThan(0);
 for(let i=0;i<100;i++) {
  const w=.1+rand()*70,h=.1+rand()*70,z=.1+rand()*70,d=.1+rand()*20,shape=kernel.extrude(frame,[{outer:segments(w,h),holes:[]}],[0,0,z]).shape;
  try {
   const topology=kernel.topology(shape),a=topology.edges.findIndex(e=>Math.abs(e.mid[1])<1e-7&&Math.abs(e.mid[2])<1e-7&&Math.abs(e.mid[0]-w/2)<1e-7),b=topology.edges.findIndex(e=>Math.abs(e.mid[1])<1e-7&&Math.abs(e.mid[2]-z)<1e-7&&Math.abs(e.mid[0]-w/2)<1e-7);
   const ruled=kernel.ruledSurface({shape,edge:a},{shape,edge:b},true),radiated=kernel.radiatedSurface(shape,a,frame.normal,d);
   try {expect(kernel.isValid(ruled)).toBe(true);expect(kernel.isValid(radiated)).toBe(true);expect(kernel.massProps(ruled).area).toBeCloseTo(w*z,5);expect(kernel.massProps(radiated).area).toBeCloseTo(w*d,5);}finally{kernel.release(ruled);kernel.release(radiated);}
  }finally{kernel.release(shape);}
 }
 console.info('surface tools heap growth bytes',(kernel.oc as any).wasmMemory.buffer.byteLength-initial);
});
it('fuzzes the planar replacement kernel path for 100 expansion/shrink configurations',()=>{
 for(let i=0;i<100;i++) {
  const w=.5+rand()*30,h=.5+rand()*30,z=1+rand()*20,shift=(rand()-.5)*z,shape=kernel.extrude(frame,[{outer:segments(w,h),holes:[]}],[0,0,z]).shape;
  try {
   const face=kernel.topology(shape).faces.findIndex(f=>f.normal&&f.normal[2]>.99),result=kernel.moveFace(shape,face,shift).shape;
   try{expect(kernel.isValid(result)).toBe(true);expect(kernel.massProps(result).volume).toBeCloseTo(w*h*(z+shift),5);}finally{kernel.release(result);}
  }finally{kernel.release(shape);}
 }
});
