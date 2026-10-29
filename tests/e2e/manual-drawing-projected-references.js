// await __projectedReferences.run();
// Real section/detail generated lines, oblique curves, asymmetric tolerances, and cold drawing reopening.
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(root+'tests/e2e/phase2-assembly.js?'+Date.now());
const H=window.__ui2,{store}=H;
const M=await import(root+'packages/model/src/index.ts'),D=await import(root+'packages/drawing/src/index.ts');
const s=()=>store.getState().drw,d=()=>store.drawingStore,pg=()=>H.page(s().doc),view=id=>pg().views.find(v=>v.id===id);
const must=(ok,message)=>{if(!ok)throw new Error(message);};
const lines=id=>D.resolveLines(s().doc,s().lines).get(id);
const sheet=(id,p)=>D.toSheet(d().scene().placed.get(id),...p);
async function pointer(id,p,click=false){
 const at=sheet(id,p),svg=document.querySelector('[data-svg] svg'),r=svg.getBoundingClientRect(),box=svg.viewBox.baseVal;
 const x=r.left+at[0]/box.width*r.width,y=r.top+(box.height-at[1])/box.height*r.height;
 const canvas=document.querySelector('[data-drawing-canvas]');
 for(const type of click?['pointermove','pointerdown','pointerup']:['pointermove']){canvas.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:77,button:0,buttons:type==='pointerdown'?1:0,bubbles:true}));await H.wait(40);}
}
async function blank(id,at){const p=d().scene().placed.get(id);await pointer(id,[(at[0]-p.at[0])/p.scale+p.centre[0],(at[1]-p.at[1])/p.scale+p.centre[1]],true);}
const visible=l=>({...l,hidden:[],tangent:[],tangentHidden:[]});
function unmatched(id,curve=false,precise=false){
 const l=lines(id),features=s().features.get(id)??[],seen=D.visibleElements(l,s().edges.get(id),features);
 const scale=d().scene().placed.get(id).scale,svg=document.querySelector('[data-svg] svg'),r=svg.getBoundingClientRect(),pixel=r.width/svg.viewBox.baseVal.width;
 const tol=precise?0.005:6/(pixel*scale);
 return D.projectionEntities(visible(l)).filter(e=>curve?!e.straight:e.straight).find(e=>{
  const p=D.projectionPoint(e,0.23), native=D.dimensionReferenceAt(l,features,p,tol,seen);return D.withProjectedReference(native,visible(l),p,tol)?.ref.kind==='projection';
 });
}
async function select(field,value){const el=document.querySelector(`[data-field="${field}"]`);must(el,field);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));await H.wait(100);}
async function edit(field,value){const el=document.querySelector(`[data-field="${field}"]`);must(el,field);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await H.wait(100);}
window.__projectedReferences={run:async()=>{
 const steps=[];let top,iso,target;
 async function step(name,fn){await fn();steps.push({name,pass:true});await window.__shot?.(name);}
 try{
  await step('1 native plate with ordinary oblique projection and an offset section',async()=>{
   H.ready();await H.project({'plate.3dbx':H.GOLDEN+'locating-plate.3dbx'});await H.open('plate.3dbx');
   await H.waitFor(()=>store.getState().result?.mesh,20000,'native plate');await H.newDrawing(['top','isometric']);
   await H.waitFor(()=>pg().views.length===2&&pg().views.every(v=>s().features.has(v.id)&&s().lines.get(v.id)),30000,'native views');
   top=pg().views.find(v=>v.direction==='top');iso=pg().views.find(v=>v.direction==='isometric');
   d().setSheet({scale:[1,1]});d().setView(top.id,{at:[100,220],display:'hiddenRemoved'});d().setView(iso.id,{at:[300,220],display:'hiddenRemoved'});
   const box=s().lines.get(top.id).box;
   must(d().execute({type:'insertViews',views:[{id:'cut',name:'section',kind:'section',parent:top.id,line:[[box.min[0]-5,2],[box.max[0]+5,2]],label:'A',at:[100,100],scale:[1,1]}]}),'insert offset section');
   await H.waitFor(()=>s().lines.get('cut')&&s().features.has('cut'),30000,'native section selection data');
   target=unmatched('cut',false,true);must(target,'real generated section line has no old native-edge/analytic reference');
   const centre=D.projectionPoint(target,0.5);
   must(d().execute({type:'insertViews',views:[{id:'detail',name:'detail',kind:'detail',parent:'cut',centre,radius:5,label:'B',scale:[10,1],at:[300,100]}]}),'insert detail');await H.wait(150);
  });
  await step('2 section-derived line in a detail can actually be selected and dimensioned',async()=>{
   const candidate=unmatched('detail');must(candidate,'detail contains an originally unselectable generated line');
   d().setTool({kind:'dimension',picks:[],mode:'aligned'});await H.wait(100);
   await pointer('detail',D.projectionPoint(candidate,0.23),true);
   must(s().tool?.picks[0]?.feature.ref.kind==='projection','real click acquires a projection reference');
   if(s().tool.picks[0].feature.type==='vertex')await pointer('detail',D.projectionPoint(candidate,0.77),true);
   await blank('detail',[360,55]);
   await H.waitFor(()=>pg().dimensions.length===1&&d().scene().dimensions.get(pg().dimensions[0].id)?.value>0,10000,'generated-edge dimension');
   must(M.dimensionRefs(pg().dimensions[0]).some(r=>r.kind==='projection'),'persistent projected references');d().setTool(null);
  });
  await step('3 oblique curved model contour supports selected point distances and curve highlighting',async()=>{
   const curve=unmatched(iso.id,true);must(curve,'native oblique curve with no original selectable circle');
   d().setTool({kind:'dimension',picks:[],mode:'aligned'});await H.wait(100);
   await pointer(iso.id,D.projectionPoint(curve,0.23));
   must(document.querySelector('[data-pick="curve"]'),'actual native curve is highlighted');
   await pointer(iso.id,D.projectionPoint(curve,0.23),true);await pointer(iso.id,D.projectionPoint(curve,0.73),true);
   must(s().tool?.picks.length===2,'two projected curve point references');
   await blank(iso.id,[365,185]);
   await H.waitFor(()=>pg().dimensions.length===2&&d().scene().dimensions.get(pg().dimensions.at(-1).id)?.value>0,10000,'native projected point distance');d().setTool(null);
  });
  await step('4 asymmetric and same-sign tolerances through actual property fields',async()=>{
   const dim=pg().dimensions[0];d().selectDimension(dim.id);await H.wait(150);
   await select('dimToleranceType','asymmetric');await edit('dimUpper',0.02);await edit('dimLower',-0.01);
   must(document.querySelector('[data-field="dimToleranceType"]').value==='asymmetric','dedicated asymmetric choice');
   must(d().scene().dimensions.get(dim.id).text.includes('+0.02/-0.01'),'different upper/lower deviations shown');
   await edit('dimUpper',0.03);await edit('dimLower',0.01);
   must(d().scene().dimensions.get(dim.id).text.includes('+0.03/+0.01'),'same-positive unilateral deviations supported');
   const scene=d().scene().scene;must(/>\+0\.03<\/text>[\s\S]*>\+0\.01<\/text>/.test(D.toSvg(scene))&&D.toDxf(scene).includes('\\S+0.03^+0.01;'),'SVG stacks and DXF writes the same deviations');
  });
  await step('4b batch asymmetric negative deviations and visible property controls',async()=>{
   d().pick(pg().dimensions.map(dim=>({kind:'dimension',id:dim.id})),'replace');await H.wait(100);
   await select('batchToleranceType','asymmetric');await edit('batchLower',-0.03);await edit('batchUpper',-0.01);
   must(pg().dimensions.every(dim=>dim.tolerance.upper===-0.01&&dim.tolerance.lower===-0.03),'batch same-negative deviations');
   must(pg().dimensions.every(dim=>d().scene().dimensions.get(dim.id).text.includes('-0.01/-0.03')),'batch values actually render');
   d().selectDimension(pg().dimensions[0].id);await H.wait(100);await edit('dimUpper',0.03);await edit('dimLower',0.01);
   document.querySelector('[data-field="dimToleranceType"]').scrollIntoView({block:'center'});await H.wait(100);
  });
  await step('5 cold reopen preserves projected references and asymmetric tolerance values',async()=>{
   const values=pg().dimensions.map(dim=>d().scene().dimensions.get(dim.id).value);
   H.next.save='projected.3dbd';await H.action('檔案','儲存檔案');await H.waitFor(()=>!s().dirty,10000,'saved drawing');
   await H.action('檔案','新零件');store.restartWorker();await H.waitFor(()=>store.getState().bootMs!==null&&!store.getState().rebuilding,20000,'fresh native worker');await H.open('projected.3dbd');
   await H.waitFor(()=>s()?.fileName==='projected.3dbd'&&pg().dimensions.every(dim=>d().scene().dimensions.get(dim.id)?.value>0),30000,'re-evaluated projection references');
   pg().dimensions.forEach((dim,i)=>must(Math.abs(d().scene().dimensions.get(dim.id).value-values[i])<1e-6,'same native projected value after cold reopen'));
   must(pg().dimensions[0].tolerance.upper===0.03&&pg().dimensions[0].tolerance.lower===0.01,'actual deviations persisted');
  });
  return{pass:true,steps};
 }catch(error){return{pass:false,steps,error:String(error?.stack??error)};}
}};
