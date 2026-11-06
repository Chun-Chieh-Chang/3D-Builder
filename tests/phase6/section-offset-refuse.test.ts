/** Research spike: refuse an offset that violates the gap, and say where. No product API. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TopoDS_Shape } from 'libcascade/single/init';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Arena, ShapeIndex } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import { OffsetClearanceError } from '@3db/regen';
import { checkedOffset, sectionEnvelope } from './section-offset-envelope';

let k:Kernel;let initialHeap=0;const reports:Record<string,unknown>[]=[];
const heap=()=>(k.oc as unknown as {wasmMemory:WebAssembly.Memory}).wasmMemory.buffer.byteLength;
beforeAll(async()=>{k=await Kernel.load();initialHeap=heap();expect(initialHeap).toBeGreaterThan(0);});
afterAll(()=>{const dir=resolve('out/section-clearance');mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,'offset-refuse.json'),JSON.stringify({initialHeap,finalHeap:heap(),reports},null,2));});

/** Gear STEP -> section -> explicit arc approximation; then the checked offset, returning what it did. */
function run(module:number,teeth:number,gap:number) {
  const oc=k.oc,a=new Arena(),raw=k as unknown as {get(id:ShapeId):TopoDS_Shape},ids:ShapeId[]=[];
  try{
    const src=k.extrude({origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]},[toothedProfile({kind:'gear',module,teeth,pressureAngle:20*Math.PI/180,width:5,bore:0,backlash:0,baseHeight:0})],[0,0,5]).shape;ids.push(src);
    const imp=k.importStep(k.exportStep(src)).shape;ids.push(imp);
    const plane=a.own(new oc.gp_Pln(a.own(new oc.gp_Pnt(0,0,2.5)),a.own(new oc.gp_Dir(0,0,1))));
    const cut=a.own(new oc.BRepAlgoAPI_Section(raw.get(imp),plane,false));cut.Approximation(true);cut.ComputePCurveOn2(true);cut.Build();if(!cut.IsDone())throw Error('section');
    const edges=ShapeIndex.of(oc,a.own(cut.Shape()),'TopAbs_EDGE',a),seq=a.own(new oc.NCollection_HSequence_TopoDS_Shape());try{for(const e of edges.keys)seq.Append(e);}finally{edges.dispose();}
    const w=a.own(oc.TopoDS.Wire(a.own(a.own(a.own(oc.ShapeAnalysis_FreeBounds.ConnectEdgesToWires(seq,1e-7,false)).Sequence()).Value(1))));
    const approx=sectionEnvelope(k,w,2e-6,a,'arc'),face=a.own(a.own(new oc.BRepBuilderAPI_MakeFace(plane,approx.wire,true)).Face());
    try{const r=checkedOffset(k,approx.wire,face,gap,a);const rep={module,teeth,gap,refused:false,minDistance:r.minDistance,edges:r.segments.length};reports.push(rep);return rep;}
    catch(e){if(!(e instanceof OffsetClearanceError))throw e;
      const rep={module,teeth,gap,refused:true,message:e.message,minDistance:e.minDistance,locations:e.locations.map(l=>({...l,radius:Math.hypot(...l.point),deg:Math.atan2(l.point[1],l.point[0])*180/Math.PI}))};reports.push(rep);return rep;}
  }finally{for(const id of ids)k.release(id);a.dispose();}
}

it('rejects invalid gaps, tolerances and sample counts before offsetting',()=>{
  const a=new Arena();
  try{const face=null as never,w=null as never;
    for(const g of [0,-1,NaN,Infinity])expect(()=>checkedOffset(k,w,face,g,a)).toThrow('positive finite gap');
    for(const t of [0,-1,NaN,0.1,1])expect(()=>checkedOffset(k,w,face,0.1,a,t)).toThrow('tolerance');
    for(const n of [0,-1,1.5,NaN])expect(()=>checkedOffset(k,w,face,0.1,a,1e-6,n)).toThrow('samples per edge');
  }finally{a.dispose();}
});

/** Module 3: one place at each of the two root corners of every tooth space. Module 1 with a 0.8 mm gap: the two corners of a
 * tooth space are closer than the gap to each other, so they are one place. */
it.each([[3,40,0.3,2],[1,24,0.8,1]] as [number,number,number,number][])('refuses module %s, %s teeth, gap %s mm, with %s place(s) in every tooth space at the root',(module,teeth,gap,perSpace)=>{
  const r=run(module,teeth,gap) as {refused:boolean;minDistance:number;message:string;locations:{radius:number;deg:number;distance:number;samples:number}[]};
  const root=module*teeth/2-1.25*module,pitch=360/teeth;
  expect(r.refused).toBe(true);
  expect(r.message).toMatch(/violates the gap/);
  expect(r.minDistance).toBeLessThan(gap-1e-3);
  expect(r.locations[0]!.distance).toBeCloseTo(r.minDistance,9);
  expect(r.locations.length).toBe(teeth*perSpace);
  // Every place is just above the root, inside the band the gap forbids.
  for(const l of r.locations){expect(l.radius).toBeGreaterThan(root);expect(l.radius).toBeLessThan(root+gap);expect(l.distance).toBeLessThan(gap-1e-6);}
  // Each tooth space has its places, mirrored about the middle of the space (tooth spaces are centred on half a pitch here).
  const bySpace=new Map<number,number[]>();
  for(const l of r.locations){const a=(l.deg+360)%360,i=Math.floor(a/pitch);(bySpace.get(i)??bySpace.set(i,[]).get(i)!).push(a-i*pitch);}
  expect(bySpace.size).toBe(teeth);
  for(const inSpace of bySpace.values())expect(inSpace.length).toBe(perSpace);
  // A merged place is reported at its closest point, which may be either corner; across the gear each position has its mirror.
  const all=[...bySpace.values()].flat();
  for(const x of all)expect(Math.min(...all.map(y=>Math.abs(y-(pitch-x))))).toBeLessThan(0.05);
  expect(k.liveShapes).toBe(0);
},170000);

it.each([[1,24,0.05],[1,24,0.2],[0.5,18,0.01],[3,40,0.1]] as [number,number,number][])('lets module %s, %s teeth, gap %s mm through',(module,teeth,gap)=>{
  const r=run(module,teeth,gap) as {refused:boolean;minDistance:number};
  expect(r.refused).toBe(false);
  expect(r.minDistance).toBeGreaterThanOrEqual(gap-1e-6);
  expect(k.liveShapes).toBe(0);
},170000);
