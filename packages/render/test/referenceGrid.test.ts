import { expect, it } from 'vitest';
import * as THREE from 'three';
import type { PlaneFrame } from '../src/overlay';
import { GRID_MID_OPACITY, GRID_MIN_PIXELS, referenceGrid, type GridLevel } from '../src/referenceGrid';
function camera(dir:THREE.Vector3,half=50,target=new THREE.Vector3()){
 const c=new THREE.OrthographicCamera(-half*1.5,half*1.5,half,-half,0.1,1e7);c.position.copy(target).addScaledVector(dir,10000);if(Math.abs(dir.y)>0.9)c.up.set(0,0,-1);c.lookAt(target);c.updateProjectionMatrix();c.updateMatrixWorld();return c;
}
const all=(g:GridLevel[])=>g.flatMap(l=>l.positions);
it('keeps the XY work plane through all camera directions, including edge-on views',()=>{
 for(const axis of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[1,1,1]]){
 const g=referenceGrid(camera(new THREE.Vector3(...axis).normalize()),720,5);
 if(axis[2]===0){expect(g).toEqual([]);continue;}
 const p=all(g);expect(p.length).toBeGreaterThan(0);for(let i=2;i<p.length;i+=3)expect(p[i]).toBe(0);
 }
});
it('100 seeded zoom/pan/orbit configurations keep finite bounded line geometry without modifying the camera',()=>{
 let seed=8234;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<100;i++){
 const d=new THREE.Vector3(rand()-.5,rand()-.5,rand()-.5).normalize(),c=camera(d,10**(1+rand()*5),new THREE.Vector3(rand()*1000,rand()*1000,rand()*1000));const before=[...c.matrixWorld.elements,...c.projectionMatrix.elements];
 const g=referenceGrid(c,480+rand()*1440,.5+rand()*10),p=all(g);expect(p.length).toBeGreaterThan(0);expect(p.length/6).toBeLessThanOrEqual(600);expect(p.every(Number.isFinite)).toBe(true);expect(g.every(l=>l.opacity>=0&&l.opacity<=1)).toBe(true);expect([...c.matrixWorld.elements,...c.projectionMatrix.elements]).toEqual(before);
 }
});
it('refuses invalid spacing or viewport height without unbounded loops or invalid GPU coordinates',()=>{
 const c=camera(new THREE.Vector3(0,0,1));for(const n of [0,-1,NaN,Infinity]){expect(referenceGrid(c,720,n)).toEqual([]);expect(referenceGrid(c,n,5)).toEqual([]);}
 for(const zoom of [0,-1,NaN,Infinity]){c.zoom=zoom;c.updateProjectionMatrix();expect(all(referenceGrid(c,720,5)).every(Number.isFinite)).toBe(true);}
});

it('200 orbit configurations cross the old dominant-axis thresholds on an offset, rotated work plane',()=>{
 const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.4,.7,.2)),vec=(v:number[])=>new THREE.Vector3(...v).applyQuaternion(rotation).toArray() as [number,number,number];
 const f:PlaneFrame={origin:[17,-23,41],xDir:vec([1,0,0]),yDir:vec([0,1,0]),normal:vec([0,0,1])};
 for(let i=0;i<200;i++){
 const angle=i*Math.PI/99.5,d=new THREE.Vector3(Math.sin(angle),.35,Math.cos(angle)).normalize(),c=camera(d,60,new THREE.Vector3(...f.origin)),g=referenceGrid(c,720,5,f),p=all(g);
 expect(p.length).toBeGreaterThan(0);expect(p.length/6).toBeLessThanOrEqual(600);
 for(let j=0;j<p.length;j+=6){const a=new THREE.Vector3(...p.slice(j,j+3)).sub(new THREE.Vector3(...f.origin)),b=new THREE.Vector3(...p.slice(j+3,j+6)).sub(new THREE.Vector3(...f.origin));expect(a.dot(new THREE.Vector3(...f.normal))).toBeCloseTo(0,7);expect(b.dot(new THREE.Vector3(...f.normal))).toBeCloseTo(0,7);const delta=b.sub(a);expect(Math.min(Math.abs(delta.dot(new THREE.Vector3(...f.xDir))),Math.abs(delta.dot(new THREE.Vector3(...f.yDir))))).toBeLessThan(1e-7);}
 }
});
it('rejects invalid plane frames rather than falling back to a camera-facing plane',()=>{
 const c=camera(new THREE.Vector3(0,0,1)),f={origin:[0,0,0],xDir:[1,0,0],yDir:[0,1,0],normal:[0,0,1]};
 for(const bad of [{...f,origin:[NaN,0,0]},{...f,xDir:[0,0,0]},{...f,normal:[0,1,0]},{...f,yDir:[1,0,0]}])expect(referenceGrid(c,720,5,bad as PlaneFrame)).toEqual([]);
});

// The user's report: zooming out, the cells first shrink on screen, then jump coarser again. Every line keeps its world position across
// zoom, so "never coarser on screen" means: as the view zooms out, no line already in view appears or gets darker, and none changes its
// opacity by more than a sliver per 1 % step (no jump). Swept over six decades of zoom, in the isometric view of the report and from above.
it('zooming out across six decades only fades lines, continuously, with the finest cells between fixed pixel bounds',()=>{
 for(const [dir,spacing,height,bounded] of [[new THREE.Vector3(1,1,1),5,720,true],[new THREE.Vector3(0,0,1),5,830,true],[new THREE.Vector3(-1,2,.6),.5,1440,false]] as const){
  const c=camera(dir.clone().normalize(),50);let previous:Map<string,number>|null=null,bounds:number[]=[],steps=0,levelChanges=0,lastStep=0;
  for(let zoom=1;zoom>1e-5;zoom*=0.99){
   c.zoom=zoom;c.updateProjectionMatrix();const g=referenceGrid(c,height,spacing);expect(g.length).toBe(3);expect(all(g).length/6).toBeLessThanOrEqual(1202);
   const px=(c.top-c.bottom)/(c.zoom*height),finest=g[0]!.step/px;
   // The finest drawn cells are never closer than GRID_MIN_PIXELS; once past the user's spacing they stay under ten times that (a grazing
   // view is instead held to 400 lines an axis, so its screen-height bound does not apply).
   expect(finest).toBeGreaterThanOrEqual(GRID_MIN_PIXELS*(1-1e-9));if(bounded&&g[0]!.step>spacing*1.0001)expect(finest).toBeLessThanOrEqual(10*GRID_MIN_PIXELS*(1+1e-9));
   expect(g[0]!.opacity).toBeLessThanOrEqual(GRID_MID_OPACITY+1e-12);expect(g[1]!.opacity).toBeGreaterThanOrEqual(GRID_MID_OPACITY-1e-12);expect(g[2]!.opacity).toBe(1);
   if(lastStep&&g[0]!.step!==lastStep){levelChanges++;expect(g[0]!.step/lastStep).toBeCloseTo(10,9);}lastStep=g[0]!.step;
   // Lines keyed by axis and index in units of the user's spacing (x = const lines have equal x at both ends on the XY plane).
   const now=new Map<string,number>(),lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
   for(const l of g)for(let j=0;j<l.positions.length;j+=6){const p=l.positions,a=Math.abs(p[j]!-p[j+3]!)<Math.abs(p[j+1]!-p[j+4]!)?0:1,v=p[j+a]!;now.set(a+':'+Math.round(v/spacing),l.opacity);lo[a]=Math.min(lo[a]!,v);hi[a]=Math.max(hi[a]!,v);}
   if(previous){for(const [key,opacity] of now){const was=previous.get(key),[a,i]=key.split(':').map(Number),v=i!*spacing;
    if(was===undefined){if(v>bounds[2*a!]!&&v<bounds[2*a!+1]!)expect(opacity,`line ${key} appeared inside the view at zoom ${zoom}`).toBeLessThanOrEqual(0.02);continue;}
    expect(opacity,`line ${key} darkened at zoom ${zoom}`).toBeLessThanOrEqual(was+1e-9);expect(was-opacity,`line ${key} jumped at zoom ${zoom}`).toBeLessThanOrEqual(0.02);}
    for(const [key,was] of previous)if(!now.has(key)){const [a,i]=key.split(':').map(Number),v=i!*spacing;if(v>lo[a!]!&&v<hi[a!]!)expect(was,`line ${key} vanished at zoom ${zoom}`).toBeLessThanOrEqual(0.02);}}
   previous=now;bounds=[lo[0]!,hi[0]!,lo[1]!,hi[1]!];steps++;
  }
  expect(steps).toBeGreaterThan(1000);expect(levelChanges).toBeGreaterThanOrEqual(4);
 }
});
