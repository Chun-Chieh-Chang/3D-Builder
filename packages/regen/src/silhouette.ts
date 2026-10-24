import { t } from '@3db/i18n';
import type { Kernel, ShapeId, Topology } from '@3db/kernel';
import type { PlaneFrame, Ref } from '@3db/model';
import { resolveRef, type ElementNames } from '@3db/naming';
import { ReferenceProblem, type Projected, type Converted } from './references';

/** One rebuild's contours: every entity referencing the same face shares one HLR evaluation. */
export function silhouetteProjector(kernel:Kernel,shape:ShapeId,names:ElementNames,topology:Topology,frame:PlaneFrame) {
  const cache=new Map<string,Projected[]>();
  const all=(ref:Ref):Projected[]=>{
    if(ref.kind!=='face')throw new ReferenceProblem(t('silhouette.empty'));
    const old=cache.get(ref.name);if(old)return old;
    const found=resolveRef(ref,names,topology);
    if(!found.ok)throw new ReferenceProblem(t('reference.lost'),[{ref,reason:found.reason,candidates:found.candidates}]);
    const projected:Projected[]=kernel.silhouetteCurves(shape,found.index,frame).map(s=>s.kind==='arc'?{kind:'arc',c:s.c,r:s.r,start:s.from,end:s.to}:s.kind==='ellipse'?(()=>{throw new ReferenceProblem(t('silhouette.empty'));})():s);
    cache.set(ref.name,projected);return projected;
  };
  return { all, branch:(ref:Ref):Projected=>{
    const i=ref.silhouette;
    if(i===undefined||!Number.isInteger(i)||i<0)throw new ReferenceProblem(t('silhouette.empty'));
    const branch=all(ref)[i];if(!branch)throw new ReferenceProblem(t('reference.changedKind',{id:ref.name}));return branch;
  } };
}
export function silhouetteItems(projector:ReturnType<typeof silhouetteProjector>,faces:Ref[]):Converted[] {
  return faces.flatMap(ref=>projector.all(ref).map((projected,silhouette)=>({ref:{...ref,silhouette},projected})));
}
