// await __mateAlignment.run();
// Tab flips an ordinary mate draft, outside the SmartMates gesture.
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
window.__mateAlignment={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`});
 await H.action('檔案','新組合件');if(store.getState().folderRequest)await H.modalButton('選擇資料夾…');
 const first=await H.insert('plate.3dbx'),second=await H.insert('plate.3dbx',[.75,.3]);await H.loaded();
 const a=store.assembly;
 const ref=id=>{const leaf=a.leaves().find(l=>l.top===id),build=a.buildOfLeaf(leaf),i=build.faceGeometry.findIndex(g=>g?.kind==='plane');H.check(i>=0,'actual planar topology');return {component:leaf.id,ref:{kind:'face',name:build.faceNames[i],fingerprint:build.faceFingerprints[i]}};};
 a.startMate();a.pickElement(ref(first.id));a.pickElement(ref(second.id));
 await H.waitFor(()=>a.getState().mate?.align,5000,'ordinary alignment draft');
 const before=a.getState().mate.align;
 const event=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});window.dispatchEvent(event);
 H.check(event.defaultPrevented && a.getState().mate.align!==before,'Tab flips and prevents focus traversal');
 H.check(a.getState().doc.mates.length===0,'preview does not write model');a.cancelMate();
 return {pass:true};
}};
