// await __sheetManufacturing.workflow();
// await __sheetManufacturing.drawing();
// Native editable unfolding, sequential bending and manufacturing drawings, with actual menus and stored files.
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
const io=await import(`${root}packages/io/src/index.ts`);
const B=await import(`${root}tests/phase1/builders.ts`);
const D=await import(`${root}packages/drawing/src/index.ts`);
const M=window.__sheetManufacturing={};
const state=()=>store.getState();
const must=(ok,why)=>{if(!ok)throw new Error(why);};
const near=(a,b)=>Math.abs(a-b)<1e-4;
const ready=async()=>{await H.waitFor(()=>!state().rebuilding&&state().result?.mesh,20000,'native sheet');must(!state().result.features.some(f=>f.status==='error'),JSON.stringify(state().result.features));};
const line=(id,x)=>B.sketch(id,B.front,{entities:[{id:id+'p',type:'point',x,y:-5},{id:id+'q',type:'point',x,y:55},{id:id+'l',type:'line',p1:id+'p',p2:id+'q'}],constraints:[]});
const feature=(id,sketch)=>({id,type:'midBend',name:id,suppressed:false,sketch,angle:'60'});
const fixture=()=>B.build(B.sketch('s',B.front,B.rectangle('r',0,0,120,50)),{id:'base',type:'baseFlange',name:'base',suppressed:false,sketch:'s',thickness:'1.5',radius:'2',kFactor:'0.5'},line('s1',85),feature('b1','s1'),line('s2',30),feature('b2','s2'));
async function setup(){H.ready();await H.project({});await H.writeAt('多折彎.3dbx',await io.writePartFile(fixture()));await H.open('多折彎.3dbx');await ready();}
async function manufacture(){
 await H.action('鈑金','展開加工');await ready();must(state().doc.features.at(-1).type==='sheetUnfold','unfold feature');
 must(near(state().result.mass.volume,9000),'flat material volume');
 const hole=B.sketch('hs',B.front,B.circle('h',60,25,2));
 must(store.execute({type:'insertFeature',feature:hole,index:state().doc.features.length}),'insert machining sketch');
 must(store.execute({type:'insertFeature',feature:B.extrude('cut','hs','cut',{type:'throughAll',reverse:true}),index:state().doc.features.length}),'insert machining cut');
 await ready();await H.action('鈑金','摺回');await ready();
 must(state().doc.features.at(-1).type==='sheetRefold','refold feature');
 must(near(state().result.mass.volume,(120*50-Math.PI*4)*1.5),'folded cut material');
}
M.workflow=async()=>{
 await setup();await manufacture();
 await window.__shot?.('sheet-refolded-machining');
 store.undo();await ready();must(state().doc.features.at(-1).type==='extrude','undo refold');
 store.redo();await ready();must(state().doc.features.at(-1).type==='sheetRefold','redo refold');
 await H.action('鈑金','展開加工');await ready();await H.action('鈑金','摺回');await ready();
 await H.save('多折彎.3dbx');await H.open('多折彎.3dbx');await ready();
 must(state().doc.schemaVersion>=83&&state().doc.features.filter(f=>f.type==='sheetRefold').length===2,'saved state history');
 return {pass:true,volume:state().result.mass.volume,schema:state().doc.schemaVersion};
};
async function field(name,text){const e=document.querySelector(`[data-field="${name}"]`);must(e,'missing '+name);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,text);e.dispatchEvent(new Event('input',{bubbles:true}));await H.wait(50);e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await H.wait(150);}
M.drawing=async()=>{
 await setup();await manufacture();await H.save('多折彎.3dbx');await H.newDrawing();
 const drw=()=>state().drw,d=()=>store.drawingStore,pg=()=>H.page(drw().doc);
 await H.waitFor(()=>drw()&&pg().views.length===3,20000,'drawing');
 must(d().execute({type:'insertViews',views:[{id:'fv',name:'展平加工圖',source:pg().views[0].source,direction:'flat',at:[145,100],scale:[1,1]}]}),'flat view');
 await H.waitFor(()=>drw().lines.get('fv')?.bends?.length===2&&drw().features.get('fv')?.length>0,30000,'real flat facts');
 d().select('fv');await H.wait(150);
 for(const field of ['bendNotes','bendTable']){const e=document.querySelector(`[data-field="${field}"]`);must(e,'missing '+field);e.scrollIntoView({block:'nearest'});e.click();await H.wait(100);}
 await field('bendTableX','285');await field('bendTableY','175');
 const n=d().autoDimension('fv',{overall:true,holes:true,positions:true});must(n>=3,'native flat dimensions available');
 await H.waitFor(()=>{const results=[...d().scene().dimensions.values()];return results.length>=3&&results.every(r=>!r.error);},30000,'native dimension evaluation');
 const values=[...d().scene().dimensions.values()].map(r=>r.value);
 must(values.some(v=>near(v,120))&&values.some(v=>near(v,50))&&values.some(v=>near(v,4)),'actual width, height, diameter '+values);
 const texts=d().scene().scene.items.filter(i=>i.kind==='text').map(i=>i.text);
 must(texts.some(t=>t.startsWith('B1 '))&&texts.some(t=>t.startsWith('B2 '))&&texts.includes('2.88'),'bend notes and allowance');
 let captured=null;const original=URL.createObjectURL;URL.createObjectURL=blob=>{captured=blob;return original.call(URL,blob);};
 try{d().exportDxf();await H.wait(100);}finally{URL.createObjectURL=original;}
 must(captured,'DXF download');const dx=D.readDxf(await captured.text());must(dx.entities.some(e=>e.type==='TEXT'&&e.text?.includes('B1')),'DXF bend text');must(dx.entities.some(e=>e.type==='DIMENSION'),'DXF flat dimensions');
 await window.__shot?.('flat-bend-table-dimensions');
 H.next.save='多折彎加工圖.3dbd';await H.action('檔案','儲存檔案');await H.waitFor(()=>!drw().dirty,10000,'save drawing');await H.open('多折彎加工圖.3dbd');
 await H.waitFor(()=>drw()?.fileName==='多折彎加工圖.3dbd'&&d().scene().dimensions.size>=3&&[...d().scene().dimensions.values()].every(r=>!r.error),30000,'reloaded manufacturing drawing');
 must(H.page(drw().doc).views.find(v=>v.id==='fv').flatBends.at[0]===285&&drw().doc.schemaVersion>=30,'table persisted');
 return {pass:true,dimensions:n,values,schema:drw().doc.schemaVersion};
};
