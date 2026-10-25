// await __actionIcons.workflow();
// await __actionIcons.drawing();
// await __actionIcons.design();
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H,B=await import(`${root}tests/phase1/builders.ts`),io=await import(`${root}packages/io/src/index.ts`);
const M=window.__actionIcons={},state=()=>store.getState();
const must=(v,why)=>{if(!v)throw new Error(why);};
const ready=async()=>{await H.wait(100);await H.waitFor(()=>!state().rebuilding&&state().result,20000,'native result');must(!state().result.features.some(f=>f.status==='error'),JSON.stringify(state().result.features));};
const loaded=async(doc=document)=>{await H.waitFor(()=>[...doc.querySelectorAll('img.action-icon')].every(i=>i.complete&&i.naturalWidth>0),10000,'SVG icons');};
const openTab=async name=>{H.tab(name);await H.wait(150);await loaded();};
async function setup(body=false){H.ready();await H.project({});const fs=[B.sketch('s',B.front,B.rectangle('r',0,0,30,20))];if(body)fs.push(B.extrude('e','s','boss',{type:'blind',depth:'10'}));await H.writeAt('圖示驗收.3dbx',await io.writePartFile(B.build(...fs)));await H.open('圖示驗收.3dbx');await ready();}
function bounds(){const p=document.querySelector('.menu-panel:not(.folded)'),r=p.getBoundingClientRect();must(r.right<=innerWidth+1&&r.left>=0,'menu fits viewport '+JSON.stringify(r));must(document.documentElement.scrollWidth<=innerWidth,'no document horizontal overflow');}
M.workflow=async()=>{
 await setup();await openTab('特徵');const fillet=document.querySelector('[data-help="fillet"]');must(fillet.disabled,'fillet disabled without body');must(fillet.querySelector('.tool-label').textContent.trim(),'visible label');must(fillet.title.length>20,'existing usage tooltip');must(fillet.querySelector('img').getAttribute('alt')==='','decorative artwork');bounds();await window.__shot?.('icons-disabled-menu');
 document.querySelector('.tabs .tab.active').click();await H.treeClick('s');await H.action('特徵','伸長填料/基材');await H.pmInput('深度','12');document.querySelector('.property-manager .pm-ok').click();await ready();must(Math.abs(state().result.mass.volume-7200)<1e-5,'actual native extrusion through icon+label action');
 await openTab('特徵');must(!document.querySelector('[data-help="fillet"]').disabled,'fillet enabled after solid');bounds();await window.__shot?.('icons-model-tools');document.querySelector('.tabs .tab.active').click();
 await store.setLanguage('en');await H.wait(100);await openTab('Features');bounds();must(document.querySelector('[data-help="extrude"]').textContent.trim().length>0,'English label');await window.__shot?.('icons-english-tools');document.querySelector('.tabs .tab.active').click();await store.setLanguage('zh-TW');await H.wait(100);
 await H.save('圖示驗收.3dbx');return{pass:true,volume:state().result.mass.volume};
};
M.drawing=async()=>{
 await setup(true);await H.newDrawing();await H.waitFor(()=>state().drw&&H.page(state().drw.doc).views.length===3,20000,'drawing views');await openTab('註記');
 const toggle=document.querySelector('[data-split-toggle="drw-dimension"]');must(toggle&&!toggle.disabled,'dimension subtype dropdown');toggle.click();await H.wait(100);await loaded();
 const buttons=[...document.querySelectorAll('.split-menu [data-help]')];must(buttons.length>=7,'all dimension kinds');must(new Set(buttons.map(b=>b.querySelector('img')?.src)).size===buttons.length,'distinct subtype artwork');bounds();await window.__shot?.('icons-dimension-kinds');
 document.querySelector('[data-help="drw-dim-radius"]').click();await H.wait(100);must(state().drw.tool?.kind==='dimension'&&state().drw.tool.mode==='radius','actual radius tool activated');
 return{pass:true,subtypes:buttons.length};
};
M.design=async()=>{
 H.ready();const frame=document.createElement('iframe');frame.src=root+'docs/design/menu-redesign/preview.html';Object.assign(frame.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',border:'0',zIndex:'10000'});document.body.append(frame);
 try{await H.waitFor(()=>frame.contentDocument?.querySelector('#tabs button'),15000,'standalone design');const d=frame.contentDocument;
 must(d.querySelectorAll('.card').length===205,'complete command gallery');
 await H.waitFor(()=>[...d.querySelectorAll('img')].filter(i=>i.getAttribute('src')).every(i=>i.complete&&i.naturalWidth>0),15000,'gallery SVGs');
 const mode=d.querySelector('#mode');mode.value='sketch';mode.dispatchEvent(new Event('change',{bubbles:true}));must(d.querySelector('#tabs button[aria-selected="true"]').textContent==='草圖','sketch contextual tab');await window.__shot?.('menu-design-sketch');
 mode.value='part';mode.dispatchEvent(new Event('change',{bubbles:true}));[...d.querySelectorAll('#tabs button')].find(b=>b.textContent==='鈑金').click();await window.__shot?.('menu-design-sheet');
 const search=d.querySelector('#search');search.value='部分';search.dispatchEvent(new Event('input',{bubbles:true}));const result=d.querySelector('#results [data-action="sheet-unfold-selected"]');must(result,'partial unfold searchable');result.click();must(d.querySelector('#help-id').textContent==='sheet-unfold-selected','selection displays command help');
 d.querySelector('#gallery-toggle').click();await window.__shot?.('icons-gallery-32px');d.querySelector('#size').value='16';d.querySelector('#size').dispatchEvent(new Event('change',{bubbles:true}));await window.__shot?.('icons-gallery-16px');return{pass:true,icons:205};
 }finally{frame.remove();}
};
