import { t } from '@3db/i18n';
import { MIN_INTERFERENCE_VOLUME } from '@3db/model';
import { store, useStore } from '../state/store';
import { INTERFERENCE_OTHERS, pairKey, pairPlace, shownPairs, type InterferenceOthers } from '../state/interferenceView';

/** mm³ to a thousandth, without trailing zeros. */
const num = (v: number) => String(Math.round(v * 1e3) / 1e3 + 0);

/**
 * The window of 「干涉檢查」 (E2.1, ADR 0180): the pairs of components that share volume, biggest first, each with the volume they share and where it is (its
 * centre and the size of its box). The overlaps are drawn red in the view with a numbered ring round each. Choosing a pair (a click, ↑／↓, or its ring in the view)
 * zooms to it, turns its two components see-through and the others as chosen here; a pair can be set aside (「忽略」). It says when the assembly has changed since
 * it was worked out.
 */
export function InterferencePanel() {
  const state = useStore((s) => s.interference);
  const asm = useStore((s) => s.asm);
  if (!state) return null;
  const stale = state.status === 'done' && (state.doc !== asm?.doc || state.solution !== asm?.solution);
  const ignored = new Set(state.ignored);
  const listed = shownPairs(state.pairs, state.ignored, state.showIgnored);
  return (
    <div className="measure-panel interference-panel" role="region" aria-label={t('interference.title')} data-interference>
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
      <label className="pm-row checkbox">
        <input type="checkbox" data-field="within" checked={state.within} disabled={state.status === 'running'} onChange={(e) => store.setInterferenceWithin(e.target.checked)} />
        <span>{t('interference.within')}</span>
      </label>
      <label className="pm-row">
        <span>{t('interference.others')}</span>
        <select data-field="others" value={state.others} onChange={(e) => store.setInterferenceOthers(e.target.value as InterferenceOthers)}>
          {INTERFERENCE_OTHERS.map((o) => (
            <option key={o} value={o}>
              {t(`interference.others.${o}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" data-field="showIgnored" checked={state.showIgnored} onChange={(e) => store.setInterferenceShowIgnored(e.target.checked)} />
        <span>{t('interference.showIgnored')}</span>
      </label>
      {state.status === 'running' && <p className="muted" data-field="running">{t('interference.running')}</p>}
      {state.error && <p className="error" data-field="error">{state.error}</p>}
      {stale && <p className="error" data-field="stale">{t('interference.stale')}</p>}
      {state.tooFew && <p className="muted" data-field="tooFew">{t('interference.tooFew')}</p>}
      {state.status === 'done' && !state.tooFew && (
        <>
          <p data-field="summary">{state.pairs.length === 0 ? t('interference.none') : t('interference.found', { n: state.pairs.length })}</p>
          {state.pairs.length > 0 && listed.length === 0 && <p className="hint" data-field="allIgnored">{t('interference.allIgnored')}</p>}
          {listed.length > 0 && (
            <>
              <p className="hint">{t('interference.pick')}</p>
              <table
                className="eq-table"
                data-field="pairs"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  e.preventDefault();
                  e.stopPropagation(); // the arrows turn the view otherwise
                  store.stepInterference(e.key === 'ArrowDown' ? 1 : -1);
                }}
              >
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('interference.pair')}</th>
                    <th>{t('interference.volume')}</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((i) => {
                    const p = state.pairs[i]!;
                    const off = ignored.has(pairKey(p));
                    const place = pairPlace(p);
                    return (
                      <tr key={pairKey(p)} data-pair={i} className={`${state.selected === i ? 'selected' : ''} ${off ? 'ignored' : ''}`} style={{ cursor: 'pointer' }} onClick={() => store.selectInterference(state.selected === i ? null : i)}>
                        <td>{i + 1}</td>
                        <td>
                          <div>
                            {p.aName} × {p.bName}
                            {off && <span className="muted">{t('interference.ignored')}</span>}
                          </div>
                          <div className="muted" data-field="center">
                            {t('interference.center', { xyz: place.center })}
                          </div>
                          <div className="muted" data-field="size">
                            {t('interference.size', { size: place.size })}
                          </div>
                          <div className="interference-actions">
                            <button
                              data-field="zoom"
                              title={t('interference.zoomTip')}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (state.selected === i) store.focusInterference();
                                else store.selectInterference(i);
                              }}
                            >
                              {t('interference.zoom')}
                            </button>
                            <button
                              data-field="ignore"
                              title={t('interference.ignoreTip')}
                              onClick={(e) => {
                                e.stopPropagation();
                                store.ignoreInterference(i, !off);
                              }}
                            >
                              {t(off ? 'interference.unignore' : 'interference.ignore')}
                            </button>
                          </div>
                        </td>
                        <td data-field="volume">{num(p.volume)}</td>
                      </tr>
                    );
                  })}
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
