import { t } from '@3db/i18n';
import { useEffect, useMemo } from 'react';
import { DENOMINATORS, MM_PER_INCH, formatAngle, lengthText, viewMeasure, type MeasureElement, type MeasureOptions, type RoundMode, type Vec3 } from '@3db/model';
import { store, useStore } from '../state/store';

/** mm (or degrees) to ten thousandths, without trailing zeros; "+ 0" turns −0 into 0. */
const num = (v: number) => String(Math.round(v * 1e4) / 1e4 + 0);

/** The way numbers are written in the tables: as they always were in millimetres (no unit), in the unit asked for otherwise. */
function writer(o: MeasureOptions) {
  const length = (mm: number) => (o.unit === 'mm' ? num(mm) : lengthText(mm, o));
  const area = (mm2: number) => (o.unit === 'mm' ? num(mm2) : `${num(mm2 / (MM_PER_INCH * MM_PER_INCH))}in²`);
  const angle = (deg: number) => (o.angle === 'deg' ? num(deg) : formatAngle(deg, 'rad'));
  const point = (p: Vec3) => p.map(length).join('  ');
  return { length, area, angle, point };
}

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
  const options = useStore((s) => s.measureOptions);
  const report = measure?.report ?? null;
  const view = useMemo(() => viewMeasure(report, options), [report, options]);
  // what is measured is drawn on the model, as eDrawings does: the lines, the distances along the axes, the labels
  const drawing = measure ? view.drawing : null;
  useEffect(() => {
    store.viewer?.setMeasureGraphics(drawing);
    return () => store.viewer?.setMeasureGraphics(null);
  }, [drawing]);
  if (!measure) return null;
  const { picks, error } = measure;
  const w = writer(options);
  const set = (patch: Partial<MeasureOptions>) => store.setMeasureOptions(patch);
  const rounds = report?.round ? view.modes : [];
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
      <div className="measure-options" data-measure-options>
        <label>
          <span>{t('measure.lengthUnit')}</span>
          <select data-field="lengthUnit" value={options.unit} onChange={(e) => set({ unit: e.target.value === 'in' ? 'in' : 'mm' })}>
            <option value="mm">{t('measure.unit.mm')}</option>
            <option value="in">{t('measure.unit.in')}</option>
          </select>
        </label>
        {options.unit === 'in' && (
          <>
            <label className="check">
              <input type="checkbox" data-field="fraction" checked={options.fraction} onChange={(e) => set({ fraction: e.target.checked })} />
              <span>{t('measure.fraction')}</span>
            </label>
            {options.fraction && (
              <>
                <label>
                  <span>{t('measure.denominator')}</span>
                  <select data-field="denominator" value={options.denominator} onChange={(e) => set({ denominator: Number(e.target.value) })}>
                    {DENOMINATORS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" data-field="nearest" checked={options.nearest} onChange={(e) => set({ nearest: e.target.checked })} />
                  <span>{t('measure.nearest')}</span>
                </label>
              </>
            )}
          </>
        )}
        <label>
          <span>{t('measure.angleUnit')}</span>
          <select data-field="angleUnit" value={options.angle} onChange={(e) => set({ angle: e.target.value === 'rad' ? 'rad' : 'deg' })}>
            <option value="deg">{t('measure.angleUnit.deg')}</option>
            <option value="rad">{t('measure.angleUnit.rad')}</option>
          </select>
        </label>
        <label className={rounds.length === 0 ? 'off' : ''} title={report?.round && !report.round.max ? t('measure.roundMaxNone') : undefined}>
          <span>{t('measure.roundTitle')}</span>
          <select data-field="roundMode" disabled={rounds.length === 0} value={view.mode} onChange={(e) => set({ round: e.target.value as RoundMode })}>
            {(rounds.length === 0 ? (['centre'] as RoundMode[]) : rounds).map((m) => (
              <option key={m} value={m}>
                {t(`measure.round.${m}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {view.text.length > 0 && (
        <div className="measure-result" data-field="result">
          <strong>{t('measure.result')}</strong>
          <pre>{view.text.join('\n')}</pre>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(view.text.join('\n')).then(() => store.notify(t('measure.copied')), () => undefined);
            }}
          >
            {t('measure.copy')}
          </button>
        </div>
      )}
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
                <td data-field="area">{w.area(e.area)}</td>
              </tr>
            )}
            {e.length !== null && (
              <tr>
                <td>{t('measure.length')}</td>
                <td data-field="length">{w.length(e.length)}</td>
              </tr>
            )}
            {e.radius !== null && (
              <>
                <tr>
                  <td>{t('measure.radius')}</td>
                  <td data-field="radius">{w.length(e.radius)}</td>
                </tr>
                <tr>
                  <td>{t('measure.diameter')}</td>
                  <td data-field="diameter">{w.length(2 * e.radius)}</td>
                </tr>
              </>
            )}
            <tr>
              <td>{t('measure.point')}</td>
              <td data-field="point">{w.point(e.point)}</td>
            </tr>
          </tbody>
        </table>
      ))}
      {report?.distance && (
        <table className="eq-table" data-field="between">
          <tbody>
            <tr>
              <td>{t('measure.distance')}</td>
              <td data-field="distance">{w.length(report.distance.value)}</td>
            </tr>
            {report.distance.value > 1e-9 && (
              <tr>
                <td>{t('measure.delta')}</td>
                <td data-field="delta">{w.point(report.distance.delta)}</td>
              </tr>
            )}
            {report.angle !== null && (
              <tr>
                <td>{t('measure.angle')}</td>
                <td data-field="angle">{w.angle(report.angle)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {report?.distance && report.distance.value <= 1e-9 && <p className="hint">{t('measure.touching')}</p>}
      <p className="hint">{options.unit === 'mm' && options.angle === 'deg' ? t('measure.unit') : t('measure.unitNote', { unit: options.unit === 'mm' ? 'mm' : 'in', angle: t(`measure.angleUnit.${options.angle}`) })}</p>
      {report?.angle !== null && report?.angle !== undefined && <p className="hint">{t('measure.angleNote')}</p>}
    </div>
  );
}
