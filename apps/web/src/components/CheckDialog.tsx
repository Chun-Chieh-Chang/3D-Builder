import { t } from '@3db/i18n';
import type { GeometryReport } from '@3db/kernel';
import { store, useStore } from '../state/store';

/** What counts as a problem (E3.1): the shape fails the validity check, its skin is open, or it has no volume. */
export const geometryProblem = (r: GeometryReport): boolean => !r.valid || r.freeEdges > 0 || !(r.volume > 0) || r.badFaces.length > 0;

/**
 * 「檢查幾何」 (E3.1): the kernel's check of the open part, or of every part file of the open assembly: valid or not, solids, faces, faces that fail,
 * open edges and the volume. It is worked out when the dialog opens.
 */
export function CheckDialog() {
  const state = useStore((s) => s.check);
  if (!state) return null;
  const close = () => store.stopCheck();
  const done = state.status === 'done';
  const bad = state.rows.filter((r) => r.report && geometryProblem(r.report)).length;
  const unread = state.rows.filter((r) => !r.report).map((r) => r.name);
  const checked = state.rows.filter((r) => r.report).length;
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide parameters" role="dialog" aria-label={t('check.title')} data-check onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('check.title')}</h3>
        {state.status === 'running' && <p className="muted">{t('check.running')}</p>}
        {state.error && <p className="error" data-field="error">{state.error}</p>}
        {done && state.rows.length === 0 && <p className="muted">{t('check.none')}</p>}
        {done && state.rows.length > 0 && (
          <>
            <div className="shortcut-list">
              <table className="eq-table" data-field="rows">
                <thead>
                  <tr>
                    <th>{t('check.name')}</th>
                    <th>{t('check.status')}</th>
                    <th>{t('check.solids')}</th>
                    <th>{t('check.faces')}</th>
                    <th>{t('check.freeEdges')}</th>
                    <th>{t('check.volume')}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((r, i) => (
                    <tr key={`${r.name}|${i}`}>
                      <td>{r.name}</td>
                      {r.report ? (
                        <>
                          <td data-field="status" className={geometryProblem(r.report) ? 'error' : ''}>
                            {geometryProblem(r.report) ? t('check.bad') : t('check.good')}
                            {r.report.badFaces.length > 0 && <div className="hint">{t('check.badList', { list: r.report.badFaces.map((f) => f + 1).join(', ') })}</div>}
                          </td>
                          <td>{r.report.solids}</td>
                          <td>{r.report.faces}</td>
                          <td>{r.report.freeEdges}</td>
                          <td>{Math.round(r.report.volume * 1e3) / 1e3}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="muted">
                          –
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint" data-field="summary">
              {bad === 0 ? t('check.summaryOk', { n: checked }) : t('check.summaryBad', { n: checked, bad })}
            </p>
            {unread.length > 0 && <p className="hint">{t('check.notRead', { names: unread.join(', ') })}</p>}
          </>
        )}
        <p className="hint">{t('check.hint')}</p>
        <div className="modal-actions">
          <button className="primary" onClick={close}>
            {t('interference.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
