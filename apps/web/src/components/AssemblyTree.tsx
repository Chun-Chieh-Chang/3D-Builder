import { Fragment, useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import { activeExplosion, componentPatternLabels, explosionSteps, joinPath, type Component, type ComponentPattern, type Id, type Mate } from '@3db/model';
import { componentName } from '@3db/io';
import { store, useDocumentName, useStore } from '../state/store';
import type { AssemblyState } from '../state/assembly';
import { DATUM_ITEMS, PART_STAGE_LABEL } from '../strings';
import { Icon } from './Icon';

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

/** A component's context menu (the tree's row, or the component in the graphics area): what to do with it, as SolidWorks offers it. */
export function ComponentMenu({ x, y, component, onClose }: { x: number; y: number; component: Component; onClose: () => void }) {
  const a = store.assembly;
  if (!a) return null;
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <ul className="context-menu" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()} data-component-menu={component.id}>
      <li onClick={act(() => store.openComponentPart(component.id))}>{a.isSubAssembly(component.id) ? t('subassembly.open') : '開啟零件'}</li>
      <li onClick={act(() => void a.browseRelink(component.file))}>重新指定零件檔…</li>
      <li className="separator" />
      {component.fixed ? <li onClick={act(() => a.setFixed([component.id], false))}>浮動</li> : <li onClick={act(() => a.setFixed([component.id], true))}>固定</li>}
      <li className="separator" />
      <li onClick={act(() => a.setComponentState([component.id], 'hidden', !component.hidden))}>{component.hidden ? t('subassembly.show') : t('subassembly.hide')}</li>
      <li onClick={act(() => a.setComponentState([component.id], 'transparent', !component.transparent))}>{component.transparent ? t('subassembly.opaque') : t('subassembly.transparent')}</li>
      <li onClick={act(() => a.setComponentState([component.id], 'suppressed', !component.suppressed))}>{component.suppressed ? t('tree.unsuppress') : t('tree.suppress')}</li>
      <li className="separator" />
      <li onClick={act(() => a.requestDelete([component.id]))}>刪除…</li>
    </ul>
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
  const [menu, setMenu] = useState<Menu | null>(null);
  const [matesOpen, setMatesOpen] = useState(true);
  const returnTo = useStore((s) => s.returnTo);
  /** Sub-assemblies shown opened, by component id. */
  const [opened, setOpened] = useState<Set<Id>>(new Set());

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
      {returnTo && (
        <button className="return-bar" onClick={() => store.returnToAssembly()} title={t('tree.returnTip')}>
          <Icon name="assembly" />
          {t('tree.returnTo', { name: returnTo })}
        </button>
      )}
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
          const sub = !!a?.isSubAssembly(c.id);
          return (
            <Fragment key={c.id}>
              <li
                data-component-row={c.id}
                className={`tree-row ${asm.selected === c.id ? 'selected' : ''} ${info.error ? 'error' : ''} ${info.loading ? 'loading' : ''} ${c.suppressed ? 'suppressed' : ''} ${c.hidden ? 'hidden-component' : ''}`}
                title={tip}
                onClick={() => select(c.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  select(c.id);
                  setMenu({ x: e.clientX, y: e.clientY, component: c });
                }}
              >
                {sub && (
                  <span
                    className="twisty"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpened((s) => new Set(s.has(c.id) ? [...s].filter((x) => x !== c.id) : [...s, c.id]));
                    }}
                  >
                    {opened.has(c.id) ? '▾' : '▸'}
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
            </Fragment>
          );
        })}
        {(asm.doc.patterns ?? []).map((p) => {
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
        {explosionSteps(asm.doc).length > 0 && (
          <li className="tree-row folder" data-explode-folder title={asm.exploded ? t('explode.collapse') : t('explode.explode')} onClick={() => a?.setExploded(!asm.exploded)}>
            <Icon name="assembly" />
            <span className="name">
              {t('explode.title')}
              {(asm.doc.explosions?.length ?? 0) > 1 ? t('explode.viewTag', { name: activeExplosion(asm.doc)?.name ?? '' }) : ''} {asm.exploded ? '▾' : '▸'}
            </span>
          </li>
        )}
        {explosionSteps(asm.doc).map((s) => {
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

      {menu && a && 'component' in menu && <ComponentMenu x={menu.x} y={menu.y} component={menu.component} onClose={() => setMenu(null)} />}
      {menu && a && !('component' in menu) && (
        <ul className="context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
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
        </ul>
      )}
    </div>
  );
}
