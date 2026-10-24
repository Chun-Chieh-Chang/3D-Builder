// Real round-edge pair: concentric + coincident commit atomically and solve, one undo.
//   await import('/@fs/<checkout>/tests/e2e/manual-smart-mate-circles.js?' + Date.now());
//   await __smartMateCircles.run();
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
window.__smartMateCircles={run:async()=>{
 H.ready();await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`,'pin.3dbx':`${H.GOLDEN}diamond-pin.3dbx`});
 await H.action('檔案','新組合件');if(store.getState().folderRequest)await H.modalButton('選擇資料夾…');
 const plate=await H.insert('plate.3dbx'),pin=await H.insert('pin.3dbx',[.75,.3]);await H.loaded();
 const a=store.assembly;
 const circle=id=>{
  const leaf=a.leaves().find(l=>l.top===id),b=a.buildOfLeaf(leaf),i=b.edgeGeometry.findIndex((g,index)=>g?.kind==='circle'&&(b.edgeFaces?.[index]??[]).filter(f=>b.faceGeometry[f]?.kind==='plane').length===1);
  H.check(i>=0,'real circular edge exists');return {component:id,ref:{kind:'edge',name:b.edgeNames[i],fingerprint:b.edgeFingerprints[i]}};
 };
 H.check(a.startSmartMate(circle(pin.id)),'floating circular source');a.hoverSmartMate(circle(plate.id));
 await a.finishSmartMate(false);
 H.check(a.getState().doc.mates.length===2,`round pair commit: ${JSON.stringify({notice:store.getState().notice,mate:a.getState().mate,states:[...a.getState().solution.mates]})}`);
 await H.waitFor(()=>a.getState().doc.mates.length===2&&[...a.getState().solution.mates.values()].every(m=>m.status==='ok'),15000,'two solved mates');
 H.check(a.getState().doc.mates.map(m=>m.type).sort().join(',')==='coincident,concentric','round-edge pair constrains both axis and seat');
 store.undo();await H.wait(100);H.check(a.getState().doc.mates.length===0,'both mates undo together');
 return {pass:true,mates:2};
}};
