import { expect, it } from 'vitest';
import * as THREE from 'three';
import { referencePlaneCorners } from '../src/referencePlane';
import type { PlaneFrame } from '../src/overlay';
const front:PlaneFrame={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
it('keeps all three base sheets centred on their common origin even when the model is far away',()=>{
 const frames:PlaneFrame[]=[front,{origin:[0,0,0],xDir:[1,0,0],yDir:[0,0,-1],normal:[0,1,0]},{origin:[0,0,0],xDir:[0,0,-1],yDir:[0,1,0],normal:[1,0,0]}];
 for(const f of frames){const c=referencePlaneCorners(f,new THREE.Box3(new THREE.Vector3(100,200,300),new THREE.Vector3(130,220,310)));expect(c.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(.25).length()).toBeLessThan(1e-10);for(const p of c)expect(p.dot(new THREE.Vector3(...f.normal))).toBe(0);}
});
it('100 translated and rotated coordinate frames enclose the model projection without moving their physical origin',()=>{
 let seed=528;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++){
 const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(rand()*6,rand()*6,rand()*6)),turn=(v:[number,number,number])=>new THREE.Vector3(...v).applyQuaternion(q).toArray() as [number,number,number];
 const f:PlaneFrame={origin:[rand()*300-150,rand()*300-150,rand()*300-150],xDir:turn([1,0,0]),yDir:turn([0,1,0]),normal:turn([0,0,1])},min=new THREE.Vector3(rand()*200-100,rand()*200-100,rand()*200-100),box=new THREE.Box3(min,min.clone().add(new THREE.Vector3(1+rand()*100,1+rand()*100,1+rand()*100))),c=referencePlaneCorners(f,box),o=new THREE.Vector3(...f.origin),center=c.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(.25);expect(center.distanceTo(o)).toBeLessThan(1e-10);
 const local=c.map(p=>p.clone().sub(o));for(const p of local)expect(Math.abs(p.dot(new THREE.Vector3(...f.normal)))).toBeLessThan(1e-10);
 for(let k=0;k<8;k++){const p=new THREE.Vector3(k&1?box.max.x:box.min.x,k&2?box.max.y:box.min.y,k&4?box.max.z:box.min.z).sub(o);for(const d of [f.xDir,f.yDir]){const axis=new THREE.Vector3(...d),projections=local.map(v=>v.dot(axis));expect(p.dot(axis)).toBeGreaterThan(Math.min(...projections));expect(p.dot(axis)).toBeLessThan(Math.max(...projections));}}
 }
});
it('has a finite origin-centred empty-scene fallback and rejects non-finite frame or bounds',()=>{
 expect(referencePlaneCorners(front,new THREE.Box3()).map(p=>p.toArray())).toEqual([[-50,-50,0],[50,-50,0],[50,50,0],[-50,50,0]]);
 expect(()=>referencePlaneCorners({...front,origin:[NaN,0,0]},new THREE.Box3())).toThrow();expect(()=>referencePlaneCorners({...front,xDir:[0,0,0]},new THREE.Box3())).toThrow();expect(()=>referencePlaneCorners(front,new THREE.Box3(new THREE.Vector3(),new THREE.Vector3(Infinity,1,1)))).toThrow();expect(()=>referencePlaneCorners(front,new THREE.Box3(new THREE.Vector3(-1e308,-1e308,-1e308),new THREE.Vector3(1e308,1e308,1e308)))).toThrow();
});
