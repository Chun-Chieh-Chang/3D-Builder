import { t } from '@3db/i18n';
import { IdAllocator, idsInUse, type Feature, type PartDoc } from '@3db/model';
import type { EntranceTarget } from '@3db/regen';
/** Existing persistent features, not frozen mesh coordinates or a second cone algorithm. */
export function entranceFeatures(doc: PartDoc, target: EntranceTarget): Feature[] {
  if (![target.diameter, target.opening].every(x => Number.isFinite(x) && x > 0) || target.opening < target.diameter - 1e-7) throw new Error(t('entrance.pick'));
  const ids = new IdAllocator(doc.idCounters, idsInUse(doc));
  const center = ids.take('point'), sketch = ids.take('sketch'), hole = ids.take('hole'), point = ids.take('p');
  const diameter = Number(target.diameter.toPrecision(12));
  const opening = Number((target.opening + 0.4).toPrecision(12));
  return [
    { id: center, type: 'refPoint', name: t('entrance.center'), suppressed: false, def: { mode: 'center', element: target.center } },
    { id: sketch, type: 'sketch', name: t('entrance.position'), suppressed: false, plane: target.plane, attach: { origin: { kind: 'datum', name: center } }, entities: [{ id: point, type: 'point', x: 0, y: 0 }], constraints: [{ id: ids.take('c'), type: 'coincident', a: point, b: '@origin' }] },
    { id: hole, type: 'hole', name: t('entrance.title'), suppressed: false, sketch, kind: 'countersink', diameter: String(diameter), csDiameter: String(opening), csAngle: '90deg', end: { type: 'blind', depth: String(Number(((opening - diameter) / 2 + 0.001).toPrecision(12))) } },
  ];
}
