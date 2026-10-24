import { beforeAll, expect, it } from 'vitest';
import type { GearParameters } from '@3db/model';
import { Kernel, type Frame } from '@3db/kernel';
import { toothedProfile } from '../../packages/regen/src/gears';
import { rackArea } from './gear-helpers';
let kernel:Kernel;beforeAll(async()=>{kernel=await Kernel.load();});
const frame:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
let seed=194;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
it('fuzzes 100 actual straight racks against exact area and volume with real WASM heap',()=>{
 const initial=(kernel.oc as any).wasmMemory?.buffer?.byteLength;expect(initial).toBeGreaterThan(0);
 for(let i=0;i<100;i++){
  const p:GearParameters={kind:'rack',module:.1+rand()*5,teeth:1+Math.floor(rand()*25),pressureAngle:(15+rand()*15)*Math.PI/180,width:.1+rand()*20,backlash:0,bore:0,baseHeight:.1+rand()*10};p.backlash=p.module*rand()*.1;
  const shape=kernel.extrude(frame,[toothedProfile(p)],[0,0,p.width]).shape;
  try{expect(kernel.isValid(shape),`case ${i}`).toBe(true);expect(kernel.solidCount(shape)).toBe(1);expect(Math.abs(kernel.massProps(shape).volume/(rackArea(p)*p.width)-1)).toBeLessThan(1e-8);}finally{kernel.release(shape);}
 }
 const final=(kernel.oc as any).wasmMemory.buffer.byteLength;expect(final-initial).toBeLessThan(512*1024*1024);console.info('100 rack heap growth bytes',final-initial);
});
