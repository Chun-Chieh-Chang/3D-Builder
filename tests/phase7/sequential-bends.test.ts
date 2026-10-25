import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Feature, type PartDoc, type Ref } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator, flatPattern, type RebuildResult } from '@3db/regen';
import { rectangle, sketch, front, circle, extrude } from '../phase1/builders';
let k: Kernel, solver: PlaneGcsSolver;
beforeAll(async()=>{k=await Kernel.load();solver=await PlaneGcsSolver.create();});
const build=(features:Feature[]):PartDoc=>features.reduce((d,feature,index)=>applyCommand(d,{type:'insertFeature',feature,index}),createEmptyPart());
const base:Feature[]=[sketch('s',front,rectangle('r',0,0,120,40)),{id:'base',name:'base',type:'baseFlange',suppressed:false,sketch:'s',thickness:'1.5',radius:'2',kFactor:'0.5'}];
const bend=(id:string,x:number,angle='90',type:'midBend'|'jog'='midBend'):Feature[]=>[sketch('s'+id,front,{entities:[{id:id+'p',type:'point',x,y:-5},{id:id+'q',type:'point',x,y:45},{id:id+'l',type:'line',p1:id+'p',p2:id+'q'}],constraints:[]}),type==='midBend'?{id,name:id,type,sketch:'s'+id,angle,suppressed:false}:{id,name:id,type,sketch:'s'+id,angle,offset:'10',suppressed:false}];
const ok=(r:RebuildResult)=>expect(r.features.filter(f=>f.status!=='ok').map(f=>f.message)).toEqual([]);
function check(features:Feature[],lines:number,volume?:number){
 const regen=new Regenerator(k,solver,new Map());
 try{const r=regen.rebuild(build(features));ok(r);expect(k.isValid(r.body!.shape)).toBe(true);expect(k.solidCount(r.body!.shape)).toBe(1);
 const p=flatPattern(k,r.sheet!);try{expect(p.notIncluded).toEqual([]);expect(p.bends).toHaveLength(lines);expect(k.isValid(p.shape)).toBe(true);expect(p.volume).toBeCloseTo(k.massProps(r.body!.shape).volume,3);if(volume!==undefined)expect(p.volume).toBeCloseTo(volume,3);return {width:p.width,height:p.height,bends:p.bends};}finally{k.release(p.shape);}
 }finally{regen.dispose();}
}
it('two mid bends and jog then mid bend retain exact flat coordinates and material',()=>{
 const r=check([...base,...bend('b1',80),...bend('b2',30)],2,120*40*1.5);
 expect(r.width).toBeCloseTo(120,6);expect(r.bends.map(b=>b.a[0])).toEqual([expect.closeTo(80,6),expect.closeTo(30,6)]);
 check([...base,...bend('j1',75,'60','jog'),...bend('b2',25)],3,120*40*1.5);
});
it('a hole on the panel between sequential bends follows its exact flat coordinates',()=>{
 const r=check([...base,sketch('hole',front,circle('c',55,20,3)),extrude('cut','hole','cut',{type:'throughAll',reverse:true}),...bend('b1',80),...bend('b2',30)],2,(120*40-Math.PI*9)*1.5);
 expect(r.width).toBeCloseTo(120,6);
});
it('edge flange and hem after a mid bend, and a mid bend after a flange, have valid matching blanks',()=>{
 const regen=new Regenerator(k,solver,new Map());
 try{const first=[...base,...bend('b1',80)];const r=regen.rebuild(build(first));ok(r);
 const ei=r.body!.topology.edges.findIndex(e=>e.curve==='line'&&Math.hypot(e.mid[0],e.mid[1]-20,e.mid[2]-1.5)<1e-6);expect(ei).toBeGreaterThanOrEqual(0);
 const edge:Ref={kind:'edge',name:r.body!.names.edges[ei]!};
 check([...first,{id:'fl',name:'fl',type:'edgeFlange',edge,length:'15',suppressed:false}],2);
 check([...first,{id:'hem',name:'hem',type:'hem',edge,length:'8',gap:'0.5',suppressed:false}],2);
 const plate=regen.rebuild(build(base));const j=plate.body!.topology.edges.findIndex(e=>e.curve==='line'&&Math.hypot(e.mid[0],e.mid[1]-20,e.mid[2]-1.5)<1e-6);
 check([...base,{id:'fl',name:'fl',type:'edgeFlange',edge:{kind:'edge',name:plate.body!.names.edges[j]!},length:'15',suppressed:false},...bend('b1',80)],2);
 }finally{regen.dispose();}
});
it('100 seeded two-bend configurations preserve exact native volume and blank dimensions',()=>{
 for(let i=0;i<100;i++){
  const a=50+(i*17%31);const b=15+(i*7%16);const angle=30+(i*13%51);
  const r=check([...base,...bend('a',a,String(angle)),...bend('b',b,String(25+i*19%51))],2,7200);
  expect(r.width).toBeCloseTo(120,6);expect(r.height).toBeCloseTo(40,6);
 }
});
it('bends a face-attached rotated panel and grows a flange on its moved edge with consistent flat mappings',()=>{
 const regen=new Regenerator(k,solver,new Map());
 try {
  const first=[...base,...bend('b1',80)];const r=regen.rebuild(build(first));ok(r);
  const face=r.body!.topology.faces.findIndex(f=>f.normal&&Math.abs(f.normal[0])>1-1e-8&&f.area>500);
  expect(face).toBeGreaterThanOrEqual(0);
  const faceRef:Ref={kind:'face',name:r.body!.names.faces[face]!};
  const worldCenter=r.body!.topology.faces[face]!.center;
  const empty=sketch('rotated',faceRef,{entities:[],constraints:[]});
  const placed=regen.rebuild(build([...first,empty]));const frame=placed.frames.get('rotated')!;expect(frame).toBeDefined();
  const xy=(p:number[]):[number,number]=>[frame.xDir.reduce((a,x,i)=>a+x*(p[i]!-frame.origin[i]!),0),frame.yDir.reduce((a,x,i)=>a+x*(p[i]!-frame.origin[i]!),0)];
  const a=xy([worldCenter[0],-5,worldCenter[2]]),b=xy([worldCenter[0],45,worldCenter[2]]);
  const sk=sketch('rotated',faceRef,{entities:[{id:'rpa',type:'point',x:a[0],y:a[1]},{id:'rpb',type:'point',x:b[0],y:b[1]},{id:'rl',type:'line',p1:'rpa',p2:'rpb'}],constraints:[]});
  const out=check([...first,sk,{id:'rotBend',name:'rotBend',type:'midBend',sketch:'rotated',angle:'45',suppressed:false}],2,7200);
  expect(out.width).toBeCloseTo(120,6);
  const native=regen.rebuild(build(first));const top=Math.max(...native.body!.topology.vertices.map(v=>v.point[2]));
  const edge=native.body!.topology.edges.findIndex(e=>e.curve==='line'&&Math.abs(e.length-40)<1e-6&&Math.abs(e.mid[2]-top)<1e-6);
  expect(edge).toBeGreaterThanOrEqual(0);
  check([...first,{id:'movedFlange',name:'movedFlange',type:'edgeFlange',edge:{kind:'edge',name:native.body!.names.edges[edge]!},length:'12',suppressed:false}],2);
 } finally {regen.dispose();}
});
