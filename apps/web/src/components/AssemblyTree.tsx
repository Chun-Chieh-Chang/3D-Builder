import { useEffect, useState } from 'react';
import { joinPath, type Component, type Id, type Mate } from '@3db/model';
import { componentName } from '@3db/io';
import { store, useDocumentName, useStore } from '../state/store';
import type { AssemblyState } from '../state/assembly';
import { DATUM_ITEMS, PART_STAGE_LABEL } from '../strings';
import { Icon } from './Icon';

type Menu = { x: number; y: number } & ({ component: Component } | { mate: Mate });

/** What the FeatureManager says about a component: its name, and what is wrong with its part file. */
export function componentInfo(asm: AssemblyState, c: Component) {
  const file = asm.doc.files.find((f) => f.id === c.file);
  const path = file ? joinPath(asm.folder, file.path) : undefined;
  const status = path ? asm.files.get(path) : undefined;
  const build = status?.status === 'ok' ? asm.builds.get(status.key) : undefined;
  return {
    name: componentName(file?.path, c.instance),
    path,
    /** What the wait is for, while the part file loads. */
    loading: status?.status === 'loading' ? PART_STAGE_LABEL[status.stage] : undefined,
    error: !file ? `找不到零組件的檔案：${c.file}` : status?.status === 'missing' || status?.status === 'error' ? status.message : undefined,
    warnings: build?.problems ?? [],
  };
}

/** SolidWorks' marks before a component's name (A3.4): 「(f)」 fixed, 「(-)」 under-defined, 「(+)」 over-defined, none when fully defined. */
export function componentPrefix(asm: AssemblyState, c: Component): string {
  const status = asm.solution?.components.get(c.id)?.status ?? (c.fixed ? 'fixed' : 'under');
  return { fixed: '(f) ', under: '(-) ', over: '(+) ', full: '' }[status];
}

/** A mate's trouble, as 「錯誤為何？」 tells it; undefined when it holds. */
export function mateProblem(asm: AssemblyState, m: Mate): string | undefined {
  const r = asm.solution?.mates.get(m.id);
  if (!r || r.status === 'ok' || r.status === 'suppressed') return undefined;
  if (r.status === 'conflict') return '與前面的結合矛盾：組合件過多定義';
  return r.message;
}

/**
 * FeatureManager of an assembly (D1.1, C15.2, C15.12): default planes and origin, the components in
 * insertion order with their state from the solved mates, then the mates folder: each mate by name
 * and the components it joins, marked when it fails; edit, suppress and delete from its context menu.
 */
export function AssemblyTree() {
  const asm = useStore((s) => s.asm)!;
  const name = useDocumentName();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [matesOpen, setMatesOpen] = useState(true);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const a = store.assembly;
  const act = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };
  const select = (id: Id) => a?.select(id);
  const nameOf = (id: Id | null) => {
    if (id === null) return name;
    const c = asm.doc.components.find((x) => x.id === id);
    return c ? componentInfo(asm, c).name : id;
  };
  const errors = asm.doc.mates.filter((m) => mateProblem(asm, m)).length;

  return (
    <div className="feature-tree">
      <div className="tree-part">
        <Icon name="assembly" />
        <span>{name}</span>
      </div>
      <ol className="tree-list">
        {DATUM_ITEMS.map((d) => (
          <li key={d.id} className={`tree-row datum ${asm.selected === d.id ? 'selected' : ''}`} onClick={() => d.icon === 'plane' && select(d.id)}>
            <Icon name={d.icon} />
            <span>{d.label}</span>
          </li>
        ))}
        {asm.doc.components.map((c) => {
          const info = componentInfo(asm, c);
          const result = asm.solution?.components.get(c.id);
          const freedom = result && result.status === 'under' ? `可移動的自由度：${result.dof}` : undefined;
          const tip = [info.path && `檔案：${info.path}`, freedom, info.loading && `載入中：${info.loading}`, info.error, ...info.warnings].filter(Boolean).join('\n');
          return (
            <li
              key={c.id}
              data-component-row={c.id}
              className={`tree-row ${asm.selected === c.id ? 'selected' : ''} ${info.error ? 'error' : ''} ${info.loading ? 'loading' : ''}`}
              title={tip}
              onClick={() => select(c.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                select(c.id);
                setMenu({ x: e.clientX, y: e.clientY, component: c });
              }}
            >
              <Icon name="part" />
              <span className="name">
                {componentPrefix(asm, c)}
                {info.name}
              </span>
              {info.error && <Icon name="error" className="status-error" />}
              {!info.error && info.warnings.length > 0 && <Icon name="warning" className="status-warning" />}
            </li>
          );
        })}
        <li className={`tree-row folder ${errors ? 'error' : ''}`} onClick={() => setMatesOpen((o) => !o)} title={errors ? `${errors} 個結合有錯誤` : undefined}>
          <Icon name="mates" />
          <span className="name">結合</span>
          {errors > 0 && <Icon name="error" className="status-error" />}
        </li>
        {matesOpen &&
          asm.doc.mates.map((m) => {
            const problem = mateProblem(asm, m);
            return (
              <li
                key={m.id}
                data-mate-row={m.id}
                className={`tree-row mate ${asm.selected === m.id ? 'selected' : ''} ${problem ? 'error' : ''} ${m.suppressed ? 'suppressed' : ''}`}
                title={problem ?? `${m.name}（${nameOf(m.a.component)}、${nameOf(m.b.component)}）`}
                onClick={() => select(m.id)}
                onDoubleClick={() => a?.editMate(m.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  select(m.id);
                  setMenu({ x: e.clientX, y: e.clientY, mate: m });
                }}
              >
                <Icon name="mates" />
                <span className="name">
                  {m.name}（{nameOf(m.a.component)}，{nameOf(m.b.component)}）
                </span>
                {problem && <Icon name="error" className="status-error" />}
              </li>
            );
          })}
      </ol>

      {menu && a && (
        <ul className="context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {'component' in menu ? (
            <>
              <li onClick={act(() => store.openComponentPart(menu.component.id))}>開啟零件</li>
              <li onClick={act(() => void a.browseRelink(menu.component.file))}>重新指定零件檔…</li>
              <li className="separator" />
              {menu.component.fixed ? <li onClick={act(() => a.setFixed([menu.component.id], false))}>浮動</li> : <li onClick={act(() => a.setFixed([menu.component.id], true))}>固定</li>}
              <li className="separator" />
              <li onClick={act(() => a.requestDelete([menu.component.id]))}>刪除…</li>
            </>
          ) : (
            <>
              <li onClick={act(() => a.editMate(menu.mate.id))}>編輯結合</li>
              {menu.mate.suppressed ? <li onClick={act(() => a.setMatesSuppressed([menu.mate.id], false))}>恢復抑制</li> : <li onClick={act(() => a.setMatesSuppressed([menu.mate.id], true))}>抑制</li>}
              <li onClick={act(() => a.requestDelete([menu.mate.id]))}>刪除…</li>
              {mateProblem(asm, menu.mate) && (
                <>
                  <li className="separator" />
                  <li onClick={act(() => store.showWhatsWrong(true))}>錯誤為何？</li>
                </>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
