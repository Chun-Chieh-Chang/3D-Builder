import { t } from '@3db/i18n';
import { formatMass, joinPath, massGrams } from '@3db/model';
import { mateProblem } from './AssemblyTree';
import { loadingText, useLoadingParts } from './LoadProgress';
import { useStore, store } from '../state/store';
import { SKETCH_STATUS_LABEL } from '../strings';

/** Status bar: notices, 「錯誤為何？」 (D7.1), sketch status (C1.31), rebuild time, volume, unit system. */
export function StatusBar() {
  const notice = useStore((s) => s.notice);
  const result = useStore((s) => s.result);
  const rebuilding = useStore((s) => s.rebuilding);
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selected);
  const editing = useStore((s) => s.editing);
  const sketchSolve = useStore((s) => s.sketchSolve);
  const bootMs = useStore((s) => s.bootMs);
  const asm = useStore((s) => s.asm);
  const loadingParts = useLoadingParts();

  if (asm) {
    // The part files the assembly uses (not a part only looked at in 「插入零組件」).
    const statuses = asm.doc.files.map((f) => asm.files.get(joinPath(asm.folder, f.path)));
    const loading = statuses.filter((s) => !s || s.status === 'loading').length;
    const missing = statuses.filter((s) => s?.status === 'missing' || s?.status === 'error').length;
    const mateErrors = asm.doc.mates.filter((m) => mateProblem(asm, m)).length;
    // The assembly as SolidWorks' status bar says it: over-defined, under-defined or fully defined.
    const states = [...(asm.solution?.components.values() ?? [])].map((c) => c.status);
    const definition = !asm.solution || asm.doc.components.length === 0 ? null : states.includes('over') ? { text: t('sketchStatus.over'), cls: 'over' } : states.includes('under') ? { text: t('sketchStatus.under'), cls: 'under' } : { text: t('sketchStatus.fully'), cls: 'fully' };
    return (
      <footer className="status-bar">
        <span className={`notice ${notice?.kind ?? ''}`} onClick={() => store.dismissNotice()}>
          {notice?.text ?? t('status.ready')}
        </span>
        {mateErrors > 0 && (
          <button className="whats-wrong-button error" onClick={() => store.showWhatsWrong(true)} title={t('status.listMateErrors')}>
            {t('status.whatsWrong', { what: t('status.mateErrors', { n: mateErrors }) })}
          </button>
        )}
        {missing > 0 && (
          <button className="whats-wrong-button error" onClick={() => void store.assembly?.openRelink()} title={t('status.relink')}>
            {t('status.missing', { n: missing })}
          </button>
        )}
        <span>
          {loading > 0
            ? loadingParts[0]
              ? t('status.loadingOne', { name: loadingParts[0].name, stage: loadingText(loadingParts[0]), more: loading > 1 ? t('status.loadingMore', { n: loading }) : '' })
              : t('status.loadingParts', { n: loading })
            : t('status.components', { n: asm.doc.components.length })}
        </span>
        {definition && <span className={`sketch-status ${definition.cls}`}>{definition.text}</span>}
        {bootMs && <span className="muted">{t('status.coreLoaded', { ms: Math.round(bootMs.occtMs) })}</span>}
        <span className="units">MMGS</span>
      </footer>
    );
  }

  // Inside a sketch its live solve is the status; otherwise the selected (or first) sketch of the last rebuild.
  const sketchId = [editing?.featureId, selected, ...doc.features.map((f) => f.id)].find((id) => id && doc.features.find((f) => f.id === id)?.type === 'sketch');
  const sketch = editing?.kind === 'sketch' ? sketchSolve : result?.features.find((f) => f.id === sketchId)?.sketch;
  const errors = result?.features.filter((f) => f.status === 'error').length ?? 0;
  const warnings = result?.features.filter((f) => f.status === 'ok' && f.warnings?.length).length ?? 0;
  const editingName = editing?.kind === 'sketch' ? doc.features.find((f) => f.id === editing.featureId)?.name : undefined;

  return (
    <footer className="status-bar">
      <span className={`notice ${notice?.kind ?? ''}`} onClick={() => store.dismissNotice()}>
        {notice?.text ?? (editingName ? t('status.editing', { name: editingName }) : t('status.ready'))}
      </span>
      {(errors > 0 || warnings > 0) && (
        <button className={`whats-wrong-button ${errors > 0 ? 'error' : 'warning'}`} onClick={() => store.showWhatsWrong(true)} title={t('status.listAll')}>
          {t('status.whatsWrong', { what: [errors > 0 && t('status.errors', { n: errors }), warnings > 0 && t('status.warnings', { n: warnings })].filter(Boolean).join(t('cmd.listSeparator')) })}
        </button>
      )}
      {sketch && (
        <span className={`sketch-status ${sketch.status}`}>
          {SKETCH_STATUS_LABEL[sketch.status]}
          {editing?.kind === 'sketch' && sketch.status === 'under' ? `(${sketch.dof})` : ''}
        </span>
      )}
      {result?.mass && editing?.kind !== 'sketch' && <span>{t('status.volume', { value: result.mass.volume.toFixed(3) })}</span>}
      {result?.mass && doc.material && editing?.kind !== 'sketch' && (
        <span title={`${doc.material.name}  ${doc.material.density} g/cm³`}>{t('material.mass')} {formatMass(massGrams(result.mass.volume, doc.material.density))}</span>
      )}
      <span>{rebuilding ? t('status.rebuilding') : result ? t('status.rebuilt', { ms: result.totalMs.toFixed(1) }) : ''}</span>
      {bootMs && <span className="muted">{t('status.coreLoaded', { ms: Math.round(bootMs.occtMs) })}</span>}
      <span className="units">MMGS</span>
    </footer>
  );
}
