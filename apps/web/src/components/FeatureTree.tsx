import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Feature, Id } from '@3db/model';
import { dependencies } from '@3db/regen/dag';
import type { FeatureResult } from '@3db/regen';
import { store, useStore } from '../state/store';
import { DATUM_ITEMS, featureLabel, SKETCH_STATUS_PREFIX } from '../strings';
import { Icon } from './Icon';

interface Menu {
  x: number;
  y: number;
  feature: Feature;
}

/** FeatureManager design tree (D1.1–D1.6): history order, status, rollback bar, context menu, parent/child. */
export function FeatureTree() {
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const selected = useStore((s) => s.selected);
  const editing = useStore((s) => s.editing);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [relations, setRelations] = useState<Feature | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const statusOf = (id: Id): FeatureResult | undefined => result?.features.find((f) => f.id === id);
  const rollback = doc.rollbackIndex ?? doc.features.length;
  const barIndex = dragIndex ?? rollback;

  // Rollback bar drag (B2.4 / D1.4): the bar snaps between feature rows.
  const onBarDown = (e: ReactPointerEvent) => {
    if (editing) return;
    e.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-feature-row]') ?? [])];
    const indexAt = (y: number) => rows.filter((r) => r.getBoundingClientRect().top + r.offsetHeight / 2 < y).length;
    const move = (ev: PointerEvent) => setDragIndex(indexAt(ev.clientY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragIndex(null);
      store.execute({ type: 'setRollback', index: indexAt(ev.clientY) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const bar = (
    <li key="rollback" className={dragIndex !== null ? 'rollback-bar dragging' : 'rollback-bar'} onPointerDown={onBarDown} title="回溯控制棒：拖曳以回到歷史中的某一點">
      <span />
    </li>
  );

  return (
    <div className="feature-tree">
      <div className="tree-part">
        <Icon name="part" />
        <span>{doc.properties['零件名稱'] || '零件1'}</span>
      </div>
      <ol ref={listRef} className="tree-list">
        {DATUM_ITEMS.map((d) => (
          <li
            key={d.id}
            className={`tree-row datum ${selected === d.id ? 'selected' : ''}`}
            title={d.icon === 'plane' ? '選取後按「草圖」即可在此基準面上繪製草圖' : undefined}
            onClick={() => d.icon === 'plane' && store.select(d.id)}
          >
            <Icon name={d.icon} />
            <span>{d.label}</span>
          </li>
        ))}
        {doc.features.flatMap((f, i) => {
          const r = statusOf(f.id);
          const rolledBack = i >= barIndex;
          const cls = [
            'tree-row',
            selected === f.id ? 'selected' : '',
            r?.status === 'error' ? 'error' : '',
            f.suppressed ? 'suppressed' : '',
            rolledBack ? 'rolled-back' : '',
            editing?.featureId === f.id ? 'editing' : '',
          ].join(' ');
          const prefix = f.type === 'sketch' && r?.sketch ? SKETCH_STATUS_PREFIX[r.sketch.status] : '';
          const tip = [r?.message, ...(r?.unresolved?.map((u) => `找不到：${u.ref.name}`) ?? [])].filter(Boolean).join('\n');
          const row = (
            <li
              key={f.id}
              data-feature-row
              className={cls}
              title={tip || `${featureLabel(f)}：${f.name}`}
              onClick={() => store.select(f.id)}
              onDoubleClick={() => !rolledBack && store.beginEdit(f.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                store.select(f.id);
                setMenu({ x: e.clientX, y: e.clientY, feature: f });
              }}
            >
              <Icon name={f.type} />
              <span className="name">
                {prefix}
                {f.name}
              </span>
              {r?.status === 'error' && <Icon name="error" className="status-error" />}
            </li>
          );
          return i === barIndex ? [bar, row] : [row];
        })}
        {barIndex >= doc.features.length && bar}
      </ol>

      {menu && (
        <ul className="context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <li onClick={() => (setMenu(null), store.beginEdit(menu.feature.id))}>{menu.feature.type === 'sketch' ? '編輯草圖' : '編輯特徵'}</li>
          <li onClick={() => (setMenu(null), store.execute({ type: 'setSuppressed', featureId: menu.feature.id, value: !menu.feature.suppressed }))}>
            {menu.feature.suppressed ? '恢復抑制' : '抑制'}
          </li>
          <li onClick={() => (setMenu(null), setRelations(menu.feature))}>父子關係…</li>
        </ul>
      )}

      {relations && <Relations feature={relations} onClose={() => setRelations(null)} />}
    </div>
  );
}

/** Parent/child dialog (B2.3, D1.3). Relations are derived from references, never stored. */
function Relations({ feature, onClose }: { feature: Feature; onClose: () => void }) {
  const doc = useStore((s) => s.doc);
  const deps = dependencies(doc);
  const name = (id: Id) => doc.features.find((f) => f.id === id)?.name ?? id;
  const parents = deps.parents.get(feature.id) ?? [];
  const children = deps.children.get(feature.id) ?? [];
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" role="dialog" aria-label="父子關係" onPointerDown={(e) => e.stopPropagation()}>
        <h3>父子關係：{feature.name}</h3>
        <div className="relations">
          <section>
            <h4>父特徵</h4>
            <ul>{parents.length ? parents.map((p) => <li key={p}>{name(p)}</li>) : <li className="muted">（無）</li>}</ul>
          </section>
          <section>
            <h4>子特徵</h4>
            <ul>{children.length ? children.map((c) => <li key={c}>{name(c)}</li>) : <li className="muted">（無）</li>}</ul>
          </section>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}
