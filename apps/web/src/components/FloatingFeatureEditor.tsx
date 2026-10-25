import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@3db/i18n';
import { store, useStore } from '../state/store';
import { ActionIcon } from './ActionIcon';

/** One editor and one existing history transaction; the canvas remains interactive behind it. */
export function FloatingFeatureEditor({ title, action, error, children }: { title:string; action:string; error?:string; children:ReactNode }) {
  const root=useRef<HTMLDivElement>(null),drag=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null);
  const [position,setPosition]=useState<{left:number;top:number}|null>(null),[invalid,setInvalid]=useState(false),[applyPending,setApplyPending]=useState(false);
  const rebuilding=useStore(s=>s.rebuilding),serial=useStore(s=>s.documentSerial);
  const fit=(left:number,top:number)=>{
    const box=root.current?.getBoundingClientRect();if(!box)return;
    const minimumTop=(document.querySelector('.command-bar')?.getBoundingClientRect().bottom??0)+8;
    const minimumLeft=Math.min(document.querySelector('.viewport-canvas')?.getBoundingClientRect().left??8,Math.max(8,innerWidth-box.width-8));
    setPosition({left:Math.max(minimumLeft,Math.min(innerWidth-box.width-8,left)),top:Math.max(minimumTop,Math.min(innerHeight-box.height-8,top))});
  };
  useLayoutEffect(()=>{
    const el=root.current;if(!el)return;
    const initial=()=>{const box=el.getBoundingClientRect();fit(box.left,box.top);};
    const observer=new ResizeObserver(initial);observer.observe(el);window.addEventListener('resize',initial);initial();
    return()=>{observer.disconnect();window.removeEventListener('resize',initial);};
  },[serial]);
  useEffect(()=>{
    const el=root.current;if(!el)return;
    const check=()=>setInvalid(!!el.querySelector('input.invalid, [aria-invalid="true"]'));
    const observer=new MutationObserver(check);observer.observe(el,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-invalid']});check();return()=>observer.disconnect();
  },[]);
  const apply=()=>{
    if(document.activeElement instanceof HTMLElement&&root.current?.contains(document.activeElement))document.activeElement.blur();
    setApplyPending(true);
  };
  useEffect(()=>{
    if(!applyPending||rebuilding)return;
    // Blur may commit an input synchronously and queue a native rebuild before this effect.
    if(store.getState().rebuilding)return;
    setApplyPending(false);
    if(!error&&!invalid&&!root.current?.querySelector('input.invalid,[aria-invalid="true"]'))store.commitEdit();
  },[applyPending,rebuilding,error,invalid]);
  return createPortal(<div ref={root} className="property-manager floating-parameters" data-floating-parameters role="dialog" aria-label={title} style={position?{left:position.left,top:position.top,right:'auto'}:undefined}
    onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();store.cancelEdit();}else if(e.key==='Enter'&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLSelectElement)&&!(e.target instanceof HTMLButtonElement)){e.preventDefault();e.stopPropagation();apply();}}}>
    <div className="pm-header floating-drag" onPointerDown={e=>{if(e.button!==0||(e.target as HTMLElement).closest('button'))return;const box=root.current!.getBoundingClientRect();e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:box.left,top:box.top};}}
      onPointerMove={e=>{const d=drag.current;if(d?.id===e.pointerId)fit(d.left+e.clientX-d.x,d.top+e.clientY-d.y);}}
      onPointerUp={e=>{if(drag.current?.id===e.pointerId)drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      <ActionIcon id={action}/><span className="pm-title">{title}</span><button type="button" className="parameter-dock" disabled={invalid} title={t('pm.dockTip')} onClick={()=>store.setOptions({floatingParameters:false})}>{t('pm.dock')}</button>
    </div>
    <div className="parameter-body"><p className="parameter-hint">{t('pm.liveHint')}</p>{error&&<p className="pm-message error-text" role="alert">{error}</p>}{children}</div>
    <div className="parameter-footer"><span className="parameter-preview" role="status">{rebuilding?t('pm.previewUpdating'):invalid?t('pm.correctInput'):t('pm.previewLive')}</span><button type="button" className="pm-cancel" title={t('pm.cancel')} onClick={()=>store.cancelEdit()}>{t('pm.cancelLabel')}</button><button type="button" className="pm-ok" disabled={invalid||!!error||rebuilding} title={t('pm.ok')} onPointerDown={e=>e.preventDefault()} onClick={apply}>{t('pm.applyLabel')}</button></div>
  </div>,document.body);
}
