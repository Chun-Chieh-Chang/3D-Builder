import { t } from '@3db/i18n';
import { KernelError, type Frame, type Kernel, type ShapeId, type Vec3 } from '@3db/kernel';
import type { FlatBend, FlatNotIncluded } from './flatPattern';

export interface SheetRigid {
  R: [number, number, number, number, number, number, number, number, number];
  t: Vec3;
}
export interface SheetPanel { shape: ShapeId; toFlat: SheetRigid; unfolds?: SheetActions; feature?: string }
/** Rebuild-owned exact planar material patches and their manufacturing coordinates. */
export interface SheetMapping {
  active: boolean;
  curves?: SheetCurve[];
  order?: string[];
  frame: Frame;
  panels: SheetPanel[];
  zones: ShapeId[];
  bends: FlatBend[];
  notIncluded: FlatNotIncluded[];
}
export const SHEET_IDENTITY: SheetRigid = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
export const sheetVector = (m: SheetRigid, p: Vec3): Vec3 => [
  m.R[0] * p[0] + m.R[1] * p[1] + m.R[2] * p[2],
  m.R[3] * p[0] + m.R[4] * p[1] + m.R[5] * p[2],
  m.R[6] * p[0] + m.R[7] * p[1] + m.R[8] * p[2],
];
export const sheetPoint = (m: SheetRigid, p: Vec3): Vec3 => sheetVector(m, p).map((x, i) => x + m.t[i]!) as Vec3;
/** a after b. */
export function sheetCompose(a: SheetRigid, b: SheetRigid): SheetRigid {
  const R = Array(9).fill(0) as SheetRigid['R'];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) R[3 * i + j]! += a.R[3 * i + k]! * b.R[3 * k + j]!;
  return { R, t: sheetPoint(a, b.t) };
}
export function sheetInverse(m: SheetRigid): SheetRigid {
  const R: SheetRigid['R'] = [m.R[0], m.R[3], m.R[6], m.R[1], m.R[4], m.R[7], m.R[2], m.R[5], m.R[8]];
  return { R, t: sheetVector({ R, t: [0, 0, 0] }, m.t).map(x => -x) as Vec3 };
}
export const sheetRows = (m: SheetRigid): number[] => [m.R[0], m.R[1], m.R[2], m.t[0], m.R[3], m.R[4], m.R[5], m.t[1], m.R[6], m.R[7], m.R[8], m.t[2]];
export const sheetPlanar = (frame: Frame, p: Vec3): [number, number] => {
  const d = p.map((x, i) => x - frame.origin[i]!) as Vec3;
  return [d.reduce((a, x, i) => a + x * frame.xDir[i]!, 0), d.reduce((a, x, i) => a + x * frame.yDir[i]!, 0)];
};
export function sheetHost(k: Kernel, mapping: SheetMapping, point: Vec3): SheetPanel {
  const candidates = mapping.panels.filter(p => k.classify(p.shape, [point], 1e-6)[0] !== 'out');
  if (!candidates.length) throw new KernelError(t('sheetMapping.noPanel'));
  return candidates[0]!;
}
/** Copies the exact remaining material; never changes a caller's source patches. */
export function sheetClipPanels(k: Kernel, panels: SheetPanel[], target: ShapeId, keep: (s: ShapeId) => ShapeId): SheetPanel[] {
  return panels.flatMap(p => {
    const shape = keep(k.boolean('common', p.shape, target).shape);
    return k.massProps(shape).volume > 1e-8 ? [{ ...p, shape }] : [];
  });
}
/** Split planar patches at a new fold; its curved strip is stored separately in flat coordinates. */
export function sheetSplitPanels(k: Kernel, mapping: SheetMapping, fixed: ShapeId, moving: ShapeId, motion: SheetRigid, keep: (s: ShapeId) => ShapeId, feature?: string): SheetPanel[] {
  const a = sheetClipPanels(k, mapping.panels, fixed, keep);
  const b = sheetClipPanels(k, mapping.panels, moving, keep).map(p => ({
    ...p,
    unfolds: { ...sheetConjugate(motion, p.unfolds), ...(feature ? { [feature]: sheetInverse(motion) } : {}) },
    shape: keep(k.transformed(p.shape, sheetRows(motion))),
    toFlat: sheetCompose(p.toFlat, sheetInverse(motion)),
  }));
  return [...a, ...b];
}
export function mappedBlank(k: Kernel, m: SheetMapping, keep: (s: ShapeId) => ShapeId): ShapeId {
  const pieces = [...m.panels.map(p => keep(k.transformed(p.shape, sheetRows(p.toFlat)))), ...m.zones];
  if (!pieces.length) throw new KernelError(t('sheetMapping.noPanel'));
  let body = keep(k.copy(pieces[0]!));
  for (const piece of pieces.slice(1)) body = keep(k.boolean('fuse', body, piece).shape);
  const volume = k.massProps(body).volume;
  const expected = pieces.reduce((sum, s) => sum + k.massProps(s).volume, 0);
  if (!k.isValid(body) || k.solidCount(body) !== 1 || Math.abs(volume - expected) > 1e-6 * Math.max(1, volume)) throw new KernelError(t('sheetMapping.invalidFlat'));
  return body;
}

export type SheetActions = Record<string, SheetRigid>;
export interface SheetCurve {
  feature: string;
  name: string;
  flat: ShapeId;
  folded: ShapeId;
  map: import('@3db/kernel').SheetBendMap;
  /** Root manufacturing coordinates to the unbent strip in the current model. */
  placement: SheetRigid;
  unfolds: SheetActions;
}
export interface SheetUnfoldPiece {
  shape: ShapeId;
  toFlat: SheetRigid;
  toFolded: SheetRigid;
  unfolds: SheetActions;
  curve?: import('@3db/kernel').SheetBendMap;
  zone?: number;
  foldedCurve?: boolean;
}
export interface SheetUnfoldSession {
  feature: string;
  folded: ShapeId;
  names: import('@3db/naming').ElementNames;
  blank: ShapeId;
  current: ShapeId;
  pieces: SheetUnfoldPiece[];
  partial: boolean;
}
export const sheetConjugate = (motion: SheetRigid, a: SheetActions = {}): SheetActions => Object.fromEntries(Object.entries(a).map(([id,v])=>[id,sheetCompose(sheetCompose(motion,v),sheetInverse(motion))]));
export function sheetMapWorld(map: import('@3db/kernel').SheetBendMap, motion: SheetRigid): import('@3db/kernel').SheetBendMap {
  return {...map,center:sheetPoint(motion,map.center),axis:sheetVector(motion,map.axis),radial:sheetVector(motion,map.radial)};
}
export function sheetMapFlat(map: import('@3db/kernel').SheetBendMap, motion: SheetRigid): import('@3db/kernel').SheetBendMap {
  return {...map,flatOrigin:sheetPoint(motion,map.flatOrigin),flatAcross:sheetVector(motion,map.flatAcross),flatAlong:sheetVector(motion,map.flatAlong),flatNormal:sheetVector(motion,map.flatNormal)};
}
export function sheetMoveCurves(k:Kernel,m:SheetMapping,moving:ShapeId,motion:SheetRigid,feature:string,keep:(s:ShapeId)=>ShapeId):SheetCurve[]{
  return (m.curves??[]).map(c=>{
    const common=keep(k.boolean('common',c.folded,moving).shape),volume=k.massProps(c.folded).volume,part=k.massProps(common).volume;
    if(part<1e-8)return c;
    if(Math.abs(part-volume)>1e-6*Math.max(1,volume))throw new KernelError(t('sheetCurve.normalCut'));
    return {...c,folded:keep(k.transformed(c.folded,sheetRows(motion))),placement:sheetCompose(motion,c.placement),map:sheetMapWorld(c.map,motion),unfolds:{...sheetConjugate(motion,c.unfolds),[feature]:sheetInverse(motion)}};
  });
}
export function joinSheetPieces(k:Kernel,pieces:ShapeId[],keep:(s:ShapeId)=>ShapeId):ShapeId{
  if(!pieces.length)throw new KernelError(t('sheetMapping.noPanel'));
  let body=keep(k.copy(pieces[0]!));
  for(const piece of pieces.slice(1))body=keep(k.boolean('fuse',body,piece).shape);
  const volume=k.massProps(body).volume,expected=pieces.reduce((v,s)=>v+k.massProps(s).volume,0);
  if(!k.isValid(body)||k.solidCount(body)!==1||Math.abs(volume-expected)>1e-6*Math.max(1,expected))throw new KernelError(t('sheetMapping.invalidFlat'));
  return body;
}
export function unfoldSheetPieces(k:Kernel,m:SheetMapping,selected:readonly string[],keep:(s:ShapeId)=>ShapeId):{shape:ShapeId;pieces:SheetUnfoldPiece[]}{
  const pieces:SheetUnfoldPiece[]=m.panels.map(p=>({...p,toFolded:SHEET_IDENTITY,unfolds:p.unfolds??{}}));
  let curves=(m.curves??[]).map((c,zone)=>({...c,zone,toFolded:SHEET_IDENTITY,originalMap:c.map}));
  for(const id of [...(m.order??[])].reverse().filter(id=>selected.includes(id))){
    for(const p of pieces){
      const motion=p.unfolds[id];if(!motion)continue;
      p.shape=keep(k.transformed(p.shape,sheetRows(motion)));
      p.toFlat=sheetCompose(p.toFlat,sheetInverse(motion));
      p.toFolded=sheetCompose(p.toFolded,sheetInverse(motion));
      if(p.curve)p.curve=sheetMapFlat(p.curve,motion);
      p.unfolds=sheetConjugate(motion,p.unfolds);delete p.unfolds[id];
    }
    const rest:typeof curves=[];
    for(const c of curves){
      if(c.feature===id){
        pieces.push({shape:keep(k.transformed(c.flat,sheetRows(c.placement))),toFlat:sheetInverse(c.placement),toFolded:SHEET_IDENTITY,curve:sheetMapFlat(c.originalMap,c.placement),zone:c.zone,unfolds:{...c.unfolds}});
        continue;
      }
      const motion=c.unfolds[id];
      if(motion){
        c.folded=keep(k.transformed(c.folded,sheetRows(motion)));c.toFolded=sheetCompose(c.toFolded,sheetInverse(motion));
        c.placement=sheetCompose(motion,c.placement);c.map=sheetMapWorld(c.map,motion);c.unfolds=sheetConjugate(motion,c.unfolds);delete c.unfolds[id];
      }
      rest.push(c);
    }
    curves=rest;
  }
  pieces.push(...curves.map(c=>({shape:c.folded,toFlat:SHEET_IDENTITY,toFolded:c.toFolded,unfolds:c.unfolds,zone:c.zone,foldedCurve:true})));
  return {shape:joinSheetPieces(k,pieces.map(p=>p.shape),keep),pieces};
}
/** Pending partial machining is projected to its complete manufacturing blank on demand. */
export function sessionFlatBlank(k:Kernel,m:SheetMapping,session:SheetUnfoldSession,keep:(s:ShapeId)=>ShapeId):ShapeId{
  if(!session.partial)return keep(k.copy(session.current));
  let body=mappedBlank(k,m,keep);
  const removed=keep(k.boolean('cut',session.blank,session.current).shape);
  for(const p of session.pieces){
    const part=keep(k.boolean('common',removed,p.shape).shape);if(k.massProps(part).volume<1e-8)continue;
    if(p.foldedCurve)throw new KernelError(t('sheetCurve.notUnfolded'));
    const flat=keep(k.transformed(part,sheetRows(p.toFlat)));body=keep(k.boolean('cut',body,flat).shape);
  }
  return body;
}
