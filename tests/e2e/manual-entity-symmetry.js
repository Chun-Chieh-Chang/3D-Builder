// await __entitySymmetry.axis();
// await __entitySymmetry.point();
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
const H=window.__ui,{store}=H;
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const begin=async()=>{H.ready();await H.action('檔案','新零件');await H.treeClick('前基準面');await H.action('草圖','草圖');await H.frameSketch(10,10,10);store.setOptions({automaticRelations:false});};
const press=async label=>{const button=[...document.querySelectorAll('.relation-buttons button')].find(b=>b.textContent===label);check(!!button,`actual ${label} relation offered for multi-selection`);button.click();await store.sketcher.settled();await H.solved();};
const circles=async()=>{await begin();for(const [x,y,r]of [[4,8,3],[6,-6,2]]){await H.tool('圓');await H.sk(x,y);await H.sk(x+r,y);await H.solved();}await H.selectTool();return H.sketch().entities.filter(e=>e.type==='circle').map(e=>e.id);};
window.__entitySymmetry={axis:async()=>{
 const ids=await circles();store.sketcher.select([...ids,'@axisH']);await H.wait(80);await press('圖元鏡射（最後選取為軸）');const [a,b]=ids.map(id=>store.getState().sketchSolve.geometry.get(id));check(Math.abs(a.c[0]-b.c[0])+Math.abs(a.c[1]+b.c[1])+Math.abs(a.r-b.r)<1e-7,'actual mirrored circle centers and radii');store.undo();await H.solved();check(!H.sketch().constraints.some(c=>c.type==='symmetricEntity'),'one undo removes entire symmetry');return{pass:true};
},point:async()=>{
 const ids=await circles();store.sketcher.select([...ids,'@origin']);await H.wait(80);await press('圖元點對稱（最後選取為中心）');const [a,b]=ids.map(id=>store.getState().sketchSolve.geometry.get(id));check(Math.hypot(a.c[0]+b.c[0],a.c[1]+b.c[1])+Math.abs(a.r-b.r)<1e-7,'actual point reflected circle centers and radii');return{pass:true};
}};
