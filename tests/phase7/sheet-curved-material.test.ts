import {beforeAll,expect,it} from 'vitest';
import {Kernel,type SheetBendMap}from '@3db/kernel';
let k:Kernel;beforeAll(async()=>{k=await Kernel.load();});
const map:SheetBendMap={flatOrigin:[0,0,0],flatAcross:[1,0,0],flatAlong:[0,-1,0],flatNormal:[0,0,1],center:[0,0,3.5],axis:[0,-1,0],radial:[0,0,-1],radiusAtZero:3.5,radialSlope:-1,neutralRadius:2.75,angle:Math.PI/2};
it('maps a round normal through-cut onto analytic concentric cylinders with exact material volume',()=>{
 const s=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},[{outer:[{kind:'circle',c:[2,5],r:1,source:'c'}],holes:[]}],[0,0,1.5]).shape;
 try{const r=k.bendSheetMaterial(s,map);try{expect(k.isValid(r.shape)).toBe(true);expect(k.solidCount(r.shape)).toBe(1);expect(k.massProps(r.shape).volume).toBeCloseTo(Math.PI*1.5,5);expect(k.topology(r.shape).faces.filter(f=>f.surface==='cylinder')).toHaveLength(2);
 const p:[number,number,number]=[2.75*Math.sin(2/2.75),5,3.5-2.75*Math.cos(2/2.75)];expect(k.classify(r.shape,[p])[0]).toBe('in');
 }finally{k.release(r.shape);}}finally{k.release(s);}
});
for(let batch=0;batch<4;batch++)it(`50 seeded cylindrical material maps, parameter regime ${batch+1}`,()=>{
 const initial=(k.oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength;expect(initial).toBeGreaterThan(0);
 let seed=9187+batch;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<50;i++){
 const thickness=0.3+rand()*2.7,inner=1+rand()*8,K=0.25+rand()*0.5,angle=(25+rand()*145)*Math.PI/180,neutral=inner+K*thickness,sign=batch%2?1:-1;
 const width=angle*neutral,rad=Math.min(width/9,0.2+rand()*0.6),x=width*(0.3+rand()*0.4);
 const m:SheetBendMap={...map,neutralRadius:neutral,angle,radiusAtZero:sign===1?inner:inner+thickness,radialSlope:sign};
 const s=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},[{outer:[{kind:'circle',c:[x,5],r:rad,source:'c'}],holes:[]}],[0,0,thickness]).shape;
 try{const r=k.bendSheetMaterial(s,m);try{expect(k.isValid(r.shape)).toBe(true);expect(k.solidCount(r.shape)).toBe(1);expect(k.massProps(r.shape).volume).toBeCloseTo(Math.PI*rad**2*thickness*(inner+thickness/2)/neutral,4);
 const rr=inner+thickness/2;expect(k.classify(r.shape,[[rr*Math.sin(x/neutral),5,3.5-rr*Math.cos(x/neutral)]])[0]).toBe('in');
 }finally{k.release(r.shape);}}finally{k.release(s);}
 }
 console.info('curved material heap bytes; not proof of zero native leakage',{initial,final:(k.oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength});
});
it('rejects corrupt maps and oblique machining explicitly',()=>{
 const s=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},[{outer:[{kind:'circle',c:[2,5],r:1,source:'c'}],holes:[]}],[0,0,1]).shape;try{
 for(const bad of [{angle:NaN},{neutralRadius:0},{radiusAtZero:-1},{radialSlope:0},{flatAcross:[2,0,0]},{angle:4},{angle:0.1}])expect(()=>k.bendSheetMaterial(s,{...map,...bad} as SheetBendMap)).toThrow();
 const tilted=k.transformed(s,[1,0,0,0,0,Math.cos(0.3),-Math.sin(0.3),0,0,Math.sin(0.3),Math.cos(0.3),0]);try{expect(()=>k.bendSheetMaterial(tilted,map)).toThrow();}finally{k.release(tilted);}
 }finally{k.release(s);}
});
it('preserves an inner wire in a constant-section slot/ring tool',()=>{
 const s=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},[{outer:[{kind:'circle',c:[2,5],r:1,source:'outer'}],holes:[[{kind:'circle',c:[2,5],r:0.4,source:'inner'}]]}],[0,0,1.5]).shape;
 try{const r=k.bendSheetMaterial(s,map);try{expect(k.isValid(r.shape)).toBe(true);expect(k.massProps(r.shape).volume).toBeCloseTo(Math.PI*(1-0.16)*1.5,5);expect(k.classify(r.shape,[[2.75*Math.sin(2/2.75),5,3.5-2.75*Math.cos(2/2.75)]])[0]).toBe('out');}finally{k.release(r.shape);}}finally{k.release(s);}
});
