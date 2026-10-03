import { t } from '@3db/i18n';
import type { UndercutClass } from '@3db/kernel';
import { UNDERCUT_COLORS } from '../state/analysis';
import { store, useStore } from '../state/store';
import { PullControls } from './PullControls';

const CLASSES: Exclude<UndercutClass, 'unknown'>[] = ['undercut', 'partial', 'split', 'up', 'down', 'both'];
const area = (v: number) => String(Math.round(v * 100) / 100);
const percent = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '–');

/**
 * The 「底切分析」 window in the graphics area (E3.3): the direction the mold opens along, how the faces come to in each class by what can be seen of them from either end
 * (their colors are on the model), the area that is an undercut, and every face with its shares. It is worked out again when the model changes. Nothing of it is saved.
 */
export function UndercutPanel() {
  const undercut = useStore((s) => s.undercut);
  // (a selector that makes a new array each time makes React render for ever)
  const names = useStore((s) => s.result?.faceNames);
  const faceNames = names ?? [];
  if (!undercut) return null;
  const { report, error, status } = undercut;
  return (
    <div className="measure-panel draft-panel" role="region" aria-label={t('undercutAnalysis.title')} data-undercut>
      <div className="measure-head">
        <strong>{t('undercutAnalysis.title')}</strong>
        <span className="spacer" />
        <button className="primary" onClick={() => store.stopUndercut()}>
          {t('undercutAnalysis.done')}
        </button>
      </div>
      <PullControls pull={undercut.pull} label={undercut.label} onPull={(pull, label) => store.setUndercutPull(pull, label)} />
      {status === 'running' && !report && <p className="muted">{t('undercutAnalysis.running')}</p>}
      {error && <p className="error" data-field="error">{error}</p>}
      {report && (
        <>
          <table className="eq-table" data-field="totals">
            <thead>
              <tr>
                <th>{''}</th>
                <th>{t('draftAnalysis.facesColumn')}</th>
                <th>{t('draftAnalysis.areaColumn')}</th>
              </tr>
            </thead>
            <tbody>
              {CLASSES.map((k) => (
                <tr key={k} data-class={k}>
                  <td>
                    <span className="swatch" style={{ background: UNDERCUT_COLORS[k], display: 'inline-block', width: 10, height: 10, marginRight: 6 }} />
                    {t(`undercutAnalysis.class.${k}`)}
                  </td>
                  <td data-field="faces">{report.totals[k].faces}</td>
                  <td data-field="area">{area(report.totals[k].area)}</td>
                </tr>
              ))}
              {report.totals.unknown.faces > 0 && (
                <tr data-class="unknown">
                  <td>{t('undercutAnalysis.class.unknown')}</td>
                  <td>{report.totals.unknown.faces}</td>
                  <td>{area(report.totals.unknown.area)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p data-field="undercutArea">
            {t('undercutAnalysis.undercutArea')}: <strong>{area(report.undercutArea)}</strong>
          </p>
          <details>
            <summary>{t('undercutAnalysis.faceList')}</summary>
            <table className="eq-table" data-field="faceList">
              <tbody>
                {report.faces.map((f) => (
                  <tr key={f.face} data-class={f.kind} onClick={() => faceNames[f.face] && store.selectFace({ kind: 'face', name: faceNames[f.face]! })}>
                    <td title={faceNames[f.face]}>{faceNames[f.face] ?? f.face + 1}</td>
                    <td>{t(`undercutAnalysis.class.${f.kind}`)}</td>
                    <td>{`${percent(f.up)} / ${percent(f.down)} / ${percent(f.blocked)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="hint" data-field="stats">
            {t('undercutAnalysis.stats', { triangles: report.triangles, samples: report.samples, ms: Math.round(report.ms) })}
          </p>
        </>
      )}
      <p className="hint">{t('undercutAnalysis.hint')}</p>
    </div>
  );
}
