// await __linkedCircularPattern.run();
// E2+: a linked circular pattern of lines, circle and arc, including actual arc rules and worker analysis.
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
window.__linkedCircularPattern={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`});await H.open('plate.3dbx');
 const pts=[['ca',0,0],['cb',10,0],['cc',10,6],['cd',20,3],['ce',30,0],['cf',34,0],['cg',30,4]];
 store.execute({type:'insertFeature',index:store.getState().doc.features.length,feature:{id:'circularSeed',type:'sketch',name:'Circular seed',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[...pts.map(([id,x,y])=>({id,type:'point',x,y})),{id:'cl1',type:'line',p1:'ca',p2:'cb'},{id:'cl2',type:'line',p1:'cb',p2:'cc'},{id:'circle',type:'circle',center:'cd',radius:3},{id:'arc',type:'arc',center:'ce',start:'cf',end:'cg'}],constraints:[{id:'ch',type:'horizontal',a:'cl1'},{id:'cw',type:'distance',a:'cl1',value:'10'},{id:'cr',type:'radius',circle:'circle',value:'3'},{id:'cp',type:'perpendicular',a:'cl1',b:'cl2'}]}});
 await H.waitFor(()=>store.getState().result?.frames.has('circularSeed'),20000,'seed frame');store.beginEdit('circularSeed');await H.waitFor(()=>store.getState().sketchSolve?.geometry.has('arc'),10000,'native arc');
 store.sketcher.select(['cl1','cl2','circle','arc']);await H.action('草圖','環狀草圖陣列');
 for(const [name,value] of [['patternCount',5],['patternAngle',360]]) {const input=document.querySelector(`input[name="${name}"]`);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));await H.wait(40);}
 const p={p:[-10,-10],px:.05,ctrl:false,shift:false};store.sketcher.pointerMove(p,false);store.sketcher.pointerDown(p);store.sketcher.pointerUp(p);
 await H.waitFor(()=>store.editedSketch().constraints.filter(c=>c.type==='patternPoint').length===35,10000,'35 real point links without worker OOM');
 await H.waitFor(()=>store.getState().sketchSolve?.geometry.size===store.editedSketch().entities.length,10000,'full worker solve');
 H.check(!['over','failed'].includes(store.getState().sketchSolve.status),'linked arc rules remain consistent');
 const g=store.getState().sketchSolve.geometry;
 for(const link of store.editedSketch().constraints.filter(c=>c.type==='patternPoint')) {const a=g.get(link.a).p,b=g.get(link.b).p,angle=parseFloat(link.angle)*Math.PI/180,[x,y]=link.center,expected=[x+Math.cos(angle)*(a[0]-x)-Math.sin(angle)*(a[1]-y),y+Math.sin(angle)*(a[0]-x)+Math.cos(angle)*(a[1]-y)];H.check(Math.hypot(b[0]-expected[0],b[1]-expected[1])<1e-6,'actual rotated copy point');}
 store.execute({type:'setDimension',featureId:'circularSeed',constraintId:'cr',value:'4'});await H.waitFor(()=>[...store.getState().sketchSolve.geometry.values()].filter(g=>g.type==='circle').every(g=>g.r===4),10000,'all six circle radii follow source');
 H.check([...store.getState().sketchSolve.geometry.values()].filter(g=>g.type==='arc').length===6,'all six real arcs survive');store.commitEdit();return {pass:true,pointLinks:35};
}};
