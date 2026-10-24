import { beforeAll, expect, it } from 'vitest';
import { Kernel, type Frame, type Segment } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { applyCommand, parsePart, serializePart, SCHEMA_VERSION, type Feature, type Ref } from '@3db/model';
import { Regenerator, dependencies } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';
let kernel:Kernel,solver:PlaneGcsSolver;
beforeAll(async()=>{kernel=await Kernel.load();solver=await PlaneGcsSolver.create();});
const frame:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
const segments=(w:number,h:number):Segment[]=>[{kind:'line',a:[0,0],b:[w,0],source:'a'},{kind:'line',a:[w,0],b:[w,h],source:'b'},{kind:'line',a:[w,h],b:[0,h],source:'c'},{kind:'line',a:[0,h],b:[0,0],source:'d'}];
const box=(w:number,h:number,z:number)=>kernel.extrude(frame,[{outer:segments(w,h),holes:[]}],[0,0,z]).shape;

it('makes real ruled and radiated surfaces with analytic areas and aligned topology names',()=>{
 const shape=box(20,12,10);
 try {
  const topology=kernel.topology(shape),a=topology.edges.findIndex(e=>Math.abs(e.mid[1])<1e-6&&Math.abs(e.mid[2])<1e-6&&Math.abs(e.mid[0]-10)<1e-6),b=topology.edges.findIndex(e=>Math.abs(e.mid[1])<1e-6&&Math.abs(e.mid[2]-10)<1e-6&&Math.abs(e.mid[0]-10)<1e-6);
  expect(a).toBeGreaterThanOrEqual(0);expect(b).toBeGreaterThanOrEqual(0);
  const ruled=kernel.ruledSurface({shape,edge:a},{shape,edge:b},true);
  try{expect(kernel.isValid(ruled)).toBe(true);expect(kernel.topology(ruled).faces.reduce((s,f)=>s+f.area,0)).toBeCloseTo(200,5);expect(kernel.massProps(ruled).volume).toBeCloseTo(0,6);}finally{kernel.release(ruled);}
  const radiated=kernel.radiatedSurface(shape,a,[0,0,1],3);
  try{expect(kernel.isValid(radiated)).toBe(true);expect(kernel.topology(radiated).faces.reduce((s,f)=>s+f.area,0)).toBeCloseTo(60,5);}finally{kernel.release(radiated);}
  expect(()=>kernel.ruledSurface({shape,edge:a},{shape,edge:a})).toThrow();
  expect(()=>kernel.radiatedSurface(shape,a,[1,0,0],3)).toThrow();expect(()=>kernel.radiatedSurface(shape,a,[0,0,1],NaN)).toThrow();
 }finally{kernel.release(shape);}
});

it('radiates circles into an exact annular surface and rejects inward collapse',()=>{
 const shape=kernel.extrude(frame,[{outer:[{kind:'circle',c:[0,0],r:5,source:'c'}],holes:[]}],[0,0,10]).shape;
 try {
  const topology=kernel.topology(shape),edge=topology.edges.findIndex(e=>e.curve==='circle'&&Math.abs(e.mid[2])<1e-6);
  const surface=kernel.radiatedSurface(shape,edge,[0,0,1],2);
  try{expect(kernel.topology(surface).faces.reduce((s,f)=>s+f.area,0)).toBeCloseTo(Math.PI*(49-25),5);}finally{kernel.release(surface);}
  expect(()=>kernel.radiatedSurface(shape,edge,[0,0,1],-5)).toThrow();
 }finally{kernel.release(shape);}
});

it('replaces a planar solid face from a real datum plane, follows it and preserves downstream references',()=>{
 const regen=new Regenerator(kernel,solver,new Map());
 try {
  const base=build(sketch('s',front,rectangle('r',0,0,20,12)),extrude('boss','s','boss',{type:'blind',depth:'10'}),{id:'target',type:'refPlane',name:'Target',suppressed:false,def:{mode:'offset',plane:front,distance:'15'}});
  const feature:Feature={id:'replace',type:'replaceFace',name:'Replace',suppressed:false,face:{kind:'face',name:'boss:cap:end'},replacement:{kind:'datum',name:'target'}};
  let doc=applyCommand(base,{type:'insertFeature',index:3,feature});
  for(const height of [15,8]) {
   doc=applyCommand(doc,{type:'setRefPlane',featureId:'target',def:{mode:'offset',plane:front,distance:String(height)}});
   const result=regen.rebuild(doc);expect(statuses(result).every(s=>s.endsWith('=ok')),statuses(result).join('\n')).toBe(true);
   expect(kernel.massProps(result.bodies[0]!.shape).volume).toBeCloseTo(20*12*height,5);
   expect(result.body!.names.faces).toContain('boss:cap:end');
  }
  expect(dependencies(doc).parents.get('replace')).toEqual(['boss','target']);expect(parsePart(serializePart(doc)).schemaVersion).toBe(SCHEMA_VERSION);
  expect(()=>applyCommand(doc,{type:'setSurfaceTools',featureId:'replace',params:{edge:{kind:'edge',name:'bad'}}})).toThrow();
 }finally{regen.dispose();}
});

it('wires ruled/radiated feature commands, DAG and real surface topology',()=>{
 const regen=new Regenerator(kernel,solver,new Map());
 try {
  const base=build(sketch('s',front,rectangle('r',0,0,20,12)),extrude('boss','s','boss',{type:'blind',depth:'10'}));
  const r=regen.rebuild(base),view=r.body!;
  const a=view.topology.edges.findIndex(e=>Math.abs(e.mid[1])<1e-6&&Math.abs(e.mid[2])<1e-6&&Math.abs(e.mid[0]-10)<1e-6),b=view.topology.edges.findIndex(e=>Math.abs(e.mid[1])<1e-6&&Math.abs(e.mid[2]-10)<1e-6&&Math.abs(e.mid[0]-10)<1e-6);
  const ref=(i:number):Ref=>({kind:'edge',name:view.names.edges[i]!});
  const doc=build(...base.features,{id:'rule',type:'ruledSurface',name:'Rule',suppressed:false,first:ref(a),second:ref(b),reverseSecond:true},{id:'rad',type:'radiatedSurface',name:'Radiate',suppressed:false,edge:ref(a),plane:front,distance:'3'});
  const result=regen.rebuild(doc);expect(statuses(result).every(s=>s.endsWith('=ok')),statuses(result).join('\n')).toBe(true);
  for(const id of ['rule','rad']){const body=result.bodies.find(b=>b.id===id)!;expect(body.surface).toBe(true);expect(body.curve).not.toBe(true);expect(body.faces).toBe(1);expect(dependencies(doc).parents.get(id)).toContain('boss');}
  expect(result.body!.names.edges).toHaveLength(result.body!.topology.edges.length);expect(result.body!.names.vertices).toHaveLength(result.body!.topology.vertices.length);
  expect(()=>applyCommand(doc,{type:'setSurfaceTools',featureId:'rad',params:{distance:'-2'}})).toThrow();
 }finally{regen.dispose();}
});

it('rejects oversized surface parameters before the native operation',()=>{
 const doc=build(sketch('s',front,rectangle('r',0,0,20,12)),extrude('boss','s','boss',{type:'blind',depth:'10'}));
 expect(()=>applyCommand(doc,{type:'insertFeature',index:2,feature:{id:'bad',type:'radiatedSurface',name:'Bad',suppressed:false,edge:{kind:'edge',name:'unknown'},plane:front,distance:'1e100'}})).toThrow();
 const shape=box(20,12,10);try{expect(()=>kernel.radiatedSurface(shape,0,frame.normal,1e100)).toThrow();}finally{kernel.release(shape);}
});
