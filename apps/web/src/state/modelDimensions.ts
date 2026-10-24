import { t } from '@3db/i18n';
import { isDimension, type Command, type Feature, type PartDoc } from '@3db/model';

export interface ModelDimensionField { id: string; label: string; value: string; command(value: string): Command }

/** Existing model commands, shared by the 3D editor and its acceptance tests. No second set of dimension values. */
export function modelDimensionFields(doc: PartDoc, feature: Feature): ModelDimensionField[] {
  const fields: ModelDimensionField[] = [];
  const add=(id:string,label:string,value:string,command:(value:string)=>Command)=>fields.push({id,label,value,command});
  if(feature.type==='extrude') for(const dir of ['dir1','dir2'] as const) {
    const end=feature[dir];
    if(end && (end.type==='blind'||end.type==='midPlane')) add(dir,t(dir==='dir1'?'modelDimensions.depth1':'modelDimensions.depth2'),end.depth,value=>({type:'setEndCondition',featureId:feature.id,dir,value:{...end,depth:value}}));
  }
  if(feature.type==='revolve') add('angle',t('modelDimensions.angle'),feature.dir1.angle,value=>({type:'setRevolveCondition',featureId:feature.id,value:{...feature.dir1,angle:value}}));
  if(feature.type==='fillet' && !feature.variable?.length) add('radius',t('modelDimensions.radius'),feature.radius,value=>({type:'setFilletRadius',featureId:feature.id,value}));
  if(feature.type==='chamfer') for(const key of ['distance','second'] as const) {
    if(feature[key]!==undefined) add(key,t(key==='distance'?'modelDimensions.distance':'modelDimensions.second'),feature[key]!,value=>({type:'setChamfer',featureId:feature.id,value:{mode:feature.mode,distance:feature.distance,second:feature.second,flip:feature.flip,[key]:value}}));
  }
  const ids = feature.type==='sketch' ? [feature.id] : 'sketch' in feature && feature.sketch ? [feature.sketch] : feature.type==='loft' ? feature.sections : [];
  for(const id of ids) {
    const sketch=doc.features.find(f=>f.id===id);
    if(sketch?.type!=='sketch')continue;
    for(const c of sketch.constraints) if(isDimension(c) && c.driving!==false) add(`${id}:${c.id}`,`${sketch.name} / ${c.label ?? c.id}`,c.value,value=>({type:'setDimension',featureId:id,constraintId:c.id,value}));
  }
  return fields;
}
