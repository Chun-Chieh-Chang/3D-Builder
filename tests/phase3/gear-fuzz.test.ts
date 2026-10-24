import { beforeAll, expect, it } from 'vitest';
import { gearDimensions, type GearParameters } from '@3db/model';
import { Kernel, type Frame } from '@3db/kernel';
import { toothedProfile } from '../../packages/regen/src/gears';
import { gearArea } from './gear-helpers';
let kernel:Kernel;beforeAll(async()=>{kernel=await Kernel.load();});
const frame:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
let seed=193;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
it('fuzzes 100 actual involute gear solids against analytic volume and native-curve samples, reading real WASM heap',()=>{
 const initial=(kernel.oc as any).wasmMemory?.buffer?.byteLength;expect(initial).toBeGreaterThan(0);
 for(let i=0;i<100;i++){
  const p:GearParameters={kind:'gear',module:.2+rand()*3,teeth:24+Math.floor(rand()*12),pressureAngle:(20+rand()*5)*Math.PI/180,width:.5+rand()*12,backlash:0,bore:0,baseHeight:0};
  const d=gearDimensions(p);p.bore=i%2===0?d.rootRadius*.5:0;p.backlash=i%3===0?p.module*.03:0;
  const shape=kernel.extrude(frame,[toothedProfile(p)],[0,0,p.width]).shape;
  try{
   expect(kernel.isValid(shape),`case ${i}`).toBe(true);expect(kernel.solidCount(shape)).toBe(1);
   expect(Math.abs(kernel.massProps(shape).volume/(gearArea(p)*p.width)-1),`volume ${i}`).toBeLessThan(2e-6);
   const edge=kernel.topology(shape).edges.find(edge=>edge.geometry?.type==='bspline');expect(edge).toBeDefined();
   const geometry=edge!.geometry!;if(geometry.type!=='bspline')throw Error('native involute missing');
   const dims=gearDimensions(p);
   for(const point of geometry.samples){const radius=Math.hypot(point[0],point[1]),t=Math.sqrt(Math.max(0,(radius/dims.baseRadius)**2-1)),theta=Math.atan2(point[1],point[0]),period=2*Math.PI/p.teeth;
    // Native explorer may return either flank of any tooth: nearest tooth center and mirrored involute.
    const local=((theta+period/2)%period+period)%period-period/2,expected=dims.half-t+Math.atan(t);
    expect(Math.abs(Math.abs(local)-expected)*radius,`flank ${i}`).toBeLessThan(p.module*1e-4);
   }
  }finally{kernel.release(shape);}
 }
 const final=(kernel.oc as any).wasmMemory.buffer.byteLength;expect(final-initial).toBeLessThan(512*1024*1024);console.info('100 gear heap growth bytes',final-initial);
});
