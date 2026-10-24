// await __loftCircles.run();
// Two different circles on two offset datum planes, no preselection, true UI section picking and model-linked diameter edits.
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
const H=window.__ui,{store}=H;
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const state=()=>store.getState();
const ready=async()=>{await H.settle();await H.waitFor(()=>!state().rebuilding,20000,'model rebuild');};
const expected=r=>Math.PI*30/3*(25+5*r+r*r);
const valid=volume=>{const result=state().result;check(result.features.every(f=>f.status==='ok'||f.status==='suppressed'),JSON.stringify(result.features.filter(f=>f.status==='error')));check(Math.abs(result.mass.volume-volume)<1e-6,`actual frustum volume ${result.mass.volume}, expected ${volume}`);};
async function plane(distance) {
 await H.treeClick('前基準面');await H.action('特徵','基準面');await H.pmInput('偏移距離',String(distance));const feature=state().doc.features.at(-1);await H.pmOk();return feature;
}
async function circle(plane,radius) {
 await H.treeClick(plane.name);await H.action('草圖','草圖');await H.frameSketch(0,0,12);await H.tool('圓');await H.sk(0,0);await H.sk(radius,0);await H.solved();
 const id=H.sketch().entities.find(e=>e.type==='circle').id;await H.dim([id],[radius+4,4],radius*2);
 const sketch=H.sketch(),dimension=sketch.constraints.find(c=>c.type==='diameter'&&c.circle===id);
 check(!!dimension,'actual diameter constraint exists');await H.exitSketch();return {sketch,dimension};
}
window.__loftCircles={run:async()=>{
 H.ready();await H.action('檔案','新零件');
 const lower=await plane(10),first=await circle(lower,5),upper=await plane(40),second=await circle(upper,2);
 store.select(null);await H.wait(80);
 await H.action('特徵','疊層拉伸填料/基材');await ready();
 const loft=state().doc.features.at(-1);check(loft.type==='loft'&&JSON.stringify(loft.sections)===JSON.stringify([first.sketch.id,second.sketch.id]),'without preselection the two circle sketches are used');valid(expected(2));
 const removes=[...document.querySelectorAll('.property-manager button')].filter(button=>button.title==='移除');check(removes.length===2,'two ordered sections in panel');removes[1].click();await ready();
 check(state().doc.features.at(-1).sections.length===1,'section removed through panel');await H.treeClick(second.sketch.name);await ready();
 check(state().doc.features.at(-1).sections.length===2,'tree click adds actual sketch as section');valid(expected(2));
 await H.treeClick(first.sketch.name);await ready();check(state().doc.features.at(-1).sections.length===2,'tree click does not duplicate an existing section');await H.pmOk();
 store.beginEdit(second.sketch.id);await H.solved();store.editDimension(second.dimension.id);
 const input=await H.waitFor(()=>document.querySelector('.modify-box input'),5000,'diameter Modify box');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'6');input.dispatchEvent(new Event('input',{bubbles:true}));await H.wait(40);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 await H.waitFor(()=>!document.querySelector('.modify-box'),5000,'diameter accepted');await H.exitSketch();await ready();valid(expected(3));
 store.undo();await ready();valid(expected(2));
 return {pass:true,sections:loft.sections,initialVolume:expected(2),editedVolume:expected(3)};
}};
