// Generic production tool: no private fixture or prepared entry feature.
// await __entranceTool.run();
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'manual-support.js?'+Date.now());
const S=window.__man,{H,store}=S;
window.__entranceTool={run:async()=>{
 S.steps.length=0;let face,edge,before,firstId;
 const state=()=>store.getState();
 await S.step('1 create a real annulus through the ordinary sketch and extrusion UI',async()=>{
  await S.fresh();await H.treeClick('前基準面');await H.action('草圖','草圖');await H.frameSketch(0,0,14);
  await H.tool('圓');await H.sk(0,0);await H.sk(10,0);await H.solved();
  await H.sk(0,0);await H.sk(3,0);await H.solved();await H.selectTool();
  const name=H.sketch().name;await H.exitSketch();await S.extrude(name,6);
  before=state().doc.features.length;
  face=state().result.faceFingerprints.findIndex(f=>f.type==='plane'&&Math.abs(f.center[2]-6)<1e-5);
  if(face<0)throw Error('No native cap');
  const nameFace=state().result.faceNames[face];
  edge=state().result.edgeNames.findIndex((n,i)=>n.includes(nameFace)&&Math.abs(state().result.edgeFingerprints[i].size-2*Math.PI*3)<1e-3);
  return {pass:edge>=0&&Math.abs(S.volume()-Math.PI*(100-9)*6)<1e-4,face,edge};
 });
 const selectFace=()=>store.selectFace({kind:'face',name:state().result.faceNames[face],fingerprint:state().result.faceFingerprints[face]});
 await S.step('2 selected face opens the real entrance tool and cancellation removes all generated features',async()=>{
  selectFace();await H.action('特徵','螺紋入口錐面');await H.waitFor(()=>state().editing?.kind==='feature',10000,'entrance editor');await H.settle();
  const added=state().doc.features.slice(before), pass=added.map(f=>f.type).join(',')==='refPoint,sketch,hole'&&added.at(-1).kind==='countersink';
  store.cancelEdit();await H.settle();return {pass:pass&&state().doc.features.length===before,types:added.map(f=>f.type)};
 });
 await S.step('3 edge preselection identifies the same mouth, confirms one history operation and makes a native cone',async()=>{
  const r=state().result;store.selectElement({kind:'edge',name:r.edgeNames[edge],fingerprint:r.edgeFingerprints[edge]},false);
  await H.action('特徵','螺紋入口錐面');await H.waitFor(()=>state().editing?.kind==='feature',10000,'edge entry');await H.settle();
  firstId=state().editing.featureId;
  await H.pmOk();await H.settle();
  const volume=Math.PI*91*6-Math.PI*(3*0.2**2+0.2**3/3),pass=S.failed().length===0&&Math.abs(S.volume()-volume)<1e-4;
  store.undo();await H.settle();const undone=state().doc.features.length===before;
  store.redo();await H.settle();return {pass:pass&&undone&&state().doc.features.length===before+3&&S.failed().length===0,volume:S.volume()};
 });
 await S.step('4 parameters remain editable after confirmation and the dependent center remains a persistent reference',async()=>{
  store.beginEdit(firstId);await H.settle();const f=state().doc.features.find(f=>f.id===firstId);
  const added=state().doc.features.slice(before),sketch=added.find(f=>f.type==='sketch');
  const guidance=document.querySelector('[data-entrance-guidance]');if(!guidance)throw Error('No machining guidance');guidance.open=true;
  const pass=f.kind==='countersink'&&f.csAngle==='90deg'&&sketch.attach?.origin?.kind==='datum'&&guidance.innerText.includes('加牙後')&&guidance.innerText.includes('tan');
  await S.shot('editable-entry-parameters');store.cancelEdit();await H.settle();return {pass};
 });
 await S.step('5 an in-flight native identification cannot insert features into a newly opened document',async()=>{
  store.undo();await H.settle();selectFace();
  const api=store.api;let release;const gate=new Promise(resolve=>{release=resolve;});let reached=false;
  store.api=new Proxy(api,{get(target,key){if(key==='entranceTarget')return async(...args)=>{const result=await api.entranceTarget(...args);reached=true;await gate;return result;};return Reflect.get(target,key);}});
  try{
   await H.action('特徵','螺紋入口錐面');await H.waitFor(()=>reached,10000,'native identification');
   await S.fresh();const serial=state().documentSerial;release();await H.wait(200);await H.settle();
   return {pass:state().documentSerial===serial&&state().doc.features.length===0&&state().editing===null};
  }finally{release();store.api=api;}
 });
 const result=S.result('entrance-tool');await S.fresh();return result;
}};
