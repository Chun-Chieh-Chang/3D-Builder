import { useEffect, useRef, useState } from 'react';
import { Parameters, type ExtrudeFeature } from '@3db/model';
import { t } from '@3db/i18n';
import { store, useStore } from '../state/store';
import { draggedExtrusion } from '../state/instantDepth';

/** During construction the pointer changes the real feature, not just a ruler label. */
export function ExtrudePreviewHandle() {
  const editing=useStore(s=>s.editing),doc=useStore(s=>s.doc),result=useStore(s=>s.result);
  const [tick,setTick]=useState(0),[shown,setShown]=useState<number|null>(null),[invalid,setInvalid]=useState(false);
  const cleanup=useRef<(()=>void)|null>(null);
  useEffect(()=>store.viewer?.subscribeView(()=>setTick(n=>n+1)),[editing?.featureId]);
  useEffect(()=>()=>cleanup.current?.(),[editing?.featureId]);
  const f=doc.features.find(f=>f.id===editing?.featureId);
  if(editing?.kind!=='feature'||f?.type!=='extrude'||(f.dir1.type!=='blind'&&f.dir1.type!=='midPlane'))return null;
  const frame=result?.frames.get(f.sketch);if(!frame)return null;
  let depth:number;try{depth=new Parameters(doc).evaluate(f.dir1.depth,'length');}catch{return null;}
  if(!(depth>0))return null;
  const cap=result?.faceNames.findIndex(name=>name===`${f.id}:cap:end`)??-1;
  const center=cap>=0?result?.faceFingerprints[cap]?.center:undefined;
  if(!center)return null;
  const viewer=store.viewer,host=document.querySelector('.viewport-canvas')?.getBoundingClientRect();if(!viewer||!host)return null;
  const at=viewer.screenPoint(center),one=viewer.screenPoint(center.map((v,i)=>v+frame.normal[i]!) as [number,number,number]);
  const scaleFactor=f.dir1.type==='midPlane'?0.5:1;
  let axis=[(one[0]!-at[0]!)*scaleFactor,(one[1]!-at[1]!)*scaleFactor];
  if(Math.hypot(...axis)<1e-4){const scale=scaleFactor/viewer.pixelSize();axis=[0,-scale];}
  const n=Math.hypot(...axis),signed=f.dir1.type==='blind'&&f.dir1.reverse?-depth:depth;
  const u=axis.map(v=>v/n*(signed<0?-1:1));
  const direct=/^\s*\d+(?:\.\d*)?(?:e[+-]?\d+)?\s*$/i.test(f.dir1.depth);
  const down=(event:React.PointerEvent<HTMLButtonElement>)=>{
    if(event.button!==0||!direct)return;
    event.preventDefault();event.stopPropagation();
    const feature=f as ExtrudeFeature,original=f.dir1,from=[event.clientX,event.clientY],session=editing.featureId;
    let value=signed,bad=false,last=0,timer:ReturnType<typeof setTimeout>|null=null;
    const apply=()=>{timer=null;if(store.getState().editing?.featureId!==session)return;const distance=value<0?-value:value;if(original.type==='midPlane')store.execute({type:'setEndCondition',featureId:feature.id,dir:'dir1',value:{type:'midPlane',depth:String(distance)}});else store.execute({type:'setEndCondition',featureId:feature.id,dir:'dir1',value:{type:'blind',depth:String(distance),...(value<0?{reverse:true}:{})}});};
    const stop=()=>{if(store.cancelFeatureGesture===restore)store.cancelFeatureGesture=null;if(timer)clearTimeout(timer);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('keydown',key,true);cleanup.current=null;setShown(null);setInvalid(false);};
    const restore=()=>{stop();if(store.getState().editing?.featureId===session)store.execute({type:'setEndCondition',featureId:feature.id,dir:'dir1',value:original});};
    const move=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;e.preventDefault();e.stopImmediatePropagation();try{value=draggedExtrusion(signed,from,[e.clientX,e.clientY],axis);if(original.type==='midPlane'&&value<0)throw new Error('Symmetric depth must be positive');bad=false;setInvalid(false);setShown(value);const now=performance.now();if(now-last>=70){if(timer)clearTimeout(timer);apply();last=now;}else if(!timer)timer=setTimeout(apply,70-(now-last));}catch{bad=true;if(timer){clearTimeout(timer);timer=null;}setInvalid(true);}};
    const up=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;move(e);if(bad){restore();store.notify(t(original.type==='midPlane'?'instant3d.positive':'extrude.dragNonzero'),'error');}else{apply();stop();}};
    const cancel=()=>restore();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();restore();}};
    cleanup.current=stop;store.cancelFeatureGesture=restore;setShown(signed);window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);window.addEventListener('keydown',key,true);
  };
  void tick;
  return <div className="extrude-preview-handle" data-extrude-preview={f.id} style={{left:at[0]!-host.left,top:at[1]!-host.top}}><svg width="140" height="140" viewBox="-70 -70 140 140" aria-hidden="true"><path d={`M0 0L${u[0]!*56} ${u[1]!*56}`} stroke="var(--accent)" strokeWidth="3"/><path d={`M${u[0]!*56} ${u[1]!*56}L${u[0]!*43-u[1]!*6} ${u[1]!*43+u[0]!*6}L${u[0]!*43+u[1]!*6} ${u[1]!*43-u[0]!*6}Z`} fill="var(--accent)"/></svg><button type="button" data-action="drag-extrude-preview" disabled={!direct} aria-invalid={invalid} title={t(direct?'extrude.dragHint':'instant3d.expression')} onPointerDown={down} style={{left:u[0]!*38,top:u[1]!*38}}>{Number((shown??signed).toFixed(3))} mm</button></div>;
}
