import { useEffect, useRef, useState } from 'react';
import { findFeature, type Ref } from '@3db/model';
import { Viewer } from '@3db/render';
import { ACTIONS } from '../actions';
import { store, useStore } from '../state/store';
import type { RebuildPayload } from '../worker/protocol';

/**
 * Graphics area (D4, D5): viewer, heads-up view toolbar, edge picking while a fillet is being edited.
 * Picked indices are resolved against the payload whose mesh is on screen — never against a newer
 * or older result — so an index can only ever name the edge the user actually clicked.
 */
export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const displayed = useRef<RebuildPayload | null>(null);
  const fitted = useRef(false);
  const result = useStore((s) => s.result);
  const editing = useStore((s) => s.editing);
  const doc = useStore((s) => s.doc);
  const bootMs = useStore((s) => s.bootMs);
  const bootError = useStore((s) => s.bootError);
  const [hover, setHover] = useState(-1);

  useEffect(() => {
    const edgeRef = (edge: number): Ref | null => {
      const r = displayed.current;
      const name = r?.edgeNames[edge];
      const fingerprint = r?.edgeFingerprints[edge];
      return name && fingerprint ? { kind: 'edge', name, fingerprint } : null;
    };
    const viewer = new Viewer(host.current!, {
      onEdgeHover: setHover,
      onEdgeClick: (edge) => {
        const ref = edgeRef(edge);
        if (ref) store.toggleFilletEdge(ref);
      },
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
    displayed.current = result;
    if (result?.mesh) fitted.current = true;
  }, [result]);

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    v.setEdgePicking(picking);
    const names = displayed.current?.edgeNames ?? [];
    v.setSelectedEdges(picking && feature?.type === 'fillet' ? feature.edges.map((e) => names.indexOf(e.name)).filter((i) => i >= 0) : []);
  }, [picking, feature, result]);

  const hoverName = picking && hover >= 0 ? displayed.current?.edgeNames[hover] : undefined;

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
        <div className="boot-overlay">{bootError ? `幾何核心載入失敗：${bootError}` : '正在載入幾何核心（OCCT WASM，約 43 MB）…'}</div>
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
