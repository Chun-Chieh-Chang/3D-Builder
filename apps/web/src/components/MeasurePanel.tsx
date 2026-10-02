import { t } from '@3db/i18n';
import type { MeasureElement, Vec3 } from '@3db/model';
import { store, useStore } from '../state/store';

/** mm (or degrees) to ten thousandths, without trailing zeros; "+ 0" turns −0 into 0. */
const num = (v: number) => String(Math.round(v * 1e4) / 1e4 + 0);
const point = (p: Vec3) => p.map(num).join('  ');

/** What kind of face, edge or vertex it is, in words. */
function typeName(e: MeasureElement): string {
  if (e.kind === 'vertex') return t('measure.type.point');
  if (e.kind === 'face') {
    const names: Record<string, string> = { plane: t('measure.surface.plane'), cylinder: t('measure.surface.cylinder'), cone: t('measure.surface.cone'), sphere: t('measure.surface.sphere'), torus: t('measure.surface.torus') };
    return names[e.type] ?? t('measure.surface.other');
  }
  const names: Record<string, string> = { line: t('measure.curve.line'), circle: t('measure.curve.circle'), ellipse: t('measure.curve.ellipse') };
  return names[e.type] ?? t('measure.curve.other');
}

/**
 * The 「測量」 tool's window in the graphics area (E1.1): the elements picked, what each is (area, length, radius, position), and for two the shortest
 * distance, the differences along the axes and the angle. It shows what the worker last answered for the picks, and is asked again whenever the model changes.
 */
export function MeasurePanel() {
  const measure = useStore((s) => s.measure);
  if (!measure) return null;
  const { picks, report, error } = measure;
  return (
    <div className="measure-panel" role="region" aria-label={t('measure.title')} data-measure>
      <div className="measure-head">
        <strong>{t('measure.title')}</strong>
        <span className="spacer" />
        <button disabled={picks.length === 0} onClick={() => store.clearMeasure()}>
          {t('measure.reset')}
        </button>
        <button className="primary" onClick={() => store.stopMeasure()}>
          {t('measure.done')}
        </button>
      </div>
      {picks.length === 0 && <p className="muted">{t('measure.prompt')}</p>}
      {error && <p className="error" data-field="error">{error}</p>}
      {report?.elements.map((e, i) => (
        <table className="eq-table" key={i} data-field={`element${i + 1}`}>
          <thead>
            <tr>
              <th colSpan={2}>
                {t('measure.element', { n: i + 1 })}: {picks[i]?.label} ({typeName(e)})
              </th>
            </tr>
          </thead>
          <tbody>
            {e.area !== null && (
              <tr>
                <td>{t('measure.area')}</td>
                <td data-field="area">{num(e.area)}</td>
              </tr>
            )}
            {e.length !== null && (
              <tr>
                <td>{t('measure.length')}</td>
                <td data-field="length">{num(e.length)}</td>
              </tr>
            )}
            {e.radius !== null && (
              <>
                <tr>
                  <td>{t('measure.radius')}</td>
                  <td data-field="radius">{num(e.radius)}</td>
                </tr>
                <tr>
                  <td>{t('measure.diameter')}</td>
                  <td data-field="diameter">{num(2 * e.radius)}</td>
                </tr>
              </>
            )}
            <tr>
              <td>{t('measure.point')}</td>
              <td data-field="point">{point(e.point)}</td>
            </tr>
          </tbody>
        </table>
      ))}
      {report?.distance && (
        <table className="eq-table" data-field="between">
          <tbody>
            <tr>
              <td>{t('measure.distance')}</td>
              <td data-field="distance">{num(report.distance.value)}</td>
            </tr>
            {report.distance.value > 1e-9 && (
              <tr>
                <td>{t('measure.delta')}</td>
                <td data-field="delta">{point(report.distance.delta)}</td>
              </tr>
            )}
            {report.angle !== null && (
              <tr>
                <td>{t('measure.angle')}</td>
                <td data-field="angle">{num(report.angle)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {report?.distance && report.distance.value <= 1e-9 && <p className="hint">{t('measure.touching')}</p>}
      <p className="hint">{t('measure.unit')}</p>
      {report?.angle !== null && report?.angle !== undefined && <p className="hint">{t('measure.angleNote')}</p>}
    </div>
  );
}
