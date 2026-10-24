// await __gearRack.gear();
// await __gearRack.rack();
// Actual feature menus, parametric panels, worker solids and measured dimensions; no replacement geometry.
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
const H=window.__ui,{store}=H;
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const state=()=>store.getState();
const ready=async()=>{await H.settle();await H.waitFor(()=>!state().rebuilding&&state().result?.mesh,20000,'real toothed solid');const failures=state().result.features.filter(f=>f.status!=='ok'&&f.status!=='suppressed');check(!failures.length,JSON.stringify(failures));};
window.__gearRack={gear:async()=>{
 H.ready();await H.action('檔案','新零件');await H.action('特徵','直齒齒輪');await ready();
 check(!!document.querySelector('[data-gear-panel="gear"]'),'gear parameters panel');await H.pmInput('模數','1.5');await H.pmInput('齒數','30');await H.pmInput('齒寬','8');await H.pmInput('軸孔直徑','6');await ready();
 const feature=state().doc.features.at(-1),result=state().result;
 check(feature.type==='gear'&&feature.teeth==='30'&&feature.module==='1.5','actual parametric gear feature');
 check(result.faceNames.filter(name=>name.includes('tooth:')&&name.includes(':left')).length===30,'thirty actual involute flank faces');
 check(result.faceFingerprints.some(face=>face.type==='cylinder'&&Math.abs(face.size-2*Math.PI*3*8)<1e-5),'real cylindrical bore has 6 mm diameter and 8 mm width');
 check(Math.abs(Number(document.querySelector('[data-gear-pitch]').dataset.gearPitch)-Math.PI*1.5)<1e-10,'pitch derived from module');
 let rejected=false;try {await H.pmInput('齒數','20.5');}catch(error){if(error.message!=='PM refused 齒數=20.5')throw error;rejected=true;}check(rejected,'panel explicitly rejects fractional count');check(state().doc.features.at(-1).teeth==='30','fractional tooth count rejected without rounding');await H.pmInput('齒數','30');check(state().notice?.kind!=='error','restoring valid value clears stale validation notice');await H.pmOk();
 const volume=state().result.mass.volume;check(volume>0,'true solid volume');store.undo();await H.settle();check(!state().doc.features.some(f=>f.id===feature.id),'one undo removes the complete feature');store.redo();await ready();check(Math.abs(state().result.mass.volume-volume)<1e-7,'redo rebuilds the same real solid');
 return {pass:true,teeth:30,volume};
},rack:async()=>{
 H.ready();await H.action('檔案','新零件');await H.action('特徵','直齒齒條');await ready();
 await H.pmInput('模數','1.5');await H.pmInput('齒數','8');await H.pmInput('齒寬','6');await H.pmInput('齒根下底座厚度','4');await ready();
 const feature=state().doc.features.at(-1),r=state().result,n=8,m=1.5,a=20*Math.PI/180;
 check(feature.type==='rack'&&feature.teeth==='8','actual rack feature');
 const expected=n*(Math.PI*m*4+2.25*m*(Math.PI*m/2)+(1.25**2-1)*m*m*Math.tan(a))*6;
 check(Math.abs(r.mass.volume-expected)<1e-6,'actual rack volume matches analytic trapezoid teeth and backing');
 const xs=Array.from(r.vertexPoints).filter((_,i)=>i%3===0);check(Math.abs(Math.max(...xs)-Math.min(...xs)-n*Math.PI*m)<1e-5,'true rack length is tooth count times circular pitch');
 const plane=document.querySelector('[data-gear-plane]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(plane,'plane:top');plane.dispatchEvent(new Event('change',{bubbles:true}));await ready();
 check(state().doc.features.at(-1).plane.name==='plane:top','construction plane updates through real panel');check(Math.abs(state().result.mass.volume-expected)<1e-6,'changing plane preserves true tooth solid');await H.pmOk();
 return {pass:true,teeth:n,volume:expected};
}};
