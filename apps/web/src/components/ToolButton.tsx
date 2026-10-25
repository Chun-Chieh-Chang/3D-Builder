import {useEffect,useId,useRef,useState}from 'react';
import {createPortal}from 'react-dom';
import {shortcutOf,type UiAction}from '../actions';
import {topicOf}from '../help/context';
import {ActionIcon}from './ActionIcon';

/** The same help catalog supplies hover, keyboard focus and the full F1 help. */
export function ToolButton({action,disabled=false,active=false,onClick,description,shutdown=false,menuItem=false,pressed}:{action:UiAction;disabled?:boolean;active?:boolean;onClick:()=>void;description?:string;shutdown?:boolean;menuItem?:boolean;pressed?:boolean}) {
 const [visible,setVisible]=useState(false),[position,setPosition]=useState({left:8,top:8,above:false});
 const anchor=useRef<HTMLSpanElement>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),id=useId();
 const hide=()=>{clearTimeout(timer.current);setVisible(false);};
 const show=(delay:number)=>{clearTimeout(timer.current);timer.current=setTimeout(()=>{const rect=anchor.current?.getBoundingClientRect();if(!rect||!rect.width)return;const above=window.innerHeight-rect.bottom<180&&rect.top>window.innerHeight-rect.bottom;setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-Math.min(360,window.innerWidth-16)-8)),top:above?rect.top-8:rect.bottom+8,above});setVisible(true);},delay);};
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 useEffect(()=>{
  if(!visible)return;
  const close=(e:Event)=>{if(e.target instanceof Element&&e.target.closest('.tool-popover'))return;hide();},key=(e:KeyboardEvent)=>{if(e.key==='Escape')hide();};
  window.addEventListener('keydown',key,true);window.addEventListener('pointerdown',close,true);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);
  return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('pointerdown',close,true);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);};
 },[visible]);
 const topic=visible?topicOf(action.id):null,shortcut=visible?shortcutOf(action):undefined;
 return <span ref={anchor} className="tool-tip-anchor" onPointerEnter={()=>show(300)} onPointerLeave={()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>setVisible(false),180);}} onFocusCapture={()=>show(0)} onBlurCapture={hide}>
  <button role={menuItem?(action.active?'menuitemcheckbox':'menuitem'):undefined} className={`tool tool-icon${active?' active':''}`} data-help={action.id} data-action={action.id} data-shutdown={shutdown?true:undefined} aria-label={action.label} aria-describedby={visible?id:undefined} aria-checked={menuItem&&action.active?active:undefined} aria-pressed={!menuItem?(pressed??(action.active?active:undefined)):undefined} disabled={disabled} onClick={()=>{hide();onClick();}}>
   <ActionIcon id={action.id} group={action.group}/><span className="sr-only">{action.label}</span>
  </button>
  {visible&&createPortal(<div id={id} role="tooltip" className={`tool-popover${position.above?' above':''}`} style={{left:position.left,top:position.top,maxHeight:Math.max(80,Math.min(480,position.above?position.top-8:window.innerHeight-position.top-8))}} onPointerEnter={()=>clearTimeout(timer.current)} onPointerLeave={hide}>
   <div className="tool-popover-title"><strong>{action.label}</strong>{shortcut&&<kbd>{shortcut}</kbd>}</div>
   {(description??topic?.summary)&&<p>{description??topic?.summary}</p>}
   {topic?.body.length? <div className="tool-popover-body">{topic.body.map((paragraph,i)=><p key={i}>{paragraph}</p>)}</div>:null}
  </div>,document.body)}
 </span>;
}
