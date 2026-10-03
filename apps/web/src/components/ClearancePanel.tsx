import { t } from '@3db/i18n';
import { store, SWEEP_DIRECTIONS, useStore } from '../state/store';

/** mm to a thousandth, without trailing zeros. */
const num = (v: number) => String(Math.round(v * 1e3) / 1e3 + 0);

/**
 * The window of 「餘隙確認」 (E2.2): the pairs of components closer than the least clearance, the closest first, with their distance; a pair chosen in the
 * list has its two components selected. Below it, room to take the selected component out along a direction: how far it moves before it meets another.
 * It says when the assembly has changed since the check was worked out.
 */
export function ClearancePanel() {
  const state = useStore((s) => s.clearance);
  const asm = useStore((s) => s.asm);
  if (!state) return null;
  const stale = state.status === 'done' && (state.doc !== asm?.doc || state.solution !== asm?.solution);
  const least = Number(state.least);
  return (
    <div className="measure-panel" role="region" aria-label={t('clearance.title')} data-clearance>
      <div className="measure-head">
        <strong>{t('clearance.title')}</strong>
        <span className="spacer" />
        <button disabled={state.status === 'running'} onClick={() => void store.runClearance()}>
          {t('clearance.run')}
        </button>
        <button className="primary" onClick={() => store.stopClearance()}>
          {t('clearance.close')}
        </button>
      </div>
      <label className="pm-row">
        <span>{t('clearance.least')}</span>
        <input data-field="least" value={state.least} onChange={(e) => store.setClearanceLeast(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? void store.runClearance() : e.stopPropagation())} />
      </label>
      {state.status === 'running' && <p className="muted" data-field="running">{t('clearance.running')}</p>}
      {state.error && <p className="error" data-field="error">{state.error}</p>}
      {stale && <p className="error" data-field="stale">{t('clearance.stale')}</p>}
      {state.tooFew && <p className="muted" data-field="tooFew">{t('clearance.tooFew')}</p>}
      {state.status === 'done' && !state.tooFew && (
        <>
          <p data-field="summary">{state.pairs.length === 0 ? t('clearance.none', { least: num(least) }) : t('clearance.found', { n: state.pairs.length, least: num(least) })}</p>
          {state.pairs.length > 0 && (
            <table className="eq-table" data-field="pairs">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('clearance.distance')}</th>
                </tr>
              </thead>
              <tbody>
                {state.pairs.map((p, i) => (
                  <tr key={`${p.a}|${p.b}`} className={state.selected === i ? 'selected' : ''} style={{ cursor: 'pointer' }} onClick={() => store.selectClearance(state.selected === i ? null : i)}>
                    <td title={t('clearance.at', { x: num(p.at[0]), y: num(p.at[1]), z: num(p.at[2]) })}>
                      {p.aName} × {p.bName}
                    </td>
                    <td data-field="distance">{p.interferes ? t('clearance.interferes') : p.distance < 1e-9 ? t('clearance.touch') : num(p.distance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {state.unknown.length > 0 && <p className="hint" data-field="unknown">{t('clearance.unknown', { names: state.unknown.join(', ') })}</p>}
          {state.failed.length > 0 && <p className="error" data-field="failed">{t('clearance.failed', { pairs: state.failed.join(', ') })}</p>}
          <p className="hint">{t('clearance.checked', { pairs: state.checked, ms: state.ms })}</p>
        </>
      )}
      <hr />
      <strong>{t('clearance.sweep')}</strong>
      <p className="hint">{t('clearance.sweepHint')}</p>
      <label className="pm-row">
        <span>{t('clearance.sweepDir')}</span>
        <select data-field="sweepDir" value={state.sweep.dir} onChange={(e) => store.setSweep({ dir: e.target.value as (typeof SWEEP_DIRECTIONS)[number] })}>
          {SWEEP_DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="pm-row">
        <span>{t('clearance.sweepLength')}</span>
        <input data-field="sweepLength" value={state.sweep.length} onChange={(e) => store.setSweep({ length: e.target.value })} onKeyDown={(e) => (e.key === 'Enter' ? void store.runSweep() : e.stopPropagation())} />
      </label>
      <button disabled={state.sweep.status === 'running'} onClick={() => void store.runSweep()}>
        {t('clearance.sweepRun')}
      </button>
      {state.sweep.text && (
        <p className={state.sweep.status === 'error' ? 'error' : state.sweep.blocked ? 'hint' : 'muted'} data-field="sweepResult">
          {state.sweep.text}
        </p>
      )}
      <p className="hint">{t('clearance.note')}</p>
    </div>
  );
}
