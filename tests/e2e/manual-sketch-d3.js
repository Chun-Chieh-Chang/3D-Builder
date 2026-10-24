// await __sketchD3.run();
// D3: real cylinder apparent contours into a sketch; actual relation buttons and solver.
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
window.__sketchD3={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`});await H.open('plate.3dbx');
 const insert=feature=>store.execute({type:'insertFeature',index:store.getState().doc.features.length,feature});
 insert({id:'d3base',type:'sketch',name:'D3 circle',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[{id:'d3c',type:'point',x:100,y:100},{id:'d3circle',type:'circle',center:'d3c',radius:5}],constraints:[{id:'d3fix',type:'fix',point:'d3c'},{id:'d3rad',type:'radius',circle:'d3circle',value:'5'}]});
 insert({id:'d3boss',type:'extrude',name:'D3 cylinder',suppressed:false,sketch:'d3base',op:'boss',merge:false,dir1:{type:'blind',depth:'10'}});
 await H.waitFor(()=>!store.getState().rebuilding&&store.getState().result?.faceNames.some(n=>n.startsWith('d3boss:side:')),20000,'real cylinder');
 insert({id:'d3sketch',type:'sketch',name:'D3 contour',suppressed:false,plane:{kind:'datum',name:'plane:right'},entities:[],constraints:[]});
 await H.waitFor(()=>store.getState().result?.frames.has('d3sketch'),20000,'sketch frame');store.beginEdit('d3sketch');
 await H.waitFor(()=>store.getState().sketchSolve,10000,'sketch solve');await H.action('草圖','側影輪廓線');
 const r=store.getState().result,i=r.faceNames.findIndex(n=>n.startsWith('d3boss:side:'));
 store.pick({kind:'face',name:r.faceNames[i],fingerprint:r.faceFingerprints[i]});
 await H.waitFor(()=>store.editedSketch().entities.some(e=>e.ref?.silhouette!==undefined),10000,'native HLR curves added');
 const curves=store.editedSketch().entities.filter(e=>e.ref?.silhouette!==undefined);H.check(curves.length===2&&curves.every(e=>e.type==='line'),'two actual cylindrical generators');
 store.undo();await H.wait(100);H.check(!store.editedSketch().entities.some(e=>e.ref?.silhouette!==undefined),'one undo removes both contours');store.redo();
 store.sketcher.setTool('select');store.execute({type:'addSketchItems',featureId:'d3sketch',entities:[{id:'d3a',type:'point',x:20,y:20},{id:'d3b',type:'point',x:30,y:20},{id:'d3center',type:'point',x:25,y:25}],constraints:[]});
 await H.waitFor(()=>store.getState().sketchSolve?.geometry.has('d3center'),10000,'real points');store.sketcher.select(['d3a','d3b','d3center']);await H.wait(80);
 const button=[...document.querySelectorAll('.property-manager button')].find(b=>b.textContent.includes('對稱於一點'));H.check(!!button,'point symmetry offered');button.click();
 await H.waitFor(()=>store.editedSketch().constraints.some(c=>c.type==='symmetricPoint'),5000,'point symmetry command');
 H.check(store.getState().sketchSolve.status!=='failed','solver accepts point symmetry');store.commitEdit();
 return {pass:true,curves:curves.length};
}};
