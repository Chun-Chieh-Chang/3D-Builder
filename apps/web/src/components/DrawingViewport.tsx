import { t } from '@3db/i18n';
import { arrangementBase, buildScene, scaleFromRatio, scaleTarget, sheetMetrics, slideAxis, toSvg } from '@3db/drawing';
import type { Scale } from '@3db/model';
import { useEffect, useMemo, useRef, useState } from 'react';
import { store, useStore } from '../state/store';

/** Pixels in a millimetre of an SVG drawn at its size (CSS: 96 pixels to the inch). */
const PX = 96 / 25.4;

/**
 * What the pointer is doing to a view. A move: of the view the others are arranged round, which takes them all with it (`shift`); of a view that is in line with the
 * rest, along that line only, which changes the distance to the others (`slide`); or free (`free`, with Shift held, or a view that has no line), which puts the view where it
 * is let go. A scale: the handle at the corner of the chosen view, which changes the scale the view takes (its own, its parent's or the sheet's) and so that of every view that takes it.
 */
type Drag =
  | { kind: 'move'; id: string; mode: 'shift' | 'slide' | 'free'; axis: 0 | 1 | null; from: [number, number]; origin: [number, number]; delta: [number, number] }
  | { kind: 'scale'; id: string; target: ReturnType<typeof scaleTarget>; centre: [number, number]; r0: number; ratio0: number; scale: Scale };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The sheet of the open drawing (C16): the scene as SVG on a page that can be panned (drag on the paper) and zoomed (wheel). A view is chosen by clicking it
 * and moved by dragging it; where it is let go it stays (its position becomes its own).
 */
export function DrawingViewport() {
  const drw = useStore((s) => s.drw)!;
  const bootMs = useStore((s) => s.bootMs);
  const d = store.drawingStore!;
  const host = useRef<HTMLElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0, zoom: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  const sheet = sheetMetrics(drw.doc.sheet);

  // what is shown: the document, as the drag would leave it (the other views follow while the pointer moves)
  const shown = useMemo(() => {
    const doc = drw.doc;
    if (!drag) return doc;
    if (drag.kind === 'scale') {
      const target = drag.target;
      return 'sheet' in target ? { ...doc, sheet: { ...doc.sheet, scale: drag.scale } } : { ...doc, views: doc.views.map((v) => (v.id === target.view ? { ...v, scale: drag.scale } : v)) };
    }
    if (drag.mode === 'shift') {
      const was = doc.sheet.shift ?? [0, 0];
      return { ...doc, sheet: { ...doc.sheet, shift: [was[0] + drag.delta[0], was[1] + drag.delta[1]] as [number, number] } };
    }
    if (drag.mode === 'slide') return { ...doc, views: doc.views.map((v) => (v.id === drag.id ? { ...v, slide: (v.slide ?? 0) + drag.delta[drag.axis!] } : v)) };
    return { ...doc, views: doc.views.map((v) => (v.id === drag.id ? { ...v, at: [drag.origin[0] + drag.delta[0], drag.origin[1] + drag.delta[1]] as [number, number], slide: undefined } : v)) };
  }, [drw.doc, drag]);
  const built = useMemo(() => buildScene(shown, drw.lines, drw.elements, drw.features, drw.boms), [shown, drw.lines, drw.elements, drw.features, drw.boms]);
  const svg = useMemo(() => toSvg(built.scene), [built]);

  const fit = () => {
    const el = host.current;
    if (!el) return;
    const zoom = Math.min((el.clientWidth - 40) / (sheet.width * PX), (el.clientHeight - 40) / (sheet.height * PX));
    setPan({ zoom, x: (el.clientWidth - sheet.width * PX * zoom) / 2, y: (el.clientHeight - sheet.height * PX * zoom) / 2 });
  };
  useEffect(fit, [drw.fitRequest, drw.doc.sheet.size, drw.doc.sheet.orientation]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setPan((p) => {
        const zoom = Math.min(20, Math.max(0.05, p.zoom * Math.pow(1.1, -e.deltaY / 100)));
        const k = zoom / p.zoom;
        return { zoom, x: px - (px - p.x) * k, y: py - (py - p.y) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** A pointer position on the sheet, in mm from its lower left corner. */
  const onSheet = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = host.current!.getBoundingClientRect();
    return [(e.clientX - rect.left - pan.x) / (pan.zoom * PX), sheet.height - (e.clientY - rect.top - pan.y) / (pan.zoom * PX)];
  };

  /** Keeps the pointer while it is dragged outside the sheet (nothing to keep when the event is not from a real pointer). */
  const capture = (e: React.PointerEvent) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone (or the event is synthetic)
    }
  };
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.heads-up')) return;
    const p = onSheet(e);
    // the handle at the corner of the chosen view: the scale
    if ((e.target as HTMLElement).closest('[data-scale-handle]') && drw.selected) {
      const view = drw.doc.views.find((v) => v.id === drw.selected);
      const placed = view && built.placed.get(view.id);
      if (view && placed) {
        capture(e);
        setDrag({ kind: 'scale', id: view.id, target: scaleTarget(drw.doc, view), centre: [placed.at[0], placed.at[1]], r0: Math.max(1e-6, Math.hypot(p[0] - placed.at[0], p[1] - placed.at[1])), ratio0: placed.scale, scale: scaleFromRatio(placed.scale) });
        return;
      }
    }
    // the view under the pointer, the one drawn last when they overlap
    const hit = [...drw.doc.views].reverse().find((v) => {
      const placed = built.placed.get(v.id);
      return placed && placed.w > 0 && Math.abs(p[0] - placed.at[0]) <= placed.w / 2 && Math.abs(p[1] - placed.at[1]) <= placed.h / 2;
    });
    capture(e);
    if (hit) {
      d.select(hit.id);
      const at = built.placed.get(hit.id)!.at;
      const axis = slideAxis(drw.doc, hit);
      const base = arrangementBase(drw.doc);
      const mode = !hit.at && base?.id === hit.id ? 'shift' : axis !== null && !e.shiftKey ? 'slide' : 'free';
      setDrag({ kind: 'move', id: hit.id, mode, axis, from: p, origin: [at[0], at[1]], delta: [0, 0] });
    } else {
      d.select(null);
      setPanning({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };
  const move = (e: React.PointerEvent) => {
    if (drag?.kind === 'scale') {
      const p = onSheet(e);
      setDrag({ ...drag, scale: scaleFromRatio((drag.ratio0 * Math.hypot(p[0] - drag.centre[0], p[1] - drag.centre[1])) / drag.r0) });
    } else if (drag) {
      const p = onSheet(e);
      setDrag({ ...drag, delta: [p[0] - drag.from[0], p[1] - drag.from[1]] });
    } else if (panning) setPan({ ...pan, x: e.clientX - panning.x, y: e.clientY - panning.y });
  };
  /** The scale the dragged view had before: the one of what the drag changes. */
  const shownBefore = (drag: Extract<Drag, { kind: 'scale' }>): Scale | null => ('sheet' in drag.target ? drw.doc.sheet.scale : (drw.doc.views.find((v) => v.id === (drag.target as { view: string }).view)?.scale ?? null));
  const up = () => {
    if (drag?.kind === 'scale') {
      const was = shownBefore(drag);
      if (was === null || was[0] !== drag.scale[0] || was[1] !== drag.scale[1]) {
        if ('sheet' in drag.target) d.setSheet({ scale: drag.scale });
        else d.setView(drag.target.view, { scale: drag.scale });
      }
    } else if (drag && Math.hypot(drag.delta[0], drag.delta[1]) > 0.05) {
      const view = drw.doc.views.find((v) => v.id === drag.id);
      if (drag.mode === 'shift') {
        const was = drw.doc.sheet.shift ?? [0, 0];
        d.setSheet({ shift: [round2(was[0] + drag.delta[0]), round2(was[1] + drag.delta[1])] });
      } else if (drag.mode === 'slide') d.setView(drag.id, { slide: round2((view?.slide ?? 0) + drag.delta[drag.axis!]) });
      else d.setView(drag.id, { at: [round2(drag.origin[0] + drag.delta[0]), round2(drag.origin[1] + drag.delta[1])], slide: null });
    }
    setDrag(null);
    setPanning(null);
  };

  const selected = drw.selected ? built.placed.get(drw.selected) : undefined;
  return (
    <main className="viewport drawing-viewport" ref={host} onPointerDown={down} onPointerMove={move} onPointerUp={up} data-drawing-canvas>
      <div className="drawing-stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${pan.zoom})` }}>
        <div className="drawing-paper" data-svg dangerouslySetInnerHTML={{ __html: svg }} />
        {selected && selected.w > 0 && (
          <div
            className="drawing-selection"
            data-selection
            style={{ left: (selected.at[0] - selected.w / 2) * PX - 4, top: (sheet.height - selected.at[1] - selected.h / 2) * PX - 4, width: selected.w * PX + 8, height: selected.h * PX + 8 }}
          >
            <span
              className="drawing-handle"
              data-scale-handle
              title={t('drawingUi.scaleHandle')}
              style={{ width: 12 / pan.zoom, height: 12 / pan.zoom, right: -6 / pan.zoom, bottom: -6 / pan.zoom, borderWidth: 1 / pan.zoom }}
            />
          </div>
        )}
      </div>
      <div className="heads-up">
        <button onClick={fit}>{t('drawingUi.fit')}</button>
        <button disabled={!drw.canUndo} onClick={() => d.undo()}>
          {t('drawingUi.undo')}
        </button>
        <button disabled={!drw.canRedo} onClick={() => d.redo()}>
          {t('drawingUi.redo')}
        </button>
      </div>
      {!bootMs && <div className="boot-overlay">{t('drawingUi.loadingKernel')}</div>}
    </main>
  );
}
