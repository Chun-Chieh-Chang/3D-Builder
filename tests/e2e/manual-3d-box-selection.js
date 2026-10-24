// Directional 3D box selection against real kernel mesh: window, crossing, filters, additive, cancellation.
//   await import('/@fs/<checkout>/tests/e2e/manual-3d-box-selection.js?' + Date.now());
//   await __box3d.run();
const root=new URL(import.meta.url).pathname.replace(/tests\/e2e\/[^/]*$/,'');
await import(`${root}tests/e2e/phase2-assembly.js?`+Date.now());
const H=window.__ui2,{store}=H;
const pointer=(type,p,buttons=0)=>document.querySelector('canvas').dispatchEvent(new PointerEvent(type,{bubbles:true,clientX:p[0],clientY:p[1],button:0,buttons,pointerId:1}));
window.__box3d={run:async()=>{
  H.ready();
  await H.project({'plate.3dbx':`${H.GOLDEN}locating-plate.3dbx`});
  await H.open('plate.3dbx');
  await H.waitFor(()=>store.getState().result?.mesh,20000,'real model mesh');
  const v=store.viewer,r=store.getState().result;
  v.setView('front'); v.fitAll(); await H.wait(150);
  const mesh=r.mesh,pts=[];
  for(let i=0;i<mesh.positions.length;i+=3) pts.push(v.screenPoint(mesh.positions.slice(i,i+3)));
  const lo=[Math.min(...pts.map(p=>p[0]))-12,Math.min(...pts.map(p=>p[1]))-12];
  const hi=[Math.max(...pts.map(p=>p[0]))+12,Math.max(...pts.map(p=>p[1]))+12];
  const drag=async(a,b,cancel=false)=>{
    pointer('pointerdown',a,1);pointer('pointermove',b,1);await H.wait(80);
    H.check(!!document.querySelector('[data-selection-box]') && document.querySelector('[data-selection-box]').style.display==='block','selection rectangle visible');
    if(cancel) window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    pointer('pointerup',b);await H.wait(100);
  };
  store.setPickFilterKind('edges');
  await drag(lo,hi);
  H.check(store.getState().selectedElements.length===mesh.edgeRanges.length/3,'window selects every real model edge');
  H.check(store.getState().selectedElements.every(ref=>ref.kind==='edge'),'filter respected');
  const before=JSON.stringify(store.getState().selectedElements);
  await drag(lo,[lo[0]+30,lo[1]+30],true);
  H.check(JSON.stringify(store.getState().selectedElements)===before,'Esc preserves prior selection');
  store.setPickFilterKind('faces');
  await drag([hi[0],lo[1]],[lo[0],hi[1]]);
  H.check(store.getState().selectedElements.length===mesh.faceRanges.length/3,'crossing selects every real model face');
  H.check(store.getState().selectedElements.every(ref=>ref.kind==='face'),'face selection remains model-linked');
  return {pass:true,edges:mesh.edgeRanges.length/3,faces:mesh.faceRanges.length/3};
}};
