import { t } from '@3db/i18n';
import { KernelError, type Frame, type Kernel, type ShapeId, type Vec3 } from '@3db/kernel';
import type { FlatBend, FlatNotIncluded } from './flatPattern';

export interface SheetRigid {
  R: [number, number, number, number, number, number, number, number, number];
  t: Vec3;
}
export interface SheetPanel { shape: ShapeId; toFlat: SheetRigid }
/** Rebuild-owned exact planar material patches and their manufacturing coordinates. */
export interface SheetMapping {
  active: boolean;
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
    return k.massProps(shape).volume > 1e-8 ? [{ shape, toFlat: p.toFlat }] : [];
  });
}
/** Split planar patches at a new fold; its curved strip is stored separately in flat coordinates. */
export function sheetSplitPanels(k: Kernel, mapping: SheetMapping, fixed: ShapeId, moving: ShapeId, motion: SheetRigid, keep: (s: ShapeId) => ShapeId): SheetPanel[] {
  const a = sheetClipPanels(k, mapping.panels, fixed, keep);
  const b = sheetClipPanels(k, mapping.panels, moving, keep).map(p => ({
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
