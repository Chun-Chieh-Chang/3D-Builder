import { t } from '@3db/i18n';
import { buildScene, sheetMetrics, toSvg } from '@3db/drawing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { store, useStore } from '../state/store';

/** Pixels in a millimetre of an SVG drawn at its size (CSS: 96 pixels to the inch). */
const PX = 96 / 25.4;

interface Drag {
  id: string;
  /** The pointer and the view's middle when the drag began (sheet mm), and where the view is now. */
  from: [number, number];
  origin: [number, number];
  at: [number, number];
}

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

  // what is shown: the document, with the view being dragged where the pointer has it
  const shown = useMemo(() => (drag ? { ...drw.doc, views: drw.doc.views.map((v) => (v.id === drag.id ? { ...v, at: drag.at } : v)) } : drw.doc), [drw.doc, drag]);
  const built = useMemo(() => buildScene(shown, drw.lines, drw.elements, drw.features), [shown, drw.lines, drw.elements, drw.features]);
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

  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.heads-up')) return;
    const p = onSheet(e);
    // the view under the pointer, the one drawn last when they overlap
    const hit = [...drw.doc.views].reverse().find((v) => {
      const placed = built.placed.get(v.id);
      return placed && placed.w > 0 && Math.abs(p[0] - placed.at[0]) <= placed.w / 2 && Math.abs(p[1] - placed.at[1]) <= placed.h / 2;
    });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (hit) {
      d.select(hit.id);
      const at = built.placed.get(hit.id)!.at;
      setDrag({ id: hit.id, from: p, origin: [at[0], at[1]], at: [at[0], at[1]] });
    } else {
      d.select(null);
      setPanning({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };
  const move = (e: React.PointerEvent) => {
    if (drag) {
      const p = onSheet(e);
      setDrag({ ...drag, at: [drag.origin[0] + p[0] - drag.from[0], drag.origin[1] + p[1] - drag.from[1]] });
    } else if (panning) setPan({ ...pan, x: e.clientX - panning.x, y: e.clientY - panning.y });
  };
  const up = () => {
    if (drag && Math.hypot(drag.at[0] - drag.origin[0], drag.at[1] - drag.origin[1]) > 0.05) d.setView(drag.id, { at: [Math.round(drag.at[0] * 100) / 100, Math.round(drag.at[1] * 100) / 100] });
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
          />
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
