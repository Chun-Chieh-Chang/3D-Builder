import { useEffect, useRef, useState } from 'react';
import { t } from '@3db/i18n';
import { DATUM_PLANES, findFeature, isDimension, isShown, ORIGIN_KEY, Parameters, settingsOf, type DatumPlaneName, type Id, type Feature, type PlaneFrame, type Ref } from '@3db/model';
import { ownerFeatures } from '@3db/naming';
import { Viewer, type DatumDisplay, type DisplayMode, type PlaneDisplay, type SectionPlane, type SketchOverlay, type StandardView } from '@3db/render';
import { ACTIONS, shortcutOf } from '../actions';
import { chosen, pickable, prompt } from '../state/datumSlots';
import { sample } from '@3db/sketch/interact';
import { buildOverlay, SKETCH_COLORS } from '../sketcher/overlay';
import { store, useSketcherView, useStore } from '../state/store';
import { FEATURE_LABEL } from '../strings';
import type { RebuildPayload } from '../worker/protocol';
import { Topology } from '../state/selectionSets';
import { Icon } from './Icon';
import { MeasurePanel } from './MeasurePanel';

/** Topology for selecting loops, tangent chains and the like, built once per rebuilt model (D5.6). */
const topologies = new WeakMap<RebuildPayload, Topology>();
function topologyOf(r: RebuildPayload): Topology | null {
  if (!r.mesh) return null;
  let topo = topologies.get(r);
  if (!topo) {
    topo = new Topology({ faceNames: r.faceNames, edgeNames: r.edgeNames, mesh: r.mesh });
    topologies.set(r, topo);
  }
  return topo;
}

/** One line of the right-click menu; one that returns more lines opens them in its place. */
interface MenuItem {
  label: string;
  run: () => MenuItem[] | void;
}

/**
 * What the graphics area picks during a PropertyManager session, what it shows as already picked
 * (the SolidWorks selection boxes), and the prompt. Outside sessions faces are picked for selection.
 */
function picking(feature: Feature | undefined, editing: boolean, modelTool: 'convert' | 'pierce' | null = null, measuring = false) {
  // reference geometry (C3.2–C3.5): what its empty selection boxes take, and what they hold
  const datum = feature?.type === 'refPlane' || feature?.type === 'refAxis' || feature?.type === 'refPoint' || feature?.type === 'coordSys' || feature?.type === 'pattern' || feature?.type === 'mirror' ? feature : undefined;
  const slots = datum ? { ...pickable(datum), ...chosen(datum), prompt: prompt(datum) } : null;
  // the end of an extrusion that is a face, a vertex or a body: what is clicked on the model goes to the direction that is waiting for it
  const ends = feature?.type === 'extrude' ? [feature.dir1, feature.dir2].flatMap((d) => (d ? [d] : [])) : [];
  const endFaces = ends.flatMap((d) => (d.type === 'upToFace' || d.type === 'offsetFromFace' ? [d.face] : []));
  const endVertices = ends.flatMap((d) => (d.type === 'upToVertex' ? [d.vertex] : []));
  const endBody = ends.some((d) => d.type === 'upToBody');
  const upTo = endFaces.length > 0 || endVertices.length > 0 || endBody ? ends : null;
  const edgeFeature = feature?.type === 'fillet' || feature?.type === 'chamfer' || feature?.type === 'fillSurface' || feature?.type === 'flatSurface' || feature?.type === 'extendSurface' ? feature : null;
  const faceFeature = feature?.type === 'deleteFace' || feature?.type === 'moveFace' || feature?.type === 'shell' || feature?.type === 'draft' || feature?.type === 'offsetSurface' || feature?.type === 'splitLine' || feature?.type === 'trimSurface' ? feature : null;
  const combine = feature?.type === 'combine' || feature?.type === 'knit' || feature?.type === 'thicken' || feature?.type === 'cutWithSurface';
  const prompt_ = combine
    ? t(feature?.type === 'knit' ? 'pick.knit' : feature?.type === 'thicken' ? 'pick.thicken' : feature?.type === 'cutWithSurface' ? 'pick.cutWithSurface' : 'pick.combine')
    : faceFeature
    ? t(faceFeature.type === 'deleteFace' ? 'pick.deleteFace' : faceFeature.type === 'shell' ? 'pick.shell' : faceFeature.type === 'draft' ? 'pick.draft' : faceFeature.type === 'offsetSurface' ? 'pick.offsetSurface' : faceFeature.type === 'splitLine' ? 'pick.splitLine' : faceFeature.type === 'trimSurface' ? 'pick.trimSurface' : 'pick.moveFace')
    : edgeFeature
    ? t('pick.edges', { what: FEATURE_LABEL[edgeFeature.type] })
    : upTo
      ? t('pick.extrudeEnd')
      : (slots?.prompt ?? null);
  return {
    edges: !!edgeFeature || !!slots?.edges || modelTool !== null || measuring,
    faces: !editing || modelTool === 'convert' || !!upTo || !!faceFeature || combine || !!slots?.faces || measuring,
    vertices: !!slots?.vertices || endVertices.length > 0 || measuring,
    pickedEdges: edgeFeature ? edgeFeature.edges : (slots?.edges ?? []),
    pickedFaces: faceFeature ? (faceFeature.type === 'deleteFace' || faceFeature.type === 'shell' || faceFeature.type === 'offsetSurface' ? faceFeature.faces : faceFeature.type === 'draft' ? [faceFeature.neutral, ...faceFeature.faces] : [faceFeature.face]) : upTo ? endFaces : (slots?.faces ?? []),
    pickedVertices: slots ? slots.vertices : endVertices,
    /** Default and reference planes, axes and points the geometry being defined is based on: they are drawn while they are used. */
    referenceDatums: slots?.datums ?? [],
    prompt: measuring ? t('measure.prompt') : prompt_,
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
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const pickFilter = useStore((s) => s.pickFilter);
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
    const clickFace = (face: number) => {
      if (store.getState().measure) return store.measurePick('face', face, null);
      const ref = faceRef(face);
      if (store.getState().editing) {
        if (ref) store.pick(ref);
      } else store.selectFace(ref);
    };
    const viewer = new Viewer(host.current!, {
      onEdgeHover: setHover,
      onEdgeClick: (edge) => {
        if (store.getState().measure) return store.measurePick('edge', edge, null);
        const ref = edgeRef(edge);
        if (ref) store.pick(ref);
      },
      onFaceHover: setHoverFace,
      onFaceClick: clickFace,
      onContextMenu: (x, y) => {
        const r = displayed.current;
        const topo = r && topologyOf(r);
        if (!r || !topo) return;
        const el = viewer.elementsAt(x, y);
        const kind = store.multiPickKind();
        const refs = (indices: number[], of: 'edge' | 'face') => indices.flatMap((i) => { const ref = of === 'edge' ? edgeRef(i) : faceRef(i); return ref ? [ref] : []; });
        const add = (list: Ref[]) => () => void store.pickMany(list);
        const items: MenuItem[] = [];
        if (kind === 'edge' && el.edge >= 0) {
          items.push({ label: t('select.tangentEdges'), run: add(refs(topo.tangentEdges(el.edge), 'edge')) });
          for (const f of topo.edgeFaces[el.edge] ?? []) items.push({ label: t('select.loopOf', { name: r.faceNames[f] ?? '' }), run: add(refs(topo.loop(f, el.edge), 'edge')) });
        }
        if (kind === 'face' && el.face >= 0) items.push({ label: t('select.tangentFaces'), run: add(refs(topo.tangentFaces(el.face), 'face')) });
        const stack = el.face >= 0 ? viewer.facesAt(x, y) : [];
        if (stack.length > 1) {
          const others: MenuItem[] = stack.map((f, i) => ({ label: t('select.otherFace', { n: i + 1, name: r.faceNames[f] ?? '' }), run: () => clickFace(f) }));
          items.push({ label: t('select.other', { count: stack.length }), run: () => others });
        }
        const rect = host.current?.getBoundingClientRect();
        if (items.length > 0 && rect) setMenu({ x: x - rect.left, y: y - rect.top, items });
        else setMenu(null);
      },
      onVertexHover: setHoverVertex,
      onVertexClick: (vertex) => {
        if (store.getState().measure) return store.measurePick('vertex', vertex, null);
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
  const measure = useStore((s) => s.measure);
  const pick = picking(feature, !!editing, modelTool, measure !== null);

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    const fit = !!result?.mesh && fittedFor.current !== fitRequest;
    v.setMesh(result?.mesh ?? null, fit);
    v.setFaceColors(result?.faceColors ?? []);
    v.setVertices(result?.vertexPoints ?? new Float32Array(0));
    displayed.current = result;
    if (fit) fittedFor.current = fitRequest;
  }, [result]);

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    const p = picking(feature, !!editing, modelTool, measure !== null);
    v.setEdgePicking(p.edges);
    v.setFacePicking(p.faces);
    v.setVertexPicking(p.vertices);
    v.setPickFilter(pickFilter); // the user's filter (what can be picked) holds for measuring too
    const r = displayed.current;
    if (measure) {
      // what is measured is shown as picked (by the numbers the mesh has), nothing else
      const of = (kind: 'face' | 'edge' | 'vertex') => measure.picks.filter((x) => x.kind === kind).map((x) => x.index);
      v.setSelectedFaces(of('face'));
      v.setSelectedEdges(of('edge'));
      v.setSelectedVertices(of('vertex'));
      return;
    }
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
  }, [feature, editing, selectedFace, selected, result, modelTool, pickFilter, measure]);

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
    overlay.current = buildOverlay(frame, sketch, sketchSolve, view, v.pixelSize(), { showRelations: true, values, dimensionPreview: sketcher.dimensionPreview(), precision: settingsOf(doc).dimensionPrecision });
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
      <ViewCube />
      <ViewOptions />
      <div className="heads-up">
        {ACTIONS.filter((a) => a.group === 'view').map((a) => (
          <button key={a.id} onClick={a.run} disabled={!a.enabled(store.getState())} title={shortcutOf(a) ? `${a.label} (${shortcutOf(a)})` : a.label}>
            {a.label}
          </button>
        ))}
      </div>
      {sketching && (
        <div className="confirm-corner">
          <button className="pm-ok" title={t('sketch.exitKeep')} onClick={() => store.commitEdit()}>
            <Icon name="ok" />
          </button>
          <button className="pm-cancel" title={t('sketch.exitDiscard')} onClick={() => store.cancelEdit()}>
            <Icon name="cancel" />
          </button>
        </div>
      )}
      {sketching && dimensionEdit && <DimensionEditor id={dimensionEdit} overlay={overlay.current} key={dimensionEdit} />}
      {!bootMs && (
        <div className="boot-overlay">{bootError ? t('boot.failed', { why: bootError }) : t('boot.loading')}</div>
      )}
      {pick.prompt && (
        <div className="pick-hint">
          {hoverName ? (
            <>
              {t('hover.name')} <code>{hoverName}</code>
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
              {t('hover.face')} <code>{hoverFaceName}</code>
            </>
          ) : (
            <>
              {t('hover.selected')} <code>{selectedFace!.name}</code> {planar ? t('hover.canSketch') : t('hover.notPlanar')}
            </>
          )}
        </div>
      )}
      {sketching && view && <div className="pick-hint">{view.hint}</div>}
      <MeasurePanel />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onItems={(items) => setMenu({ ...menu, items })} onClose={() => setMenu(null)} />}
    </main>
  );
}

/** The right-click menu of the graphics area (D5.5, D5.6): closes on any click elsewhere or Esc. */
function ContextMenu({ x, y, items, onItems, onClose }: { x: number; y: number; items: MenuItem[]; onItems: (items: MenuItem[]) => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onClose);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', onClose);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div className="ctx-menu" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            const more = item.run();
            if (more) onItems(more);
            else onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
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

/** The faces of the view cube (D4.3): the view each shows, and where it is on the cube. */
const CUBE_FACES: { view: StandardView; label: string; transform: string }[] = [
  { view: 'front', label: 'cube.front', transform: 'translateZ(22px)' },
  { view: 'back', label: 'cube.back', transform: 'rotateY(180deg) translateZ(22px)' },
  { view: 'right', label: 'cube.right', transform: 'rotateY(90deg) translateZ(22px)' },
  { view: 'left', label: 'cube.left', transform: 'rotateY(-90deg) translateZ(22px)' },
  { view: 'top', label: 'cube.top', transform: 'rotateX(90deg) translateZ(22px)' },
  { view: 'bottom', label: 'cube.bottom', transform: 'rotateX(-90deg) translateZ(22px)' },
];

/** 視角選擇方塊 (D4.3): a cube that turns with the model; a click on a face looks at the model from that side. */
function ViewCube() {
  const [matrix, setMatrix] = useState<number[] | null>(null);
  useEffect(() => {
    let stop = () => {};
    // the viewer is made after the first render: look for it until it is there
    const wait = setInterval(() => {
      const v = store.viewer;
      if (!v) return;
      clearInterval(wait);
      setMatrix(v.cubeMatrix());
      stop = v.subscribeView(() => setMatrix(v.cubeMatrix()));
    }, 100);
    return () => {
      clearInterval(wait);
      stop();
    };
  }, []);
  if (!matrix) return null;
  return (
    <div className="view-cube" aria-label={t('cube.title')}>
      <div className="cube" style={{ transform: `matrix3d(${matrix.join(',')})` }}>
        {CUBE_FACES.map((f) => (
          <button key={f.view} className="cube-face" style={{ transform: f.transform }} title={t('cube.look', { face: t(f.label as 'cube.front') })} onClick={() => store.viewer?.setView(f.view)}>
            {t(f.label as 'cube.front')}
          </button>
        ))}
      </div>
    </div>
  );
}

const DISPLAY_MODES: DisplayMode[] = ['shadedEdges', 'shaded', 'hiddenRemoved', 'hiddenVisible', 'wireframe'];

/** 顯示類型 (A4.3) and 剖面視圖 (D4.4): how the model is drawn, and a cut through it. */
function ViewOptions() {
  const filter = useStore((s) => s.pickFilter);
  const [mode, setMode] = useState<DisplayMode>('shadedEdges');
  const [cut, setCut] = useState<{ axis: 0 | 1 | 2; at: number; flip: boolean } | null>(null);
  const result = useStore((s) => s.result);
  useEffect(() => store.viewer?.setDisplayMode(mode), [mode, result]);
  const bounds = store.viewer?.contentBounds() ?? null;
  const range = bounds && cut ? ([bounds.min[cut.axis], bounds.max[cut.axis]] as const) : null;
  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    if (!cut || !range) return v.setSection(null);
    const normal: [number, number, number] = [0, 0, 0];
    normal[cut.axis] = cut.flip ? -1 : 1;
    const plane: SectionPlane = { normal, offset: cut.flip ? -cut.at : cut.at };
    v.setSection(plane);
  }, [cut, result]);
  const span = range ? Math.max(range[1] - range[0], 1e-6) : 1;
  return (
    <div className="view-options">
      <select value={mode} aria-label={t('view.mode')} title={t('view.mode')} onChange={(e) => setMode(e.target.value as DisplayMode)}>
        {DISPLAY_MODES.map((m) => (
          <option key={m} value={m}>
            {t(`view.mode.${m}`)}
          </option>
        ))}
      </select>
      <span className="pick-filter" title={t('select.filterTitle')}>
        {t('select.filter')}
        {(['faces', 'edges', 'vertices'] as const).map((k) => (
          <label key={k}>
            <input type="checkbox" checked={filter[k]} onChange={(e) => store.setPickFilter(k, e.target.checked)} />
            {t(k === 'faces' ? 'select.filterFaces' : k === 'edges' ? 'select.filterEdges' : 'select.filterVertices')}
          </label>
        ))}
      </span>
      <button className={cut ? 'active' : ''} onClick={() => setCut(cut ? null : { axis: 0, at: ((bounds?.min[0] ?? 0) + (bounds?.max[0] ?? 0)) / 2, flip: false })}>
        {t('view.section')}
      </button>
      {cut && range && (
        <div className="section-panel">
          <select
            value={cut.axis}
            aria-label={t('view.sectionAxis')}
            onChange={(e) => {
              const axis = Number(e.target.value) as 0 | 1 | 2;
              const b = store.viewer!.contentBounds()!;
              setCut({ ...cut, axis, at: (b.min[axis] + b.max[axis]) / 2 });
            }}
          >
            <option value={0}>{t('view.sectionX')}</option>
            <option value={1}>{t('view.sectionY')}</option>
            <option value={2}>{t('view.sectionZ')}</option>
          </select>
          <input type="range" aria-label={t('view.sectionAt')} min={range[0]} max={range[1]} step={span / 200} value={cut.at} onChange={(e) => setCut({ ...cut, at: Number(e.target.value) })} />
          <span className="muted">{cut.at.toFixed(2)}</span>
          <label>
            <input type="checkbox" checked={cut.flip} onChange={(e) => setCut({ ...cut, flip: e.target.checked })} /> {t('view.sectionFlip')}
          </label>
        </div>
      )}
    </div>
  );
}
