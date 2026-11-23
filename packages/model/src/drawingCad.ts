/** Detached, editable 2D CAD entities. They never pretend to reference a 3D model. */
export type CadPoint = [number, number];
export type CadDimensionGeometry =
  | { kind: 'linear'; a: CadPoint; b: CadPoint; line: CadPoint; rotation?: number }
  | { kind: 'diameter'; far: CadPoint; near: CadPoint; leader: number }
  | { kind: 'radius'; centre: CadPoint; near: CadPoint; leader: number }
  | { kind: 'angular'; first: [CadPoint, CadPoint]; second: [CadPoint, CadPoint]; arc: CadPoint };
export interface CadAppearance { layer: string; color?: string; width?: number }
export type CadItem = CadAppearance & (
  | { kind: 'polyline'; points: number[]; closed?: boolean; filled?: boolean }
  | { kind: 'text'; at: CadPoint; text: string; height: number; angle?: number; anchor?: 'left' | 'center' | 'right' }
);
export type CadEntity = (CadItem | (CadAppearance & { kind: 'dimension'; text: string; textAt: CadPoint; geometry: CadDimensionGeometry; items: CadItem[] })) & { id: string };
export interface CadLayer { name: string; color?: string; width: number; dash?: number[]; hidden?: boolean }
export interface CadDrawing { width: number; height: number; source: string; entities: CadEntity[]; layers: CadLayer[]; sourceOrigin?: CadPoint }

/** Expands the visible paper around edits without changing a user's coordinates or the original CAD origin. */
export function cadDrawingBounds(cad: CadDrawing): { width: number; height: number; origin: CadPoint } {
  let x0 = 0, y0 = 0, x1 = cad.width, y1 = cad.height;
  const include = (x: number, y: number) => { x0 = Math.min(x0, x - 10); y0 = Math.min(y0, y - 10); x1 = Math.max(x1, x + 10); y1 = Math.max(y1, y + 10); };
  for (const entity of cad.entities) for (const i of entity.kind === 'dimension' ? entity.items : [entity]) {
    if (i.kind === 'text') { include(i.at[0], i.at[1]); include(i.at[0] + i.text.length * i.height, i.at[1] + 2 * i.height); }
    else for (let k = 0; k < i.points.length; k += 2) include(i.points[k]!, i.points[k + 1]!);
  }
  return { width: x1 - x0, height: y1 - y0, origin: [x0, y0] };
}

export function moveCadEntity(entity: CadEntity, dx: number, dy: number): CadEntity {
  const p = (a: CadPoint): CadPoint => [a[0] + dx, a[1] + dy];
  const item = (i: CadItem): CadItem => i.kind === 'text' ? { ...i, at: p(i.at) } : { ...i, points: i.points.map((v, k) => v + (k % 2 ? dy : dx)) };
  if (entity.kind !== 'dimension') return { ...item(entity), id: entity.id };
  const g = entity.geometry;
  const geometry: CadDimensionGeometry = g.kind === 'linear' ? { ...g, a: p(g.a), b: p(g.b), line: p(g.line) }
    : g.kind === 'radius' ? { ...g, centre: p(g.centre), near: p(g.near) }
      : g.kind === 'diameter' ? { ...g, far: p(g.far), near: p(g.near) }
        : { ...g, first: [p(g.first[0]), p(g.first[1])], second: [p(g.second[0]), p(g.second[1])], arc: p(g.arc) };
  return { ...entity, textAt: p(entity.textAt), geometry, items: entity.items.map(item) };
}

export function checkCadDrawing(value: unknown): asserts value is CadDrawing {
  const fail = (): never => { throw new Error('Invalid imported CAD drawing: finite coordinates, positive sizes, unique ids and valid colors/layers are required.'); };
  const obj = (v: unknown): Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : fail();
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9;
  const positive = (v: unknown) => finite(v) && v > 0;
  const point = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(finite);
  const color = (v: unknown) => v === undefined || (typeof v === 'string' && /^#[\da-f]{6}$/i.test(v));
  const d = obj(value);
  if (!positive(d.width) || !positive(d.height) || typeof d.source !== 'string' || !Array.isArray(d.entities) || d.entities.length > 100000 || !Array.isArray(d.layers) || d.layers.length > 10000) fail();
  if (d.sourceOrigin !== undefined && !point(d.sourceOrigin)) fail();
  const layers = new Set<string>();
  for (const raw of d.layers) {
    const l = obj(raw);
    if (typeof l.name !== 'string' || !l.name.length || l.name.length > 255 || /[\x00-\x1f<>\/\\":;?*|=]/.test(l.name) || layers.has(l.name) || !color(l.color) || !positive(l.width) || (l.hidden !== undefined && typeof l.hidden !== 'boolean') || (l.dash !== undefined && (!Array.isArray(l.dash) || l.dash.length > 100 || !l.dash.every(positive)))) fail();
    layers.add(l.name);
  }
  let vertices = 0;
  const item = (raw: unknown) => {
    const e = obj(raw);
    if (!layers.has(e.layer) || !color(e.color) || (e.width !== undefined && !positive(e.width))) fail();
    if (e.kind === 'polyline') {
      if (!Array.isArray(e.points) || e.points.length < 4 || e.points.length % 2 || !e.points.every(finite) || (e.closed !== undefined && typeof e.closed !== 'boolean') || (e.filled !== undefined && typeof e.filled !== 'boolean')) fail();
      vertices += e.points.length / 2;
    } else if (e.kind === 'text') {
      if (!point(e.at) || typeof e.text !== 'string' || e.text.length > 100000 || !positive(e.height) || (e.angle !== undefined && !finite(e.angle)) || (e.anchor !== undefined && !['left', 'center', 'right'].includes(e.anchor))) fail();
    } else fail();
  };
  const ids = new Set<string>();
  for (const raw of d.entities) {
    const e = obj(raw);
    if (typeof e.id !== 'string' || !e.id.length || ids.has(e.id)) fail();
    ids.add(e.id);
    if (e.kind !== 'dimension') item(e);
    else {
      if (!layers.has(e.layer) || !color(e.color) || (e.width !== undefined && !positive(e.width)) || typeof e.text !== 'string' || e.text.length > 100000 || !point(e.textAt) || !Array.isArray(e.items) || e.items.length > 10000) fail();
      e.items.forEach(item);
      const g = obj(e.geometry);
      if (g.kind === 'linear') { if (![g.a, g.b, g.line].every(point) || (g.rotation !== undefined && !finite(g.rotation))) fail(); }
      else if (g.kind === 'radius') { if (!point(g.centre) || !point(g.near) || !finite(g.leader)) fail(); }
      else if (g.kind === 'diameter') { if (!point(g.far) || !point(g.near) || !finite(g.leader)) fail(); }
      else if (g.kind === 'angular') { if (![g.first, g.second].every((a) => Array.isArray(a) && a.length === 2 && a.every(point)) || !point(g.arc)) fail(); }
      else fail();
    }
    if (vertices > 1000000) fail();
  }
}
