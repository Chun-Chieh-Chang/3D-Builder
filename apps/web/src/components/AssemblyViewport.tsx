import { useEffect, useMemo, useRef, useState } from 'react';
import { DATUM_PLANES, IDENTITY_ROTATION, isDatumPlaneName, joinPath, poseMatrix, type Vec3 } from '@3db/model';
import { partNameOf } from '@3db/io';
import { Viewer, type ViewInstance, type ViewMesh } from '@3db/render';
import { ACTIONS } from '../actions';
import { store, useStore } from '../state/store';
import type { AssemblyStore } from '../state/assembly';
import { componentInfo } from './AssemblyTree';

/**
 * Graphics area of an assembly (A3.1, C15.1): each component is its part's mesh placed by its pose;
 * a click selects a component. While 「插入零組件」 has a part chosen, a see-through copy follows the
 * cursor on the plane through the origin facing the viewer, and a click places it there.
 */
export function AssemblyViewport() {
  const host = useRef<HTMLDivElement>(null);
  const fitted = useRef<{ store: AssemblyStore | null; request: number }>({ store: null, request: 0 });
  const asm = useStore((s) => s.asm)!;
  const bootMs = useStore((s) => s.bootMs);
  const bootError = useStore((s) => s.bootError);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const viewer = new Viewer(host.current!, {
      onComponentHover: setHover,
      onComponentClick: (key) => store.assembly?.select(key),
    });
    viewer.setComponentPicking(true);
    store.viewer = viewer;
    return () => {
      viewer.dispose();
      store.viewer = null;
    };
  }, []);

  const meshes = useMemo(() => {
    const m = new Map<string, ViewMesh>();
    for (const [key, build] of asm.builds) if (build.mesh) m.set(key, build.mesh);
    return m;
  }, [asm.builds]);

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    v.setParts(meshes);
    const instances: ViewInstance[] = asm.doc.components.flatMap((c) => {
      const file = asm.doc.files.find((f) => f.id === c.file);
      const status = file && asm.files.get(joinPath(asm.folder, file.path));
      return status?.status === 'ok' && meshes.has(status.key) ? [{ key: c.id, part: status.key, matrix: poseMatrix(c.placement) }] : [];
    });
    v.setInstances(instances);
    // Fit once per open (or first insert), when every part that can be shown is shown.
    const loading = [...asm.files.values()].some((s) => s.status === 'loading');
    const f = fitted.current;
    if (instances.length > 0 && !loading && (f.store !== store.assembly || f.request !== asm.fitRequest)) {
      v.fitAll();
      fitted.current = { store: store.assembly, request: asm.fitRequest };
    }
  }, [asm.doc, asm.files, asm.folder, asm.fitRequest, meshes]);

  useEffect(() => {
    const v = store.viewer;
    if (!v) return;
    v.setSelectedComponents(asm.selected && !isDatumPlaneName(asm.selected) ? [asm.selected] : []);
    v.setPlanes(asm.selected && isDatumPlaneName(asm.selected) ? [{ key: asm.selected, frame: DATUM_PLANES[asm.selected], highlighted: true }] : []);
  }, [asm.selected, asm.doc]);

  // Placing a component: the chosen part follows the cursor, a click puts it down.
  const chosen = asm.insert?.chosen ?? null;
  const chosenStatus = chosen ? asm.files.get(chosen) : undefined;
  const ghost = chosenStatus?.status === 'ok' && meshes.has(chosenStatus.key) ? chosenStatus.key : null;
  useEffect(() => {
    const v = store.viewer;
    if (!v || !ghost) return;
    v.setGhost(ghost);
    v.setComponentPicking(false);
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
      v.setComponentPicking(true);
    };
  }, [ghost]);

  const hovered = hover ? asm.doc.components.find((c) => c.id === hover) : undefined;
  const hint = asm.insert
    ? ghost
      ? `在圖面中按一下以放置「${partNameOf(chosen!)}」（Esc 取消）`
      : chosen
        ? '正在載入零件…'
        : '在左側選擇要插入的零件'
    : hovered
      ? `零組件：${componentInfo(asm, hovered).name}`
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
      {!bootMs && <div className="boot-overlay">{bootError ? `幾何核心載入失敗：${bootError}` : '正在載入幾何核心（OCCT WASM，約 43 MB）…'}</div>}
      {hint && <div className="pick-hint">{hint}</div>}
    </main>
  );
}
