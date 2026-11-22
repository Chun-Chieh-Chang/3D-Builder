import { t } from '@3db/i18n';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

const WIDTH_KEY = '3db-workspace-sidebar-width';
const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 260;
const MAX_WIDTH = 560;
const MIN_MODEL_WIDTH = 440;
const OVERLAY_WIDTH = 768;

function savedWidth(): number {
  try {
    const width = Number(localStorage.getItem(WIDTH_KEY));
    if (width >= MIN_WIDTH && width <= MAX_WIDTH) return width;
  } catch { /* Storage can be unavailable in a private browser session. */ }
  return DEFAULT_WIDTH;
}

export function WorkspaceLayout({ drawing, editing, sidebar, children }: {
  drawing: boolean;
  editing: boolean;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [screenWidth, setScreenWidth] = useState(() => window.innerWidth);
  const [preferred, setPreferred] = useState(savedWidth);
  const [preview, setPreview] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(editing);
  const toggle = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ pointer: number; x: number; width: number } | null>(null);
  const overlay = screenWidth <= OVERLAY_WIDTH;
  const maxWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, screenWidth - MIN_MODEL_WIDTH));
  const clamp = (value: number) => Math.round(Math.max(MIN_WIDTH, Math.min(value, maxWidth)));
  const width = clamp(preview ?? preferred);

  useEffect(() => {
    const measure = () => setScreenWidth(window.innerWidth);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    if (editing) setExpanded(true);
  }, [editing]);

  const save = (value: number, reset = false) => {
    const next = reset ? DEFAULT_WIDTH : clamp(value);
    setPreferred(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch { /* Keep the width for the current session when storage is unavailable. */ }
  };
  const finishDrag = (pointer: number, x?: number) => {
    const start = drag.current;
    if (!start || start.pointer !== pointer) return;
    drag.current = null;
    setPreview(null);
    if (x !== undefined && x !== start.x) save(start.width + x - start.x);
  };
  const close = () => {
    toggle.current?.focus({ preventScroll: true });
    setExpanded(false);
  };
  // Place focus on a layout control before the editor blurs, including on touch browsers.
  const focusLayoutControl = (e: PointerEvent<HTMLButtonElement>) => e.currentTarget.focus({ preventScroll: true });

  return (
    <div className={`workspace${drawing ? ' with-task-pane' : ''}${overlay ? ' sidebar-overlay' : ''}`}
      style={{ '--sidebar-width': `${overlay ? preferred : width}px` } as CSSProperties}>
      {overlay && (
        <button ref={toggle} className="sidebar-toggle" type="button" data-preserve-editor
          aria-controls="workspace-sidebar" aria-expanded={expanded}
          onPointerDown={focusLayoutControl}
          onClick={() => expanded ? close() : setExpanded(true)}>
          {t(expanded ? 'sidebar.collapse' : 'sidebar.expand')}
        </button>
      )}
      {overlay && expanded && <button className="sidebar-backdrop" type="button" data-preserve-editor
        tabIndex={-1} aria-label={t('sidebar.collapse')} onPointerDown={focusLayoutControl} onClick={close} />}
      <aside id="workspace-sidebar" className="left-panel" data-collapsed={overlay && !expanded || undefined}
        inert={overlay && !expanded} data-help={editing ? 'concept.property-manager' : 'concept.feature-tree'}>
        {sidebar}
      </aside>
      {!drawing && !overlay && (
        <div className="sidebar-divider" role="separator" tabIndex={0} aria-orientation="vertical"
          aria-controls="workspace-sidebar" aria-label={t('sidebar.resize')}
          aria-valuemin={MIN_WIDTH} aria-valuenow={width} aria-valuemax={maxWidth} data-preserve-editor
          title={t('sidebar.resize')}
          onPointerDown={(e) => {
            if (e.button !== 0 || drag.current) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { pointer: e.pointerId, x: e.clientX, width };
          }}
          onPointerMove={(e) => {
            const start = drag.current;
            if (start?.pointer === e.pointerId) setPreview(clamp(start.width + e.clientX - start.x));
          }}
          onPointerUp={(e) => finishDrag(e.pointerId, e.clientX)}
          onPointerCancel={(e) => finishDrag(e.pointerId)}
          onLostPointerCapture={(e) => finishDrag(e.pointerId)}
          onDoubleClick={() => save(DEFAULT_WIDTH, true)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 32 : 8;
            const value = { ArrowLeft: width - step, ArrowRight: width + step, Home: MIN_WIDTH, End: maxWidth }[e.key];
            if (value === undefined) return;
            e.preventDefault();
            e.stopPropagation();
            save(value);
          }}
        />
      )}
      {children}
    </div>
  );
}
