// Real Alt-drag SmartMate: preview, Esc rollback, Tab alignment, commit, undo/redo.
//   await import('/@fs/<checkout>/tests/e2e/manual-smart-mates.js?' + Date.now());
//   await __smartMates.run();
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
window.__smartMates={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`,'block.3dbx':`${H.GOLDEN}v-block.3dbx`});
 await H.action('檔案','新組合件');if(store.getState().folderRequest)await H.modalButton('選擇資料夾…');
 const plate=await H.insert('plate.3dbx'),block=await H.insert('block.3dbx',[.75,.3]);await H.loaded();
 const a=store.assembly,v=store.viewer;v.setView('iso');v.fitAll();store.setPickFilterKind('faces');await H.wait(150);
 const spot=id=>{
  const r=H.rect();for(let y=r.top+20;y<r.bottom-15;y+=8)for(let x=r.left+20;x<r.right-15;x+=8){
   const e=v.pickElement(x,y);if(!e||e.kind!=='face')continue;
   const leaf=a.leaves().find(l=>l.id===e.key),build=leaf&&a.buildOfLeaf(leaf);
   if(leaf?.top===id&&build?.faceGeometry[e.index]?.kind==='plane')return [x,y];
  }throw new Error('No visible planar face: '+id);
 };
 const from=spot(block.id),to=spot(plate.id);
 const send=(type,p,buttons)=>H.canvas().dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:p[0],clientY:p[1],button:0,buttons,pointerId:1,altKey:true}));
 send('pointerdown',from,1);send('pointermove',to,1);
 await H.waitFor(()=>a.getState().mate?.type==='coincident'&&a.getState().solution?.mates.get('preview')?.status==='ok',10000,'real mate preview');
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await H.wait(150);
 H.check(!a.getState().smartMate&&a.getState().doc.mates.length===0,'Esc leaves document unchanged');
 send('pointerdown',spot(block.id),1);send('pointermove',spot(plate.id),1);
 await H.waitFor(()=>a.getState().mate?.align,10000,'mate alignment');
 const alignment=a.getState().mate.align;
 window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
 H.check(a.getState().mate.align!==alignment,'Tab flips alignment');
 send('pointerup',spot(plate.id),0);
 await H.waitFor(()=>a.getState().doc.mates.length===1&&!a.getState().smartMate,10000,'SmartMate committed');
 H.check(a.getState().doc.mates[0].type==='coincident','planar faces mate coincident');
 store.undo();await H.wait(100);H.check(a.getState().doc.mates.length===0,'one undo');
 store.redo();await H.wait(100);H.check(a.getState().doc.mates.length===1,'one redo');
 return {pass:true,mate:a.getState().doc.mates[0]};
}};
