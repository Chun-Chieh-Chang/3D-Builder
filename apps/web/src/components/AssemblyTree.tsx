import { useEffect, useState } from 'react';
import { joinPath, type Component, type Id } from '@3db/model';
import { componentName } from '@3db/io';
import { store, useDocumentName, useStore } from '../state/store';
import type { AssemblyState } from '../state/assembly';
import { DATUM_ITEMS } from '../strings';
import { Icon } from './Icon';

interface Menu {
  x: number;
  y: number;
  component: Component;
}

/** What the FeatureManager says about a component: its name, and what is wrong with its part file. */
export function componentInfo(asm: AssemblyState, c: Component) {
  const file = asm.doc.files.find((f) => f.id === c.file);
  const path = file ? joinPath(asm.folder, file.path) : undefined;
  const status = path ? asm.files.get(path) : undefined;
  const build = status?.status === 'ok' ? asm.builds.get(status.key) : undefined;
  return {
    name: componentName(file?.path, c.instance),
    path,
    loading: status?.status === 'loading',
    error: !file ? `找不到零組件的檔案：${c.file}` : status?.status === 'missing' || status?.status === 'error' ? status.message : undefined,
    warnings: build?.problems ?? [],
  };
}

/**
 * FeatureManager of an assembly (D1.1, C15.2): default planes and origin, then the components in
 * insertion order — 「(f)」 fixed, 「(-)」 floating and not fully positioned — then the mates folder,
 * which 2C fills.
 */
export function AssemblyTree() {
  const asm = useStore((s) => s.asm)!;
  const name = useDocumentName();
  const [menu, setMenu] = useState<Menu | null>(null);

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
          const tip = [info.path && `檔案：${info.path}`, info.loading && '載入中…', info.error, ...info.warnings].filter(Boolean).join('\n');
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
                {c.fixed ? '(f) ' : '(-) '}
                {info.name}
              </span>
              {info.error && <Icon name="error" className="status-error" />}
              {!info.error && info.warnings.length > 0 && <Icon name="warning" className="status-warning" />}
            </li>
          );
        })}
        <li className="tree-row folder" title="結合（2C）">
          <Icon name="mates" />
          <span className="name muted">結合</span>
        </li>
      </ol>

      {menu && a && (
        <ul className="context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {menu.component.fixed ? (
            <li onClick={act(() => a.setFixed([menu.component.id], false))}>浮動</li>
          ) : (
            <li onClick={act(() => a.setFixed([menu.component.id], true))}>固定</li>
          )}
          <li className="separator" />
          <li onClick={act(() => a.requestDelete([menu.component.id]))}>刪除…</li>
        </ul>
      )}
    </div>
  );
}
