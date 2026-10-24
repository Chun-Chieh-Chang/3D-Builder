// await __surfaceTools.run();
// D5: actual paired rails, planar radiation and plane-driven replacement from menus and PropertyManager.
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
window.__surfaceTools={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`});await H.open('plate.3dbx');
 const insert=feature=>store.execute({type:'insertFeature',index:store.getState().doc.features.length,feature});
 const points=[[100,100],[120,100],[120,112],[100,112]];
 insert({id:'toolBase',type:'sketch',name:'Surface rectangle',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[...points.map(([x,y],i)=>({id:'toolP'+i,type:'point',x,y})),...points.map((_,i)=>({id:'toolL'+i,type:'line',p1:'toolP'+i,p2:'toolP'+(i+1)%4}))],constraints:points.map((_,i)=>({id:'toolFix'+i,type:'fix',point:'toolP'+i}))});
 insert({id:'toolBoss',type:'extrude',name:'Surface block',suppressed:false,sketch:'toolBase',op:'boss',merge:false,dir1:{type:'blind',depth:'10'}});
 insert({id:'toolTarget',type:'refPlane',name:'Replacement plane',suppressed:false,def:{mode:'offset',plane:{kind:'datum',name:'plane:front'},distance:'13'}});
 await H.waitFor(()=>!store.getState().rebuilding&&store.getState().result?.frames.has('toolTarget'),20000,'actual block');
 const r=store.getState().result,edgeAt=z=>{const i=r.edgeFingerprints.findIndex(f=>f.type==='line'&&Math.abs(f.center[0]-110)<1e-6&&Math.abs(f.center[1]-100)<1e-6&&Math.abs(f.center[2]-z)<1e-6);H.check(i>=0,'actual horizontal rail');return {kind:'edge',name:r.edgeNames[i],fingerprint:r.edgeFingerprints[i]};};
 const a=edgeAt(0),b=edgeAt(10),feature=type=>store.getState().doc.features.find(f=>f.type===type);
 const ok=async type=>H.waitFor(()=>!store.getState().rebuilding&&store.getState().result?.features.find(x=>x.id===feature(type)?.id)?.status==='ok',20000,type+' rebuilt');
 store.selectElements([a,b],false);await H.action('特徵','直紋曲面');
 document.querySelector('.property-manager input[type="checkbox"]').click();await ok('ruledSurface');
 document.querySelector('.pm-ok').click();await H.waitFor(()=>!store.getState().editing,5000,'accept ruled');
 H.check(store.getState().result.bodies.find(b=>b.id===feature('ruledSurface').id)?.surface,'real surface body');
 store.selectElements([a],false);await H.action('特徵','放射曲面');await ok('radiatedSurface');document.querySelector('.pm-ok').click();
 await H.waitFor(()=>!store.getState().editing,5000,'accept radiation');
 const i=store.getState().result.faceNames.indexOf('toolBoss:cap:end');store.selectFace({kind:'face',name:'toolBoss:cap:end',fingerprint:store.getState().result.faceFingerprints[i]});
 await H.action('特徵','取代面');const select=document.querySelector('.property-manager select');select.value='toolTarget';select.dispatchEvent(new Event('change',{bubbles:true}));await ok('replaceFace');
 H.check(Math.abs(store.getState().result.bodies.find(b=>b.id==='toolBoss').volume-20*12*13)<1e-5,'replacement changes real solid volume');
 document.querySelector('.pm-ok').click();await H.waitFor(()=>!store.getState().editing,5000,'accept replacement');store.undo();
 await H.waitFor(()=>!store.getState().rebuilding&&Math.abs(store.getState().result.bodies.find(b=>b.id==='toolBoss').volume-2400)<1e-5,20000,'one undo restores solid');
 return {pass:true};
}};
