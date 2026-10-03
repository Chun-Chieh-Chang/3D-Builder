import { t } from '@3db/i18n';
import type { DraftClass } from '@3db/kernel';
import type { Vec3 } from '@3db/model';
import { DRAFT_COLORS } from '../state/analysis';
import { store, useStore } from '../state/store';

const CLASSES: Exclude<DraftClass, 'unknown'>[] = ['positive', 'negative', 'required', 'straddle'];
const AXES: { id: string; label: string; dir: Vec3 }[] = [
  { id: '+z', label: '+Z', dir: [0, 0, 1] },
  { id: '-z', label: '−Z', dir: [0, 0, -1] },
  { id: '+y', label: '+Y', dir: [0, 1, 0] },
  { id: '-y', label: '−Y', dir: [0, -1, 0] },
  { id: '+x', label: '+X', dir: [1, 0, 0] },
  { id: '-x', label: '−X', dir: [-1, 0, 0] },
];
/** Degrees to a hundredth, without trailing zeros; "+ 0" turns −0 into 0. */
const deg = (rad: number) => String(Math.round(((rad * 180) / Math.PI) * 100) / 100 + 0);
const area = (v: number) => String(Math.round(v * 100) / 100);

/**
 * The 「拔模分析」 window in the graphics area (E3.2): the direction the mold opens along (an axis, or the normal of a planar face picked in the view), the draft angle
 * asked for, what the faces come to in each of the four classes (their colors are on the model), and every face with its least and greatest angle. It is worked out
 * again when the model changes. Nothing of it is saved with the part.
 */
export function DraftPanel() {
  const draft = useStore((s) => s.draft);
  const selected = useStore((s) => s.selectedFace);
  // (a selector that makes a new array each time makes React render for ever)
  const names = useStore((s) => s.result?.faceNames);
  const faceNames = names ?? [];
  if (!draft) return null;
  const { report, error, status } = draft;
  const axis = AXES.find((a) => a.dir.every((v, i) => v === draft.pull[i]));
  const plane = selected?.kind === 'face' && selected.fingerprint?.type === 'plane' && selected.fingerprint.dir ? selected : null;
  const valid = Number.isFinite(Number(draft.required)) && draft.required.trim() !== '' && Number(draft.required) >= 0;
  return (
    <div className="measure-panel draft-panel" role="region" aria-label={t('draftAnalysis.title')} data-draft>
      <div className="measure-head">
        <strong>{t('draftAnalysis.title')}</strong>
        <span className="spacer" />
        <button className="primary" onClick={() => store.stopDraft()}>
          {t('draftAnalysis.done')}
        </button>
      </div>
      <label className="pm-row">
        <span>{t('draftAnalysis.direction')}</span>
        <select value={axis?.id ?? 'face'} onChange={(e) => AXES.some((a) => a.id === e.target.value) && store.setDraftPull(AXES.find((a) => a.id === e.target.value)!.dir, e.target.value)}>
          {!axis && <option value="face">{draft.label}</option>}
          {AXES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <div className="pm-row">
        <button disabled={!plane} title={plane ? '' : t('draftAnalysis.noPlane')} onClick={() => plane && store.setDraftPull(plane.fingerprint!.dir as Vec3, t('draftAnalysis.faceDirection', { name: plane.name }))}>
          {t('draftAnalysis.useFace')}
        </button>
        <button onClick={() => store.setDraftPull([-draft.pull[0], -draft.pull[1], -draft.pull[2]], draft.label)}>{t('draftAnalysis.flip')}</button>
      </div>
      <label className="pm-row">
        <span>{t('draftAnalysis.required')}</span>
        <input data-field="required" className={valid ? '' : 'invalid'} value={draft.required} onChange={(e) => store.setDraftRequired(e.target.value)} />
      </label>
      {!valid && <p className="error">{t('draftAnalysis.badAngle')}</p>}
      {status === 'running' && !report && <p className="muted">{t('draftAnalysis.running')}</p>}
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
                    <span className="swatch" style={{ background: DRAFT_COLORS[k], display: 'inline-block', width: 10, height: 10, marginRight: 6 }} />
                    {t(`draftAnalysis.class.${k}`)}
                  </td>
                  <td data-field="faces">{report.totals[k].faces}</td>
                  <td data-field="area">{area(report.totals[k].area)}</td>
                </tr>
              ))}
              {report.totals.unknown.faces > 0 && (
                <tr data-class="unknown">
                  <td>{t('draftAnalysis.class.unknown')}</td>
                  <td>{report.totals.unknown.faces}</td>
                  <td>{area(report.totals.unknown.area)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <details>
            <summary>{t('draftAnalysis.faceList')}</summary>
            <table className="eq-table" data-field="faceList">
              <tbody>
                {report.faces.map((f) => (
                  <tr key={f.face} data-class={f.kind} onClick={() => faceNames[f.face] && store.selectFace({ kind: 'face', name: faceNames[f.face]! })}>
                    <td title={faceNames[f.face]}>{faceNames[f.face] ?? f.face + 1}</td>
                    <td>{t(`draftAnalysis.class.${f.kind}`)}</td>
                    <td>{f.kind === 'unknown' ? '–' : f.min === f.max || deg(f.min) === deg(f.max) ? deg(f.min) : `${deg(f.min)} … ${deg(f.max)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      <p className="hint">{t('draftAnalysis.hint')}</p>
    </div>
  );
}
