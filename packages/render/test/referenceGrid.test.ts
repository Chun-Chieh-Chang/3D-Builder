import { expect, it } from 'vitest';
import * as THREE from 'three';
import { referenceGrid } from '../src/referenceGrid';
function camera(dir:THREE.Vector3,half=50,target=new THREE.Vector3()){
 const c=new THREE.OrthographicCamera(-half*1.5,half*1.5,half,-half,0.1,1e7);c.position.copy(target).addScaledVector(dir,10000);if(Math.abs(dir.y)>0.9)c.up.set(0,0,-1);c.lookAt(target);c.updateProjectionMatrix();c.updateMatrixWorld();return c;
}
it('supplies origin-anchored grid lines in every principal view and isometric, with no edge-on disappearance',()=>{
 for(const axis of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,1]]){
 const c=camera(new THREE.Vector3(...axis).normalize()),g=referenceGrid(c,720,5);expect(g.minor.length+g.major.length).toBeGreaterThan(0);expect([...g.minor,...g.major].every(Number.isFinite)).toBe(true);expect(g.major.length).toBeGreaterThan(0);
 const normal=axis.every(v=>v===1)?2:axis.findIndex(v=>v!==0);for(const p of [g.minor,g.major])for(let i=normal;i<p.length;i+=3)expect(p[i]).toBe(0);
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
