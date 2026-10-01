import { useEffect, useRef, useState } from 'react';
import { t } from '@3db/i18n';
import { DATUM_PLANES, findFeature, isDimension, isShown, ORIGIN_KEY, Parameters, type DatumPlaneName, type Id, type Feature, type PlaneFrame, type Ref } from '@3db/model';
import { ownerFeatures } from '@3db/naming';
import { Viewer, type DatumDisplay, type PlaneDisplay, type SketchOverlay } from '@3db/render';
import { ACTIONS } from '../actions';
import { chosen, pickable, prompt } from '../state/datumSlots';
import { sample } from '@3db/sketch/interact';
import { buildOverlay, SKETCH_COLORS } from '../sketcher/overlay';
import { store, useSketcherView, useStore } from '../state/store';
import { FEATURE_LABEL } from '../strings';
import type { RebuildPayload } from '../worker/protocol';
import { Icon } from './Icon';

/**
 * What the graphics area picks during a PropertyManager session, what it shows as already picked
 * (the SolidWorks selection boxes), and the prompt. Outside sessions faces are picked for selection.
 */
function picking(feature: Feature | undefined, editing: boolean, modelTool: 'convert' | 'pierce' | null = null) {
  // reference geometry (C3.2–C3.5): what its empty selection boxes take, and what they hold
  const datum = feature?.type === 'refPlane' || feature?.type === 'refAxis' || feature?.type === 'refPoint' || feature?.type === 'coordSys' || feature?.type === 'pattern' || feature?.type === 'mirror' ? feature : undefined;
  const slots = datum ? { ...pickable(datum), ...chosen(datum), prompt: prompt(datum) } : null;
  // the end of an extrusion that is a face, a vertex or a body: what is clicked on the model goes to the direction that is waiting for it
  const ends = feature?.type === 'extrude' ? [feature.dir1, feature.dir2].flatMap((d) => (d ? [d] : [])) : [];
  const endFaces = ends.flatMap((d) => (d.type === 'upToFace' || d.type === 'offsetFromFace' ? [d.face] : []));
  const endVertices = ends.flatMap((d) => (d.type === 'upToVertex' ? [d.vertex] : []));
  const endBody = ends.some((d) => d.type === 'upToBody');
  const upTo = endFaces.length > 0 || endVertices.length > 0 || endBody ? ends : null;
  const edgeFeature = feature?.type === 'fillet' || feature?.type === 'chamfer' ? feature : null;
  const faceFeature = feature?.type === 'deleteFace' || feature?.type === 'moveFace' || feature?.type === 'shell' || feature?.type === 'draft' ? feature : null;
  const combine = feature?.type === 'combine';
  const prompt_ = combine
    ? t('pick.combine')
    : faceFeature
    ? t(faceFeature.type === 'deleteFace' ? 'pick.deleteFace' : faceFeature.type === 'shell' ? 'pick.shell' : faceFeature.type === 'draft' ? 'pick.draft' : 'pick.moveFace')
    : edgeFeature
    ? `點選邊線以加入${FEATURE_LABEL[edgeFeature.type]}`
    : upTo
      ? t('pick.extrudeEnd')
      : (slots?.prompt ?? null);
  return {
    edges: !!edgeFeature || !!slots?.edges || modelTool !== null,
    faces: !editing || modelTool === 'convert' || !!upTo || !!faceFeature || combine || !!slots?.faces,
    vertices: !!slots?.vertices || endVertices.length > 0,
    pickedEdges: edgeFeature ? edgeFeature.edges : (slots?.edges ?? []),
    pickedFaces: faceFeature ? (faceFeature.type === 'deleteFace' || faceFeature.type === 'shell' ? faceFeature.faces : faceFeature.type === 'draft' ? [faceFeature.neutral, ...faceFeature.faces] : [faceFeature.face]) : upTo ? endFaces : (slots?.faces ?? []),
    pickedVertices: slots ? slots.vertices : endVertices,
    /** Default and reference planes, axes and points the geometry being defined is based on: they are drawn while they are used. */
    referenceDatums: slots?.datums ?? [],
    prompt: prompt_,
  };
}

/**
 * Graphics area (D4, D5): viewer, heads-up view toolbar, face selection, reference planes, element
 * picking for the feature being edited (edges of a fillet or chamfer, the end face of 「成形至某一面」,
 * faces, edges and vertices of a reference plane), and the sketch overlay with its tools while a
 * sketch is being edited.
 * Picked indices are resolved against the payload whose mesh is on screen — never against a newer
 * or older result — so an index can only ever name the element the user actually clicked.
 */
export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const displayed = useRef<RebuildPayload | null>(null);
  const overlay = useRef<SketchOverlay | null>(null);
  const sketchingRef = useRef(false);
  /** The fitRequest the view was last fitted for: a new or opened part is fitted once its model arrives. */
  const fittedFor = useRef(-1);
  const result = useStore((s) => s.result);
  const editing = useStore((s) => s.editing);
  const doc = useStore((s) => s.doc);
  const selectedFace = useStore((s) => s.selectedFace);
  const selected = useStore((s) => s.selected);
  const sketchSolve = useStore((s) => s.sketchSolve);
  const dimensionEdit = useStore((s) => s.dimensionEdit);
  const bootMs = useStore((s) => s.bootMs);
  const bootError = useStore((s) => s.bootError);
  const fitRequest = useStore((s) => s.fitRequest);
  const view = useSketcherView();
  const [hover, setHover] = useState(-1);
  const [hoverFace, setHoverFace] = useState(-1);
  const [hoverVertex, setHoverVertex] = useState(-1);
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
    const vertexRef = (vertex: number): Ref | null => {
      const r = displayed.current;
      const name = r?.vertexNames[vertex];
      const fingerprint = r?.vertexFingerprints[vertex];
      return name && fingerprint ? { kind: 'vertex', name, fingerprint } : null;
    };
    const idOf = (key: string) => key.slice(key.indexOf(':') + 1);
    const viewer = new Viewer(host.current!, {
      onEdgeHover: setHover,
      onEdgeClick: (edge) => {
        const ref = edgeRef(edge);
        if (ref) store.pick(ref);
      },
      onFaceHover: setHoverFace,
      onFaceClick: (face) => {
        const ref = faceRef(face);
        if (store.getState().editing) {
          if (ref) store.pick(ref);
        } else store.selectFace(ref);
      },
      onVertexHover: setHoverVertex,
      onVertexClick: (vertex) => {
        const ref = vertexRef(vertex);
        if (ref) store.pick(ref);
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
  // 「轉換實體引用」 and 「貫穿」 pick the model, not points on the sketch plane (C1.18)
  const modelTool = sketching && (view?.tool === 'convert' || view?.tool === 'pierce') ? view.tool : null;
  const pick = picking(feature, !!editing, modelTool);

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    const fit = !!result?.mesh && fittedFor.current !== fitRequest;
    v.setMesh(result?.mesh ?? null, fit);
    v.setVertices(result?.vertexPoints ?? new Float32Array(0));
    displayed.current = result;
    if (fit) fittedFor.current = fitRequest;
  }, [result]);

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    const p = picking(feature, !!editing, modelTool);
    v.setEdgePicking(p.edges);
    v.setFacePicking(p.faces);
    v.setVertexPicking(p.vertices);
    const r = displayed.current;
    const indices = (names: string[] | undefined, refs: Ref[]) => refs.map((x) => names?.indexOf(x.name) ?? -1).filter((i) => i >= 0);
    v.setSelectedEdges(indices(r?.edgeNames, p.pickedEdges));
    v.setSelectedVertices(indices(r?.vertexNames, p.pickedVertices));
    /** The faces of bodies, by the ranges the rebuild gave them (C7.1). */
    const ofBodies = (ids: string[]) => (r?.bodies ?? []).filter((b) => ids.includes(b.id)).flatMap((b) => Array.from({ length: b.faces }, (_, k) => b.face0 + k));
    if (editing && feature?.type === 'combine') v.setSelectedFaces(ofBodies([feature.main.name, ...feature.tools.map((x) => x.name)]));
    else if (!editing && selected?.startsWith('body:')) v.setSelectedFaces(ofBodies([selected.slice('body:'.length)]));
    else if (editing) v.setSelectedFaces(indices(r?.faceNames, p.pickedFaces));
    else if (selectedFace?.kind === 'face') v.setSelectedFaces(indices(r?.faceNames, [selectedFace]));
    // D1.2: a feature selected in the FeatureManager shows the faces it made.
    else v.setSelectedFaces(selected ? (r?.faceNames ?? []).flatMap((n, i) => (ownerFeatures(n)[0] === selected ? [i] : [])) : []);
  }, [feature, editing, selectedFace, selected, result, modelTool]);

  // Reference planes show like new planes in SolidWorks; default planes only when selected or referenced (D4.6).
  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    const reference = picking(feature, !!editing).referenceDatums;
    const planes: PlaneDisplay[] = [];
    const show = (key: string, frame: PlaneFrame | undefined, highlighted: boolean) => frame && planes.push({ key, frame, highlighted });
    for (const name of Object.keys(DATUM_PLANES) as DatumPlaneName[]) {
      if (selected === name || reference.includes(name) || isShown(doc, name)) show(name, DATUM_PLANES[name], selected === name);
    }
    for (const f of doc.features) {
      if (f.type === 'refPlane' && (isShown(doc, f.id) || selected === f.id || editing?.featureId === f.id)) show(f.id, result?.frames.get(f.id), selected === f.id || editing?.featureId === f.id);
    }
    v.setPlanes(planes);
  }, [feature, editing, selected, doc, result]);

  // Reference axes, points and coordinate systems (D4.6): shown, or being defined, or used by what is being defined.
  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    const reference = picking(feature, !!editing).referenceDatums;
    const lit = (id: Id) => selected === id || editing?.featureId === id;
    const datums: DatumDisplay = { axes: [], points: [], systems: [] };
    for (const f of doc.features) {
      if (!(isShown(doc, f.id) || lit(f.id) || reference.includes(f.id))) continue;
      if (f.type === 'refAxis') {
        const a = result?.axes.get(f.id);
        if (a) datums.axes.push({ key: f.id, origin: a.origin, dir: a.dir, highlighted: lit(f.id) });
      } else if (f.type === 'refPoint') {
        const p = result?.points.get(f.id);
        if (p) datums.points.push({ key: f.id, p, highlighted: lit(f.id) });
      } else if (f.type === 'coordSys') {
        const c = result?.systems.get(f.id);
        if (c) datums.systems.push({ key: f.id, ...c, highlighted: lit(f.id) });
      }
    }
    v.setDatums(datums);
  }, [feature, editing, selected, doc, result]);

  // Shown sketches and the origin (D4.6). The sketch being edited is drawn by its own overlay.
  const zoomBand = store.viewer ? Math.round(Math.log2(store.viewer.pixelSize())) : 0;
  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    v.setOrigin(isShown(doc, ORIGIN_KEY));
    const px = v.pixelSize();
    const overlays: SketchOverlay[] = [];
    for (const [id, geometry] of result?.sketchGeometry ?? []) {
      const frame = result?.frames.get(id);
      if (!frame || id === editing?.featureId || !isShown(doc, id)) continue;
      const status = result?.features.find((f) => f.id === id)?.sketch?.status;
      const color = status === 'over' ? SKETCH_COLORS.over : status === 'fully' ? SKETCH_COLORS.fully : SKETCH_COLORS.under;
      const curves: SketchOverlay['curves'] = [];
      for (const g of geometry.values()) if (g.type !== 'point') curves.push({ points: sample(g, px), color, dashed: g.construction });
      overlays.push({ frame, curves, points: [], labels: [] });
    }
    v.setSketches(overlays);
  }, [doc, result, editing?.featureId, zoomBand]);

  // Sketch tools own the left mouse button while a sketch is being edited.
  useEffect(() => {
    const v = store.viewer;
    const sketcher = store.sketcher;
    const sketch = store.editedSketch();
    const frame = sketch && store.frameOf(sketch);
    if (!v || !sketching || !sketcher || !frame || modelTool) return;
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
  }, [sketching, editing?.featureId, modelTool]);

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
    const params = new Parameters(doc);
    const values = new Map<Id, number>();
    for (const c of sketch.constraints) {
      const r = isDimension(c) ? params.dimensionValue(sketch, c) : null;
      if (r && 'value' in r) values.set(c.id, r.value);
    }
    overlay.current = buildOverlay(frame, sketch, sketchSolve, view, v.pixelSize(), { showRelations: true, values, dimensionPreview: sketcher.dimensionPreview() });
    v.setOverlay(overlay.current);
  }, [sketching, doc, sketchSolve, view, viewTick]);

  const shown = displayed.current;
  const hoverName =
    (pick.vertices && hoverVertex >= 0 ? shown?.vertexNames[hoverVertex] : undefined) ??
    (pick.edges && hover >= 0 ? shown?.edgeNames[hover] : undefined) ??
    (pick.faces && hoverFace >= 0 ? shown?.faceNames[hoverFace] : undefined);
  const hoverFaceName = pick.faces && hoverFace >= 0 ? shown?.faceNames[hoverFace] : undefined;
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
      {pick.prompt && (
        <div className="pick-hint">
          {hoverName ? (
            <>
              持久名稱：<code>{hoverName}</code>
            </>
          ) : (
            pick.prompt
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
