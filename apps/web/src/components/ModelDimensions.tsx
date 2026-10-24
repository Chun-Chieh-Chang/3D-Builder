import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import { store, useStore } from '../state/store';
import { modelDimensionFields, type ModelDimensionField } from '../state/modelDimensions';

function DimensionField({field}:{field:ModelDimensionField}) {
  const [draft,setDraft]=useState(field.value),[invalid,setInvalid]=useState(false);
  useEffect(()=>{setDraft(field.value);setInvalid(false);},[field.value]);
  return <label style={{display:'flex',gap:8,justifyContent:'space-between',margin:'4px 0'}}><span>{field.label}</span>
    <input data-model-dimension={field.id} aria-label={field.label} aria-invalid={invalid} value={draft} style={{width:100}} onChange={e=>{setDraft(e.target.value);setInvalid(false);}}
      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(draft!==field.value)setInvalid(!store.execute(field.command(draft)));}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setDraft(field.value);setInvalid(false);}}}/>
  </label>;
}

/** A face's real model dimensions, anchored in the graphics area. Enter changes one SSOT parameter and one undo step. */
export function ModelDimensions({id,faceName,onClose}:{id:string;faceName:string;onClose:()=>void}) {
  const doc=useStore(s=>s.doc),result=useStore(s=>s.result),editing=useStore(s=>s.editing);
  const [,tick]=useState(0);
  useEffect(()=>store.viewer?.subscribeView(()=>tick(v=>v+1)),[]);
  useEffect(()=>{if(editing)onClose();},[editing]);
  const feature=doc.features.find(f=>f.id===id);
  const face=result?.faceNames.indexOf(faceName)??-1, center=face>=0?result?.faceFingerprints[face]?.center:null;
  const at=center&&store.viewer?.screenPoint(center),host=document.querySelector('.viewport-canvas')?.getBoundingClientRect();
  if(!feature||!at||!host||editing)return null;
  const fields=modelDimensionFields(doc,feature);
  return <div data-model-dimensions={id} style={{position:'absolute',zIndex:8,left:Math.max(8,Math.min(at[0]-host.left,host.width-310)),top:Math.max(8,Math.min(at[1]-host.top,host.height-250)),maxHeight:240,overflow:'auto',width:290,padding:10,background:'var(--bg)',border:'1px solid var(--accent)',borderRadius:5}}>
    <button aria-label={t('modelDimensions.close')} onClick={onClose} style={{float:'right'}}>×</button><strong>{feature.name}</strong>
    {fields.map(field=><DimensionField key={field.id} field={field}/>)}
    <p className="pm-hint">{t(fields.length?'modelDimensions.hint':'modelDimensions.none')}</p>
  </div>;
}
