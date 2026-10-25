// await __explicitTangency.circles();
// await __explicitTangency.endpoints();
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
const H=window.__ui,{store}=H;
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const begin=async()=>{H.ready();await H.action('檔案','新零件');await H.treeClick('前基準面');await H.action('草圖','草圖');await H.frameSketch(10,10,10);store.setOptions({automaticRelations:false});};
const press=async label=>{const button=[...document.querySelectorAll('.relation-buttons button')].find(b=>b.textContent===label);check(!!button,`actual ${label} relation offered for multi-selection`);button.click();await store.sketcher.settled();await H.solved();};
window.__explicitTangency={circles:async()=>{
 for(const internal of [false,true]){await begin();for(const [x,y,r]of [[0,8,8],[internal?4:13,8,3]]){await H.tool('圓');await H.sk(x,y);await H.sk(x+r,y);await H.solved();}const ids=H.sketch().entities.filter(e=>e.type==='circle').map(e=>e.id);await H.selectTool();store.sketcher.select(ids);await H.wait(80);await press(internal?'內相切':'外相切');const [a,b]=ids.map(id=>store.getState().sketchSolve.geometry.get(id));check(Math.abs(Math.hypot(a.c[0]-b.c[0],a.c[1]-b.c[1])-(internal?Math.abs(a.r-b.r):a.r+b.r))<1e-7,'actual specified tangency');await H.exitSketch();}return{pass:true};
},endpoints:async()=>{
 await begin();await H.tool('直線');await H.sk(-10,0);await H.sk(0,0);await H.solved();await H.selectTool();await H.tool('中心點圓弧');await H.sk(0,6);await H.sk(1,1);await H.sk(5,6);await H.solved();await H.selectTool();const ids=H.sketch().entities.filter(e=>e.type==='line'||e.type==='arc').map(e=>e.id);store.sketcher.select(ids);await H.wait(80);await press('最近端點重合＋相切');
 const c=H.sketch().constraints.find(c=>c.type==='endpointTangent');check(c,'actual endpoint relation committed');const geometry=store.getState().sketchSolve.geometry,a=geometry.get(c.a),b=geometry.get(c.b),pa=c.aEnd==='start'?a.a:a.b,angle=c.bEnd==='start'?b.a0:b.a1,pb=[b.c[0]+b.r*Math.cos(angle),b.c[1]+b.r*Math.sin(angle)];check(Math.hypot(pa[0]-pb[0],pa[1]-pb[1])<1e-7,'actual endpoint coincidence');check(Math.abs((a.b[0]-a.a[0])*(pb[0]-b.c[0])+(a.b[1]-a.a[1])*(pb[1]-b.c[1]))<1e-7,'actual tangent derivative');store.undo();await H.solved();check(!H.sketch().constraints.some(c=>c.type==='endpointTangent'),'one undo removes join and tangent');return{pass:true};
}};
