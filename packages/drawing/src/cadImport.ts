import { checkCadDrawing, createEmptyDrawing, moveCadEntity, type CadAppearance, type CadDrawing, type CadEntity, type CadItem, type CadLayer, type CadPoint, type DrawingDoc } from '@3db/model';
import { readDxf, type DxfDimension, type DxfEntity } from './dxfRead';
import ACI_COLORS from './aciColors';

const val = (e: { pairs: [number, string][] }, code: number) => e.pairs.find(([c]) => c === code)?.[1];
const num = (e: { pairs: [number, string][] }, code: number, fallback = 0) => val(e, code) === undefined ? fallback : Number(val(e, code));
const point = (e: DxfEntity, code = 10): CadPoint => [num(e, code), num(e, code + 10)];
const hex = (v: number) => `#${v.toString(16).padStart(6, '0').toUpperCase()}`;
export function cadIndexedColor(index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 255) throw new Error('Invalid CAD indexed color.');
  return index === 7 ? '#000000' : hex(ACI_COLORS[index]!);
}
function ink(e: { pairs: [number, string][] }): string | undefined {
  const rgb = val(e, 420);
  if (rgb !== undefined) {
    const n = Number(rgb);
    if (!Number.isInteger(n) || n < 0 || n > 0xffffff) throw new Error('Invalid CAD RGB color.');
    return hex(n);
  }
  const index = Math.abs(num(e, 62, 256));
  if (index === 0 || index === 256) return undefined;
  if (!Number.isInteger(index) || index < 1 || index > 255) throw new Error('Invalid CAD indexed color.');
  // ACI 7 switches white/black with the CAD background; paper in this app is white.
  return cadIndexedColor(index);
}

/** DXF $INSUNITS code → millimetres per drawing unit. Codes not listed here are refused; 0 (unitless) is read as millimetres with a notice. */
const CAD_UNIT_MM: Record<number, number | undefined> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 9: 0.0254, 10: 914.4, 13: 0.001, 14: 100 };

type DimGeometry = Extract<CadEntity, { kind: 'dimension' }>['geometry'];
const fmt = (v: number): string => (Math.round(v * 1000) / 1000).toString();

/** The standard-style drawing of a dimension whose own graphics block is missing: extension lines, the dimension line with arrowheads, and the measured text. Millimetres. */
/** The dimension line of a linear dimension: its direction and the two points where the extension lines meet it. */
function linearDimensionLine(g: Extract<DimGeometry, { kind: 'linear' }>): { u: CadPoint; n: CadPoint; p1: CadPoint; p2: CadPoint } {
  const len = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) || 1;
  const u: CadPoint = g.rotation === undefined ? [(g.b[0] - g.a[0]) / len, (g.b[1] - g.a[1]) / len] : [Math.cos(g.rotation * Math.PI / 180), Math.sin(g.rotation * Math.PI / 180)];
  const n: CadPoint = [-u[1], u[0]];
  const onLine = (p: CadPoint): CadPoint => { const k = (g.line[0] - p[0]) * n[0] + (g.line[1] - p[1]) * n[1]; return [p[0] + n[0] * k, p[1] + n[1] * k]; };
  return { u, n, p1: onLine(g.a), p2: onLine(g.b) };
}

/** Some CAD files leave a dimension's text position at (0, 0) meaning "not set": put the text on the middle of the dimension line (a little above a linear one). */
function defaultTextAt(g: DimGeometry): CadPoint {
  const mid = (p: CadPoint, q: CadPoint): CadPoint => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (g.kind === 'linear') { const { n, p1, p2 } = linearDimensionLine(g); const m = mid(p1, p2); return [m[0] + n[0] * 2.5, m[1] + n[1] * 2.5]; }
  if (g.kind === 'diameter') return mid(g.far, g.near);
  if (g.kind === 'radius') return mid(g.centre, g.near);
  return g.arc;
}

function standardDimensionItems(g: DimGeometry, textAt: CadPoint, override: string, a: CadAppearance, size: { text: number; arrow: number } = { text: 3.5, arrow: 2.5 }): CadItem[] {
  const out: CadItem[] = [];
  const line = (...pts: CadPoint[]) => { out.push({ ...a, kind: 'polyline', points: pts.flatMap((p) => p) }); };
  const arrow = (tip: CadPoint, toward: CadPoint) => {
    const len = Math.hypot(toward[0] - tip[0], toward[1] - tip[1]) || 1, ux = (toward[0] - tip[0]) / len, uy = (toward[1] - tip[1]) / len, s = size.arrow, w = size.arrow / 3;
    line([tip[0] + ux * s - uy * w, tip[1] + uy * s + ux * w], tip, [tip[0] + ux * s + uy * w, tip[1] + uy * s - ux * w]);
  };
  const text = (measured: string) => { out.push({ ...a, kind: 'text', at: textAt, text: override && override !== '<>' ? override.replace('<>', measured) : measured, height: size.text, angle: 0, anchor: 'center' }); };
  const dist = (p: CadPoint, q: CadPoint) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (g.kind === 'linear') {
    const { u, p1, p2 } = linearDimensionLine(g);
    line(g.a, p1); line(g.b, p2); line(p1, p2); arrow(p1, p2); arrow(p2, p1);
    text(fmt(Math.abs((g.b[0] - g.a[0]) * u[0] + (g.b[1] - g.a[1]) * u[1])));
  } else if (g.kind === 'diameter') {
    line(g.far, g.near); arrow(g.far, g.near); arrow(g.near, g.far);
    text(`Ø${fmt(dist(g.far, g.near))}`);
  } else if (g.kind === 'radius') {
    line(g.centre, g.near); arrow(g.near, g.centre);
    text(`R${fmt(dist(g.centre, g.near))}`);
  } else {
    const [p, q] = g.first, [r, t] = g.second;
    const d1: CadPoint = [q[0] - p[0], q[1] - p[1]], d2: CadPoint = [t[0] - r[0], t[1] - r[1]];
    const det = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(det) < 1e-9) throw new Error('An angular CAD dimension between parallel lines cannot be redrawn.');
    const k = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / det;
    const c: CadPoint = [p[0] + d1[0] * k, p[1] + d1[1] * k];
    const far = (x: CadPoint, y: CadPoint): CadPoint => dist(c, x) >= dist(c, y) ? x : y;
    const f1 = far(p, q), f2 = far(r, t);
    const a1 = Math.atan2(f1[1] - c[1], f1[0] - c[0]);
    let sweep = Math.atan2(f2[1] - c[1], f2[0] - c[0]) - a1;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    const radius = dist(c, g.arc);
    const arc: CadPoint[] = Array.from({ length: 25 }, (_, i) => [c[0] + radius * Math.cos(a1 + sweep * i / 24), c[1] + radius * Math.sin(a1 + sweep * i / 24)]);
    line(...arc); arrow(arc[0]!, arc[1]!); arrow(arc[24]!, arc[23]!);
    text(`${fmt(Math.abs(sweep) * 180 / Math.PI)}°`);
  }
  return out;
}

/** Supported 2D entities become independent editable objects. Unsupported data refuses the whole import, never silently disappears. */
export function importCadDxf(text: string, source: string): { doc: DrawingDoc; warnings: string[] } {
  if (text.length > 64 * 1024 * 1024) throw new Error('CAD DXF exceeds 64 MiB.');
  const input = readDxf(text);
  const warnings = new Set<string>();
  const unit = Number(input.header.get('$INSUNITS')?.[0]?.[1] ?? 0);
  const unitScale = unit === 0 ? 1 : CAD_UNIT_MM[unit];
  if (unitScale === undefined) throw new Error(`CAD drawing unit code ${unit} (DXF $INSUNITS) is not supported. Supported: millimetre, centimetre, decimetre, metre, inch, foot, yard, mil, micron. Convert the drawing in the source CAD first.`);
  if (unit === 0) warnings.add('Source drawing has no unit definition; coordinates are interpreted as millimetres.');
  else if (unitScale !== 1) warnings.add(`Source drawing units were converted to millimetres (×${unitScale}).`);
  const bad = new Map<string, number>();
  const layers: CadLayer[] = (input.tables.get('LAYER')?.entries ?? []).map((l) => {
    const lt = input.tables.get('LTYPE')?.entries.find((e) => e.name === val(l, 6));
    const pattern = lt?.pairs.filter(([c]) => c === 49).map(([, v]) => Math.abs(Number(v))).filter((n) => n > 0);
    return { name: l.name, color: ink(l) ?? '#000000', width: num(l, 370, 25) > 0 ? num(l, 370) / 100 : 0.25,
      ...(pattern?.length ? { dash: pattern } : {}), ...(num(l, 62, 7) < 0 || (num(l, 70) & 1) ? { hidden: true } : {}),
    };
  });
  const layerNames = new Set(layers.map((l) => l.name));
  const ensureLayer = (name: string) => { if (!layerNames.has(name)) { layers.push({ name, width: 0.25 }); layerNames.add(name); } };
  let counter = 0, visited = 0, vertices = 0;
  const appearance = (e: DxfEntity, inherited?: CadAppearance): CadAppearance => {
    const layer = e.layer === '0' && inherited ? inherited.layer : e.layer || '0';
    ensureLayer(layer);
    const color = ink(e) ?? (num(e, 62, 256) === 0 ? inherited?.color : undefined);
    const width = num(e, 370, -1);
    return { layer, ...(color ? { color } : {}), ...(width > 0 ? { width: width / 100 } : {}) };
  };
  type Transform = { scale: number; angle: number; x: number; y: number };
  const identity: Transform = { scale: 1, angle: 0, x: 0, y: 0 };
  // The drawing's own dimension style sizes a redrawn dimension (DIMTXT, DIMASZ times DIMSCALE), in millimetres; 3.5 / 2.5 mm when the file gives none.
  const headerNumber = (name: string) => { const v = Number(input.header.get(name)?.[0]?.[1]); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const dimScale = headerNumber('$DIMSCALE') ?? 1;
  const dimSize = { text: (headerNumber('$DIMTXT') ?? 3.5 / unitScale) * dimScale * unitScale, arrow: (headerNumber('$DIMASZ') ?? 2.5 / unitScale) * dimScale * unitScale };
  const root: Transform = { ...identity, scale: unitScale }; // The whole drawing is brought to millimetres here; block, text and arc handling already honour the scale.
  const transformPoint = (p: CadPoint, tr: Transform): CadPoint => [tr.x + tr.scale * (p[0] * Math.cos(tr.angle) - p[1] * Math.sin(tr.angle)), tr.y + tr.scale * (p[0] * Math.sin(tr.angle) + p[1] * Math.cos(tr.angle))];
  const transformItem = (i: CadItem, tr: Transform): CadItem => {
    if (i.kind === 'text') return { ...i, at: transformPoint(i.at, tr), height: i.height * tr.scale, angle: (i.angle ?? 0) + tr.angle * 180 / Math.PI };
    const points: number[] = [];
    for (let k = 0; k < i.points.length; k += 2) points.push(...transformPoint([i.points[k]!, i.points[k + 1]!], tr));
    return { ...i, points }; // CAD lineweights are paper-space widths, independent of block scale.
  };
  const convert = (e: DxfEntity, tr: Transform, stack: string[], inherited?: CadAppearance): CadEntity[] => {
    if (++visited > 100000) throw new Error('CAD import exceeds 100,000 entity visits.');
    // A paper-space viewport is only the window onto the model (its frame carries no drawing of its own); the model's entities are imported themselves.
    if (e.type === 'VIEWPORT') { warnings.add('Paper-space viewport frames were not imported (the drawing itself was).'); return []; }
    if (num(e, 48, 1) !== 1) throw new Error('Per-entity CAD linetype scales are not supported.');
    if (e.pairs.some(([c, v]) => c >= 30 && c <= 39 && Number(v) !== 0) || num(e, 210) !== 0 || num(e, 220) !== 0 || num(e, 230, 1) !== 1) throw new Error(`Non-planar CAD entity ${e.type} is not supported.`);
    const a = appearance(e, inherited);
    const id = () => `cad${++counter}`;
    const wrap = (i: CadItem): CadEntity[] => {
      if (i.kind === 'polyline') vertices += i.points.length / 2;
      if (vertices > 1000000) throw new Error('CAD import exceeds 1,000,000 vertices.');
      return [{ ...transformItem(i, tr), id: id() }];
    };
    switch (e.type) {
      case 'LINE': return wrap({ ...a, kind: 'polyline', points: [...point(e), ...point(e, 11)] });
      case 'LWPOLYLINE': {
        if (e.pairs.some(([c, v]) => c === 42 && Number(v) !== 0)) { bad.set('LWPOLYLINE bulge', (bad.get('LWPOLYLINE bulge') ?? 0) + 1); return []; }
        const points: number[] = [];
        for (let k = 0; k < e.pairs.length; k++) if (e.pairs[k]![0] === 10) {
          const y = e.pairs.slice(k + 1).find(([c]) => c === 20 || c === 10);
          if (!y || y[0] !== 20) throw new Error('Malformed CAD polyline.');
          points.push(Number(e.pairs[k]![1]), Number(y[1]));
        }
        return wrap({ ...a, kind: 'polyline', points, closed: !!(num(e, 70) & 1) });
      }
      case 'SOLID': case 'TRACE': {
        const third = point(e, 12), fourth = point(e, 13);
        const triangle = third[0] === fourth[0] && third[1] === fourth[1];
        return wrap({ ...a, kind: 'polyline', points: [...point(e), ...point(e, 11), ...(triangle ? third : [...fourth, ...third])], closed: true, filled: true });
      }
      case 'TEXT': {
        const align = num(e, 72);
        if (![0, 1, 2].includes(align) || num(e, 41, 1) !== 1 || num(e, 51) !== 0 || num(e, 71) !== 0) throw new Error('Stretched, oblique or mirrored CAD TEXT is not supported.');
        // readDxf already decodes Unicode escapes.
        const decoded = e as unknown as { text: string; at: CadPoint };
        return wrap({ ...a, kind: 'text', at: align ? point(e, 11) : point(e), text: decoded.text, height: num(e, 40), angle: num(e, 50), anchor: align === 1 ? 'center' : align === 2 ? 'right' : 'left' });
      }
      case 'ARC': case 'CIRCLE': {
        const c = point(e), r = num(e, 40);
        if (!Number.isFinite(r) || r <= 0) throw new Error('Invalid CAD circle radius.');
        const start = e.type === 'CIRCLE' ? 0 : num(e, 50) * Math.PI / 180;
        const sweep = e.type === 'CIRCLE' ? Math.PI * 2 : ((num(e, 51) * Math.PI / 180 - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        const segments = Math.max(4, Math.ceil(sweep / (2 * Math.acos(Math.max(-1, 1 - 0.001 / (r * tr.scale))))));
        if (!Number.isFinite(segments) || segments > 100000) throw new Error('CAD arc exceeds the 0.001 mm approximation budget.');
        const points: number[] = [];
        for (let k = 0; k <= segments; k++) { const t = start + sweep * k / segments; points.push(c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)); }
        warnings.add('ARC/CIRCLE are editable polylines (maximum chord error 0.001 mm).');
        return wrap({ ...a, kind: 'polyline', points, closed: e.type === 'CIRCLE' });
      }
      case 'INSERT': {
        const name = val(e, 2) ?? '';
        if (stack.includes(name) || stack.length >= 16) throw new Error('Cyclic or excessively nested CAD block.');
        if (num(e, 70, 1) !== 1 || num(e, 71, 1) !== 1) throw new Error('CAD block arrays must be exploded before import.');
        const sx = num(e, 41, 1), sy = num(e, 42, 1);
        if (sx <= 0 || sx !== sy || !Number.isFinite(sx)) throw new Error('Mirrored/nonuniform CAD blocks must be exploded before import.');
        const content = input.blockEntities.get(name);
        if (!content) throw new Error(`Missing CAD block ${name}.`);
        const angle = tr.angle + num(e, 50) * Math.PI / 180;
        const origin = transformPoint(point(e), tr), base = input.blockBases.get(name) ?? [0, 0];
        const scale = tr.scale * sx;
        const nested = { scale, angle, x: origin[0] - scale * (base[0] * Math.cos(angle) - base[1] * Math.sin(angle)), y: origin[1] - scale * (base[0] * Math.sin(angle) + base[1] * Math.cos(angle)) };
        return content.flatMap((child) => convert(child, nested, [...stack, name], a));
      }
      case 'DIMENSION': {
        if (num(e, 52) !== 0 || num(e, 53) !== 0) throw new Error('Oblique or rotated-text CAD dimensions are not supported.');
        warnings.add('Imported dimensions retain 2D definition points and graphics; re-export uses the app’s standard CAD font/dimension style and has no 3D associations.');
        if (unitScale !== 1) warnings.add('Dimension geometry was converted to millimetres; dimension text overrides typed in the source drawing keep their original wording.');
        if (tr.scale !== unitScale || tr.angle !== 0 || tr.x !== 0 || tr.y !== 0) throw new Error('Dimensions inside transformed CAD blocks must be exploded before import.');
        const d = e as DxfDimension;
        const mm = (p: CadPoint): CadPoint => [p[0] * unitScale, p[1] * unitScale];
        const required = (code: number) => { const p = d.points.get(code); if (!p) throw new Error('Missing CAD dimension definition point.'); return mm(p); };
        const def = mm(d.def), leader = (d.leader ?? 0) * unitScale;
        const geometry = d.kind === 0 || d.kind === 1 ? { kind: 'linear' as const, a: required(13), b: required(14), line: def, ...(d.kind === 0 ? { rotation: d.rotation ?? 0 } : {}) }
          : d.kind === 3 ? { kind: 'diameter' as const, far: def, near: required(15), leader }
            : d.kind === 4 ? { kind: 'radius' as const, centre: def, near: required(15), leader }
              : d.kind === 2 ? { kind: 'angular' as const, first: [required(13), required(14)] as [CadPoint, CadPoint], second: [required(15), def] as [CadPoint, CadPoint], arc: required(16) } : null;
        if (!geometry) throw new Error(`Unsupported CAD dimension kind ${d.kind}.`);
        const textAt = d.textAt[0] === 0 && d.textAt[1] === 0 ? defaultTextAt(geometry) : mm(d.textAt);
        const block = d.block ? input.blockEntities.get(d.block) : undefined;
        let items: (CadItem & { id: string })[];
        if (block?.length) {
          const parts = block.flatMap((i) => convert(i, root, [d.block], a));
          if (parts.some((i) => i.kind === 'dimension')) throw new Error('Nested CAD dimensions are not supported.');
          items = parts as (CadItem & { id: string })[];
        } else {
          warnings.add('Some dimensions had no stored graphics; they were redrawn in the standard style from their definition points.');
          items = standardDimensionItems(geometry, textAt, d.text, a, dimSize).map((i) => ({ ...i, id: '' }));
        }
        return [{ ...a, id: id(), kind: 'dimension', text: d.text, textAt, geometry, items: items.map(({ id: _id, ...i }) => i) }];
      }
      default: bad.set(e.type, (bad.get(e.type) ?? 0) + 1); return [];
    }
  };
  const groups = new Map<string, DxfEntity[]>();
  for (const e of input.entities) {
    const layout = val(e, 410) ?? (num(e, 67) ? 'Paper' : 'Model');
    const group = groups.get(layout) ?? []; group.push(e); groups.set(layout, group);
    if (groups.size > 64) throw new Error('CAD import supports at most 64 layouts.');
  }
  const doc = createEmptyDrawing();
  // A layout with nothing left to edit (in practice a paper-space layout holding only viewport frames) is not made into an empty page.
  const converted = [...groups].map(([name, entries]) => ({ name, entities: entries.flatMap((e) => convert(e, root, [])) }));
  const empty = converted.filter((g) => !g.entities.length).map((g) => g.name);
  const kept = converted.filter((g) => g.entities.length);
  if (empty.length && kept.length) warnings.add(`Layouts with nothing editable were not made into pages: ${empty.join(', ')}.`);
  doc.pages = kept.map(({ name, entities }, pageIndex) => {
    const points = entities.flatMap((e) => e.kind === 'dimension' ? e.items : [e]).flatMap((i) => i.kind === 'text' ? [i.at[0], i.at[1], i.at[0] + i.text.length * i.height, i.at[1] + i.height * 2] : i.points);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < points.length; k += 2) { minX = Math.min(minX, points[k]!); minY = Math.min(minY, points[k + 1]!); maxX = Math.max(maxX, points[k]!); maxY = Math.max(maxY, points[k + 1]!); }
    if (!points.length) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
    const cad: CadDrawing = { source, width: maxX - minX + 20, height: maxY - minY + 20, sourceOrigin: [minX - 10, minY - 10], layers: structuredClone(layers), entities: entities.map((e) => moveCadEntity(e, 10 - minX, 10 - minY)) };
    checkCadDrawing(cad);
    return { ...doc.pages[0]!, id: `page${pageIndex + 1}`, name, cad, title: { drawingName: source.replace(/\.(dwg|dxf)$/i, '') } };
  });
  if (bad.size) throw new Error(`CAD import refused; unsupported entities (nothing imported): ${[...bad].map(([kind, n]) => `${kind} ×${n}`).join(', ')}. Convert/explode these entities in the source CAD first.`);
  if (!doc.pages.length || !doc.pages.some((p) => p.cad?.entities.length)) throw new Error('No editable 2D entities were found.');
  return { doc, warnings: [...warnings] };
}
