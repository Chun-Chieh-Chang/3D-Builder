import { expect, it } from 'vitest';
import * as THREE from 'three';
import type { PlaneFrame } from '../src/overlay';
import { referenceGrid } from '../src/referenceGrid';
function camera(dir:THREE.Vector3,half=50,target=new THREE.Vector3()){
 const c=new THREE.OrthographicCamera(-half*1.5,half*1.5,half,-half,0.1,1e7);c.position.copy(target).addScaledVector(dir,10000);if(Math.abs(dir.y)>0.9)c.up.set(0,0,-1);c.lookAt(target);c.updateProjectionMatrix();c.updateMatrixWorld();return c;
}
it('keeps the XY work plane through all camera directions, including edge-on views',()=>{
 for(const axis of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,1]]){
 const g=referenceGrid(camera(new THREE.Vector3(...axis).normalize()),720,5);
 if(axis[2]===0){expect(g).toEqual({minor:[],major:[]});continue;}
 expect(g.minor.length+g.major.length).toBeGreaterThan(0);for(const p of [g.minor,g.major])for(let i=2;i<p.length;i+=3)expect(p[i]).toBe(0);
 }
});
it('100 seeded zoom/pan/orbit configurations keep finite bounded line geometry without modifying the camera',()=>{
 let seed=8234;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++){
 const d=new THREE.Vector3(rand()-.5,rand()-.5,rand()-.5).normalize(),c=camera(d,10**(1+rand()*5),new THREE.Vector3(rand()*1000,rand()*1000,rand()*1000));const before=[...c.matrixWorld.elements,...c.projectionMatrix.elements];
 const g=referenceGrid(c,480+rand()*1440,.5+rand()*10);expect(g.minor.length+g.major.length).toBeGreaterThan(0);expect((g.minor.length+g.major.length)/6).toBeLessThanOrEqual(600);expect([...g.minor,...g.major].every(Number.isFinite)).toBe(true);expect([...c.matrixWorld.elements,...c.projectionMatrix.elements]).toEqual(before);
 }
});
it('refuses invalid spacing or viewport height without unbounded loops or invalid GPU coordinates',()=>{
 const c=camera(new THREE.Vector3(0,0,1));for(const n of [0,-1,NaN,Infinity]){expect(referenceGrid(c,720,n)).toEqual({minor:[],major:[]});expect(referenceGrid(c,n,5)).toEqual({minor:[],major:[]});}
});

it('200 orbit configurations cross the old dominant-axis thresholds on an offset, rotated work plane',()=>{
 const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.4,.7,.2)),vec=(v:number[])=>new THREE.Vector3(...v).applyQuaternion(rotation).toArray() as [number,number,number];
 const f:PlaneFrame={origin:[17,-23,41],xDir:vec([1,0,0]),yDir:vec([0,1,0]),normal:vec([0,0,1])};
 for(let i=0;i<200;i++){
 const angle=i*Math.PI/99.5,d=new THREE.Vector3(Math.sin(angle),.35,Math.cos(angle)).normalize(),c=camera(d,60,new THREE.Vector3(...f.origin)),g=referenceGrid(c,720,5,f);
 expect(g.minor.length+g.major.length).toBeGreaterThan(0);expect((g.minor.length+g.major.length)/6).toBeLessThanOrEqual(600);
 for(const lines of [g.minor,g.major])for(let j=0;j<lines.length;j+=6){const a=new THREE.Vector3(...lines.slice(j,j+3)).sub(new THREE.Vector3(...f.origin)),b=new THREE.Vector3(...lines.slice(j+3,j+6)).sub(new THREE.Vector3(...f.origin));expect(a.dot(new THREE.Vector3(...f.normal))).toBeCloseTo(0,7);expect(b.dot(new THREE.Vector3(...f.normal))).toBeCloseTo(0,7);const delta=b.sub(a);expect(Math.min(Math.abs(delta.dot(new THREE.Vector3(...f.xDir))),Math.abs(delta.dot(new THREE.Vector3(...f.yDir))))).toBeLessThan(1e-7);}
 }
});
it('rejects invalid plane frames rather than falling back to a camera-facing plane',()=>{
 const c=camera(new THREE.Vector3(0,0,1)),f={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
 for(const bad of [{...f,origin:[NaN,0,0]},{...f,xDir:[0,0,0]},{...f,normal:[0,1,0]},{...f,yDir:[1,0,0]}])expect(referenceGrid(c,720,5,bad as PlaneFrame)).toEqual({minor:[],major:[]});
});
