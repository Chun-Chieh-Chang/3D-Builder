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
  /** The feature being dragged to a new place (B2.5, D1.5), and where it would land: before a row, or after it. */
  const [moving, setMoving] = useState<Id | null>(null);
  const [dropAt, setDropAt] = useState<{ id: Id; after: boolean } | null>(null);
  /** Filter text (D1.7), the folders closed, the feature being renamed, the feature whose note is open. */
  const [filter, setFilter] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [renamingFeature, setRenamingFeature] = useState<Id | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [noting, setNoting] = useState<Feature | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folder: string } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!menu && !bodyMenu && !folderMenu) return;
    const close = () => {
      setMenu(null);
      setBodyMenu(null);
      setFolderMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu, bodyMenu, folderMenu]);

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
  const needle = filter.trim().toLowerCase();
  const matches = (f: Feature) => !needle || [f.name, featureLabel(f), f.tag ?? '', f.comment ?? ''].some((x) => x.toLowerCase().includes(needle));
  const canDrag = !editing && !needle;
  /** The id of the feature a dragged one lands before (null: at the end). */
  const landing = (): Id | null => {
    if (!dropAt) return null;
    const i = doc.features.findIndex((f) => f.id === dropAt.id);
    return dropAt.after ? (doc.features[i + 1]?.id ?? null) : dropAt.id;
  };
  const endDrag = () => {
    setMoving(null);
    setDropAt(null);
  };

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
      <div className="tree-filter">
        <input value={filter} placeholder={t('tree.filter')} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('tree.filter')} />
        {needle && doc.features.every((f) => !matches(f)) && <span className="muted">{t('tree.filterNone')}</span>}
      </div>
      <ol
        ref={listRef}
        className="tree-list"
        title={canDrag ? t('tree.dragHint') : undefined}
        onDragOver={(e) => moving && e.preventDefault()}
        onDrop={(e) => {
          // dropped below the last row: to the end of the history
          if (moving && e.target === e.currentTarget) store.moveFeature(moving, null);
          endDrag();
        }}
      >
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
          if (!matches(f)) return [];
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
            f.folder && !needle ? 'in-folder' : '',
            moving === f.id ? 'moving' : '',
            dropAt?.id === f.id ? (dropAt.after ? 'drop-after' : 'drop-before') : '',
          ].join(' ');
          const prefix = f.type === 'sketch' && r?.sketch ? SKETCH_STATUS_PREFIX[r.sketch.status] : '';
          const tip = [r?.message, ...(r?.unresolved?.map((u) => `找不到：${u.ref.name}`) ?? []), ...(r?.warnings ?? [])].filter(Boolean).join('\n');
          const startsFolder = !needle && f.folder !== undefined && doc.features[i - 1]?.folder !== f.folder;
          const hidden = !needle && f.folder !== undefined && closed.has(f.folder);
          const head = startsFolder ? (
            <li
              key={`folder:${f.folder}`}
              className="tree-row folder-head"
              onClick={() => setClosed((c) => (c.has(f.folder!) ? new Set([...c].filter((x) => x !== f.folder)) : new Set([...c, f.folder!])))}
              onDoubleClick={() => !editing && setRenamingFolder(f.folder!)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!editing) setFolderMenu({ x: e.clientX, y: e.clientY, folder: f.folder! });
              }}
            >
              <span className="twisty">{closed.has(f.folder!) ? '▸' : '▾'}</span>
              {renamingFolder === f.folder ? (
                <input
                  className="rename"
                  autoFocus
                  defaultValue={f.folder}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value.trim() !== f.folder) store.renameFolder(f.folder!, e.target.value.trim());
                    setRenamingFolder(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenamingFolder(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                <span className="name">{f.folder}</span>
              )}
            </li>
          ) : null;
          const row = hidden ? null : (
            <li
              key={f.id}
              data-feature-row
              className={cls}
              draggable={canDrag && !rolledBack}
              title={[tip || `${featureLabel(f)}：${f.name}`, f.comment].filter(Boolean).join('\n')}
              onClick={() => store.treeClick(f.id)}
              onDoubleClick={() => !rolledBack && store.beginEdit(f.id)}
              onDragStart={(e) => {
                setMoving(f.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', f.id);
              }}
              onDragOver={(e) => {
                if (!moving || moving === f.id) return;
                e.preventDefault();
                const box = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > box.top + box.height / 2;
                if (dropAt?.id !== f.id || dropAt.after !== after) setDropAt({ id: f.id, after });
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (moving && moving !== f.id) {
                  // the lower half of a row of a folder is inside the folder; the upper half of the first row of a folder is outside it
                  const inside = f.folder !== undefined && (dropAt?.after || doc.features[i - 1]?.folder === f.folder);
                  store.moveFeature(moving, landing(), f.folder === undefined ? undefined : inside ? f.folder : null);
                }
                endDrag();
              }}
              onDragEnd={endDrag}
              onContextMenu={(e) => {
                e.preventDefault();
                if (editing) return;
                store.select(f.id);
                setMenu({ x: e.clientX, y: e.clientY, feature: f });
              }}
            >
              <Icon name={f.type} />
              {renamingFeature === f.id ? (
                <input
                  className="rename"
                  autoFocus
                  defaultValue={f.name}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== f.name) store.execute({ type: 'renameFeature', featureId: f.id, name: v });
                    setRenamingFeature(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setRenamingFeature(null);
                    e.stopPropagation();
                  }}
                />
              ) : (
                <span className="name">
                  {prefix}
                  {f.name}
                </span>
              )}
              {f.tag && <span className="tag">{f.tag}</span>}
              {f.comment && <span className="note-mark" aria-hidden>✎</span>}
              {r?.status === 'error' && <Icon name="error" className="status-error" />}
              {warned && <Icon name="warning" className="status-warning" />}
              {eye(f.id)}
            </li>
          );
          const rows = [...(head ? [head] : []), ...(row ? [row] : [])];
          return i === barIndex && !needle ? [bar, ...rows] : rows;
        })}
        {barIndex >= doc.features.length && !needle && bar}
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
          <li onClick={act(() => setRenamingFeature(menu.feature.id))}>{t('tree.renameFeature')}</li>
          <li onClick={act(() => setNoting(menu.feature))}>{t('tree.editNote')}</li>
          {menu.feature.folder ? <li onClick={act(() => store.leaveFolder(menu.feature.id))}>{t('tree.leaveFolder')}</li> : <li onClick={act(() => store.newFolder(menu.feature.id))}>{t('tree.intoFolder')}</li>}
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

      {folderMenu && (
        <ul className="context-menu" style={{ left: folderMenu.x, top: folderMenu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <li
            onClick={() => {
              setRenamingFolder(folderMenu.folder);
              setFolderMenu(null);
            }}
          >
            {t('tree.renameFolder')}
          </li>
          <li
            onClick={() => {
              store.renameFolder(folderMenu.folder, null);
              setFolderMenu(null);
            }}
          >
            {t('tree.dissolveFolder')}
          </li>
        </ul>
      )}

      {noting && <NoteDialog feature={noting} onClose={() => setNoting(null)} />}
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

/** Comment and tag of a feature (D1.7). */
function NoteDialog({ feature, onClose }: { feature: Feature; onClose: () => void }) {
  const [comment, setComment] = useState(feature.comment ?? '');
  const [tag, setTag] = useState(feature.tag ?? '');
  const save = () => {
    store.execute({ type: 'setFeatureNote', featureId: feature.id, comment, tag });
    onClose();
  };
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" role="dialog" aria-label={t('note.title')} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>{t('note.titleFor', { name: feature.name })}</h3>
        <label className="pm-row">
          <span>{t('note.tag')}</span>
          <input value={tag} autoFocus onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label className="pm-row">
          <span>{t('note.comment')}</span>
          <textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <div className="modal-actions">
          <button className="primary" onClick={save}>
            {t('note.save')}
          </button>
          <button onClick={onClose}>{t('note.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
