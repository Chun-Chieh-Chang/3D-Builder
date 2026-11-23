import { cadDrawingBounds, moveCadEntity, type CadDrawing, type CadItem } from '@3db/model';
import type { Scene, SceneItem } from './scene';

export function cadScene(cad: CadDrawing, includeHidden = false): Scene {
  const items: SceneItem[] = [];
  const layers = new Map(cad.layers.map((l) => [l.name, l]));
  const dimensions: NonNullable<Scene['dimensions']> = [];
  const add = (i: CadItem, owner: string, group?: string, color?: string) => {
    const layer = layers.get(i.layer);
    if (layer?.hidden && !includeHidden) return;
    const ink = i.color ?? color;
    const common = { owner, ...(group ? { group } : {}), color: ink ?? layer?.color ?? '#000000', byLayer: ink === undefined };
    if (i.kind === 'polyline') items.push({ ...i, ...common, style: 'thin', width: i.width ?? layer?.width ?? 0.25 });
    else items.push({ ...i, ...common });
  };
  for (const e of cad.entities) {
    if (layers.get(e.layer)?.hidden && !includeHidden) continue;
    if (e.kind === 'dimension') {
      dimensions.push({ id: e.id, text: e.text, textAt: e.textAt, geometry: e.geometry, layer: e.layer, color: e.color, byLayer: e.color === undefined });
      e.items.forEach((i) => add(i, e.id, e.id, e.color));
    } else add(e, e.id);
  }
  const bounds = cadDrawingBounds(cad);
  const [x, y] = bounds.origin;
  return { width: bounds.width, height: bounds.height,
    items: items.map((i) => i.kind === 'text' ? { ...i, at: [i.at[0] - x, i.at[1] - y] } : { ...i, points: i.points.map((v, k) => v - (k % 2 ? y : x)) }),
    dimensions: dimensions.map((d) => {
      const moved = moveCadEntity({ ...d, kind: 'dimension', layer: d.layer ?? 'DIMENSION', items: [] }, -x, -y);
      return moved.kind === 'dimension' ? { ...d, geometry: moved.geometry, textAt: moved.textAt } : d;
    }),
    cadLayers: cad.layers, cadOrigin: [(cad.sourceOrigin?.[0] ?? 0) + x, (cad.sourceOrigin?.[1] ?? 0) + y], ...(includeHidden ? {} : { cadSource: cad }),
  };
}
