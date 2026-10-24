import { beforeAll, expect, it } from 'vitest';
import { applyCommand, parsePart, serializePart, SCHEMA_VERSION, mapRefs, type ProjectedCurveFeature } from '@3db/model';
import { Kernel, type Frame, type Segment } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, dependencies } from '@3db/regen';
import { build, extrude, front, line, circle, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel, solver: PlaneGcsSolver;
beforeAll(async()=>{kernel=await Kernel.load();solver=await PlaneGcsSolver.create();});
const feature = (extra: Partial<ProjectedCurveFeature> = {}): ProjectedCurveFeature => ({ id:'curve',name:'curve',type:'projectedCurve',suppressed:false,mode:'sketchOnSketch',sketch:'a',secondSketch:'b',...extra });
const docOf = () => build(sketch('a',front,line('la',0,1,10,6)),sketch('b',{kind:'datum',name:'plane:top'},line('lb',0,2,10,12)),feature());

it('builds a spatial intersection with topology-aligned names, dependencies and serialization',()=>{
  const doc=docOf(), regen=new Regenerator(kernel,solver,new Map());
  try {
    const r=regen.rebuild(doc); expect(statuses(r).every(s=>s.endsWith('=ok')),statuses(r).join('\n')).toBe(true);
    const curve=r.bodies.find(b=>b.id==='curve')!;
    expect(curve.curve).toBe(true); expect(r.body!.topology.faces).toHaveLength(0);
    expect(r.body!.names.edges).toHaveLength(r.body!.topology.edges.length);
    expect(r.body!.names.vertices).toHaveLength(r.body!.topology.vertices.length);
    expect(r.body!.topology.edges.length).toBeGreaterThan(0);
    expect(dependencies(doc).parents.get('curve')).toEqual(['a','b']);
    const parsed=parsePart(serializePart(doc));expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);expect(parsed.schemaVersion).toBeGreaterThanOrEqual(77);
  } finally {regen.dispose();}
});

it('projects an open sketch onto a real trimmed face and follows target changes',()=>{
  const base=build(sketch('base',front,rectangle('r',0,0,20,20)),extrude('boss','base','boss',{type:'blind',depth:'10'}),sketch('a',front,line('l',2,4,15,8)));
  const doc=applyCommand(base,{type:'insertFeature',index:3,feature:feature({mode:'sketchOnFaces',faces:[{kind:'face',name:'boss:cap:end'}]})});
  const regen=new Regenerator(kernel,solver,new Map());
  try {
    for(const depth of [10,17]) {
      const changed=applyCommand(doc,{type:'setEndCondition',featureId:'boss',dir:'dir1',value:{type:'blind',depth:String(depth)}});
      const r=regen.rebuild(changed); expect(statuses(r).every(s=>s.endsWith('=ok')),statuses(r).join('\n')).toBe(true);
      const c=r.bodies.find(b=>b.id==='curve')!;const topology=kernel.topology(c.shape);expect(topology.edges).toHaveLength(1);
      for(const v of topology.vertices)expect(v.point[2]).toBeCloseTo(depth,6);
    }
    expect(mapRefs(doc.features[3]!,r=>({...r,name:r.name==='boss:cap:end'?'boss:cap:start':r.name})).replaced).toBe(1);
  } finally {regen.dispose();}
});

it('rejects invalid references, parallel planes and empty intersections explicitly',()=>{
  const base=docOf();
  expect(()=>applyCommand(base,{type:'setProjectedCurve',featureId:'curve',params:{secondSketch:'a'}})).toThrow();
  expect(()=>applyCommand(base,{type:'setProjectedCurve',featureId:'curve',params:{secondSketch:'missing'}})).toThrow();
  expect(()=>applyCommand(base,{type:'setProjectedCurve',featureId:'curve',params:{mode:'sketchOnFaces',faces:[{kind:'edge',name:'x'}]}})).toThrow();
  const regen=new Regenerator(kernel,solver,new Map());
  try {
    const parallel=build(sketch('a',front,line('la',0,1,10,6)),sketch('b',front,line('lb',0,2,10,12)),feature());
    expect(regen.rebuild(parallel).features.find(f=>f.id==='curve')?.status).toBe('error');
    const empty=build(sketch('a',front,line('la',0,1,10,6)),sketch('b',{kind:'datum',name:'plane:top'},line('lb',20,2,30,12)),feature());
    expect(regen.rebuild(empty).features.find(f=>f.id==='curve')?.status).toBe('error');
  } finally {regen.dispose();}
});

it('fuzzes 100 real intersections against analytic endpoints and lengths',()=>{
  const heap=()=> (kernel.oc as any).wasmMemory?.buffer?.byteLength as number;
  const initial=heap();expect(initial).toBeGreaterThan(0);
  const a:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
  const b:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,0,1],normal:[0,-1,0]};
  let seed=92643;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const start=kernel.liveShapes;
  for(let i=0;i<100;i++) {
    const length=0.01+random()*100, m=random()*3-1.5, n=random()*3-1.5, y=random()*10-5,z=random()*10-5;
    const pa:Segment[][]=[[{kind:'line',source:'a',a:[0,y],b:[length,y+m*length]}]];
    const pb:Segment[][]=[[{kind:'line',source:'b',a:[0,z],b:[length,z+n*length]}]];
    const shape=kernel.intersectSketchCurves(a,pa,b,pb);
    try {
      const topo=kernel.topology(shape);expect(topo.edges).toHaveLength(1);expect(topo.vertices).toHaveLength(2);
      for(const v of topo.vertices) {const [x,vy,vz]=v.point;expect(vy).toBeCloseTo(y+m*x,5);expect(vz).toBeCloseTo(z+n*x,5);}
      expect(topo.edges[0]!.length).toBeCloseTo(length*Math.sqrt(1+m*m+n*n),5);
    } finally {kernel.release(shape);}
  }
  expect(kernel.liveShapes).toBe(start);expect(heap()).toBeGreaterThan(0);
  console.info('projected-curve heap growth bytes',heap()-initial);
});

it('keeps both branches on a cylinder and 100 trimmed-face projections',()=>{
 const regen=new Regenerator(kernel,solver,new Map());
 try {
  const r=regen.rebuild(build(sketch('s',front,circle('c',0,0,5)),extrude('cyl','s','boss',{type:'blind',depth:'10'})));
  const body=r.bodies[0]!, topology=kernel.topology(body.shape), face=topology.faces.findIndex(f=>f.surface==='cylinder');expect(face).toBeGreaterThanOrEqual(0);
  const frame:Frame={origin:[0,-10,0],xDir:[1,0,0],yDir:[0,0,1],normal:[0,-1,0]};
  const shape=kernel.projectedCurve(frame,[[{kind:'line',source:'line',a:[-2,4],b:[2,4]}]],[{shape:body.shape,face}],frame.normal);
  try {const t=kernel.topology(shape);expect(t.edges).toHaveLength(2);expect(t.edges.reduce((a,e)=>a+e.length,0)).toBeCloseTo(20*Math.asin(2/5),5);for(const v of t.vertices){expect(Math.hypot(v.point[0],v.point[1])).toBeCloseTo(5,6);expect(v.point[2]).toBeCloseTo(4,6);}} finally {kernel.release(shape);}
  const cap=topology.faces.findIndex(f=>f.surface==='plane'&&f.center[2]>9);
  const flat:Frame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
  let seed=18342;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<100;i++) {const x=rand()*2-1,y=rand()*2-1,dx=0.1+rand(),dy=0.1+rand();const s=kernel.projectedCurve(flat,[[{kind:'line',source:'l',a:[x,y],b:[x+dx,y+dy]}]],[{shape:body.shape,face:cap}],flat.normal);try{const t=kernel.topology(s);expect(t.edges).toHaveLength(1);expect(t.edges[0]!.length).toBeCloseTo(Math.hypot(dx,dy),6);for(const v of t.vertices)expect(v.point[2]).toBeCloseTo(10,6);}finally{kernel.release(s);}}
 } finally {regen.dispose();}
});
