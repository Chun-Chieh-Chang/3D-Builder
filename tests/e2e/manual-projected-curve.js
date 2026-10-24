// await __projectedCurve.run();
// C8.2: real sketch intersections, PropertyManager changes, face picking, undo and redo.
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
window.__projectedCurve={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`});await H.open('plate.3dbx');
 const make=(id,plane,y)=>({id,name:id,type:'sketch',suppressed:false,plane:{kind:'datum',name:plane},entities:[{id:id+'p',type:'point',x:0,y},{id:id+'q',type:'point',x:10,y:y+5},{id:id+'l',type:'line',p1:id+'p',p2:id+'q'}],constraints:[]});
 for(const sketch of [make('projectionA','plane:front',1),make('projectionB','plane:top',2)])store.execute({type:'insertFeature',index:store.getState().doc.features.length,feature:sketch});
 await H.waitFor(()=>store.getState().result?.frames.has('projectionB'),20000,'actual solved sketches');
 store.select('projectionA');await H.action('特徵','投影曲線');
 await H.waitFor(()=>document.querySelector('.property-manager select'),5000,'projection panel');
 const feature=()=>store.getState().doc.features.find(f=>f.type==='projectedCurve');
 const selects=[...document.querySelectorAll('.property-manager select')];
 const choose=(element,value)=>{element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));};
 const second=selects.find(s=>[...s.options].some(o=>o.value==='projectionB')&&s.value!=='projectionA');
 H.check(!!second,'second sketch selector exists');choose(second,'projectionB');
 await H.waitFor(()=>store.getState().result?.features.find(f=>f.id===feature().id)?.status==='ok',20000,'real projected intersection');
 document.querySelector('.pm-ok').click();await H.waitFor(()=>!store.getState().editing,5000,'accept');
 const id=feature().id,body=store.getState().result.bodies.find(b=>b.id===id);
 const edges=store.getState().result.edgeNames.filter(n=>n.startsWith(id+':curve:')).length;
 H.check(body?.curve && body.faces===0 && edges>0,'curve body has actual edges without fake faces');
 store.undo();await H.waitFor(()=>!feature(),5000,'one undo');store.redo();await H.waitFor(()=>store.getState().result?.bodies.some(b=>b.id===id),20000,'redo rebuild');
 return {pass:true,edges};
}};
