// await __sheetExtensions.partial();
// await __sheetExtensions.curved();
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H,B=await import(`${root}tests/phase1/builders.ts`),io=await import(`${root}packages/io/src/index.ts`);
const M=window.__sheetExtensions={},state=()=>store.getState();
const must=(ok,why)=>{if(!ok)throw new Error(why);};
const ready=async()=>{await H.wait(100);await H.waitFor(()=>!state().rebuilding&&state().result?.mesh,20000,'native sheet');must(!state().result.features.some(f=>f.status==='error'),JSON.stringify(state().result.features));};
const bend=(id,x)=>[B.sketch('s'+id,B.front,{entities:[{id:id+'p',type:'point',x,y:-5},{id:id+'q',type:'point',x,y:55},{id:id+'l',type:'line',p1:id+'p',p2:id+'q'}],constraints:[]}),{id,type:'midBend',name:id,suppressed:false,sketch:'s'+id,angle:'90'}];
async function setup(two){H.ready();await H.project({});const fs=[B.sketch('s',B.front,B.rectangle('r',0,0,120,50)),{id:'base',type:'baseFlange',name:'base',suppressed:false,sketch:'s',thickness:'1.5',radius:'2',kFactor:'0.5'},...(two?[...bend('b1',85),...bend('b2',30)]:bend('b',60))];await H.writeAt('局部展開.3dbx',await io.writePartFile(B.build(...fs)));await H.open('局部展開.3dbx');await ready();}
async function cut(x,r){for(const f of [B.sketch('h',B.front,B.circle('hc',x,25,r)),B.extrude('cut','h','cut',{type:'throughAll',reverse:true})])must(store.execute({type:'insertFeature',feature:f,index:state().doc.features.length}),'insert cut');await ready();}
M.partial=async()=>{
 await setup(true);await H.action('鈑金','部分展開');await ready();
 await H.waitFor(()=>document.querySelector('[data-sheet-unfold-panel]'),5000,'selection panel');
 const a=document.querySelector('[data-bend="b1"]'),b=document.querySelector('[data-bend="b2"]');must(a?.checked&&!b?.checked,'first bend default');b.click();await ready();a.click();await ready();
 must(state().doc.features.at(-1).bends.join()==='b2','changed selection persisted');
 await window.__shot?.('partial-unfold-selection');document.querySelector('.property-manager .pm-ok').click();await ready();
 await cut(60,2);await H.action('鈑金','摺回');await ready();must(Math.abs(state().result.mass.volume-(6000-Math.PI*4)*1.5)<1e-4,'refold physical volume');
 await H.save('局部展開.3dbx');await H.open('局部展開.3dbx');await ready();must(state().doc.schemaVersion>=84&&state().doc.features.find(f=>f.type==='sheetUnfold').bends.join()==='b2','selection save/reopen');
 return{pass:true,volume:state().result.mass.volume};
};
M.curved=async()=>{
 await setup(false);await H.action('鈑金','展開加工');await ready();await cut(60,3);await H.action('鈑金','摺回');await ready();
 must(Math.abs(state().result.mass.volume-(6000-Math.PI*9)*1.5)<1e-4,'cross-bend refold volume');await window.__shot?.('cross-bend-refolded-hole');
 await H.action('鈑金','展開加工');await ready();must(Math.abs(state().result.mass.volume-(6000-Math.PI*9)*1.5)<1e-4,'repeated unfolding retains contour');await H.action('鈑金','摺回');await ready();
 await H.save('局部展開.3dbx');await H.open('局部展開.3dbx');await ready();return{pass:true,volume:state().result.mass.volume};
};
