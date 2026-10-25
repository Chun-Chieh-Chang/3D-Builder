// await __spacingRatio.ratio();
// await __spacingRatio.spacing();
const here=import.meta.url.slice(0,import.meta.url.lastIndexOf('/')+1);
await import(here+'phase1-demo-parts.js?'+Date.now());
const H=window.__ui,{store}=H;
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const begin=async()=>{H.ready();await H.action('檔案','新零件');await H.treeClick('前基準面');await H.action('草圖','草圖');await H.frameSketch(10,10,10);store.setOptions({automaticRelations:false});};
const press=async label=>{const button=[...document.querySelectorAll('.relation-buttons button')].find(b=>b.textContent===label);check(!!button,`actual ${label} relation offered for multi-selection`);button.click();await store.sketcher.settled();await H.solved();};
window.__spacingRatio={ratio:async()=>{
 await begin();for(const [y,length]of [[0,10],[10,6]]){await H.tool('直線');await H.sk(0,y);await H.sk(length,y);await H.solved();await H.selectTool();}
 const ids=H.sketch().entities.filter(e=>e.type==='line').map(e=>e.id);await H.dim([ids[0]],[5,-4],10);await H.selectTool();store.sketcher.select(ids);await H.wait(80);await press('長度比例（第一／第二）');
 const length=id=>{const g=store.getState().sketchSolve.geometry.get(id);return Math.hypot(g.b[0]-g.a[0],g.b[1]-g.a[1]);};check(Math.abs(length(ids[0])/length(ids[1])-2)<1e-7,'actual ratio 2');
 const input=document.querySelector('.relation-list input');check(input,'ratio editable in actual existing relations list');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'0.5');input.dispatchEvent(new Event('input',{bubbles:true}));await H.wait(80);input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await H.solved();check(Math.abs(length(ids[0])/length(ids[1])-0.5)<1e-7,'actual ratio after DOM edit');
 store.undo();await H.solved();check(Math.abs(length(ids[0])/length(ids[1])-2)<1e-7,'undo ratio edit');return {pass:true};
},spacing:async()=>{
 await begin();for(const [x,y]of [[0,8],[8,12],[24,8]]){await H.tool('圓');await H.sk(x,y);await H.sk(x+2,y);await H.solved();}
 const ids=H.sketch().entities.filter(e=>e.type==='circle').map(e=>e.id);await H.selectTool();store.sketcher.select(ids);await H.wait(80);await press('等距（依選取順序）');
 const cs=ids.map(id=>store.getState().sketchSolve.geometry.get(id).c);check(Math.hypot(cs[1][0]-(cs[0][0]+cs[2][0])/2,cs[1][1]-(cs[0][1]+cs[2][1])/2)<1e-7,'actual equally spaced circle centers');check(!['over','failed'].includes(store.getState().sketchSolve.status),'spacing accepted by worker');store.undo();await H.solved();check(!H.sketch().constraints.some(c=>c.type==='equalSpacing'),'one undo removes spacing');return {pass:true};
}};
