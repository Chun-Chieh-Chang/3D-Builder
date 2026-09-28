import { useEffect, useRef, useState } from 'react';
import { findFeature, isDimension, type Ref } from '@3db/model';
import { ownerFeatures } from '@3db/naming';
import { Viewer, type SketchOverlay } from '@3db/render';
import { ACTIONS } from '../actions';
import { buildOverlay } from '../sketcher/overlay';
import { store, useSketcherView, useStore } from '../state/store';
import { FEATURE_LABEL } from '../strings';
import type { RebuildPayload } from '../worker/protocol';
import { Icon } from './Icon';

/**
 * Graphics area (D4, D5): viewer, heads-up view toolbar, face selection, edge picking while a fillet
 * or chamfer is being edited, end-face picking for 「成形至某一面」, and the sketch overlay with its
 * tools while a sketch is being edited.
 * Picked indices are resolved against the payload whose mesh is on screen — never against a newer
 * or older result — so an index can only ever name the element the user actually clicked.
 */
export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const displayed = useRef<RebuildPayload | null>(null);
  const overlay = useRef<SketchOverlay | null>(null);
  const sketchingRef = useRef(false);
  const fitted = useRef(false);
  const result = useStore((s) => s.result);
  const editing = useStore((s) => s.editing);
  const doc = useStore((s) => s.doc);
  const selectedFace = useStore((s) => s.selectedFace);
  const selected = useStore((s) => s.selected);
  const sketchSolve = useStore((s) => s.sketchSolve);
  const dimensionEdit = useStore((s) => s.dimensionEdit);
  const bootMs = useStore((s) => s.bootMs);
  const bootError = useStore((s) => s.bootError);
  const view = useSketcherView();
  const [hover, setHover] = useState(-1);
  const [hoverFace, setHoverFace] = useState(-1);
  const [viewTick, setViewTick] = useState(0);
  const sketching = editing?.kind === 'sketch';
  sketchingRef.current = sketching;

  useEffect(() => {
    const edgeRef = (edge: number): Ref | null => {
      const r = displayed.current;
      const name = r?.edgeNames[edge];
      const fingerprint = r?.edgeFingerprints[edge];
      return name && fingerprint ? { kind: 'edge', name, fingerprint } : null;
    };
    const faceRef = (face: number): Ref | null => {
      const r = displayed.current;
      const name = r?.faceNames[face];
      const fingerprint = r?.faceFingerprints[face];
      return name && fingerprint ? { kind: 'face', name, fingerprint } : null;
    };
    const idOf = (key: string) => key.slice(key.indexOf(':') + 1);
    const viewer = new Viewer(host.current!, {
      onEdgeHover: setHover,
      onEdgeClick: (edge) => {
        const ref = edgeRef(edge);
        if (ref) store.toggleEdge(ref);
      },
      onFaceHover: setHoverFace,
      onFaceClick: (face) => {
        const ref = faceRef(face);
        if (store.getState().editing) {
          if (ref) store.setUpToFace(ref);
        } else store.selectFace(ref);
      },
      // Screen-sized parts of the sketch overlay (dimension offsets, arrows) follow the zoom.
      onViewChange: () => sketchingRef.current && setViewTick((t) => t + 1),
      onLabelClick: (key, additive) => {
        if (key.startsWith('dim:') || key.startsWith('rel:')) store.sketcher?.select([idOf(key)], additive);
      },
      onLabelDoubleClick: (key) => {
        if (key.startsWith('dim:')) store.editDimension(idOf(key));
      },
    });
    store.viewer = viewer;
    return () => {
      viewer.dispose();
      store.viewer = null;
    };
  }, []);

  const feature = editing ? findFeature(doc, editing.featureId) : undefined;
  const edgeFeature = feature?.type === 'fillet' || feature?.type === 'chamfer' ? feature : null;
  const endFace = feature?.type === 'extrude' && feature.dir1.type === 'upToFace' ? feature.dir1.face : null;
  const pickingEndFace = feature?.type === 'extrude' && feature.dir1.type === 'upToFace';
  const pickingFaces = !editing || pickingEndFace;

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
    v.setEdgePicking(!!edgeFeature);
    v.setFacePicking(pickingFaces);
    const edgeNames = displayed.current?.edgeNames ?? [];
    const faceNames = displayed.current?.faceNames ?? [];
    v.setSelectedEdges(edgeFeature ? edgeFeature.edges.map((e) => edgeNames.indexOf(e.name)).filter((i) => i >= 0) : []);
    const face = pickingEndFace ? endFace : !editing ? selectedFace : null;
    if (face && face.kind === 'face') v.setSelectedFaces([faceNames.indexOf(face.name)].filter((i) => i >= 0));
    // D1.2: a feature selected in the FeatureManager shows the faces it made.
    else v.setSelectedFaces(!editing && selected ? faceNames.flatMap((n, i) => (ownerFeatures(n)[0] === selected ? [i] : [])) : []);
  }, [edgeFeature, pickingFaces, pickingEndFace, endFace, editing, selectedFace, selected, result]);

  // Sketch tools own the left mouse button while a sketch is being edited.
  useEffect(() => {
    const v = store.viewer;
    const sketcher = store.sketcher;
    const sketch = store.editedSketch();
    const frame = sketch && store.frameOf(sketch);
    if (!v || !sketching || !sketcher || !frame) return;
    v.setToolHandler((e) => {
      const p = v.planePoint(e.clientX, e.clientY, frame);
      if (!p && e.type !== 'leave') return;
      const input = { p: p ?? [0, 0], px: v.pixelSize(), ctrl: e.ctrl, shift: e.shift } as const;
      if (e.type === 'down') sketcher.pointerDown(input);
      else if (e.type === 'move') sketcher.pointerMove(input, e.pressed);
      else if (e.type === 'up') sketcher.pointerUp(input);
      else if (e.type === 'dblclick') sketcher.doubleClick(input);
      else sketcher.leave();
    });
    return () => v.setToolHandler(null);
  }, [sketching, editing?.featureId]);

  useEffect(() => {
    const v = store.viewer;
    const sketcher = store.sketcher;
    const sketch = store.editedSketch();
    const frame = sketch && store.frameOf(sketch);
    if (!v) return;
    if (!sketching || !sketcher || !sketch || !frame || !view) {
      overlay.current = null;
      v.setOverlay(null);
      return;
    }
    overlay.current = buildOverlay(frame, sketch, sketchSolve, view, v.pixelSize(), { showRelations: true, dimensionPreview: sketcher.dimensionPreview() });
    v.setOverlay(overlay.current);
  }, [sketching, doc, sketchSolve, view, viewTick]);

  const hoverEdgeName = edgeFeature && hover >= 0 ? displayed.current?.edgeNames[hover] : undefined;
  const hoverFaceName = pickingFaces && hoverFace >= 0 ? displayed.current?.faceNames[hoverFace] : undefined;
  const planar = selectedFace?.fingerprint?.type === 'plane';

  return (
    <main className="viewport">
      <div ref={host} className="viewport-canvas" />
      <div className="heads-up">
        {ACTIONS.filter((a) => a.group === 'view').map((a) => (
          <button key={a.id} onClick={a.run} disabled={!a.enabled(store.getState())} title={a.shortcut ? `${a.label}（${a.shortcut}）` : a.label}>
            {a.label}
          </button>
        ))}
      </div>
      {sketching && (
        <div className="confirm-corner">
          <button className="pm-ok" title="離開草圖（保留變更）" onClick={() => store.commitEdit()}>
            <Icon name="ok" />
          </button>
          <button className="pm-cancel" title="放棄變更並離開草圖" onClick={() => store.cancelEdit()}>
            <Icon name="cancel" />
          </button>
        </div>
      )}
      {sketching && dimensionEdit && <DimensionEditor id={dimensionEdit} overlay={overlay.current} key={dimensionEdit} />}
      {!bootMs && (
        <div className="boot-overlay">{bootError ? `幾何核心載入失敗：${bootError}` : '正在載入幾何核心（OCCT WASM，約 43 MB）…'}</div>
      )}
      {edgeFeature && (
        <div className="pick-hint">
          {hoverEdgeName ? (
            <>
              持久名稱：<code>{hoverEdgeName}</code>
            </>
          ) : (
            `點選邊線以加入${FEATURE_LABEL[edgeFeature.type]}`
          )}
        </div>
      )}
      {pickingEndFace && (
        <div className="pick-hint">
          {hoverFaceName ? (
            <>
              持久名稱：<code>{hoverFaceName}</code>
            </>
          ) : (
            '點選伸長要終止的面'
          )}
        </div>
      )}
      {!editing && (hoverFaceName || selectedFace) && (
        <div className="pick-hint">
          {hoverFaceName ? (
            <>
              面：<code>{hoverFaceName}</code>
            </>
          ) : (
            <>
              已選取面 <code>{selectedFace!.name}</code>
              {planar ? '：按「草圖」分頁的「草圖」即可在此面上繪製。' : '（不是平面，不能放草圖）'}
            </>
          )}
        </div>
      )}
      {sketching && view && <div className="pick-hint">{view.hint}</div>}
    </main>
  );
}

/** Modify box (D6.1): the dimension's value, applied with Enter, dismissed with Esc. */
function DimensionEditor({ id, overlay }: { id: string; overlay: SketchOverlay | null }) {
  const sketch = store.editedSketch();
  const c = sketch?.constraints.find((x) => x.id === id);
  const [text, setText] = useState(c && isDimension(c) ? c.value : '');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const label = overlay?.labels.find((l) => l.key === `dim:${id}`);
  const v = store.viewer;
  if (!c || !isDimension(c) || !label || !v || !overlay) return null;
  const at = v.screenOf(overlay.frame, label.p);
  return (
    <div className="modify-box" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        className={invalid ? 'invalid' : ''}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setInvalid(!store.setDimensionValue(id, text.trim()));
          if (e.key === 'Escape') store.editDimension(null);
          e.stopPropagation();
        }}
        onBlur={() => store.editDimension(null)}
      />
      <span className="suffix">{c.type === 'angle' ? '°' : 'mm'}</span>
    </div>
  );
}
