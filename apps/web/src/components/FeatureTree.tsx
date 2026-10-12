import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '@3db/i18n';
import { bodyKey, isHideable, isShown, type Feature, type Id } from '@3db/model';
import { ownerFeatures } from '@3db/naming';
import { dependencies } from '@3db/regen/dag';
import type { FeatureResult } from '@3db/regen';
import { store, useDocumentName, useStore } from '../state/store';
import { DATUM_ITEMS, featureLabel, SKETCH_STATUS_PREFIX } from '../strings';
import { Icon } from './Icon';
import { ContextMenu } from './ContextMenu';

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

/** Returns the sketch IDs consumed by a feature to build its 3D geometry. */
function consumedSketchesOf(f: Feature): Id[] {
  switch (f.type) {
    case 'extrude':
    case 'revolve':
    case 'hole':
    case 'rib':
    case 'vent':
    case 'splitLine':
    case 'trimSurface':
    case 'baseFlange':
    case 'midBend':
    case 'snapHook':
    case 'snapCatch':
      return f.sketch ? [f.sketch] : [];
    case 'sweep':
      return [f.sketch, f.path].filter((x): x is Id => !!x);
    case 'thread':
      return f.sketch ? [f.sketch] : [];
    case 'loft':
      return [...f.sections];
    default:
      return [];
  }
}

/**
 * FeatureManager design tree (D1.1–D1.8): history order, status and warnings, rollback bar,
 * hierarchical absorbed sketches, dynamic reference visualization (parent/child highlighting),
 * and boundary-safe context menus.
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
  /** View mode: 'hierarchy' (absorbed sketches nested under features) vs 'flat' (chronological). */
  const [treeMode, setTreeMode] = useState<'hierarchy' | 'flat'>('hierarchy');
  /** Features whose child sketches are collapsed in hierarchy mode. */
  const [collapsedFeatures, setCollapsedFeatures] = useState<ReadonlySet<Id>>(new Set());
  /** Hovered feature/datum ID for Dynamic Reference Visualization (D1.8). */
  const [hovered, setHovered] = useState<Id | null>(null);
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

  const deps = dependencies(doc);
  const activeRefId = hovered ?? selected ?? null;
  const activeParents = new Set(activeRefId ? (deps.parents.get(activeRefId) ?? []) : []);
  const activeChildren = new Set(activeRefId ? (deps.children.get(activeRefId) ?? []) : []);

  const featureNameOf = (id: Id): string => {
    if (id === 'plane:front') return t('tree.datumFront');
    if (id === 'plane:top') return t('tree.datumTop');
    if (id === 'plane:right') return t('tree.datumRight');
    if (id === '@origin') return t('tree.datumOrigin');
    const f = doc.features.find((x) => x.id === id);
    if (f) return f.name;
    const b = result?.bodies.find((x) => x.id === id);
    if (b) return b.name;
    return id;
  };

  const absorbedSketchSet = new Set<Id>();
  for (const f of doc.features) {
    for (const sid of consumedSketchesOf(f)) absorbedSketchSet.add(sid);
  }

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
    <li key="rollback" className={dragIndex !== null ? 'rollback-bar dragging' : 'rollback-bar'} onPointerDown={onBarDown} title={t('tree.rollbackBar')}>
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
        title={shown ? t('tree.hide') : t('tree.show')}
        aria-label={shown ? t('tree.hide') : t('tree.show')}
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

  const renderRow = (f: Feature, i: number, isAbsorbed = false, parentFeature?: Feature) => {
    const r = statusOf(f.id);
    const rolledBack = i >= barIndex || (parentFeature ? doc.features.indexOf(parentFeature) >= barIndex : false);
    const warned = r?.status === 'ok' && !!r.warnings?.length;
    const isParent = activeParents.has(f.id);
    const isChild = activeChildren.has(f.id);
    const isActive = activeRefId === f.id;
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
      isAbsorbed ? 'absorbed-sketch' : '',
      isParent ? 'is-parent' : '',
      isChild ? 'is-child' : '',
      isActive ? 'active-ref' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const prefix = f.type === 'sketch' && r?.sketch ? SKETCH_STATUS_PREFIX[r.sketch.status] : '';
    const tip = [r?.message, ...(r?.unresolved?.map((u) => t('tree.notFound', { name: u.ref.name })) ?? []), ...(r?.warnings ?? [])].filter(Boolean).join('\n');
    const pIds = deps.parents.get(f.id) ?? [];
    const parentHint = !isAbsorbed && f.type !== 'sketch' && pIds[0] ? featureNameOf(pIds[0]) : null;
    const parentHintTitle = parentHint ? t('tree.builtFrom', { parents: pIds.map(featureNameOf).join(', ') }) : '';
    const childSketches = consumedSketchesOf(f);
    const hasChildren = treeMode === 'hierarchy' && !needle && childSketches.length > 0;
    const isCollapsed = collapsedFeatures.has(f.id);

    return (
      <li
        key={isAbsorbed ? `${parentFeature?.id}:${f.id}` : f.id}
        data-feature-row
        className={cls}
        draggable={canDrag && !rolledBack}
        title={[tip || `${featureLabel(f)}: ${f.name}`, parentHintTitle, f.comment].filter(Boolean).join('\n')}
        onClick={() => store.treeClick(f.id)}
        onDoubleClick={() => !rolledBack && store.beginEdit(f.id)}
        onPointerEnter={() => setHovered(f.id)}
        onPointerLeave={() => setHovered(null)}
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
        {isAbsorbed ? (
          <span className="tree-branch-guide" aria-hidden>
            └──
          </span>
        ) : hasChildren ? (
          <span
            className="twisty"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsedFeatures((prev) => {
                const next = new Set(prev);
                if (next.has(f.id)) next.delete(f.id);
                else next.add(f.id);
                return next;
              });
            }}
            title={isCollapsed ? t('tree.expandSketches') : t('tree.collapseSketches')}
          >
            {isCollapsed ? '▸' : '▾'}
          </span>
        ) : null}
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
        {parentHint && (
          <span className="tree-parent-hint" title={parentHintTitle}>
            {`↳ ${parentHint}`}
          </span>
        )}
        {f.tag && <span className="tag">{f.tag}</span>}
        {f.comment && (
          <span className="note-mark" aria-hidden>
            ✎
          </span>
        )}
        {isParent && (
          <span className="dep-badge parent-badge" title={t('relations.parents')}>
            {t('tree.parentBadge')}
          </span>
        )}
        {isChild && (
          <span className="dep-badge child-badge" title={t('relations.children')}>
            {t('tree.childBadge')}
          </span>
        )}
        {r?.status === 'error' && <Icon name="error" className="status-error" />}
        {warned && <Icon name="warning" className="status-warning" />}
        {eye(f.id)}
      </li>
    );
  };

  return (
    <div className="feature-tree">
      {returnTo && (
        <button className="return-bar" onClick={() => store.returnToAssembly()} title={t('tree.returnTip')}>
          <Icon name="assembly" />
          {t('tree.returnTo', { name: returnTo })}
        </button>
      )}
      <div className="tree-part">
        <Icon name="part" />
        <span>{name}</span>
      </div>
      <div className="tree-filter">
        <input value={filter} placeholder={t('tree.filter')} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('tree.filter')} />
        <button
          type="button"
          className={`tree-mode-toggle ${treeMode === 'hierarchy' ? 'active' : ''}`}
          onClick={() => setTreeMode((m) => (m === 'hierarchy' ? 'flat' : 'hierarchy'))}
          title={treeMode === 'hierarchy' ? t('tree.toggleToFlat') : t('tree.toggleToHierarchy')}
          aria-label={t('tree.toggleModeAria')}
        >
          {treeMode === 'hierarchy' ? `🌿 ${t('tree.viewHierarchy')}` : `⏱ ${t('tree.viewFlat')}`}
        </button>
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
        {DATUM_ITEMS.map((d) => {
          const isParent = activeParents.has(d.id);
          const cls = `tree-row datum ${selected === d.id ? 'selected' : ''} ${isParent ? 'is-parent' : ''}`;
          return (
            <li
              key={d.id}
              className={cls}
              title={d.icon === 'plane' ? t('tree.sketchOnPlane') : undefined}
              onClick={() => d.icon === 'plane' && store.treeClick(d.id)}
              onPointerEnter={() => setHovered(d.id)}
              onPointerLeave={() => setHovered(null)}
            >
              <Icon name={d.icon} />
              <span className="name">{d.label}</span>
              {isParent && <span className="dep-badge parent-badge">{t('tree.datumBadge')}</span>}
              {eye(d.id)}
            </li>
          );
        })}
        {bodies.length > 0 && (
          <li key="bodies" className="tree-row folder">
            <Icon name="body" />
            <span className="name">{t('tree.bodies', { n: bodies.length })}</span>
          </li>
        )}
        {bodies.map((b) => {
          const key = bodyKey(b.id);
          const isParent = activeParents.has(b.id);
          const tip = t('tree.bodyTip', { name: b.name, volume: Math.round(b.volume * 1000) / 1000 });
          const cls = `tree-row body ${selected === key ? 'selected' : ''} ${b.shown ? '' : 'suppressed'} ${isParent ? 'is-parent' : ''}`;
          return (
            <li
              key={key}
              className={cls}
              title={b.reference ? `${tip}\n${t('tree.referenceTip')}` : tip}
              onClick={() => store.select(key)}
              onDoubleClick={() => !editing && setRenaming(b.id)}
              onPointerEnter={() => setHovered(b.id)}
              onPointerLeave={() => setHovered(null)}
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
                  {b.surface && t('tree.surface')}
                </span>
              )}
              {isParent && <span className="dep-badge parent-badge">{t('tree.bodyBadge')}</span>}
              {eye(key)}
            </li>
          );
        })}
        {doc.features.flatMap((f, i) => {
          if (!matches(f)) return [];
          const startsFolder = !needle && f.folder !== undefined && doc.features[i - 1]?.folder !== f.folder;
          const hidden = !needle && f.folder !== undefined && closed.has(f.folder);
          const head = startsFolder ? (
            <li
              key={`folder:${f.folder}`}
              className="tree-row folder-head"
              onClick={() => setClosed((c) => (c.has(f.folder!) ? new Set([...c].filter((x) => x !== f.folder)) : new Set([...c, f.folder!])))}
              onDoubleClick={() => !editing && setRenamingFolder(f.folder!)}
              onDragOver={(e) => moving && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (moving) {
                  // dropped on the name of a folder: the feature joins it, at the end of what it holds (one that is already there only goes to the end)
                  const last = doc.features.reduce((n, g, j) => (g.folder === f.folder ? j : n), -1);
                  store.moveFeature(moving, doc.features.slice(last + 1).find((g) => g.id !== moving)?.id ?? null, f.folder);
                }
                endDrag();
              }}
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

          if (hidden) return head ? [head] : [];

          // In hierarchy mode, absorbed sketches are rendered under their consuming features
          if (treeMode === 'hierarchy' && !needle && f.type === 'sketch' && absorbedSketchSet.has(f.id)) {
            return head ? [head] : [];
          }

          const mainRow = renderRow(f, i);
          const childSketches =
            treeMode === 'hierarchy' && !needle && !collapsedFeatures.has(f.id)
              ? doc.features.filter((x) => consumedSketchesOf(f).includes(x.id))
              : [];
          const childRows = childSketches.map((sk) => renderRow(sk, doc.features.indexOf(sk), true, f));

          const rows = [...(head ? [head] : []), mainRow, ...childRows];
          return i === barIndex && !needle ? [bar, ...rows] : rows;
        })}
        {barIndex >= doc.features.length && !needle && bar}
      </ol>

      {/* Dynamic Reference Visualization (D1.8) Status Bar */}
      {activeRefId && (
        <div className="tree-dependency-bar" aria-live="polite">
          <div className="dep-bar-header">
            <span className="dep-bar-title">{t('tree.depBarTitle')}</span>
            <span className="dep-bar-active">{featureNameOf(activeRefId)}</span>
          </div>
          <div className="dep-bar-groups">
            <div className="dep-group">
              <span className="dep-group-label">{t('tree.depParentsLabel')}</span>
              {activeParents.size === 0 ? (
                <span className="dep-empty">{t('tree.depNoneRoot')}</span>
              ) : (
                [...activeParents].map((pid) => (
                  <button key={pid} type="button" className="dep-chip parent-chip" onClick={() => store.treeClick(pid)} title={t('tree.selectParent', { name: featureNameOf(pid) })}>
                    {featureNameOf(pid)}
                  </button>
                ))
              )}
            </div>
            <div className="dep-group">
              <span className="dep-group-label">{t('tree.depChildrenLabel')}</span>
              {activeChildren.size === 0 ? (
                <span className="dep-empty">{t('tree.depNone')}</span>
              ) : (
                [...activeChildren].map((cid) => (
                  <button key={cid} type="button" className="dep-chip child-chip" onClick={() => store.treeClick(cid)} title={t('tree.selectChild', { name: featureNameOf(cid) })}>
                    {featureNameOf(cid)}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onPointerDown={(e) => e.stopPropagation()}>
          {doc.features.indexOf(menu.feature) < rollback && (
            <li onClick={act(() => store.beginEdit(menu.feature.id))}>{menu.feature.type === 'sketch' ? t('tree.editSketch') : t('tree.editFeature')}</li>
          )}
          {menu.feature.type === 'sketch' && doc.features.indexOf(menu.feature) < rollback && (
            <li onClick={act(() => store.beginEditSketchPlane(menu.feature.id))}>{t('tree.editSketchPlane')}</li>
          )}
          {menu.feature.suppressed ? (
            <>
              <li onClick={act(() => store.suppress(menu.feature.id, 'unsuppress'))}>{t('tree.unsuppress')}</li>
              <li onClick={act(() => store.suppress(menu.feature.id, 'unsuppressWithDependents'))}>{t('tree.unsuppressDeps')}</li>
            </>
          ) : (
            <li onClick={act(() => store.suppress(menu.feature.id, 'suppress'))}>{t('tree.suppress')}</li>
          )}
          {isHideable(doc, menu.feature.id) && (
            <li onClick={act(() => store.setVisibility([menu.feature.id], !isShown(doc, menu.feature.id)))}>{isShown(doc, menu.feature.id) ? t('tree.hide') : t('tree.show')}</li>
          )}
          <li onClick={act(() => setRenamingFeature(menu.feature.id))}>{t('tree.renameFeature')}</li>
          <li onClick={act(() => setNoting(menu.feature))}>{t('tree.editNote')}</li>
          {menu.feature.folder ? <li onClick={act(() => store.leaveFolder(menu.feature.id))}>{t('tree.leaveFolder')}</li> : <li onClick={act(() => store.newFolder(menu.feature.id))}>{t('tree.intoFolder')}</li>}
          <li onClick={act(() => store.requestDelete(menu.feature.id))}>{t('tree.delete')}</li>
          <li className="separator" />
          <li onClick={act(() => store.rollTo(menu.feature.id))}>{t('tree.rollHere')}</li>
          {doc.rollbackIndex !== null && <li onClick={act(() => store.rollTo(null))}>{t('tree.rollEnd')}</li>}
          <li className="separator" />
          <li onClick={act(() => setRelations(menu.feature))}>{t('tree.relations')}</li>
          {(statusOf(menu.feature.id)?.status === 'error' || statusOf(menu.feature.id)?.warnings) && <li onClick={act(() => store.showWhatsWrong(true))}>{t('tree.whatsWrong')}</li>}
        </ContextMenu>
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
            <ContextMenu x={bodyMenu.x} y={bodyMenu.y} onPointerDown={(e) => e.stopPropagation()}>
              <li onClick={done(() => store.setVisibility([bodyKey(b.id)], !b.shown))}>{t(b.shown ? 'tree.hide' : 'tree.show')}</li>
              <li onClick={done(() => setRenaming(b.id))}>{t('tree.rename')}</li>
              <li onClick={done(() => store.setBody(b.id, { reference: !b.reference }))}>{t(b.reference ? 'tree.unmakeReference' : 'tree.makeReference')}</li>
            </ContextMenu>
          );
        })()}

      {folderMenu && (
        <ContextMenu x={folderMenu.x} y={folderMenu.y} onPointerDown={(e) => e.stopPropagation()}>
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
        </ContextMenu>
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
      <div className="modal" role="dialog" aria-label={t('relations.title')} onPointerDown={(e) => e.stopPropagation()}>
        <h3>{t('relations.titleFor', { name: feature.name })}</h3>
        <div className="relations">
          <section>
            <h4>{t('relations.parents')}</h4>
            <ul>{parents.length ? parents.map((p) => <li key={p}>{name(p)}</li>) : <li className="muted">{t('relations.none')}</li>}</ul>
          </section>
          <section>
            <h4>{t('relations.children')}</h4>
            <ul>{children.length ? children.map((c) => <li key={c}>{name(c)}</li>) : <li className="muted">{t('relations.none')}</li>}</ul>
          </section>
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>{t('relations.close')}</button>
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
