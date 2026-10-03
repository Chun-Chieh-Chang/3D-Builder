import { t } from '@3db/i18n';
import { MIN_INTERFERENCE_VOLUME } from '@3db/model';
import { store, useStore } from '../state/store';

/** mm³ to a thousandth, without trailing zeros. */
const num = (v: number) => String(Math.round(v * 1e3) / 1e3 + 0);

/**
 * The window of 「干涉檢查」 (E2.1): the pairs of components that share volume, biggest first, with the volume they share. The overlaps are drawn
 * red in the view; a pair chosen in the list is shown alone, with its two components selected. It says when the assembly has changed since it was worked out.
 */
export function InterferencePanel() {
  const state = useStore((s) => s.interference);
  const asm = useStore((s) => s.asm);
  if (!state) return null;
  const stale = state.status === 'done' && (state.doc !== asm?.doc || state.solution !== asm?.solution);
  return (
    <div className="measure-panel" role="region" aria-label={t('interference.title')} data-interference>
      <div className="measure-head">
        <strong>{t('interference.title')}</strong>
        <span className="spacer" />
        <button disabled={state.status === 'running'} onClick={() => void store.runInterference()}>
          {t('interference.run')}
        </button>
        <button className="primary" onClick={() => store.stopInterference()}>
          {t('interference.close')}
        </button>
      </div>
      {state.status === 'running' && <p className="muted" data-field="running">{t('interference.running')}</p>}
      {state.error && <p className="error" data-field="error">{state.error}</p>}
      {stale && <p className="error" data-field="stale">{t('interference.stale')}</p>}
      {state.tooFew && <p className="muted" data-field="tooFew">{t('interference.tooFew')}</p>}
      {state.status === 'done' && !state.tooFew && (
        <>
          <p data-field="summary">{state.pairs.length === 0 ? t('interference.none') : t('interference.found', { n: state.pairs.length })}</p>
          {state.pairs.length > 0 && (
            <>
              <table className="eq-table" data-field="pairs">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('interference.volume')}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.pairs.map((p, i) => (
                    <tr key={`${p.a}|${p.b}`} className={state.selected === i ? 'selected' : ''} style={{ cursor: 'pointer' }} onClick={() => store.selectInterference(state.selected === i ? null : i)}>
                      <td>
                        {p.aName} × {p.bName}
                      </td>
                      <td data-field="volume">{num(p.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button disabled={state.selected === null} onClick={() => store.selectInterference(null)}>
                {t('interference.showAll')}
              </button>
            </>
          )}
          {state.unknown.length > 0 && <p className="hint" data-field="unknown">{t('interference.unknown', { names: state.unknown.join(', ') })}</p>}
          {state.failed.length > 0 && <p className="error" data-field="failed">{t('interference.failed', { pairs: state.failed.join(', ') })}</p>}
          <p className="hint">{t('interference.checked', { pairs: state.checked, ms: state.ms })}</p>
        </>
      )}
      <p className="hint">{t('interference.note', { min: MIN_INTERFERENCE_VOLUME })}</p>
    </div>
  );
}
