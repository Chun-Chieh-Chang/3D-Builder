// await __extendRectangle.run();
// Real UI rectangle + outside lines. Shared ends continue without changing the rectangle or dimensions; one undo.
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
const H=window.__ui,{store}=H;
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const geometry=()=>store.getState().sketchSolve.geometry;
const unchanged=before=>{for(const [id,g]of before){const after=geometry().get(id);check(!!after,`original ${id} kept`);if(g.type==='point')check(Math.hypot(after.p[0]-g.p[0],after.p[1]-g.p[1])<1e-7,`original point ${id} stayed put`);else if(g.type==='line')check(Math.hypot(after.a[0]-g.a[0],after.a[1]-g.a[1],after.b[0]-g.b[0],after.b[1]-g.b[1])<1e-7,`original line ${id} stayed put`);}};
window.__extendRectangle={run:async()=>{
 H.ready();await H.action('檔案','新零件');await H.treeClick('前基準面');await H.action('草圖','草圖');await H.frameSketch(17,5,10);await H.tool('邊角矩形');await H.sk(0,0);await H.sk(20,10);await H.solved();
 const bottom=H.lineWhere(g=>Math.abs(g.a[1])<1e-6&&Math.abs(g.b[1])<1e-6),right=H.lineWhere(g=>Math.abs(g.a[0]-20)<1e-6&&Math.abs(g.b[0]-20)<1e-6);
 await H.dim([bottom],[10,-4],20);await H.dim([right],[24,5],10);
 for(const x of [30,40]) {await H.tool('直線');await H.sk(x,-5);await H.sk(x,15);await H.solved();await H.selectTool();}
 const initial=H.sketch(),before=new Map(geometry()),count=initial.entities.length;const values=initial.constraints.filter(c=>c.type==='distance').map(c=>[c.id,c.value]);
 // G08 (P2-5): a chosen boundary is crossed past a nearer target — pick the far line, then extend the rectangle edge; it reaches x=40 in one go
 const farLine=H.lineWhere(g=>Math.abs(g.a[0]-40)<1e-6&&Math.abs(g.b[0]-40)<1e-6);
 store.sketcher.select([farLine]);
 await H.tool('延伸');
 await H.sk(19,0);await store.sketcher.settled();await H.solved();
 const bridge=H.sketch().entities.find(e=>e.type==='line'&&!initial.entities.some(old=>old.id===e.id));
 check(!!bridge,'chosen-boundary continuation created');
 check(H.sketch().entities.length===count+2,'the chosen boundary adds one continuation only');
 const bridgeLine=geometry().get(bridge.id);
 check(Math.hypot(bridgeLine.a[0]-20,bridgeLine.a[1],bridgeLine.b[0]-40,bridgeLine.b[1])<1e-7,'continuation crosses the near target to the chosen far target');
 unchanged(before);
 for(const [id,value]of values)check(H.sketch().constraints.find(c=>c.id===id)?.value===value,'rectangle dimension kept across the boundary extension');
 store.undo();await H.solved();
 check(!H.sketch().entities.some(e=>e.id===bridge.id),'one undo removes the boundary extension');
 unchanged(before);
 await H.tool('延伸');await H.sk(19,0);await store.sketcher.settled();await H.solved();
 const after=H.sketch(),extension=after.entities.find(e=>e.type==='line'&&!initial.entities.some(old=>old.id===e.id));check(!!extension,'new shared-end continuation created');
 check(after.entities.length===count+2,'exactly a new endpoint and continuation added');unchanged(before);
 const line=geometry().get(extension.id);check(Math.hypot(line.a[0]-20,line.a[1],line.b[0]-30,line.b[1])<1e-7,'continuation reaches first external line');
 for(const [id,value]of values)check(after.constraints.find(c=>c.id===id)?.value===value,'original rectangle dimension kept');check(!['over','failed'].includes(store.getState().sketchSolve.status),'actual solver accepts extension');
 // Repeating on the original edge would duplicate the drawn continuation: reject and leave model unchanged.
 await H.sk(19,0);await store.sketcher.settled();await H.solved();check(H.sketch().entities.length===count+2,'duplicate extension refused');check(store.getState().notice?.text.includes('重疊'),'overlap explained');
 store.undo();await H.solved();check(!H.sketch().entities.some(e=>e.id===extension.id),'one undo removes entire operation');unchanged(before);
 store.redo();await H.solved();check(H.sketch().entities.some(e=>e.id===extension.id),'redo restores continuation');
 await H.sk(29,0);await store.sketcher.settled();await H.solved();const further=geometry().get(extension.id);check(Math.hypot(further.b[0]-40,further.b[1])<1e-7,'outer continuation extends to next target');unchanged(before);check(store.getState().notice?.text.includes('已延伸'),'successful extension replaces the earlier overlap notice');
 return {pass:true,rectangleWidth:20,rectangleHeight:10,firstTarget:30,nextTarget:40};
}};
