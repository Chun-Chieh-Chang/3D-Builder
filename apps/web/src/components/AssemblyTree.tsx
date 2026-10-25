import { Fragment, useEffect, useState, type MouseEvent } from 'react';
import { t } from '@3db/i18n';
import { activeExplosion, componentPatternLabels, explosionSteps, joinPath, type Component, type ComponentPattern, type Id, type Mate } from '@3db/model';
import { componentName } from '@3db/io';
import { store, useDocumentName, useStore } from '../state/store';
import type { AssemblyState } from '../state/assembly';
import { DATUM_ITEMS, PART_STAGE_LABEL } from '../strings';
import { Icon } from './Icon';
import { ContextMenu } from './ContextMenu';
import { treeFilterMatches, treeNeedle } from './treeFilter';
import { assemblyMenu } from '../contextMenus';
import { MenuEntries } from './GraphicsMenu';

type Menu = { x: number; y: number } & ({ component: Component } | { mate: Mate } | { pattern: ComponentPattern });

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
  if (c.suppressed) return ''; // left out of the assembly: not solved, so no state to mark
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
 * A component's context menu (the tree's row, or the component in the graphics area): what to do with it, as SolidWorks offers it. The component is the one
 * selected (the right click selects it first), and the lines are the registry's commands (ADR 0176), the same in both places.
 */
export function ComponentMenu({ x, y, component, onClose }: { x: number; y: number; component: Component; onClose: () => void }) {
  if (!store.assembly) return null;
  return (
    <ContextMenu x={x} y={y} onPointerDown={(e) => e.stopPropagation()} data-component-menu={component.id}>
      <MenuEntries items={assemblyMenu(store.getState(), component.id)} onClose={onClose} />
    </ContextMenu>
  );
}

/**
 * FeatureManager of an assembly (D1.1, C15.2, C15.12): default planes and origin, the components in
 * insertion order with their state from the solved mates, then the mates folder: each mate by name
 * and the components it joins, marked when it fails; edit, suppress and delete from its context menu.
 */
export function AssemblyTree() {
  const asm = useStore((s) => s.asm)!;
  const name = useDocumentName();
  const [featureMenu, setFeatureMenu] = useState<{ x:number; y:number; component:Id; feature:Id; sketch:boolean } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [matesOpen, setMatesOpen] = useState(true);
  const [filter, setFilter] = useState('');
  const returnTo = useStore((s) => s.returnTo);
  const opened = asm.opened;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  useEffect(() => {if(!featureMenu)return;const close=()=>setFeatureMenu(null);window.addEventListener('pointerdown',close);return()=>window.removeEventListener('pointerdown',close);},[featureMenu]);
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
  /**
   * The search box (E1-P2, the one FeatureTree already had): the needle, and the rows it keeps. A component is kept by its name or file, a pattern by its name
   * or seed, an exploded step by its name, a mate by its name or the components it joins. Datum rows are structure — as in FeatureTree, which never filters
   * them — so they always stay. With nothing typed every row is kept, so the tree reads exactly as it did before.
   */
  const needle = treeNeedle(filter);
  const shownComponents = asm.doc.components
    .map((c) => ({ c, info: componentInfo(asm, c) }))
    .filter(({ c, info }) => treeFilterMatches(needle, [info.name, info.path, componentPrefix(asm, c)]));
  const shownPatterns = (asm.doc.patterns ?? []).filter((p) => treeFilterMatches(needle, [p.name, nameOf(p.seed)]));
  const shownExplodeSteps = explosionSteps(asm.doc).filter((s) => treeFilterMatches(needle, [s.name]));
  const shownMates = asm.doc.mates.filter((m) => treeFilterMatches(needle, [m.name, nameOf(m.a.component), nameOf(m.b.component)]));
  const noMatch = !!needle && !shownComponents.length && !shownPatterns.length && !shownExplodeSteps.length && !shownMates.length;
  const additive = (e: MouseEvent) => e.ctrlKey || e.shiftKey || e.metaKey;
  const picked = (component: Id | null, name: string) => asm.picks.some((p) => p.component === component && !p.path?.length && p.ref.kind === 'datum' && p.ref.name === name);
  /** A datum row (the assembly's, or a component's own): a click picks it, Ctrl adds it (see `picks`). */
  const datumRow = (component: Id | null, id: string, label: string, icon: 'plane' | 'origin', indent?: number) => (
    <li
      key={`${component ?? ''}:${id}`}
      {...(component ? { 'data-component-datum': `${component}:${id}` } : { 'data-asm-datum': id })}
      className={`tree-row datum ${component ? 'component-datum' : ''} ${picked(component, id) ? 'selected' : ''}`}
      style={indent ? { paddingLeft: indent } : undefined}
      title={component ? t('tree.componentDatumTip') : undefined}
      onClick={(e) => a?.pickDatum({ component, ref: { kind: 'datum', name: id } }, additive(e))}
      onDoubleClick={() => {if(component&&a?.buildOf(component)?.features.some(f=>f.id===id))store.openComponentPart(component,id);}}
    >
      <Icon name={icon} />
      <span className="name">{label}</span>
    </li>
  );
  /**
   * What a part shows under its component when it is opened (as SolidWorks lists a part in an assembly): its origin and default planes, then its features in
   * history order. Double-click edits its source feature; reference planes remain selectable datums.
   */
  const partRows = (c: Component) => {
    const build = a?.buildOf(c.id);
    if (!build) return null;
    return (
      <>
        {DATUM_ITEMS.map((d) => datumRow(c.id, d.id, d.label, d.icon, 30))}
        {build.features.map((f) =>
          f.type === 'refPlane' && build.planes.some((p) => p.id === f.id) ? (
            datumRow(c.id, f.id, f.name, 'plane', 30)
          ) : (
            <li
              key={`${c.id}:${f.id}`}
              data-component-feature={`${c.id}:${f.id}`}
              className={`tree-row component-feature ${f.status === 'error' ? 'error' : ''} ${f.status === 'suppressed' ? 'suppressed' : ''}`}
              style={{ paddingLeft: 30 }}
              title={f.status === 'error' ? t('tree.componentFeatureFailed') : t('tree.componentFeatureTip')}
              onDoubleClick={() => store.openComponentPart(c.id, f.id)}
              onContextMenu={e => {e.preventDefault();setFeatureMenu({x:e.clientX,y:e.clientY,component:c.id,feature:f.id,sketch:f.type==='sketch'});}}
            >
              <Icon name={f.type} />
              <span className="name">{f.name}</span>
              {f.status === 'error' && <Icon name="error" className="status-error" />}
            </li>
          ),
        )}
      </>
    );
  };

  return (
    <div className="feature-tree">
      {featureMenu && <ContextMenu x={featureMenu.x} y={featureMenu.y}><li data-action="edit-component-feature" onClick={() => {store.openComponentPart(featureMenu.component, featureMenu.feature);setFeatureMenu(null);}}>{t(featureMenu.sketch?'tree.editComponentSketch':'tree.editComponentFeature')}</li></ContextMenu>}
      {returnTo && (
        <button className="return-bar" data-action="returnBack" onClick={() => store.returnToAssembly()} title={t(returnTo.kind === 'drawing' ? 'tree.returnDrawingTip' : 'tree.returnTip')}>
          <Icon name="assembly" />
          {t(returnTo.kind === 'drawing' ? 'tree.returnToDrawing' : 'tree.returnTo', { name: returnTo.name })}
        </button>
      )}
      <div className="tree-part">
        <Icon name="assembly" />
        <span>{name}</span>
      </div>
      {asm.doc.components.some(c => c.hidden) && <button className="show-hidden" data-action="show-hidden-components" onClick={() => a?.showHiddenComponents()}>{t('tree.showHiddenComponents')}</button>}
      <div className="tree-filter">
        <label className="search-field">
          <Icon name="search" />
          <input type="search" value={filter} placeholder={t('tree.filter')} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label={t('tree.filter')} />
        </label>
        {noMatch && <span className="muted">{t('tree.filterNone')}</span>}
      </div>
      <ol className="tree-list">
        {DATUM_ITEMS.map((d) => datumRow(null, d.id, d.label, d.icon))}
        {shownComponents.map(({ c, info }) => {
          const result = asm.solution?.components.get(c.id);
          const freedom = result && result.status === 'under' ? `可移動的自由度：${result.dof}` : undefined;
          const tip = [info.path && `檔案：${info.path}`, freedom, info.loading && `載入中：${info.loading}`, info.error, ...info.warnings].filter(Boolean).join('\n');
          const sub = !!a?.isSubAssembly(c.id);
          // a part opens to show its own origin, planes and features; a sub-assembly its components (a suppressed one is not built: nothing to show)
          const expandable = sub || (!c.suppressed && !!a?.buildOf(c.id));
          return (
            <Fragment key={c.id}>
              <li
                data-component-row={c.id}
                className={`tree-row ${asm.selected === c.id || asm.selectedComponents.includes(c.id) ? 'selected' : ''} ${info.error ? 'error' : ''} ${info.loading ? 'loading' : ''} ${c.suppressed ? 'suppressed' : ''} ${c.hidden ? 'hidden-component' : ''}`}
                title={tip}
                onClick={() => select(c.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  select(c.id);
                  setMenu({ x: e.clientX, y: e.clientY, component: c });
                }}
              >
                {expandable && (
                  <span
                    className="twisty"
                    data-twisty={c.id}
                    data-open={opened.has(c.id) || undefined}
                    title={sub ? undefined : t('tree.componentExpand')}
                    onClick={(e) => {
                      e.stopPropagation();
                      a?.toggleOpened(c.id);
                    }}
                  >
                    {/* drawn, not a character: the row's text stays the component's name */}
                    <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
                      <path d={opened.has(c.id) ? 'M1 3 L9 3 L5 8 Z' : 'M3 1 L8 5 L3 9 Z'} fill="currentColor" />
                    </svg>
                  </span>
                )}
                <Icon name={sub ? 'assembly' : 'part'} />
                <span className="name">
                  {componentPrefix(asm, c)}
                  {info.name}
                </span>
                {info.error && <Icon name="error" className="status-error" />}
                {!info.error && info.warnings.length > 0 && <Icon name="warning" className="status-warning" />}
                {!c.suppressed && (
                  <button
                    className={c.hidden ? 'vis-toggle' : 'vis-toggle shown'}
                    data-eye={c.id}
                    title={c.hidden ? t('tree.show') : t('tree.hide')}
                    aria-label={c.hidden ? t('tree.show') : t('tree.hide')}
                    onClick={(e) => {
                      e.stopPropagation();
                      a?.setComponentState([c.id], 'hidden', !c.hidden);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <Icon name={c.hidden ? 'eyeOff' : 'eye'} />
                  </button>
                )}
              </li>
              {sub &&
                opened.has(c.id) &&
                a?.subComponents(c.id).map((s) => (
                  <li key={s.path.join('/')} className={`tree-row sub-component ${s.missing ? 'error' : ''}`} style={{ paddingLeft: 16 + 14 * s.depth }} title={t('subassembly.insideTip')}>
                    <Icon name={s.assembly ? 'assembly' : 'part'} />
                    <span className="name">{s.name}</span>
                    {s.missing && <Icon name="error" className="status-error" />}
                  </li>
                ))}
              {!sub && expandable && opened.has(c.id) && partRows(c)}
            </Fragment>
          );
        })}
        {shownPatterns.map((p) => {
          const problem = a?.patternProblems().get(p.id);
          const seedName = nameOf(p.seed);
          const n = p.kind === 'mirror' ? 1 : componentPatternLabels(p).length - (p.skip?.length ?? 0);
          return (
            <li
              key={p.id}
              data-pattern-row={p.id}
              className={`tree-row pattern ${asm.selected === p.id ? 'selected' : ''} ${problem ? 'error' : ''}`}
              title={problem ?? t('pattern.instances', { n })}
              onClick={() => select(p.id)}
              onDoubleClick={() => a?.editPattern(p.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                select(p.id);
                setMenu({ x: e.clientX, y: e.clientY, pattern: p });
              }}
            >
              <Icon name="assembly" />
              <span className="name">{t('pattern.treeRow', { name: p.name, seed: seedName })}</span>
              {problem && <Icon name="error" className="status-error" />}
            </li>
          );
        })}
        {shownExplodeSteps.length > 0 && (
          <li className="tree-row folder" data-explode-folder title={asm.exploded ? t('explode.collapse') : t('explode.explode')} onClick={() => a?.setExploded(!asm.exploded)}>
            <Icon name="assembly" />
            <span className="name">
              {t('explode.title')}
              {(asm.doc.explosions?.length ?? 0) > 1 ? t('explode.viewTag', { name: activeExplosion(asm.doc)?.name ?? '' }) : ''} {asm.exploded ? '▾' : '▸'}
            </span>
          </li>
        )}
        {shownExplodeSteps.map((s) => {
          const problem = a?.explodeProblems().get(s.id);
          return (
            <li
              key={s.id}
              data-explode-row={s.id}
              className={`tree-row pattern ${asm.selected === s.id ? 'selected' : ''} ${problem ? 'error' : ''}`}
              title={problem ?? t('explode.stepSummary', { components: s.components.map(nameOf).join(', '), distance: s.distance })}
              style={{ paddingLeft: 24 }}
              onClick={() => select(s.id)}
              onDoubleClick={() => a?.editExplodeStep(s.id)}
            >
              <span className="name">{s.name}</span>
              {problem && <Icon name="error" className="status-error" />}
            </li>
          );
        })}
        {(!needle || shownMates.length > 0) && (
          <li className={`tree-row folder ${errors ? 'error' : ''}`} onClick={() => setMatesOpen((o) => !o)} title={errors ? `${errors} 個結合有錯誤` : undefined}>
            <Icon name="mates" />
            <span className="name">結合</span>
            {errors > 0 && <Icon name="error" className="status-error" />}
          </li>
        )}
        {matesOpen &&
          shownMates.map((m) => {
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

      {menu && a && 'component' in menu && <ComponentMenu x={menu.x} y={menu.y} component={menu.component} onClose={() => setMenu(null)} />}
      {menu && a && !('component' in menu) && (
        <ContextMenu x={menu.x} y={menu.y} onPointerDown={(e) => e.stopPropagation()}>
          {'pattern' in menu ? (
            <>
              <li onClick={act(() => a.editPattern(menu.pattern.id))}>{t('pattern.edit')}</li>
              <li onClick={act(() => a.deletePatterns([menu.pattern.id]))}>{t('pattern.delete')}</li>
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
        </ContextMenu>
      )}
    </div>
  );
}
