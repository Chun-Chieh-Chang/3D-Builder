import { t } from '@3db/i18n';
import type { ThicknessClass, ThicknessSpot } from '@3db/kernel';
import { THICKNESS_COLORS } from '../state/analysis';
import { store, thicknessLimits, useStore } from '../state/store';

const CLASSES: Exclude<ThicknessClass, 'unknown'>[] = ['thin', 'ok', 'thick', 'open'];
const area = (v: number) => String(Math.round(v * 100) / 100);
/** mm to a hundredth, without trailing zeros; "+ 0" turns −0 into 0. */
const mm = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100 + 0) : '–');

/**
 * The 「厚度分析」 window in the graphics area (E3.5): the least and greatest wall thickness asked for, what the faces come to (too thin, within the limits, too thick,
 * nothing on the other side; their colors are on the model), where the thinnest and the thickest place are, and every face with its least, median and greatest
 * thickness. It is worked out again when the model changes. Nothing of it is saved with the part.
 */
export function ThicknessPanel() {
  const analysis = useStore((s) => s.thickness);
  // (a selector that makes a new array each time makes React render for ever)
  const names = useStore((s) => s.result?.faceNames);
  const faceNames = names ?? [];
  if (!analysis) return null;
  const { report, error, status } = analysis;
  const valid = thicknessLimits(analysis.least, analysis.greatest) !== null;
  const spot = (label: string, s: ThicknessSpot | null, field: string) => (
    <p data-field={field}>
      {label}:{' '}
      {s ? t('thicknessAnalysis.spot', { thickness: mm(s.thickness), x: mm(s.point[0]), y: mm(s.point[1]), z: mm(s.point[2]), face: faceNames[s.face] ?? s.face + 1 }) : t('thicknessAnalysis.none')}
    </p>
  );
  return (
    <div className="measure-panel draft-panel" role="region" aria-label={t('thicknessAnalysis.title')} data-thickness>
      <div className="measure-head">
        <strong>{t('thicknessAnalysis.title')}</strong>
        <span className="spacer" />
        <button className="primary" onClick={() => store.stopThickness()}>
          {t('thicknessAnalysis.done')}
        </button>
      </div>
      <label className="pm-row">
        <span>{t('thicknessAnalysis.least')}</span>
        <input data-field="least" className={valid ? '' : 'invalid'} value={analysis.least} onChange={(e) => store.setThicknessLimits(e.target.value, analysis.greatest)} />
      </label>
      <label className="pm-row">
        <span>{t('thicknessAnalysis.greatest')}</span>
        <input data-field="greatest" className={valid ? '' : 'invalid'} value={analysis.greatest} onChange={(e) => store.setThicknessLimits(analysis.least, e.target.value)} />
      </label>
      {!valid && <p className="error">{t('thicknessAnalysis.badLimits')}</p>}
      {status === 'running' && !report && <p className="muted">{t('thicknessAnalysis.running')}</p>}
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
                    <span className="swatch" style={{ background: THICKNESS_COLORS[k], display: 'inline-block', width: 10, height: 10, marginRight: 6 }} />
                    {t(`thicknessAnalysis.class.${k}`)}
                  </td>
                  <td data-field="faces">{report.totals[k].faces}</td>
                  <td data-field="area">{area(report.totals[k].area)}</td>
                </tr>
              ))}
              {report.totals.unknown.faces > 0 && (
                <tr data-class="unknown">
                  <td>{t('thicknessAnalysis.class.unknown')}</td>
                  <td>{report.totals.unknown.faces}</td>
                  <td>{area(report.totals.unknown.area)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {spot(t('thicknessAnalysis.thinnest'), report.thinnest, 'thinnest')}
          {spot(t('thicknessAnalysis.thickest'), report.thickest, 'thickest')}
          <details>
            <summary>{t('thicknessAnalysis.faceList')}</summary>
            <table className="eq-table" data-field="faceList">
              <tbody>
                {report.faces.map((f) => (
                  <tr key={f.face} data-class={f.kind} onClick={() => faceNames[f.face] && store.selectFace({ kind: 'face', name: faceNames[f.face]! })}>
                    <td title={faceNames[f.face]}>{faceNames[f.face] ?? f.face + 1}</td>
                    <td>{t(`thicknessAnalysis.class.${f.kind}`)}</td>
                    <td>{f.kind === 'unknown' || f.kind === 'open' ? '–' : `${mm(f.min)} / ${mm(f.median)} / ${mm(f.max)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <p className="hint" data-field="stats">
            {t('thicknessAnalysis.stats', { triangles: report.triangles, samples: report.samples, ms: Math.round(report.ms) })}
          </p>
        </>
      )}
      <p className="hint">{t('thicknessAnalysis.hint')}</p>
    </div>
  );
}
