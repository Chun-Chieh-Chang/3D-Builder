// await __linkedSketchPattern.run();
// E2+: two-direction linked pattern through real PropertyManager controls; source edits move actual solver geometry.
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
window.__linkedSketchPattern={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`});await H.open('plate.3dbx');
 store.execute({type:'insertFeature',index:store.getState().doc.features.length,feature:{id:'patternSeed',type:'sketch',name:'Pattern seed',suppressed:false,plane:{kind:'datum',name:'plane:front'},entities:[{id:'seedPoint',type:'point',x:30,y:30},{id:'seedCircle',type:'circle',center:'seedPoint',radius:2}],constraints:[{id:'seedFix',type:'fix',point:'seedPoint'},{id:'seedRadius',type:'radius',circle:'seedCircle',value:'2'}]}});
 await H.waitFor(()=>store.getState().result?.frames.has('patternSeed'),20000,'actual sketch');store.beginEdit('patternSeed');await H.waitFor(()=>store.getState().sketchSolve?.geometry.has('seedCircle'),10000,'real circle');
 store.sketcher.select(['seedCircle']);await H.action('草圖','線性草圖陣列');
 const set=async(name,value)=>{const input=document.querySelector(`.property-manager input[name="${name}"]`);H.check(!!input,name+' field');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));await H.wait(30);};
 await set('patternX',10);await set('patternY',0);await set('patternCount',1);document.querySelector('input[name="secondDirection"]').click();await H.wait(50);
 await set('pattern2X',0);await set('pattern2Y',8);await set('pattern2Count',1);
 H.check(document.querySelector('input[name="linkCopies"]').checked,'linked copies are explicit and enabled');document.querySelector('button[name="applyTransform"]').click();
 await H.waitFor(()=>store.editedSketch().entities.filter(e=>e.type==='circle').length===4,10000,'four-cell grid');
 H.check(store.editedSketch().constraints.filter(c=>c.type==='patternPoint').length===3,'three persistent copy links');
 store.execute({type:'setDimension',featureId:'patternSeed',constraintId:'seedRadius',value:'4'});store.execute({type:'editSketch',featureId:'patternSeed',place:[{id:'seedPoint',x:35,y:37}]});
 await H.waitFor(()=>[...store.getState().sketchSolve.geometry.values()].filter(g=>g.type==='circle').every(g=>g.r===4&&g.c[0]>=35&&g.c[1]>=37),10000,'actual linked geometry follows radius and seed');
 const circles=[...store.getState().sketchSolve.geometry.values()].filter(g=>g.type==='circle');H.check(circles.length===4,'all four actual circles remain');
 H.check(circles.some(g=>g.c[0]===45&&g.c[1]===45),'second direction reaches expected final cell');
 store.commitEdit();await H.waitFor(()=>!store.getState().rebuilding,20000,'regenerated linked sketch');
 return {pass:true,circles:circles.length};
}};
