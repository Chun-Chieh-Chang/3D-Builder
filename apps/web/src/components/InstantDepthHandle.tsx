import { ToolButton } from './ToolButton';
import { useEffect, useRef, useState } from 'react';
import { t } from '@3db/i18n';
import { Parameters } from '@3db/model';
import { ownerFeatures } from '@3db/naming';
import { store, useStore } from '../state/store';
import { draggedDepth } from '../state/instantDepth';

/** A cap handle previews the actual axial displacement; release is one normal model command. */
export function InstantDepthHandle() {
  const [enabled,setEnabled]=useState(false),[tick,setTick]=useState(0),[preview,setPreview]=useState<number|null>(null),[invalid,setInvalid]=useState(false);
  const doc=useStore(s=>s.doc),result=useStore(s=>s.result),selected=useStore(s=>s.selected),face=useStore(s=>s.selectedFace),editing=useStore(s=>s.editing),measure=useStore(s=>s.measure);
  const cleanup=useRef<(()=>void)|null>(null);
  useEffect(()=>{const v=store.viewer;return v?.subscribeView(()=>setTick(n=>n+1));},[result,enabled]);
  useEffect(()=>()=>cleanup.current?.(),[]);
  const id=face?ownerFeatures(face.name).find(id=>doc.features.some(f=>f.id===id&&f.type==='extrude')):selected;
  const feature=doc.features.find(f=>f.id===id);
  const cap=result?.faceNames.findIndex(name=>name===`${id}:cap:end`)??-1;
  const center=cap>=0?result?.faceFingerprints[cap]?.center:undefined;
  const frame=feature?.type==='extrude'?result?.frames.get(feature.sketch):undefined;
  let depth=0;
  if(feature?.type==='extrude' && feature.dir1.type==='blind')try{depth=new Parameters(doc).evaluate(feature.dir1.depth,'length');}catch{/* invalid feature has no handle */}
  const eligible=enabled&&!editing&&!measure&&feature?.type==='extrude'&&feature.dir1.type==='blind'&&!feature.dir2&&center&&frame&&depth>0;
  const v=store.viewer,host=document.querySelector('.viewport-canvas')?.getBoundingClientRect();
  const at=eligible&&v?v.screenPoint(center):null;
  const n=eligible?frame.normal:undefined;
  const sign=eligible?((center[0]-frame.origin[0])*n![0]+(center[1]-frame.origin[1])*n![1]+(center[2]-frame.origin[2])*n![2]>=0?1:-1):1;
  let axis=at&&n&&v?v.screenPoint(center!.map((value,i)=>value+sign*n[i]!)).map((value,i)=>value-at[i]!):[0,-1];
  if(at&&v&&Math.hypot(...axis)<1e-4){
    const scale=Math.max(...[0,1,2].map(k=>Math.hypot(...v.screenPoint(center!.map((value,i)=>value+(i===k?1:0))).map((value,i)=>value-at[i]!))));
    axis=[0,-scale]; // End-on: the screen-up ruler still reports model millimetres.
  }
  const len=Math.hypot(...axis),u=axis.map(value=>value/(len||1)),shown=preview??depth;
  const direct=feature?.type==='extrude'&&feature.dir1.type==='blind'&&/^\s*\d+(?:\.\d*)?(?:e[+-]?\d+)?\s*$/i.test(feature.dir1.depth);
  const down=(event:React.PointerEvent<HTMLButtonElement>)=>{
    if(!eligible||!direct||feature.type!=='extrude'||feature.dir1.type!=='blind'||event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    const from=[event.clientX,event.clientY],before=doc,end=feature.dir1,start=depth;
    let value=depth,bad=false;
    const stop=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('keydown',key,true);cleanup.current=null;setPreview(null);setInvalid(false);};
    const move=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;e.preventDefault();e.stopImmediatePropagation();try{value=draggedDepth(start,from,[e.clientX,e.clientY],axis);bad=false;setPreview(value);setInvalid(false);}catch{bad=true;setInvalid(true);}};
    const cancel=()=>stop();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();stop();}};
    const up=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;move(e);stop();if(bad)return store.notify(t('instant3d.positive'),'error');if(store.getState().doc!==before)return store.notify(t('instant3d.changed'),'error');if(value!==start)store.execute({type:'setEndCondition',featureId:feature.id,dir:'dir1',value:{...end,depth:String(value)}});};
    cleanup.current=stop;setPreview(depth);window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('keydown',key,true);
  };
  void tick;
  return <>
    <div style={{position:'absolute',right:16,bottom:16,zIndex:5}}><ToolButton action={{id:'instant3D',label:t('instant3d.name'),group:'view',enabled:()=>true,run:()=>{}}} active={enabled} pressed={enabled} description={t('instant3d.tip')} onClick={()=>{cleanup.current?.();setEnabled(value=>!value);}}/></div>
    {at&&host&&eligible&&<div data-instant-depth={feature.id} style={{position:'absolute',left:at[0]-host.left,top:at[1]-host.top,zIndex:5,pointerEvents:'none'}}>
      <svg width="220" height="220" viewBox="-110 -110 220 220" style={{position:'absolute',left:-110,top:-110,overflow:'visible'}}>
        <line x1="0" y1="0" x2={u[0]!*90} y2={u[1]!*90} stroke="var(--accent)"/>
        {[0,20,40,60,80].map(px=><line key={px} x1={u[0]!*px-u[1]!*4} y1={u[1]!*px+u[0]!*4} x2={u[0]!*px+u[1]!*4} y2={u[1]!*px-u[0]!*4} stroke="var(--accent)"/>)}
      </svg>
      <button data-action="instantDepthDrag" disabled={!direct} onPointerDown={down} title={t(direct?'instant3d.drag':'instant3d.expression')} style={{position:'absolute',left:u[0]!*(24+(shown-depth)*len)-12,top:u[1]!*(24+(shown-depth)*len)-12,pointerEvents:'auto',cursor:'ns-resize',whiteSpace:'nowrap',color:invalid?'var(--error)':'var(--accent)'}}>
        ↔ {Number(shown.toFixed(3))} mm
      </button>
    </div>}
  </>;
}
