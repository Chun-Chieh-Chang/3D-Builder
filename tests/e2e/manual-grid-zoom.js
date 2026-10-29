// await __gridZoom.part();
// await __gridZoom.assembly();
// The report: in the isometric view, zooming out with the wheel first shrinks the grid cells on screen and then makes them coarser again.
// The rendered grid is read back after every real wheel turn: no line already in view may appear or get darker while zooming out, and none
// may change its opacity by more than a sliver per turn (the old 1-2-5 ladder dropped every minor line at once at each threshold).
// At the wheel's limit the picture must show every line the grid draws, all over the screen (the fixed near and far planes cut it into a band there).
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H,B=await import(`${root}tests/phase1/builders.ts`),io=await import(`${root}packages/io/src/index.ts`),{ZOOM_RANGE}=await import(`${root}packages/render/src/viewNav.ts`),{GRID_MID_OPACITY}=await import(`${root}packages/render/src/referenceGrid.ts`);
const M=window.__gridZoom={},state=()=>store.getState(),v=()=>store.viewer,must=(x,why)=>{if(!x)throw new Error(why);};
// A shaft like the report's: 100 mm long, lying on the XY grid plane.
const fixture=()=>B.build(B.sketch('s',B.front,B.circle('c',0,0,8)),B.extrude('e','s','boss',{type:'blind',depth:'100'}));
async function setup(){H.ready();if(state().recovery)store.discardRecovery();await H.project({});await H.writeAt('網格縮放.3dbx',await io.writePartFile(fixture()));await H.open('網格縮放.3dbx');await H.settle();must(Math.abs(state().result.mass.volume-Math.PI*64*100)<1e-5,'actual native shaft');}
/** The grid as drawn: each line keyed by axis and index in the user's spacing, with its material opacity. */
function drawn(){
 const f=v().gridFrame,spacing=v().gridSpacing,lines=new Map(),lo=[Infinity,Infinity],hi=[-Infinity,-Infinity],dot=(p,d)=>p.reduce((s,x,i)=>s+(x-f.origin[i])*d[i],0);
 must(JSON.stringify(f.normal)==='[0,0,1]','default XY work plane');
 for(const child of v().gridGroup.children){const p=child.geometry.getAttribute('position').array,o=child.material.opacity;must(o>=0&&o<=1,'opacity in range');for(let i=0;i<p.length;i+=6){const a=[p[i],p[i+1],p[i+2]],b=[p[i+3],p[i+4],p[i+5]],u=[dot(a,f.xDir),dot(b,f.xDir)],w=[dot(a,f.yDir),dot(b,f.yDir)],axis=Math.abs(u[0]-u[1])<Math.abs(w[0]-w[1])?0:1,at=axis?w[0]:u[0];lines.set(axis+':'+Math.round(at/spacing),o);lo[axis]=Math.min(lo[axis],at);hi[axis]=Math.max(hi[axis],at);}}
 return{lines,lo,hi,spacing};
}
async function zoomOut(label){
 v().setView('iso');await H.wait(100);v().fitAll();await H.wait(150);
 const r=H.rect(),x=r.left+r.width/2,y=r.top+r.height/2;let previous=drawn(),turns=0,problems=[];const startZoom=v().camera.zoom;
 await window.__shot?.(label+'-0');
 // From the fitted view down to the wheel's limit (ZOOM_RANGE.min), one real wheel turn at a time, toward the middle of the view.
 for(let i=1;i<=340&&v().camera.zoom>2e-3;i++){
  H.canvas().dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:20,clientX:x,clientY:y}));for(let f=0;f<2;f++)await new Promise(requestAnimationFrame);turns++;
  const now=drawn();
  for(const [key,o] of now.lines){const was=previous.lines.get(key),[a,n]=key.split(':').map(Number),at=n*now.spacing;
   if(was===undefined){if(at>previous.lo[a]&&at<previous.hi[a]&&o>.02)problems.push(`${key} appeared at ${o}`);continue;}
   if(o>was+1e-9)problems.push(`${key} darkened ${was}→${o}`);if(was-o>.02)problems.push(`${key} jumped ${was}→${o}`);}
  for(const [key,was] of previous.lines)if(!now.lines.has(key)){const [a,n]=key.split(':').map(Number),at=n*now.spacing;if(at>now.lo[a]&&at<now.hi[a]&&was>.02)problems.push(`${key} vanished from ${was}`);}
  must(problems.length===0,`turn ${i}, zoom ${v().camera.zoom}: ${problems.slice(0,4).join('; ')}`);
  previous=now;if(i%60===0)await window.__shot?.(`${label}-${i}`);
 }
 const steps=new Set(v().gridGroup.children.map(c=>c.material.opacity));must(steps.size>=2,'faded levels drawn');
 must(v().camera.zoom<startZoom*3e-3,'zoomed out more than two and a half decades: '+v().camera.zoom/startZoom);await window.__shot?.(label+'-end');
 // On to the wheel's very limit: the fixed ±1e5 near and far planes cut the grid there into a band across the screen.
 for(let i=0;i<60&&v().camera.zoom>ZOOM_RANGE.min;i++){H.canvas().dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:20,clientX:x,clientY:y}));for(let f=0;f<2;f++)await new Promise(requestAnimationFrame);turns++;}
 must(v().camera.zoom===ZOOM_RANGE.min,'at the wheel limit: '+v().camera.zoom);
 const cover=await coverage();await window.__shot?.(label+'-limit');
 must(cover.samples>2000&&cover.quadrants.every(n=>n>200),'grid sampled all over the screen: '+JSON.stringify(cover));
 must(cover.drawn/cover.samples>=0.99&&cover.worst>=0.95,'grid fills the view at the wheel limit: '+JSON.stringify(cover));
 return{turns,zoom:v().camera.zoom/startZoom,limitCover:cover.drawn/cover.samples};
}
async function pixels(){const blob=await v().snapshot();must(blob?.size>0,'real WebGL PNG');const im=await createImageBitmap(blob),c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);im.close();return{width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data};}
/**
 * Where the drawn grid says a line is, the picture must show it. Every line of at least the middle level's opacity is followed across the screen (the inner
 * 97 %) and the rendered picture compared with one drawn without the grid: a line the near or far plane cuts away leaves the two the same there.
 */
async function coverage(){
 const cam=v().camera,spacing=v().gridSpacing;cam.updateMatrixWorld();
 const on=await pixels();v().setGridVisible(false,spacing);const off=await pixels();v().setGridVisible(true,spacing);
 must(on.width===off.width&&on.height===off.height,'same picture size');
 const W=cam.matrixWorldInverse.elements,P=cam.projectionMatrix.elements,mul=(m,p)=>[0,1,2,3].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]*p[3]);
 const ndc=p=>{const q=mul(P,mul(W,[...p,1]));return[q[0]/q[3],q[1]/q[3],q[2]/q[3]];};
 const shows=(X,Y)=>{for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const i=((Y+dy)*on.width+X+dx)*4;for(let k=0;k<3;k++)if(Math.abs(on.data[i+k]-off.data[i+k])>=6)return true;}return false;};
 let samples=0,drawn=0,worst=1,lines=0;const quadrants=[0,0,0,0],edge=.97;
 for(const child of v().gridGroup.children){if(child.material.opacity<GRID_MID_OPACITY)continue;const p=child.geometry.getAttribute('position').array;
  for(let i=0;i<p.length;i+=6){const a=ndc([p[i],p[i+1],p[i+2]]),b=ndc([p[i+3],p[i+4],p[i+5]]);let t0=0,t1=1;
   // the part of the segment inside the inner screen
   for(const k of [0,1]){const d=b[k]-a[k];if(Math.abs(d)<1e-12){if(Math.abs(a[k])>edge)t1=-1;continue;}const s=(-edge-a[k])/d,e=(edge-a[k])/d;t0=Math.max(t0,Math.min(s,e));t1=Math.min(t1,Math.max(s,e));}
   if(t1-t0<1e-6)continue;lines++;let hit=0,n=0;
   for(let j=0;j<=256;j++){const t=t0+(t1-t0)*j/256,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,X=Math.round((x+1)/2*on.width),Y=Math.round((1-y)/2*on.height);n++;if(shows(X,Y))hit++;quadrants[(x>0?1:0)+(y>0?2:0)]++;}
   samples+=n;drawn+=hit;worst=Math.min(worst,hit/n);}
 }
 return{lines,samples,drawn,worst,quadrants,near:cam.near,far:cam.far};
}
M.part=async()=>{await setup();const doc=state().doc;const r=await zoomOut('grid-zoom-part');must(state().doc===doc,'zoom does not change the document');return{pass:true,...r};};
M.assembly=async()=>{
 await setup();await H.action('檔案','新組合件');if(state().folderRequest)await H.modalButton('選擇資料夾…');const c=await H.insert('網格縮放.3dbx');await H.loaded();
 const r=await zoomOut('grid-zoom-assembly');must(Math.abs(store.assembly.buildOf(c.id).mass.volume-Math.PI*64*100)<1e-5,'assembly native material unchanged');await H.save('網格縮放組合.3dba');return{pass:true,...r};
};
