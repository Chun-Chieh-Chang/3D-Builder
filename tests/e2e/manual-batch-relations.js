// await __batchRelations.lines();
// await __batchRelations.circles();
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
const H=window.__ui,{store}=H;
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const begin=async()=>{H.ready();await H.action('檔案','新零件');await H.treeClick('前基準面');await H.action('草圖','草圖');await H.frameSketch(10,10,10);store.setOptions({automaticRelations:false});};
const press=async label=>{const button=[...document.querySelectorAll('.relation-buttons button')].find(b=>b.textContent===label);check(!!button,`actual ${label} relation offered for multi-selection`);button.click();await store.sketcher.settled();await H.solved();};
window.__batchRelations={lines:async()=>{
 await begin();for(const [y,length]of [[0,10],[10,6],[20,4]]){await H.tool('直線');await H.sk(0,y);await H.sk(length,y);await H.solved();await H.selectTool();}
 const ids=H.sketch().entities.filter(e=>e.type==='line').map(e=>e.id);await H.dim([ids[0]],[5,-4],10);await H.selectTool();store.sketcher.select(ids);await H.wait(80);await press('平行');
 check(H.sketch().constraints.filter(c=>c.type==='parallel').length===2,'minimal two parallel links for three lines');await press('相等');
 check(H.sketch().constraints.filter(c=>c.type==='equal').length===2,'minimal two equality links');
 const geometry=store.getState().sketchSolve.geometry;for(const id of ids){const g=geometry.get(id);check(Math.abs(Math.hypot(g.b[0]-g.a[0],g.b[1]-g.a[1])-10)<1e-7,'actual line length 10');}check(!['over','failed'].includes(store.getState().sketchSolve.status),'real batch solves');
 store.undo();await H.solved();check(H.sketch().constraints.filter(c=>c.type==='equal').length===0&&H.sketch().constraints.filter(c=>c.type==='parallel').length===2,'one undo removes only the entire last equality batch');return {pass:true};
},circles:async()=>{
 await begin();for(let i=0;i<3;i++){await H.tool('圓');await H.sk(i*10,8);await H.sk(i*10+3+i,8);await H.solved();}
 const ids=H.sketch().entities.filter(e=>e.type==='circle').map(e=>e.id);await H.dim([ids[0]],[-5,2],6);await H.selectTool();store.sketcher.select(ids);await H.wait(80);await press('同心同徑');
 check(H.sketch().constraints.filter(c=>c.type==='concentric').length===2&&H.sketch().constraints.filter(c=>c.type==='equal').length===2,'nonredundant center/radius forest');
 const circles=ids.map(id=>store.getState().sketchSolve.geometry.get(id));for(const g of circles){check(Math.hypot(g.c[0]-circles[0].c[0],g.c[1]-circles[0].c[1])<1e-7,'actual centers coincide');check(Math.abs(g.r-3)<1e-7,'actual equal radii follow dimension');}
 check(!['over','failed'].includes(store.getState().sketchSolve.status),'actual coradial batch accepted');check(![...document.querySelectorAll('.relation-buttons button')].some(b=>b.textContent==='同心同徑'),'already implied batch is no longer offered');return {pass:true};
}};
