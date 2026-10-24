// Window selection selects placed component geometry; bulk hide is one undo step, hidden components excluded.
//   await import('/@fs/<checkout>/tests/e2e/manual-asm-box-selection.js?' + Date.now());
//   await __asmBox.run();
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const {transformPoint}=await import(`${root}packages/model/src/index.ts`);
const {ACTIONS}=await import(`${root}apps/web/src/actions.ts`);
const H=window.__ui2,{store}=H;
window.__asmBox={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`,'block.3dbx':`${H.GOLDEN}v-block.3dbx`});
 await H.action('檔案','新組合件');if(store.getState().folderRequest)await H.modalButton('選擇資料夾…');
 await H.insert('plate.3dbx');await H.insert('block.3dbx',[.7,.25]);await H.loaded();
 const a=store.assembly,v=store.viewer;v.setView('iso');v.fitAll();await H.wait(100);
 const points=[];
 for(const leaf of a.leaves()){
  const mesh=a.buildOfLeaf(leaf)?.mesh;if(!mesh)continue;
  for(let i=0;i<mesh.positions.length;i+=3)points.push(v.screenPoint(transformPoint(leaf.pose,mesh.positions.slice(i,i+3))));
 }
 const lo=[Math.min(...points.map(p=>p[0]))-12,Math.min(...points.map(p=>p[1]))-12],hi=[Math.max(...points.map(p=>p[0]))+12,Math.max(...points.map(p=>p[1]))+12];
 const send=(type,p,buttons)=>H.canvas().dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:p[0],clientY:p[1],pointerId:1,button:0,buttons}));
 send('pointerdown',lo,1);send('pointermove',hi,1);send('pointerup',hi,0);await H.wait(120);
 H.check(a.getState().selectedComponents.length===2,'both components selected from placed geometry');
 const before=JSON.stringify(a.getState().doc.components.map(c=>c.placement));
 ACTIONS.find(x=>x.id==='hide-component').run();await H.wait(150);
 H.check(a.getState().doc.components.every(c=>c.hidden),'bulk hide');
 H.check(v.elementsInBox(lo,hi).components.length===0,'hidden instances excluded');
 store.undo();await H.wait(150);
 H.check(a.getState().doc.components.every(c=>!c.hidden),'one undo restores both components');
 H.check(JSON.stringify(a.getState().doc.components.map(c=>c.placement))===before,'selection never moved components');
 return {pass:true,components:2};
}};
