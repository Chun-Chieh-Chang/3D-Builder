// await __moveFaceTarget.run();
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase3-direct-edit.js?'+Date.now());
const facePoint=window.__ui.facePoint;
await import(here+'manual-loft-circles.js?'+Date.now());
const H=window.__ui,{store}=H;
window.__moveFaceTarget={run:async()=>{
 await window.__loftCircles.run();
 const loft=store.getState().doc.features.find(f=>f.type==='loft');
 await H.action('檢視','後視');await H.wait(200);
 await H.action('特徵','移動面');await H.settle();
 await H.at(facePoint(loft.id+':cap:start'));await H.settle();
 const f=()=>store.getState().doc.features.at(-1);
 if(f().face.name!==loft.id+':cap:start')throw new Error('did not pick lower cap: '+f().face.name);
 const target=[...document.querySelectorAll('.property-manager button')].find(b=>b.textContent==='目標平面');
 target.click();await H.wait(80);await H.treeClick('前基準面');await H.settle();
 if(f().target?.name!=='plane:front')throw new Error('tree target not stored');
 await H.pmOk();await H.settle();
 const result=store.getState().result;
 if(result.features.some(f=>f.status==='error'))throw new Error(JSON.stringify(result.features));
 // Original cone r=5 at z=10 and r=2 at z=40; extrapolated r=6 at z=0.
 const expected=Math.PI*40/3*(36+12+4);
 if(Math.abs(result.mass.volume-expected)>1e-5)throw new Error('wrong cone volume '+result.mass.volume);
 return {pass:true,volume:result.mass.volume,target:f().target};
}};
