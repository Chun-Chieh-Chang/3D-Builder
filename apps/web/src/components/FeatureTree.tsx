import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '@3db/i18n';
import { bodyKey, isHideable, isShown, type Feature, type Id } from '@3db/model';
import { ownerFeatures } from '@3db/naming';
import { dependencies } from '@3db/regen/dag';
import type { FeatureResult } from '@3db/regen';
import { store, useDocumentName, useStore } from '../state/store';
import { DATUM_ITEMS, featureLabel, SKETCH_STATUS_PREFIX } from '../strings';
import { Icon } from './Icon';

interface Menu {
  x: number;
  y: number;
  feature: Feature;
}

/** The context menu of a body (C7.1). */
interface BodyMenu {
  x: number;
  y: number;
  id: Id;
}

/**
 * FeatureManager design tree (D1.1–D1.6): history order, status and warnings, rollback bar,
 * context menu (edit, suppress, delete, roll back, parent/child, what's wrong), and the feature
 * owning the face selected in the graphics area (D1.2).
 */
export function FeatureTree() {
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const selected = useStore((s) => s.selected);
  const selectedFace = useStore((s) => s.selectedFace);
  const editing = useStore((s) => s.editing);
  const name = useDocumentName();
  const returnTo = useStore((s) => s.returnTo);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [bodyMenu, setBodyMenu] = useState<BodyMenu | null>(null);
  /** The body whose name is being typed. */
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [relations, setRelations] = useState<Feature | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!menu && !bodyMenu) return;
    const close = () => {
      setMenu(null);
      setBodyMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu, bodyMenu]);

  const statusOf = (id: Id): FeatureResult | undefined => result?.features.find((f) => f.id === id);
  const rollback = doc.rollbackIndex ?? doc.features.length;
  const barIndex = dragIndex ?? rollback;
  const owner = selectedFace ? ownerFeatures(selectedFace.name)[0] : undefined;

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

  /** Eye button (D4.6): hides or shows a sketch, reference plane, default plane or the origin. */
  const eye = (key: string) => {
    if (!isHideable(doc, key)) return null;
    const shown = isShown(doc, key);
    return (
      <button
        className={shown ? 'vis-toggle shown' : 'vis-toggle'}
        title={shown ? '隱藏' : '顯示'}
        aria-label={shown ? '隱藏' : '顯示'}
        disabled={!!editing}
        onClick={(e) => {
          e.stopPropagation();
          store.setVisibility([key], !shown);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Icon name={shown ? 'eye' : 'eyeOff'} />
      </button>
    );
  };

  const bodies = result?.bodies ?? [];

  const act = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  return (
    <div className="feature-tree">
      {returnTo && (
        <button className="return-bar" onClick={() => store.returnToAssembly()} title="回到組合件：存檔過的零件變更會顯示出來">
          <Icon name="assembly" />
          返回組合件「{returnTo}」
        </button>
      )}
      <div className="tree-part">
        <Icon name="part" />
        <span>{name}</span>
      </div>
      <ol ref={listRef} className="tree-list">
        {DATUM_ITEMS.map((d) => (
          <li
            key={d.id}
            className={`tree-row datum ${selected === d.id ? 'selected' : ''}`}
            title={d.icon === 'plane' ? '選取後按「草圖」即可在此基準面上繪製草圖' : undefined}
            onClick={() => d.icon === 'plane' && store.treeClick(d.id)}
          >
            <Icon name={d.icon} />
            <span className="name">{d.label}</span>
            {eye(d.id)}
          </li>
        ))}
        {bodies.length > 0 && (
          <li key="bodies" className="tree-row folder">
            <Icon name="body" />
            <span className="name">{t('tree.bodies', { n: bodies.length })}</span>
          </li>
        )}
        {bodies.map((b) => {
          const key = bodyKey(b.id);
          const tip = t('tree.bodyTip', { name: b.name, volume: Math.round(b.volume * 1000) / 1000 });
          return (
            <li
              key={key}
              className={`tree-row body ${selected === key ? 'selected' : ''} ${b.shown ? '' : 'suppressed'}`}
              title={b.reference ? `${tip}\n${t('tree.referenceTip')}` : tip}
              onClick={() => store.select(key)}
              onDoubleClick={() => !editing && setRenaming(b.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (editing) return;
                store.select(key);
                setBodyMenu({ x: e.clientX, y: e.clientY, id: b.id });
              }}
            >
              <Icon name="body" />
              {renaming === b.id ? (
                <input
                  className="rename"
                  autoFocus
                  defaultValue={b.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    store.setBody(b.id, { name: e.target.value });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      store.setBody(b.id, { name: e.currentTarget.value });
                      setRenaming(null);
                    }
                    if (e.key === 'Escape') setRenaming(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                <span className="name">
                  {b.name}
                  {b.reference && t('tree.reference')}
                </span>
              )}
              {eye(key)}
            </li>
          );
        })}
        {doc.features.flatMap((f, i) => {
          const r = statusOf(f.id);
          const rolledBack = i >= barIndex;
          const warned = r?.status === 'ok' && !!r.warnings?.length;
          const cls = [
            'tree-row',
            selected === f.id ? 'selected' : '',
            owner === f.id ? 'owner' : '',
            r?.status === 'error' ? 'error' : '',
            warned ? 'warning' : '',
            f.suppressed ? 'suppressed' : '',
            rolledBack ? 'rolled-back' : '',
            editing?.featureId === f.id ? 'editing' : '',
          ].join(' ');
          const prefix = f.type === 'sketch' && r?.sketch ? SKETCH_STATUS_PREFIX[r.sketch.status] : '';
          const tip = [r?.message, ...(r?.unresolved?.map((u) => `找不到：${u.ref.name}`) ?? []), ...(r?.warnings ?? [])].filter(Boolean).join('\n');
          const row = (
            <li
              key={f.id}
              data-feature-row
              className={cls}
              title={tip || `${featureLabel(f)}：${f.name}`}
              onClick={() => store.treeClick(f.id)}
              onDoubleClick={() => !rolledBack && store.beginEdit(f.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (editing) return;
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
              {warned && <Icon name="warning" className="status-warning" />}
              {eye(f.id)}
            </li>
          );
          return i === barIndex ? [bar, row] : [row];
        })}
        {barIndex >= doc.features.length && bar}
      </ol>

      {menu && (
        <ul className="context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {doc.features.indexOf(menu.feature) < rollback && (
            <li onClick={act(() => store.beginEdit(menu.feature.id))}>{menu.feature.type === 'sketch' ? '編輯草圖' : '編輯特徵'}</li>
          )}
          {menu.feature.suppressed ? (
            <>
              <li onClick={act(() => store.suppress(menu.feature.id, 'unsuppress'))}>恢復抑制</li>
              <li onClick={act(() => store.suppress(menu.feature.id, 'unsuppressWithDependents'))}>恢復抑制（含相依特徵）</li>
            </>
          ) : (
            <li onClick={act(() => store.suppress(menu.feature.id, 'suppress'))}>抑制</li>
          )}
          {isHideable(doc, menu.feature.id) && (
            <li onClick={act(() => store.setVisibility([menu.feature.id], !isShown(doc, menu.feature.id)))}>{isShown(doc, menu.feature.id) ? '隱藏' : '顯示'}</li>
          )}
          <li onClick={act(() => store.requestDelete(menu.feature.id))}>刪除…</li>
          <li className="separator" />
          <li onClick={act(() => store.rollTo(menu.feature.id))}>回溯（到此特徵之前）</li>
          {doc.rollbackIndex !== null && <li onClick={act(() => store.rollTo(null))}>推進至最後</li>}
          <li className="separator" />
          <li onClick={act(() => setRelations(menu.feature))}>父子關係…</li>
          {(statusOf(menu.feature.id)?.status === 'error' || statusOf(menu.feature.id)?.warnings) && <li onClick={act(() => store.showWhatsWrong(true))}>錯誤為何？</li>}
        </ul>
      )}

      {bodyMenu &&
        (() => {
          const b = bodies.find((x) => x.id === bodyMenu.id);
          if (!b) return null;
          const done = (fn: () => void) => () => {
            setBodyMenu(null);
            fn();
          };
          return (
            <ul className="context-menu" style={{ left: bodyMenu.x, top: bodyMenu.y }} onPointerDown={(e) => e.stopPropagation()}>
              <li onClick={done(() => store.setVisibility([bodyKey(b.id)], !b.shown))}>{t(b.shown ? 'tree.hide' : 'tree.show')}</li>
              <li onClick={done(() => setRenaming(b.id))}>{t('tree.rename')}</li>
              <li onClick={done(() => store.setBody(b.id, { reference: !b.reference }))}>{t(b.reference ? 'tree.unmakeReference' : 'tree.makeReference')}</li>
            </ul>
          );
        })()}

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
