// await __stretchEntities.run();
// E2+: a shared endpoint stretches two real lines, with the opposite endpoints held and one undo.
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
window.__stretchEntities={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`});await H.open('plate.3dbx');
 store.execute({type:'insertFeature',index:store.getState().doc.features.length,feature:{id:'stretchSketch',type:'sketch',name:'Stretch',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[{id:'stretchA',type:'point',x:0,y:0},{id:'stretchB',type:'point',x:10,y:0},{id:'stretchC',type:'point',x:10,y:10},{id:'stretchAB',type:'line',p1:'stretchA',p2:'stretchB'},{id:'stretchBC',type:'line',p1:'stretchB',p2:'stretchC'}],constraints:[{id:'stretchFixA',type:'fix',point:'stretchA'},{id:'stretchFixC',type:'fix',point:'stretchC'}]}});
 await H.waitFor(()=>store.getState().result?.frames.has('stretchSketch'),20000,'real sketch');store.beginEdit('stretchSketch');await H.waitFor(()=>store.getState().sketchSolve?.geometry.has('stretchB'),10000,'actual endpoint');
 store.sketcher.select(['stretchB']);await H.action('草圖','延展圖元');
 for(const [name,value] of [['moveX',3],['moveY',2]]){const input=document.querySelector(`input[name="${name}"]`);H.check(!!input,'stretch typed controls');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));await H.wait(40);}
 document.querySelector('button[name="applyTransform"]').click();
 const point=id=>store.getState().sketchSolve?.geometry.get(id)?.p;
 await H.waitFor(()=>point('stretchB')?.[0]===13&&point('stretchB')?.[1]===2,10000,'shared endpoint stretched');H.check(JSON.stringify(point('stretchA'))==='[0,0]'&&JSON.stringify(point('stretchC'))==='[10,10]','unselected endpoints stay fixed');
 store.undo();await H.waitFor(()=>point('stretchB')?.[0]===10&&point('stretchB')?.[1]===0,10000,'one undo');store.commitEdit();return {pass:true};
}};
