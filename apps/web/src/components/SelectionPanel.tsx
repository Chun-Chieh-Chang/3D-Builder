import { t } from '@3db/i18n';
import { MATE_LABEL } from '@3db/assembly';
import { ownerFeatures } from '@3db/naming';
import { useState } from 'react';
import { store, useStore } from '../state/store';
import { assemblySelection, partSelection } from '../state/selectionFacts';
import { currentTopicId } from '../help/context';
import { featureLabel } from '../strings';
import { Icon, type IconName } from './Icon';
import { typeName, writer } from './MeasurePanel';
import { componentInfo } from './AssemblyTree';
import { elementLabel } from './MatePanel';
import { PMGroup } from './PMGroup';
import { FeatureParams } from './PropertyManager';
import type { MeasureElement, Ref } from '@3db/model';

/** The word for a picked kind — the 「測量」 tool's words, so the sidebar and the tool say the same thing. */
const kindLabel = (kind: 'face' | 'edge' | 'vertex') => (kind === 'face' ? t('measure.kind.face') : kind === 'edge' ? t('measure.kind.edge') : t('measure.kind.vertex'));

/**
 * The PropertyManager of what is picked with no session open (plan §2.2): a part's pick (its face, edges and vertices, or the tree item), or an
 * assembly's (the component clicked in the view, or a component or mate picked in its tree). Both are the panel a drawing lays out (ADR 0133).
 */
export function SelectionPanel() {
  const assembly = useStore((s) => s.asm);
  return assembly ? <AssemblySelection /> : <PartSelection />;
}

/**
 * The PropertyManager of what is picked in a part with no session open (plan §2.2): the face, the edges and vertices the graphics area was clicked on,
 * or the tree item the FeatureManager has selected — whichever the store keeps. The header says what it is, as a drawing's panel does (ADR 0133); the
 * groups hold what is really known of it: the element's identity (its persistent name and the feature that made it) and its measured numbers, asked of
 * the kernel the same way the 「測量」 tool asks (`store.selectionFacts`, re-asked when the model or the pick changes). A feature picked in the tree also
 * lays out its parameter groups — the same components a session shows, each writing through an immediate command — so the page says what the feature
 * really is before any session is opened for it; a sketch is the exception, its body belongs to the sketch editor. Nothing here is a placeholder: a
 * number the kernel did not answer is a row that is not there, and an element the model no longer has is said so.
 */
function PartSelection() {
  const selected = useStore((s) => s.selected);
  const selectedFace = useStore((s) => s.selectedFace);
  const selectedElements = useStore((s) => s.selectedElements);
  const facts = useStore((s) => s.selectionFacts);
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const options = useStore((s) => s.measureOptions);
  const pick = partSelection(selected, selectedFace, selectedElements);
  const w = writer(options);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // both groups start open, as SolidWorks keeps them; one opened or closed by hand stays so
  const isOpen = (g: string) => open[g] ?? true;
  const toggle = (g: string) => setOpen((m) => ({ ...m, [g]: !isOpen(g) }));
  if (pick.kind === 'none') return null;
  const feature = pick.kind === 'feature' ? doc.features.find((f) => f.id === pick.id) : undefined;
  const rolledBack = feature ? doc.features.indexOf(feature) >= (doc.rollbackIndex ?? doc.features.length) : false;
  // Why the feature cannot be built yet, as the session's PropertyManager says it — but not for a sketch: that one is rebuilt by its own editor.
  const status = feature && feature.type !== 'sketch' ? result?.features.find((r) => r.id === feature.id) : undefined;
  const clear = () => {
    if (pick.kind === 'feature') store.select(null);
    else if (pick.kind === 'face') store.selectFace(null);
    else store.selectElement(null, false);
  };
  /** The picked elements, as the ones the kernel can be asked about (the viewport picks faces, edges and vertices; a datum or a body is a tree item). */
  const elements: (Ref & { kind: 'face' | 'edge' | 'vertex' })[] = (pick.kind === 'face' ? [pick.ref] : pick.kind === 'elements' ? pick.refs : []).filter(
    (r): r is Ref & { kind: 'face' | 'edge' | 'vertex' } => r.kind === 'face' || r.kind === 'edge' || r.kind === 'vertex',
  );
  const head: { icon: IconName; title: string; sub: string } =
    pick.kind === 'feature' && feature
      ? { icon: feature.type, title: t('sel.feature'), sub: feature.name }
      : elements.length === 1
        ? { icon: elements[0]!.kind === 'vertex' ? 'refPoint' : elements[0]!.kind === 'face' ? 'plane' : 'refAxis', title: kindLabel(elements[0]!.kind), sub: elements[0]!.name }
        : { icon: 'refAxis', title: t('sel.elements'), sub: t('sel.count', { n: elements.length }) };
  /** The measured rows of one element, written the way the 「測量」 tool writes them (the same options, the same numbers). */
  const measured = (e: MeasureElement) => (
    <>
      {e.area !== null && (
        <label className="pm-row">
          <span>{t('measure.area')}</span>
          <span data-field="area">{w.area(e.area)}</span>
        </label>
      )}
      {e.length !== null && (
        <label className="pm-row">
          <span>{t('measure.length')}</span>
          <span data-field="length">{w.length(e.length)}</span>
        </label>
      )}
      {e.radius !== null && (
        <>
          <label className="pm-row">
            <span>{t('measure.radius')}</span>
            <span data-field="radius">{w.length(e.radius)}</span>
          </label>
          <label className="pm-row">
            <span>{t('measure.diameter')}</span>
            <span data-field="diameter">{w.length(2 * e.radius)}</span>
          </label>
        </>
      )}
      <label className="pm-row">
        <span>{t('measure.point')}</span>
        <span data-field="point">{w.point(e.point)}</span>
      </label>
    </>
  );
  /** The feature that made the element, by its persistent name (`<feature>:…`), as the tree reads it. */
  const ownerOf = (ref: Ref): string => {
    const owner = ownerFeatures(ref.name)[0];
    return owner ? (doc.features.find((f) => f.id === owner)?.name ?? owner) : '';
  };
  const measuredFacts = facts?.elements ?? [];
  return (
    <div className="property-manager" data-selection-panel data-help={currentTopicId()}>
      <div className="sw-pm-header">
        <Icon name={head.icon} className="sw-pm-icon" />
        <div className="sw-pm-title">
          <strong>{head.title}</strong>
          <span>{head.sub}</span>
        </div>
        <button type="button" className="sw-ok" title={t('sel.clear')} data-action="clearSelection" onClick={clear}>
          <Icon name="ok" />
        </button>
      </div>
      {status?.status === 'error' && <p className="pm-message error-text">{status.message}</p>}
      {pick.kind === 'feature' && feature && (
        <>
          <PMGroup title={t('sel.identity')} icon={feature.type} open={isOpen('identity')} onToggle={() => toggle('identity')} group="identity">
            <label className="pm-row">
              <span>{t('sel.name')}</span>
              <span data-field="name">{feature.name}</span>
            </label>
            <label className="pm-row">
              <span>{t('sel.kind')}</span>
              <span data-field="kind">{featureLabel(feature)}</span>
            </label>
            <label className="pm-row">
              <span>{t('sel.state')}</span>
              <span data-field="state">{feature.suppressed ? t('sel.stateSuppressed') : t('sel.stateNormal')}</span>
            </label>
            <div className="pm-row">
              <button type="button" className="pm-button" data-action="editFeature" disabled={rolledBack} title={rolledBack ? t('tree.rollbackBar') : t('tree.editFeature')} onClick={() => store.beginEdit(feature.id)}>
                {t('sel.editFeature')}
              </button>
            </div>
          </PMGroup>
          <FeatureParams f={feature} />
        </>
      )}
      {(pick.kind === 'face' || pick.kind === 'elements') && (
        <>
          <PMGroup title={t('sel.identity')} icon="datum" open={isOpen('identity')} onToggle={() => toggle('identity')} group="identity">
            {elements.length > 1 && (
              <label className="pm-row">
                <span>{t('sel.kind')}</span>
                <span data-field="count">{t('sel.count', { n: elements.length })}</span>
              </label>
            )}
            {elements.map((ref, i) => (
              <div key={`${ref.kind}:${ref.name}:${i}`}>
                <label className="pm-row">
                  <span>{elements.length > 1 ? kindLabel(ref.kind) : t('sel.name')}</span>
                  <span data-field="name">{ref.name}</span>
                </label>
                <label className="pm-row">
                  <span>{t('sel.owner')}</span>
                  <span data-field="owner">{ownerOf(ref)}</span>
                </label>
              </div>
            ))}
            {(facts?.unresolved ?? []).map((name) => (
              <p key={name} className="error-text" data-field="unresolved">
                {t('sel.unresolved', { name })}
              </p>
            ))}
          </PMGroup>
          <PMGroup title={t('sel.measured')} icon="dimension" open={isOpen('measured')} onToggle={() => toggle('measured')} group="measured">
            {facts?.error && (
              <p className="error-text" data-field="factsError">
                {t('measure.failed', { why: facts.error })}
              </p>
            )}
            {measuredFacts.map((e, i) => (
              <div key={`${facts!.keys[i] ?? i}`}>
                {measuredFacts.length > 1 && (
                  <label className="pm-row">
                    <span>{kindLabel(e.kind)}</span>
                    <span data-field="elementName">{facts!.keys[i] ?? ''}</span>
                  </label>
                )}
                <label className="pm-row">
                  <span>{t('sel.kind')}</span>
                  <span data-field="kind">{typeName(e)}</span>
                </label>
                {measured(e)}
              </div>
            ))}
            {!facts?.error && measuredFacts.length === 0 && (facts?.unresolved.length ?? 0) === 0 && <p className="muted">{t('sel.measuring')}</p>}
          </PMGroup>
        </>
      )}
    </div>
  );
}

/**
 * The PropertyManager of what is picked in an assembly with no session open (plan §2.2): the component clicked in the graphics area (which brought
 * this page forward), or the component or mate the FeatureManager has selected. The header says what it is, as a drawing's panel does (ADR 0133);
 * the group holds what the document really says of it. A component has no parameters of its own here — its shape is its part's business — and a
 * mate is changed in its own session, so nothing here is a placeholder: ✓ lets go of the pick, and 「編輯結合」 opens the mate the way the tree does.
 */
function AssemblySelection() {
  const asm = useStore((s) => s.asm)!;
  const selected = useStore((s) => s.asm?.selected ?? null);
  const viewPick = useStore((s) => s.asm?.viewPick ?? null);
  const pick = assemblySelection(viewPick, selected, asm.doc);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (g: string) => open[g] ?? true;
  const toggle = (g: string) => setOpen((m) => ({ ...m, [g]: !isOpen(g) }));
  if (pick.kind === 'none') return null;
  const component = pick.kind === 'component' ? asm.doc.components.find((c) => c.id === pick.id) : undefined;
  const mate = pick.kind === 'mate' ? asm.doc.mates.find((m) => m.id === pick.id) : undefined;
  if (!component && !mate) return null;
  const info = component ? componentInfo(asm, component) : undefined;
  const head: { icon: IconName; title: string; sub: string } = component
    ? { icon: 'assembly', title: t('sel.component'), sub: info!.name }
    : { icon: 'mates', title: t('sel.mate'), sub: mate!.name };
  const state = component
    ? component.suppressed
      ? t('sel.stateSuppressed')
      : component.fixed
        ? t('sel.stateFixed')
        : t('sel.stateFloating')
    : mate!.suppressed
      ? t('sel.stateSuppressed')
      : t('sel.stateNormal');
  return (
    <div className="property-manager" data-selection-panel data-help={currentTopicId()}>
      <div className="sw-pm-header">
        <Icon name={head.icon} className="sw-pm-icon" />
        <div className="sw-pm-title">
          <strong>{head.title}</strong>
          <span>{head.sub}</span>
        </div>
        <button type="button" className="sw-ok" title={t('sel.clear')} data-action="clearSelection" onClick={() => store.assembly?.select(null)}>
          <Icon name="ok" />
        </button>
      </div>
      <PMGroup title={t('sel.identity')} icon={head.icon} open={isOpen('identity')} onToggle={() => toggle('identity')} group="identity">
        <label className="pm-row">
          <span>{t('sel.name')}</span>
          <span data-field="name">{component ? info!.name : mate!.name}</span>
        </label>
        <label className="pm-row">
          <span>{t('sel.kind')}</span>
          <span data-field="kind">{component ? (store.assembly?.isSubAssembly(component.id) ? t('sel.subassembly') : t('sel.component')) : MATE_LABEL[mate!.type]}</span>
        </label>
        <label className="pm-row">
          <span>{t('sel.state')}</span>
          <span data-field="state">{state}</span>
        </label>
        {info?.path && (
          <label className="pm-row">
            <span>{t('sel.file')}</span>
            <span data-field="file">{info.path}</span>
          </label>
        )}
        {mate && (
          <>
            <label className="pm-row">
              <span>{t('sel.referenceA')}</span>
              <span data-field="referenceA">{elementLabel(asm, mate.a)}</span>
            </label>
            <label className="pm-row">
              <span>{t('sel.referenceB')}</span>
              <span data-field="referenceB">{elementLabel(asm, mate.b)}</span>
            </label>
            <div className="pm-row">
              <button type="button" className="pm-button" data-action="editMate" onClick={() => store.assembly?.editMate(mate.id)}>
                {t('sel.editMate')}
              </button>
            </div>
          </>
        )}
      </PMGroup>
    </div>
  );
}
