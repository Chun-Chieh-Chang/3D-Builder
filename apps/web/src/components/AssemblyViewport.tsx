import { t } from '@3db/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DATUM_PLANES, IDENTITY_ROTATION, isDatumPlaneName, poseMatrix, transformPoint, type MateRef, type PlaneFrame, type Pose, type Vec3 } from '@3db/model';
import { partNameOf } from '@3db/io';
import { Viewer, type DatumDisplay, type InstanceElement, type PlaneDisplay, type ViewInstance, type ViewPart } from '@3db/render';
import { ACTIONS, shortcutOf } from '../actions';
import { store, useStore } from '../state/store';
import type { AssemblyStore } from '../state/assembly';
import { componentInfo } from './AssemblyTree';
import { dragHint } from '../state/movability';
import { LoadProgress } from './LoadProgress';
import { MateFlyout } from './MatePanel';
import { InterferencePanel } from './InterferencePanel';
import { shownPairs } from '../state/interferenceView';
import { ClearancePanel } from './ClearancePanel';
import { MeasurePanel } from './MeasurePanel';
import { ViewCube, ViewOptions } from './Viewport';
import { ComponentMenu } from './AssemblyTree';
import { GraphicsMenu } from './GraphicsMenu';
import { assemblyMenu, triadMenu, type MenuEntry } from '../contextMenus';
import type { TriadHandle } from '@3db/assembly';


/** A frame of a part, placed by the component's pose. */
function placedFrame(frame: PlaneFrame, pose: Pose): PlaneFrame {
  const o = transformPoint(pose, frame.origin);
  const d = (v: Vec3): Vec3 => {
    const e = transformPoint(pose, [frame.origin[0] + v[0], frame.origin[1] + v[1], frame.origin[2] + v[2]]);
    return [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
  };
  return { origin: o, xDir: d(frame.xDir), yDir: d(frame.yDir), normal: d(frame.normal) };
}

/** The instance a mate element is on: the component's id, and for a part inside a sub-assembly the ids on the way (a leaf's id, see `leavesOf`). */
const leafKey = (ref: MateRef): string => [ref.component, ...(ref.path ?? [])].join('/');

/** Where a mate's element (or a datum picked in the FeatureManager) is drawn: a face, edge or vertex of a component, a plane, or an origin. */
function shownElement(ref: MateRef): { element?: InstanceElement; plane?: PlaneDisplay; point?: DatumDisplay['points'][number] } {
  const a = store.assembly;
  if (ref.ref.kind === 'datum' && ref.ref.name === 'origin') {
    // the assembly's origin, or the part's (where its component, or the part inside a sub-assembly, is placed)
    const pose = ref.component ? (a?.elementPart(ref)?.pose ?? (ref.path?.length ? null : a?.poseOf(ref.component))) : null;
    if (ref.component && !pose) return {};
    return { point: { key: `${ref.component ? leafKey(ref) : 'asm'}:origin`, p: pose ? pose.position : [0, 0, 0], highlighted: true } };
  }
  if (ref.ref.kind === 'datum') {
    if (!isDatumPlaneName(ref.ref.name) && ref.component === null) return {};
    const part = a?.elementPart(ref);
    // a sub-assembly's own planes (no path) are where the sub-assembly is; a part's reference planes are in the part
    const pose = ref.component ? (part?.pose ?? (ref.path?.length ? null : a?.poseOf(ref.component))) : null;
    const local = isDatumPlaneName(ref.ref.name) ? DATUM_PLANES[ref.ref.name] : part?.build.planes.find((p) => p.id === ref.ref.name)?.frame;
    if (!local || (ref.component && !pose)) return {};
    return { plane: { key: `${ref.component ? leafKey(ref) : 'asm'}:${ref.ref.name}`, frame: pose ? placedFrame(local, pose) : local, highlighted: true } };
  }
  const build = a?.elementPart(ref)?.build;
  if (!build || !ref.component) return {};
  const names = ref.ref.kind === 'face' ? build.faceNames : ref.ref.kind === 'edge' ? build.edgeNames : build.vertexNames;
  const index = names.indexOf(ref.ref.name);
  return index < 0 ? {} : { element: { key: leafKey(ref), kind: ref.ref.kind as InstanceElement['kind'], index } };
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
  const measure = useStore((s) => s.measure);
  const interference = useStore((s) => s.interference);
  const clearance = useStore((s) => s.clearance);
  const measuring = measure !== null;
  const pickFilter = useStore((s) => s.pickFilter);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverElement, setHoverElement] = useState<InstanceElement | null>(null);
  /** The component's context menu (right click on it in the graphics area); with no component under the pointer, the assembly's own (ADR 0176). */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [spaceMenu, setSpaceMenu] = useState<{ x: number; y: number; items: MenuEntry[]; what?: string } | null>(null);
  const closeSpaceMenu = useCallback(() => setSpaceMenu(null), []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  useEffect(() => {
    /** The element as a mate refers to it: the component (with the path inside it, for a part of a sub-assembly), and the persistent name in its part. */
    const refOf = (el: InstanceElement): MateRef | null => {
      const leaf = store.assembly?.leaves().find((l) => l.id === el.key);
      const build = leaf && store.assembly?.buildOfLeaf(leaf);
      if (!leaf || !build) return null;
      if (leaf.instanceOf) {
        store.notify(t('pattern.derivedNoMate'), 'error'); // an instance has no elements of its own: picking one would bind to the seed's (C15.13)
        return null;
      }
      const [names, prints] = el.kind === 'face' ? [build.faceNames, build.faceFingerprints] : el.kind === 'edge' ? [build.edgeNames, build.edgeFingerprints] : [build.vertexNames, build.vertexFingerprints];
      const name = names[el.index];
      const fingerprint = prints[el.index];
      return name && fingerprint ? { component: leaf.top, ...(leaf.path.length ? { path: leaf.path } : {}), ref: { kind: el.kind, name, fingerprint } } : null;
    };
    const viewer = new Viewer(host.current!, {
      onComponentHover: setHover,
      onComponentClick: (key, additive) => store.assembly?.selectComponentFromView(key, additive),
      onBoxSelect: (box, additive) => store.assembly?.selectComponents(box.components,additive),
      onComponentContextMenu: (key, x, y) => {
        setSpaceMenu(null);
        if (!key) {
          setMenu(null);
          const rect = host.current?.getBoundingClientRect();
          if (rect) setSpaceMenu({ x: x - rect.left, y: y - rect.top, items: assemblyMenu(store.getState(), null) });
          return;
        }
        // the menu is the answer to a right click: the pick is the tree's kind, so the PropertyManager is not brought forward for it
        if(!store.getState().asm?.selectedComponents.includes(key)) store.assembly?.select(key);
        setMenu({ x, y, id: key });
      },
      onElementHover: setHoverElement,
      onElementClick: (el) => {
        // measuring takes any element of any instance, a derived one (pattern, mirror) too: what is measured is what is seen
        if (store.getState().measure) return void (el && store.measurePick(el.kind, el.index, el.key));
        const ref = el && refOf(el);
        if (ref) store.assembly?.pickElement(ref);
      },
      onComponentDragStart: (key, point, button) => store.assembly?.startDrag(key, point, button) ?? false,
      onComponentDrag: (e) => store.assembly?.dragTo(e),
      onComponentDragEnd: (cancelled) => store.assembly?.endDrag(cancelled),
      onSmartMateStart: el => {const ref=refOf(el);return !!ref && (store.assembly?.startSmartMate(ref)??false);},
      onSmartMateHover: el => store.assembly?.hoverSmartMate(el?refOf(el):null),
      onSmartMateFlip: ()=>store.assembly?.flipMateAlignment(),
      onSmartMateEnd: cancelled=>void store.assembly?.finishSmartMate(cancelled),
      // the only markers of an assembly are the interferences', keyed by their place in the list and the piece ("2:0")
      onMarkerClick: (key) => store.selectInterference(Number(key.split(':')[0])),
      // 以座標軸移動 (ADR 0179): a handle held, the ray of the pointer as it moves; a right click on a handle is its menu
      onTriadDragStart: (part, ray) => {
        const a = store.assembly;
        const id = a?.triadComponent();
        if (!a || !id || part.kind === 'center') return false;
        const handle: TriadHandle = part.kind === 'plane' ? { kind: 'plane', normal: part.axis } : { kind: part.kind, axis: part.axis };
        return a.startTriadDrag(id, handle, ray);
      },
      onTriadDrag: (ray) => store.assembly?.triadDragTo(ray),
      onTriadDragEnd: (cancelled) => store.assembly?.endDrag(cancelled),
      onTriadContextMenu: (part, x, y) => {
        setMenu(null);
        const rect = host.current?.getBoundingClientRect();
        if (rect) setSpaceMenu({ x: x - rect.left, y: y - rect.top, items: triadMenu(part), what: 'triad' });
      },
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
    // every part to draw: a component that is a part, and the parts inside a sub-assembly, which belong to the component they are in (C15.4)
    // hidden ones are solved but not drawn, so they cannot be picked either (C15.5)
    const instances: ViewInstance[] = (store.assembly?.leaves() ?? []).flatMap((l) => (parts.has(l.key) && !l.hidden ? [{ key: l.id, part: l.key, matrix: poseMatrix(l.pose), owner: l.top, transparent: l.transparent }] : []));
    v.setInstances(instances);
    // Fit once per open (or first insert), when every part that can be shown is shown.
    const loading = [...asm.files.values()].some((s) => s.status === 'loading');
    const f = fitted.current;
    if (instances.length > 0 && !loading && (f.store !== store.assembly || f.request !== asm.fitRequest)) {
      v.fitAll();
      fitted.current = { store: store.assembly, request: asm.fitRequest };
    }
    v.setGuides(store.assembly?.explodeGuides() ?? []);
  }, [asm.doc, asm.files, asm.folder, asm.fitRequest, asm.solution, asm.drag, asm.pattern, asm.explodeT, asm.explodeLines, parts]);

  // What is shown as chosen: the mate being defined, else the mate or component selected in the tree, or the datums picked there.
  const selectedMate = asm.selected ? asm.doc.mates.find((m) => m.id === asm.selected) : undefined;
  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    const refs = asm.mate ? [asm.mate.a, asm.mate.b] : selectedMate ? [selectedMate.a, selectedMate.b] : asm.picks;
    v.setBoxSelectionEnabled(!asm.insert && !asm.mate && !asm.move && !asm.pattern && !asm.explode && !asm.formSub && !measure);
    const shown = refs.flatMap((r) => (r ? [shownElement(r)] : []));
    // while measuring, what is picked is what is shown as chosen
    v.setSelectedElements(measure ? measure.picks.flatMap((p) => (p.leaf && !p.point ? [{ key: p.leaf, kind: p.kind, index: p.index }] : [])) : shown.flatMap((s) => (s.element ? [s.element] : [])));
    v.setPlanes(shown.flatMap((s) => (s.plane ? [s.plane] : [])));
    v.setDatums({ axes: [], points: measure ? [] : shown.flatMap((s) => (s.point ? [s.point] : [])), systems: [] });
    const pair = interference && interference.selected !== null ? interference.pairs[interference.selected] : undefined;
    const close = clearance && clearance.selected !== null ? clearance.pairs[clearance.selected] : undefined;
    v.setSelectedComponents(pair ? [pair.aTop, pair.bTop] : close ? [close.aTop, close.bTop] : !asm.mate ? asm.selectedComponents : []);
  }, [asm.mate, asm.selected, asm.selectedComponents, asm.picks, asm.doc, asm.solution, asm.drag, asm.builds, asm.insert, asm.move, asm.pattern, asm.explode, asm.formSub, measure, interference, clearance]);

  // What a dragged component has run into (A3.6): those components are red
  useEffect(() => {
    store.viewer?.setCollidedComponents(asm.drag?.blocked?.tops ?? []);
  }, [asm.drag]);

  // 以座標軸移動 (ADR 0179): the triad on the component asked for (or the selected one while 移動零組件 is open), at its middle as it is now, also mid-drag
  useEffect(() => {
    const v = store.viewer;
    const a = store.assembly;
    if (!v || !a) return;
    const id = a.triadComponent();
    const origin = id ? a.triadOrigin(id) : null;
    v.setTriad(id && origin ? { key: id, origin } : null);
  }, [asm.triad, asm.move, asm.selected, asm.solution, asm.drag, asm.builds, asm.doc, asm.mate, asm.insert, asm.pattern, asm.explode, asm.exploded]);

  // Where components share volume (E2.1, ADR 0180): the overlaps in red with a ring round each pair's, or only the chosen pair's; while one is chosen its two
  // components turn see-through and the others look as the window says. Pairs set aside are left out unless listed.
  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    const done = interference?.status === 'done' ? interference : null;
    const listed = done ? shownPairs(done.pairs, done.ignored, done.showIgnored) : [];
    const shown = !done ? [] : done.selected === null ? listed : [done.selected];
    v.setHighlights(shown.flatMap((i) => done!.pairs[i]!.overlaps.map((mesh) => ({ mesh }))));
    // a ring on each piece of the overlap, at a point of the piece itself: the centre of mass of a ring or of pieces round an axis is in empty space
    v.setMarkers(
      shown.flatMap((i) => {
        const p = done!.pairs[i]!;
        const title = t('interference.markerTip', { n: i + 1, a: p.aName, b: p.bName });
        return (p.regions.length > 0 ? p.regions.map((r) => r.anchor) : [p.center]).map((at, k) => ({ key: `${i}:${k}`, at, label: String(i + 1), lit: done!.selected === i, title }));
      }),
    );
    const pair = done && done.selected !== null ? done.pairs[done.selected] : undefined;
    v.setComponentFocus(pair ? { keys: [pair.aTop, pair.bTop], others: done!.others } : null);
  }, [interference]);

  // Choosing a pair (or 「縮放至干涉」) takes the view to its overlap
  const focus = interference?.focus ?? 0;
  useEffect(() => {
    const s = store.getState().interference;
    const pair = s && s.selected !== null ? s.pairs[s.selected] : undefined;
    if (pair) store.viewer?.fitBox(pair.min, pair.max);
  }, [focus]);

  // Placing a component: the chosen part follows the cursor, a click puts it down.
  const chosen = asm.insert?.chosen ?? null;
  const chosenStatus = chosen ? asm.files.get(chosen) : undefined;
  const ghost = chosenStatus?.status === 'ok' && parts.has(chosenStatus.key) ? chosenStatus.key : null;
  // a sub-assembly has no single mesh to follow the cursor (C15.4): a click places it, and ✓ puts it at the origin
  const subChosen = chosenStatus?.status === 'ok' && !!chosenStatus.assembly && ![...asm.files.values()].some((s) => s.status === 'loading'); // its own files too
  useEffect(() => {
    const v = store.viewer;
    if (!v || !subChosen) return;
    v.setToolHandler((e) => {
      if (e.type === 'up') store.assembly?.place(v.pointOnViewPlane(e.clientX, e.clientY));
    });
    return () => v.setToolHandler(null);
  }, [subChosen]);
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
  const pickingAxis = !!asm.pattern?.picking || !!asm.explode?.picking; // a pattern's direction or axis is picked from the elements in the view (C15.13)
  const patterning = !!asm.pattern || !!asm.explode;
  const placing = !!asm.insert;
  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    v.setComponentPicking(!mating && !pickingAxis && !measuring && !ghost && !subChosen);
    v.setComponentDragging(!mating && !placing && !patterning && !measuring);
    v.setElementPicking(mating || pickingAxis || measuring);
  }, [mating, pickingAxis, patterning, measuring, ghost, placing, subChosen]);

  // The selection filter (ADR 0145, 0148) narrows the elements picked for a mate, a pattern direction or a measurement; whole components are not elements and stay pickable.
  useEffect(() => {
    store.viewer?.setPickFilter(pickFilter);
  }, [pickFilter, mating, pickingAxis, measuring]);

  const hovered = hover ? asm.doc.components.find((c) => c.id === hover) : undefined;
  const elementName = (() => {
    if (!(mating || pickingAxis || measuring) || !hoverElement) return null;
    const leaf = store.assembly?.leaves().find((l) => l.id === hoverElement.key);
    const build = leaf && store.assembly?.buildOfLeaf(leaf);
    const names = hoverElement.kind === 'face' ? build?.faceNames : hoverElement.kind === 'edge' ? build?.edgeNames : build?.vertexNames;
    return build && leaf ? t('asmui.elementHover', { kind: t(`measure.kind.${hoverElement.kind}`), name: names?.[hoverElement.index] ?? '?', owner: store.assembly?.ownerLabel(leaf.top, leaf.path) ?? '' }) : null;
  })();
  const dragged = asm.drag ? asm.doc.components.find((c) => c.id === asm.drag!.component) : undefined;
  const hint = measuring
    ? (elementName ?? t('measure.prompt'))
    : dragged
    ? t('asmui.dragging', { verb: t(asm.drag!.mode === 'move' ? 'movepm.move' : 'movepm.rotate'), name: componentInfo(asm, dragged).name })
    : asm.insert
    ? ghost || subChosen
      ? t('asmui.place', { name: partNameOf(chosen!) })
      : chosen
        ? t('asmui.loadingPart')
        : t('asmui.choosePart')
    : pickingAxis
    ? (elementName ?? t('pattern.picking'))
    : mating
      ? (elementName ?? t(asm.smartMate?'smartMate.hint':'asmui.mateHint'))
      : hovered
        ? t('asmui.componentHover', { name: componentInfo(asm, hovered).name, hint: dragHint(hovered, asm.solution, asm.move?.tool) })
        : asm.triad
          ? t('triad.hint')
          : asm.move
          ? t('asmui.moveHint', { verb: t(asm.move.tool === 'move' ? 'move.verbMove' : 'move.verbRotate') })
          : null;

  return (
    <main className="viewport">
      <div ref={host} className="viewport-canvas" />
      <ViewCube />
      <ViewOptions assembly />
      {spaceMenu && <GraphicsMenu x={spaceMenu.x} y={spaceMenu.y} items={spaceMenu.items} what={spaceMenu.what ?? 'assembly-empty'} onClose={closeSpaceMenu} />}
      {menu && asm.doc.components.some((c) => c.id === menu.id) && <ComponentMenu x={menu.x} y={menu.y} component={asm.doc.components.find((c) => c.id === menu.id)!} onClose={() => setMenu(null)} />}
      <div className="heads-up">
        {ACTIONS.filter((a) => a.group === 'view').map((a) => (
          <button key={a.id} onClick={a.run} disabled={!a.enabled(store.getState())} title={shortcutOf(a) ? `${a.label} (${shortcutOf(a)})` : a.label}>
            {a.label}
          </button>
        ))}
      </div>
      {mating && <MateFlyout />}
      {!bootMs && <div className="boot-overlay">{bootError ? t('boot.failed', { why: bootError }) : t('boot.loading')}</div>}
      <LoadProgress />
      <MeasurePanel />
      <InterferencePanel />
      <ClearancePanel />
      {hint && <div className="pick-hint">{hint}</div>}
    </main>
  );
}
