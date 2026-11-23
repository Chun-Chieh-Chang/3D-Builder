import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@3db/i18n';
import { cadDrawingBounds, moveCadEntity, page, type CadEntity, type CadItem, type CadPoint } from '@3db/model';
import { cadScene } from '@3db/drawing';
import { dwgAvailable } from '../dwg';
import { store, useStore } from '../state/store';

/** Text inputs commit on blur/Enter, so an incomplete decimal never becomes a silent zero. */
function NumberField({ label, value, onChange }: { label: string; value: number; onChange(n: number): void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = text.trim() ? Number(text) : NaN;
    if (Number.isFinite(n)) onChange(n);
    else { store.notify(t('drawingUi.cadBadPoints'), 'error'); setText(String(value)); }
  };
  return <label className="pm-row"><span>{label}</span><input aria-label={label} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); }} /></label>;
}

function EntityFields({ entity }: { entity: CadEntity }) {
  const drw = useStore((s) => s.drw)!;
  const cad = page(drw.doc, drw.activePageIndex).cad!;
  const d = store.drawingStore!;
  const [points, setPoints] = useState('');
  const [text, setText] = useState('');
  // Each draft is reset only when its own stored value changes (undo, another edit of it): saving the height or color must not throw away text being typed.
  const storedPoints = entity.kind === 'polyline' ? entity.points.reduce<string[]>((lines, v, i, all) => { if (i % 2 === 0) lines.push(`${v}, ${all[i + 1]}`); return lines; }, []).join('\n') : '';
  const storedText = entity.kind === 'text' || entity.kind === 'dimension' ? entity.text : '';
  useEffect(() => { setPoints(storedPoints); }, [storedPoints]);
  useEffect(() => { setText(storedText); }, [storedText]);
  const save = (next: CadEntity) => {
    if (next.kind === 'dimension' && (next.layer !== entity.layer || next.color !== entity.color)) {
      next = { ...next, items: next.items.map((i) => ({ ...i, layer: next.layer, color: next.color })) };
    }
    return d.execute({ type: 'setCadEntity', pageIndex: drw.activePageIndex, entity: next });
  };
  const position = entity.kind === 'text' ? entity.at : entity.kind === 'dimension' ? entity.textAt : [entity.points[0]!, entity.points[1]!] as CadPoint;
  const move = (axis: number, n: number) => save(moveCadEntity(entity, axis === 0 ? n - position[0] : 0, axis === 1 ? n - position[1] : 0));
  const layer = cad.layers.find((l) => l.name === entity.layer)!;
  return <div data-cad-properties>
    <label className="pm-row"><span>{t('drawingUi.cadLayer')}</span><select data-field="cadLayer" value={entity.layer} onChange={(e) => save({ ...entity, layer: e.target.value })}>{cad.layers.map((l) => <option key={l.name}>{l.name}</option>)}</select></label>
    <label className="pm-row"><input data-field="cadByLayer" type="checkbox" checked={entity.color === undefined} onChange={(e) => { const next = { ...entity }; if (e.target.checked) delete next.color; else next.color = layer.color ?? '#000000'; save(next); }} />{t('drawingUi.cadByLayer')}</label>
    <label className="pm-row"><span>{t('drawingUi.color')}</span><input data-field="cadColor" type="color" value={entity.color ?? layer.color ?? '#000000'} onChange={(e) => save({ ...entity, color: e.target.value })} /></label>
    <NumberField label="X (mm)" value={position[0]} onChange={(n) => move(0, n)} />
    <NumberField label="Y (mm)" value={position[1]} onChange={(n) => move(1, n)} />
    {entity.kind === 'polyline' ? <>
      <NumberField label={t('drawingUi.cadWidth')} value={entity.width ?? layer.width} onChange={(width) => save({ ...entity, width })} />
      <label><span>{t('drawingUi.cadPoints')}</span><textarea data-field="cadPoints" rows={6} style={{ width: '100%', resize: 'vertical' }} value={points} onChange={(e) => setPoints(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
      <button className="pm-button" data-action="cadApplyPoints" onClick={() => {
        const rows = points.trim().split(/\r?\n/).map((line) => line.split(',').map((v) => v.trim() ? Number(v) : NaN));
        if (rows.length < 2 || rows.some((r) => r.length !== 2 || r.some((v) => !Number.isFinite(v)))) return store.notify(t('drawingUi.cadBadPoints'), 'error');
        save({ ...entity, points: rows.flat() });
      }}>{t('drawingUi.cadApply')}</button>
    </> : <>
      <label><span>{t('drawingUi.cadText')}</span><textarea data-field="cadText" rows={3} style={{ width: '100%', resize: 'vertical' }} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></label>
      <button className="pm-button" data-action="cadApplyText" onClick={() => {
        if (entity.kind === 'text') save({ ...entity, text });
        else {
          const first = entity.items.find((i) => i.kind === 'text');
          // A replacement is one label: remove the old stacked fragments rather than leaving stale deviations beside the new value.
          const items: CadItem[] = entity.items.filter((i) => i.kind !== 'text');
          if (first?.kind === 'text') items.push({ ...first, text, at: entity.textAt, anchor: 'center' });
          save({ ...entity, text, items });
        }
      }}>{t('drawingUi.cadApply')}</button>
      {entity.kind === 'text' && <><NumberField label={t('drawingUi.cadTextHeight')} value={entity.height} onChange={(height) => save({ ...entity, height })} /><NumberField label="°" value={entity.angle ?? 0} onChange={(angle) => save({ ...entity, angle })} /></>}
    </>}
    <button className="pm-button" data-action="cadDelete" onClick={() => d.deleteSelection()}>{t('drawingUi.cadDelete')}</button>
  </div>;
}

export function CadDrawingPanel() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const cad = page(drw.doc, drw.activePageIndex).cad!;
  const [search, setSearch] = useState('');
  const selected = cad.entities.find((e) => e.id === drw.selection.at(-1)?.id);
  const [layerName, setLayerName] = useState(cad.layers[0]?.name ?? '');
  const layer = cad.layers.find((l) => l.name === layerName) ?? cad.layers[0];
  const updateLayer = (patch: Partial<NonNullable<typeof layer>>) => {
    if (layer) d.execute({ type: 'setCadDrawing', pageIndex: drw.activePageIndex, cad: { ...cad, layers: cad.layers.map((l) => l.name === layer.name ? { ...l, ...patch } : l) } });
  };
  const filtered = cad.entities.filter((e) => `${e.id} ${e.layer} ${e.kind === 'polyline' ? '' : e.text}`.toLowerCase().includes(search.toLowerCase()));
  return <aside className="drawing-panel sw-panel cad-editor" data-drawing-panel data-cad-panel>
    <h3>{t('drawingUi.cadTitle')}</h3><p style={{ fontSize: 12 }}>{t('drawingUi.cadHint')}</p>
    <div className="pm-row wrap"><button className="pm-button" onClick={() => store.importCadDrawing()}>{t('drawingUi.importCad')}</button><button className="pm-button" data-action="exportDwg" disabled={!dwgAvailable()} title={dwgAvailable() ? '' : t('drawingUi.dwgDesktopOnly')} onClick={() => void d.exportDwg()}>{t('drawingUi.exportDwg')}</button><button className="pm-button" data-action="exportDxf" onClick={() => d.exportDxf()}>{t('drawingUi.exportDxf')}</button><button className="pm-button" onClick={() => void d.exportPdf()}>{t('drawingUi.exportPdf')}</button><button className="pm-button" onClick={() => d.exportSvg()}>{t('drawingUi.exportSvg')}</button></div>
    {dwgAvailable() && <button className="pm-button" data-action="setupDwg" onClick={() => void d.setupDwg()}>{t('drawingUi.dwgInstall')}</button>}
    <label>{t('drawingUi.cadSelect')} ({cad.entities.length})<input aria-label={t('drawingUi.cadSelect')} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    <select data-field="cadEntity" size={6} style={{ width: '100%' }} value={selected?.id ?? ''} onChange={(e) => d.pick([{ kind: 'cad', id: e.target.value }], 'replace')}>
      {filtered.slice(0, 500).map((e) => <option key={e.id} value={e.id}>{e.id} · {e.layer} · {e.kind === 'polyline' ? `${e.points.length / 2} ↔` : e.text.slice(0, 50)}</option>)}
    </select>
    {selected && <EntityFields key={selected.id} entity={selected} />}
    {layer && <fieldset style={{ marginTop: 16 }}><legend>{t('drawingUi.cadLayer')}</legend><select value={layer.name} onChange={(e) => setLayerName(e.target.value)}>{cad.layers.map((l) => <option key={l.name}>{l.name}</option>)}</select>
      <label className="pm-row">{t('drawingUi.cadLayerColor')}<input data-field="cadLayerColor" type="color" value={layer.color ?? '#000000'} onChange={(e) => updateLayer({ color: e.target.value })} /></label>
      <label className="pm-row"><input data-field="cadLayerVisible" type="checkbox" checked={!layer.hidden} onChange={(e) => updateLayer({ hidden: !e.target.checked })} />{t('drawingUi.cadLayerVisible')}</label>
      <NumberField label={t('drawingUi.cadWidth')} value={layer.width} onChange={(width) => updateLayer({ width })} />
    </fieldset>}
    <div className="pm-row wrap">{drw.doc.pages.map((p, i) => <button key={p.id} className="pm-button" aria-pressed={i === drw.activePageIndex} onClick={() => d.setActivePage(i)}>{p.name || String(i + 1)}</button>)}</div>
  </aside>;
}

export function CadDrawingViewport() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const cad = page(drw.doc, drw.activePageIndex).cad!;
  const svg = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ entity: CadEntity; from: CadPoint; delta: CadPoint } | null>(null);
  const scene = useMemo(() => cadScene(cad), [cad]);
  const bounds = useMemo(() => cadDrawingBounds(cad), [cad]);
  // A real lineweight (0.25 mm) shrinks below one pixel when a large drawing is fitted to the window and the lines all but vanish.
  // The shown line is therefore never thinner than about a pixel; the drawing's own widths (and the exported file) are not touched.
  const [pxPerUnit, setPxPerUnit] = useState(1);
  useEffect(() => {
    const el = svg.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => { const w = el.getBoundingClientRect().width; if (w > 0 && bounds.width > 0) setPxPerUnit(w / bounds.width); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bounds.width, zoom]);
  const pointAt = (e: React.PointerEvent): CadPoint => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return [p.x + bounds.origin[0], bounds.height - p.y + bounds.origin[1]];
  };
  const selected = new Set(drw.selection.filter((s) => s.kind === 'cad').map((s) => s.id));
  return <main className="viewport drawing-viewport" data-drawing-canvas data-cad-canvas style={{ overflow: 'auto', display: 'block', padding: 20 }}>
    <label style={{ display: 'block', position: 'sticky', top: 0, zIndex: 1 }}>{t('drawingUi.cadZoom')} <input type="range" min="0.25" max="4" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
    <svg ref={svg} viewBox={`0 0 ${bounds.width} ${bounds.height}`} style={{ width: `${zoom * 100}%`, minHeight: 300, background: 'white', touchAction: 'none' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const id = (e.target as Element).closest('[data-cad-id]')?.getAttribute('data-cad-id');
        const entity = cad.entities.find((i) => i.id === id);
        if (!entity) return d.clearSelection();
        d.pick([{ kind: 'cad', id: entity.id }], e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
        if (!e.ctrlKey && !e.metaKey) {
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
          setDrag({ entity, from: pointAt(e), delta: [0, 0] });
        }
      }}
      onPointerMove={(e) => { if (drag) { const p = pointAt(e); setDrag({ ...drag, delta: [p[0] - drag.from[0], p[1] - drag.from[1]] }); } }}
      onPointerUp={() => { if (drag && (drag.delta[0] !== 0 || drag.delta[1] !== 0)) d.execute({ type: 'setCadEntity', pageIndex: drw.activePageIndex, entity: moveCadEntity(drag.entity, ...drag.delta) }); setDrag(null); }}
      onPointerCancel={() => setDrag(null)}
      onDoubleClick={() => document.querySelector<HTMLTextAreaElement>('[data-field="cadText"]')?.focus()}>
      <g transform={`translate(0 ${bounds.height}) scale(1 -1)`}>{scene.items.map((i, n) => {
        const ink = selected.has(i.owner ?? '') ? '#1687e8' : i.color ?? '#000000';
        return <g key={n} data-cad-id={i.owner} transform={drag && drag.entity.id === i.owner ? `translate(${drag.delta.join(' ')})` : undefined}>{i.kind === 'polyline' ? <>
          <polyline points={i.points.join(' ')} fill="none" stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" pointerEvents="stroke" />
          <polyline points={(i.closed ? [...i.points, i.points[0]!, i.points[1]!] : i.points).join(' ')} fill={i.filled ? ink : 'none'} stroke={ink} strokeWidth={Math.max(i.width ?? 0.25, 1.25 / pxPerUnit)} strokeDasharray={cad.layers.find((l) => l.name === i.layer)?.dash?.join(' ')} pointerEvents="visiblePainted" />
        </> : <text transform={`translate(${i.at[0]} ${i.at[1]}) rotate(${i.angle ?? 0}) scale(1 -1)`} fontFamily="Arial, sans-serif" fontSize={i.height * 1.4} textAnchor={i.anchor === 'center' ? 'middle' : i.anchor === 'right' ? 'end' : 'start'} fill={ink} style={{ userSelect: 'none', cursor: 'move' }}>{i.text}</text>}</g>;
      })}</g>
    </svg>
  </main>;
}
