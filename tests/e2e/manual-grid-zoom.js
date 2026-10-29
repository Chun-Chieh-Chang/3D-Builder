// await __gridZoom.part();
// await __gridZoom.assembly();
// The report: in the isometric view, zooming out with the wheel first shrinks the grid cells on screen and then makes them coarser again.
// The rendered grid is read back after every real wheel turn: no line already in view may appear or get darker while zooming out, and none
// may change its opacity by more than a sliver per turn (the old 1-2-5 ladder dropped every minor line at once at each threshold).
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H,B=await import(`${root}tests/phase1/builders.ts`),io=await import(`${root}packages/io/src/index.ts`);
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
 return{turns,zoom:v().camera.zoom/startZoom};
}
M.part=async()=>{await setup();const doc=state().doc;const r=await zoomOut('grid-zoom-part');must(state().doc===doc,'zoom does not change the document');return{pass:true,...r};};
M.assembly=async()=>{
 await setup();await H.action('檔案','新組合件');if(state().folderRequest)await H.modalButton('選擇資料夾…');const c=await H.insert('網格縮放.3dbx');await H.loaded();
 const r=await zoomOut('grid-zoom-assembly');must(Math.abs(store.assembly.buildOf(c.id).mass.volume-Math.PI*64*100)<1e-5,'assembly native material unchanged');await H.save('網格縮放組合.3dba');return{pass:true,...r};
};
