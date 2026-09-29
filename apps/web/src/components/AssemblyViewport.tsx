import { useEffect, useMemo, useRef, useState } from 'react';
import { DATUM_PLANES, IDENTITY_ROTATION, isDatumPlaneName, joinPath, poseMatrix, transformPoint, type MateRef, type PlaneFrame, type Pose, type Vec3 } from '@3db/model';
import { partNameOf } from '@3db/io';
import { Viewer, type InstanceElement, type PlaneDisplay, type ViewInstance, type ViewPart } from '@3db/render';
import { ACTIONS } from '../actions';
import { store, useStore } from '../state/store';
import type { AssemblyStore } from '../state/assembly';
import { componentInfo } from './AssemblyTree';
import { MateFlyout } from './MatePanel';

const KIND_WORD = { face: '面', edge: '邊線', vertex: '頂點' } as const;

/** A frame of a part, placed by the component's pose. */
function placedFrame(frame: PlaneFrame, pose: Pose): PlaneFrame {
  const o = transformPoint(pose, frame.origin);
  const d = (v: Vec3): Vec3 => {
    const e = transformPoint(pose, [frame.origin[0] + v[0], frame.origin[1] + v[1], frame.origin[2] + v[2]]);
    return [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
  };
  return { origin: o, xDir: d(frame.xDir), yDir: d(frame.yDir), normal: d(frame.normal) };
}

/** Where a mate's element is drawn: a face, edge or vertex of a component, or a plane. */
function shownElement(ref: MateRef): { element?: InstanceElement; plane?: PlaneDisplay } {
  const a = store.assembly;
  if (ref.ref.kind === 'datum') {
    if (!isDatumPlaneName(ref.ref.name) && ref.component === null) return {};
    const local = isDatumPlaneName(ref.ref.name) ? DATUM_PLANES[ref.ref.name] : ref.component ? a?.buildOf(ref.component)?.planes.find((p) => p.id === ref.ref.name)?.frame : undefined;
    const pose = ref.component ? a?.poseOf(ref.component) : null;
    if (!local || (ref.component && !pose)) return {};
    return { plane: { key: `${ref.component ?? 'asm'}:${ref.ref.name}`, frame: pose ? placedFrame(local, pose) : local, highlighted: true } };
  }
  const build = ref.component ? a?.buildOf(ref.component) : null;
  if (!build || !ref.component) return {};
  const names = ref.ref.kind === 'face' ? build.faceNames : ref.ref.kind === 'edge' ? build.edgeNames : build.vertexNames;
  const index = names.indexOf(ref.ref.name);
  return index < 0 ? {} : { element: { key: ref.component, kind: ref.ref.kind as InstanceElement['kind'], index } };
}

/**
 * Graphics area of an assembly (A3.1, C15.1, C15.3, C15.8): each component is its part's mesh placed
 * where the mates put it (its placement until they are solved); a click selects a component, and a
 * drag moves it (left button) or turns it (right button) along the freedoms its mates leave. While
 * 「插入零組件」 has a part chosen, a see-through copy follows the cursor and a click places it. While
 * a mate is being defined, faces, edges and vertices of the components are picked, and planes in the
 * flyout tree.
 */
export function AssemblyViewport() {
  const host = useRef<HTMLDivElement>(null);
  const fitted = useRef<{ store: AssemblyStore | null; request: number }>({ store: null, request: 0 });
  const asm = useStore((s) => s.asm)!;
  const bootMs = useStore((s) => s.bootMs);
  const bootError = useStore((s) => s.bootError);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverElement, setHoverElement] = useState<InstanceElement | null>(null);

  useEffect(() => {
    /** The element as a mate refers to it: the component, and the persistent name in its part. */
    const refOf = (el: InstanceElement): MateRef | null => {
      const build = store.assembly?.buildOf(el.key);
      if (!build) return null;
      const [names, prints] = el.kind === 'face' ? [build.faceNames, build.faceFingerprints] : el.kind === 'edge' ? [build.edgeNames, build.edgeFingerprints] : [build.vertexNames, build.vertexFingerprints];
      const name = names[el.index];
      const fingerprint = prints[el.index];
      return name && fingerprint ? { component: el.key, ref: { kind: el.kind, name, fingerprint } } : null;
    };
    const viewer = new Viewer(host.current!, {
      onComponentHover: setHover,
      onComponentClick: (key) => store.assembly?.select(key),
      onElementHover: setHoverElement,
      onElementClick: (el) => {
        const ref = el && refOf(el);
        if (ref) store.assembly?.pickElement(ref);
      },
      onComponentDragStart: (key, point, button) => store.assembly?.startDrag(key, point, button) ?? false,
      onComponentDrag: (e) => store.assembly?.dragTo(e),
      onComponentDragEnd: (cancelled) => store.assembly?.endDrag(cancelled),
    });
    viewer.setComponentPicking(true);
    store.viewer = viewer;
    return () => {
      viewer.dispose();
      store.viewer = null;
    };
  }, []);

  const parts = useMemo(() => {
    const m = new Map<string, ViewPart>();
    for (const [key, build] of asm.builds) if (build.mesh) m.set(key, { mesh: build.mesh, vertices: build.vertexPoints });
    return m;
  }, [asm.builds]);

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    v.setParts(parts);
    const instances: ViewInstance[] = asm.doc.components.flatMap((c) => {
      const file = asm.doc.files.find((f) => f.id === c.file);
      const status = file && asm.files.get(joinPath(asm.folder, file.path));
      const pose = asm.drag?.poses?.get(c.id) ?? asm.solution?.poses.get(c.id) ?? c.placement;
      return status?.status === 'ok' && parts.has(status.key) ? [{ key: c.id, part: status.key, matrix: poseMatrix(pose) }] : [];
    });
    v.setInstances(instances);
    // Fit once per open (or first insert), when every part that can be shown is shown.
    const loading = [...asm.files.values()].some((s) => s.status === 'loading');
    const f = fitted.current;
    if (instances.length > 0 && !loading && (f.store !== store.assembly || f.request !== asm.fitRequest)) {
      v.fitAll();
      fitted.current = { store: store.assembly, request: asm.fitRequest };
    }
  }, [asm.doc, asm.files, asm.folder, asm.fitRequest, asm.solution, asm.drag, parts]);

  // What is shown as chosen: the mate being defined, else the mate or component selected in the tree.
  const selectedMate = asm.selected ? asm.doc.mates.find((m) => m.id === asm.selected) : undefined;
  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    const refs = asm.mate ? [asm.mate.a, asm.mate.b] : selectedMate ? [selectedMate.a, selectedMate.b] : [];
    const shown = refs.flatMap((r) => (r ? [shownElement(r)] : []));
    v.setSelectedElements(shown.flatMap((s) => (s.element ? [s.element] : [])));
    const planes = shown.flatMap((s) => (s.plane ? [s.plane] : []));
    if (!asm.mate && asm.selected && isDatumPlaneName(asm.selected)) planes.push({ key: asm.selected, frame: DATUM_PLANES[asm.selected], highlighted: true });
    v.setPlanes(planes);
    v.setSelectedComponents(!asm.mate && asm.selected && asm.doc.components.some((c) => c.id === asm.selected) ? [asm.selected] : []);
  }, [asm.mate, asm.selected, asm.doc, asm.solution, asm.drag, asm.builds]);

  // Placing a component: the chosen part follows the cursor, a click puts it down.
  const chosen = asm.insert?.chosen ?? null;
  const chosenStatus = chosen ? asm.files.get(chosen) : undefined;
  const ghost = chosenStatus?.status === 'ok' && parts.has(chosenStatus.key) ? chosenStatus.key : null;
  useEffect(() => {
    const v = store.viewer;
    if (!v || !ghost) return;
    v.setGhost(ghost);
    const at = (p: Vec3) => poseMatrix({ position: p, rotation: IDENTITY_ROTATION });
    v.setToolHandler((e) => {
      if (e.type === 'leave') return v.moveGhost(null);
      const p = v.pointOnViewPlane(e.clientX, e.clientY);
      if (e.type === 'move') v.moveGhost(at(p));
      else if (e.type === 'up') store.assembly?.place(p);
    });
    return () => {
      v.setToolHandler(null);
      v.setGhost(null);
    };
  }, [ghost]);

  // Whole components are picked (and dragged) normally; elements while a mate is being defined.
  const mating = !!asm.mate;
  const placing = !!asm.insert;
  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    v.setComponentPicking(!mating && !ghost);
    v.setComponentDragging(!mating && !placing);
    v.setElementPicking(mating);
  }, [mating, ghost, placing]);

  const hovered = hover ? asm.doc.components.find((c) => c.id === hover) : undefined;
  const elementName = (() => {
    if (!mating || !hoverElement) return null;
    const build = store.assembly?.buildOf(hoverElement.key);
    const c = asm.doc.components.find((x) => x.id === hoverElement.key);
    const names = hoverElement.kind === 'face' ? build?.faceNames : hoverElement.kind === 'edge' ? build?.edgeNames : build?.vertexNames;
    return build && c ? `${KIND_WORD[hoverElement.kind]}：${names?.[hoverElement.index] ?? '?'}（${componentInfo(asm, c).name}）` : null;
  })();
  const dragged = asm.drag ? asm.doc.components.find((c) => c.id === asm.drag!.component) : undefined;
  const hint = dragged
    ? `${asm.drag!.mode === 'move' ? '移動' : '旋轉'}「${componentInfo(asm, dragged).name}」：只沿結合留下的自由度（Esc 取消）`
    : asm.insert
    ? ghost
      ? `在圖面中按一下以放置「${partNameOf(chosen!)}」（Esc 取消）`
      : chosen
        ? '正在載入零件…'
        : '在左側選擇要插入的零件'
    : mating
      ? (elementName ?? '點選兩個要結合的元素：零組件的面、邊線、頂點，或左上樹中的基準面與原點')
      : hovered
        ? `零組件：${componentInfo(asm, hovered).name}${asm.move ? `（拖曳以${asm.move.tool === 'move' ? '移動' : '旋轉'}）` : ''}`
        : asm.move
          ? `在圖面中拖曳零組件以${asm.move.tool === 'move' ? '移動' : '旋轉'}（右鍵拖曳旋轉）`
          : null;

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
      {mating && <MateFlyout />}
      {!bootMs && <div className="boot-overlay">{bootError ? `幾何核心載入失敗：${bootError}` : '正在載入幾何核心（OCCT WASM，約 43 MB）…'}</div>}
      {hint && <div className="pick-hint">{hint}</div>}
    </main>
  );
}
