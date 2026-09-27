import { useEffect, useRef, useState } from 'react';
import { findFeature } from '@3db/model';
import { Viewer } from '@3db/render';
import { ACTIONS } from '../actions';
import { store, useStore } from '../state/store';

/** Graphics area (D4, D5): viewer, heads-up view toolbar, edge picking while a fillet is being edited. */
export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const result = useStore((s) => s.result);
  const editing = useStore((s) => s.editing);
  const doc = useStore((s) => s.doc);
  const bootMs = useStore((s) => s.bootMs);
  const bootError = useStore((s) => s.bootError);
  const [hover, setHover] = useState(-1);

  useEffect(() => {
    const viewer = new Viewer(host.current!, {
      onEdgeHover: setHover,
      onEdgeClick: (edge) => store.toggleFilletEdge(edge),
    });
    store.viewer = viewer;
    return () => {
      viewer.dispose();
      store.viewer = null;
    };
  }, []);

  const feature = editing ? findFeature(doc, editing.featureId) : undefined;
  const picking = feature?.type === 'fillet';

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    v.setMesh(result?.mesh ?? null, !fitted.current && !!result?.mesh);
    if (result?.mesh) fitted.current = true;
  }, [result]);

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    v.setEdgePicking(picking);
    const names = result?.edgeNames ?? [];
    v.setSelectedEdges(picking && feature?.type === 'fillet' ? feature.edges.map((e) => names.indexOf(e.name)).filter((i) => i >= 0) : []);
  }, [picking, feature, result]);

  const hoverName = picking && hover >= 0 ? result?.edgeNames[hover] : undefined;

  return (
    <main className="viewport">
      <div ref={host} className="viewport-canvas" />
      <div className="heads-up">
        {ACTIONS.filter((a) => a.group === 'view').map((a) => (
          <button key={a.id} onClick={a.run} title={a.shortcut ? `${a.label}（${a.shortcut}）` : a.label}>
            {a.label}
          </button>
        ))}
      </div>
      {!bootMs && (
        <div className="boot-overlay">{bootError ? `幾何核心載入失敗：${bootError}` : '正在載入幾何核心（OCCT WASM，約 23 MB）…'}</div>
      )}
      {picking && (
        <div className="pick-hint">
          {hoverName ? (
            <>
              持久名稱：<code>{hoverName}</code>
            </>
          ) : (
            '點選邊線以加入圓角'
          )}
        </div>
      )}
    </main>
  );
}
