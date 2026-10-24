// await __dimensionLineDrag.sketch();
// await __dimensionLineDrag.drawing();
// Real pointer drags of dimension lines and numbers, measured geometry unchanged and one-step undo.
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
await import(here+'phase2-assembly.js?'+Date.now());
const S=window.__ui,H=window.__ui2,{store}=H;
const root=here.replace(/tests\/e2e\/$/,'');
const {layoutDimension,mid}=await import(root+'packages/sketch/src/interact.ts');
const check=(ok,why)=>{if(!ok)throw new Error(why);};
const near=(a,b)=>Math.abs(a-b)<0.06;
window.__dimensionLineDrag={sketch:async()=>{
 S.ready();await S.action('檔案','新零件');await S.treeClick('上基準面');await S.action('草圖','草圖');await S.frameSketch(0,0,8);
 await S.tool('邊角矩形');await S.sk(-12,-6);await S.sk(12,6);await S.solved();
 const line=S.lineWhere(g=>Math.abs(g.a[1]-g.b[1])<1e-4&&g.a[1]<0);await S.dim([line],[0,-12],24);store.sketcher.setTool('select');
 const dim=S.sketch().constraints.find(c=>c.type==='distance'&&c.a===line),before=JSON.stringify([...store.getState().sketchSolve.geometry]);
 const geometry=store.getState().sketchSolve.geometry,px=store.viewer.pixelSize();
 const pts=[...geometry.values()].filter(g=>g.type==='point').map(g=>g.p),center=[pts.reduce((n,p)=>n+p[0],0)/pts.length,pts.reduce((n,p)=>n+p[1],0)/pts.length];
 const first=layoutDimension(dim,geometry,px,center),from=mid(...first.segments[2]);
 const a=S.toClient(...from),b=S.toClient(from[0]+3,from[1]-4);
 S.ptr('pointerdown',a.x,a.y);for(let i=1;i<=4;i++){S.ptr('pointermove',a.x+(b.x-a.x)*i/4,a.y+(b.y-a.y)*i/4,{buttons:1});await S.wait(30);}
 check(!!store.sketcher.getView().dimensionDrag,'line drag shows live dimension preview');
 check(!S.sketch().constraints.find(c=>c.id===dim.id).labelPosition,'preview does not commit history');S.ptr('pointerup',b.x,b.y);await S.solved();
 const after=S.sketch().constraints.find(c=>c.id===dim.id),moved=layoutDimension(after,store.getState().sketchSolve.geometry,px,center);
 check(near(moved.segments[2][0][1]-first.segments[2][0][1],-4),'actual dimension line moved 4 mm');check(after.value===dim.value,'driving dimension unchanged');
 check(JSON.stringify([...store.getState().sketchSolve.geometry])===before,'actual solved geometry unchanged');
 store.undo();await S.solved();check(!S.sketch().constraints.find(c=>c.id===dim.id).labelPosition,'one undo restores line layout');
 // Numeric text still drags, and now moves its dimension line too.
 const label=store.viewer.labels.get('dim:'+dim.id).el,r=label.getBoundingClientRect(),target=S.toClient(10,-16);
 label.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,buttons:1,bubbles:true}));
 window.dispatchEvent(new PointerEvent('pointermove',{clientX:target.x,clientY:target.y,buttons:1,bubbles:true}));
 window.dispatchEvent(new PointerEvent('pointerup',{clientX:target.x,clientY:target.y,button:0,buttons:0,bubbles:true}));await S.solved();
 const relocated=S.sketch().constraints.find(c=>c.id===dim.id),layout=layoutDimension(relocated,store.getState().sketchSolve.geometry,px,center);
 check(near(layout.text[0],10)&&near(layout.text[1],-16),'numeric label position retained');check(Math.abs(layout.segments[2][0][1]-first.segments[2][0][1])>3,'numeric drag moves line as well');
 return {pass:true,value:relocated.value};
},drawing:async()=>{
 H.ready();await H.project({'plate.3dbx':H.GOLDEN+'locating-plate.3dbx'});await H.open('plate.3dbx');await H.waitFor(()=>store.getState().result?.mesh,20000,'real plate');await H.newDrawing();
 const d=store.drawingStore,page=()=>H.page(),state=()=>store.getState().drw;
 await H.waitFor(()=>page()?.views.length===3&&[...state().lines.values()].filter(Boolean).length===3,30000,'views');
 const view=page().views.find(v=>v.direction==='top');document.querySelector(`[data-view="${view.id}"]`).click();await H.waitFor(()=>state().features.get(view.id),30000,'actual model facts');
 const auto=document.querySelector('[data-action="autoDimension"]');check(!!auto,'auto dimension action');auto.click();await H.waitFor(()=>page().dimensions.some(x=>x.kind==='linear')&&state().elements.size,30000,'real dimension');await H.wait(150);
 const dimension=()=>page().dimensions.find(x=>x.id===id),initial=page().dimensions.find(x=>x.kind==='linear'&&x.orientation==='horizontal'),id=initial.id;
 const outcome=()=>d.scene().dimensions.get(id),first=outcome(),value=first.value;
 const client=p=>{const svg=document.querySelector('[data-svg] svg'),r=svg.getBoundingClientRect(),box=svg.viewBox.baseVal;return [r.left+p[0]/box.width*r.width,r.top+(box.height-p[1])/box.height*r.height];};
 const canvas=()=>document.querySelector('[data-drawing-canvas]');
 const drag=async(from,delta)=>{const a=client(from),b=client([from[0]+delta[0],from[1]+delta[1]]);const send=(type,p)=>canvas().dispatchEvent(new PointerEvent(type,{clientX:p[0],clientY:p[1],button:0,buttons:type==='pointerup'?0:1,pointerId:19,bubbles:true}));send('pointerdown',a);for(let i=1;i<=5;i++){send('pointermove',[a[0]+(b[0]-a[0])*i/5,a[1]+(b[1]-a[1])*i/5]);await H.wait(25);}send('pointerup',b);await H.wait(180);};
 const handle=first.handle,line=handle.mid;
 // Grab away from the number so hit-testing must choose the actual dimension line.
 const from=[line[0]+(handle.a[0]-handle.b[0])*0.25,line[1]];
 await drag(from,[0,6]);check(near(dimension().offset-initial.offset,6),'line drag changes offset by 6 mm');check(near(outcome().handle.mid[1]-first.handle.mid[1],6),'rendered dimension line follows');check(outcome().value===value,'measured model dimension unchanged');
 d.undo();await H.wait(150);check(dimension().offset===initial.offset,'one undo restores original line');
 const text=outcome().items.find(i=>i.kind==='text');await drag(text.at,[5,7]);check(near(dimension().offset-initial.offset,7),'numeric drag moves dimension line vertically');check(near((dimension().slide??0)-(initial.slide??0),5),'numeric drag also moves text along line');check(outcome().value===value,'text drag preserves measured value');
 // An extension line can be grabbed without snapping the dimension line to the pointer.
 d.undo();await H.wait(150);const extension=outcome().items.find(i=>i.kind==='polyline'&&i.points.length===4&&Math.abs(i.points[0]-i.points[2])<1e-8&&Math.abs(i.points[1]-i.points[3])>5);
 check(!!extension,'real extension line exists');await drag([(extension.points[0]+extension.points[2])/2,(extension.points[1]+extension.points[3])/2],[0,4]);check(near(dimension().offset-initial.offset,4),'extension drag preserves initial grab offset');
 return {pass:true,value};
}};
