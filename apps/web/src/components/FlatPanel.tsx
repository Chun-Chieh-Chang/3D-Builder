import { t } from '@3db/i18n';
import type { FlatSegment } from '@3db/regen';
import { store, useStore } from '../state/store';

const num = (v: number, digits = 3) => String(Math.round(v * 10 ** digits) / 10 ** digits);
const deg = (r: number) => num((r * 180) / Math.PI, 1);

/** The path of an arc from `from` to `to` through `mid`, in the y-up coordinates of the pattern turned into the y-down ones of a picture. */
function arcPath(s: Extract<FlatSegment, { kind: 'arc' }>, y: (v: number) => number): string {
  const ang = (p: [number, number]) => Math.atan2(p[1] - s.c[1], p[0] - s.c[0]);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const [a0, am, a1] = [ang(s.from), ang(s.mid), ang(s.to)];
  const ccw = norm(am - a0) < norm(a1 - a0);
  const sweep = ccw ? norm(a1 - a0) : norm(a0 - a1);
  // y is turned over, so a counter-clockwise arc is clockwise in the picture
  return `M ${s.from[0]} ${y(s.from[1])} A ${s.r} ${s.r} 0 ${sweep > Math.PI ? 1 : 0} ${ccw ? 1 : 0} ${s.to[0]} ${y(s.to[1])}`;
}

/**
 * The 「平板型式」 window in the graphics area (C11.3): the flat pattern of the sheet metal part as it is shown, drawn (the outline in full, the bend lines dashed), its overall size
 * and area, and the bends with their angle, inside radius, direction and allowance. It is worked out again when the model changes. Nothing of it is saved.
 */
/** The manufacturability checks (C11): the three limits, and every check that was made with whether it passed. */
function Checks() {
  const flat = useStore((s) => s.flat);
  if (!flat || (flat.status === 'running' && flat.checks.length === 0)) return null;
  const { checks, limits } = flat;
  const bad = checks.filter((c) => !c.ok);
  const field = (key: 'radius' | 'flange' | 'hole', label: string) => (
    <label className="pm-row">
      <span>{label}</span>
      <input data-limit={key} value={limits[key]} onChange={(e) => store.setFlatLimits({ ...limits, [key]: e.target.value })} style={{ width: '4em' }} />
    </label>
  );
  return (
    <div data-checks>
      <strong>{t('flat.checks')}</strong>
      {field('radius', t('flat.checkRadius'))}
      {field('flange', t('flat.checkFlange'))}
      {field('hole', t('flat.checkHole'))}
      {checks.length === 0 ? (
        <p className="muted">{t('flat.checksNone')}</p>
      ) : (
        <>
          <p data-field="summary">{t('flat.checksSummary', { total: checks.length, ok: checks.length - bad.length, bad: bad.length })}</p>
          <ul data-field="checks">
            {[...bad, ...checks.filter((c) => c.ok)].map((c, i) => (
              <li key={i} data-rule={c.rule} data-ok={c.ok} className={c.ok ? 'muted' : 'error'}>
                {c.ok ? '✓ ' : '✗ '}
                {c.message}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">{t('flat.checksHint')}</p>
    </div>
  );
}

export function FlatPanel() {
  const flat = useStore((s) => s.flat);
  if (!flat) return null;
  const { report, error, status } = flat;
  const pad = report ? Math.max(report.width, report.height) * 0.06 + 1 : 0;
  const y = (v: number) => (report ? report.max[1] + report.min[1] - v : v);
  return (
    <div className="measure-panel draft-panel" role="region" aria-label={t('flat.title')} data-flat>
      <div className="measure-head">
        <strong>{t('flat.title')}</strong>
        <span className="spacer" />
        <button data-action="exportFlatDxf" disabled={!report} onClick={() => store.exportFlatDxf()}>
          {t('flat.exportDxf')}
        </button>
        <button className="primary" onClick={() => store.stopFlat()}>
          {t('flat.done')}
        </button>
      </div>
      {status === 'running' && !report && <p className="muted">{t('flat.running')}</p>}
      {error && <p className="error" data-field="error">{error}</p>}
      {report && (
        <>
          <svg data-field="drawing" viewBox={`${report.min[0] - pad} ${report.min[1] - pad} ${report.width + 2 * pad} ${report.height + 2 * pad}`} width="100%" style={{ maxHeight: 220, background: 'var(--panel-bg, transparent)' }} preserveAspectRatio="xMidYMid meet">
            {report.outline.map((s, i) =>
              s.kind === 'line' ? (
                <line key={i} x1={s.a[0]} y1={y(s.a[1])} x2={s.b[0]} y2={y(s.b[1])} stroke="currentColor" strokeWidth={report.width / 400} />
              ) : s.kind === 'circle' ? (
                <circle key={i} cx={s.c[0]} cy={y(s.c[1])} r={s.r} fill="none" stroke="currentColor" strokeWidth={report.width / 400} />
              ) : (
                <path key={i} d={arcPath(s, y)} fill="none" stroke="currentColor" strokeWidth={report.width / 400} />
              ),
            )}
            {report.bends.map((b, i) => (
              <line key={`b${i}`} x1={b.a[0]} y1={y(b.a[1])} x2={b.b[0]} y2={y(b.b[1])} stroke="#c0392b" strokeDasharray={`${report.width / 60} ${report.width / 120}`} strokeWidth={report.width / 400} />
            ))}
          </svg>
          <table className="eq-table" data-field="sizes">
            <tbody>
              <tr>
                <td>{t('flat.size')}</td>
                <td data-field="size">
                  {num(report.width)} × {num(report.height)} mm
                </td>
              </tr>
              <tr>
                <td>{t('flat.area')}</td>
                <td data-field="area">{num(report.area, 2)} mm²</td>
              </tr>
              <tr>
                <td>{t('flat.thickness')}</td>
                <td>{num(report.thickness)} mm</td>
              </tr>
            </tbody>
          </table>
          <strong>{t('flat.bends')}</strong>
          {report.bends.length === 0 ? (
            <p className="muted">{t('flat.noBends')}</p>
          ) : (
            <table className="eq-table" data-field="bends">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('flat.bendAngle')}</th>
                  <th>{t('flat.bendRadius')}</th>
                  <th>{t('flat.bendDirection')}</th>
                  <th>{t('flat.bendAllowance')}</th>
                  <th>{t('flat.bendAt')}</th>
                </tr>
              </thead>
              <tbody>
                {report.bends.map((b, i) => (
                  <tr key={i} data-bend={i + 1}>
                    <td>{i + 1}</td>
                    <td>{deg(b.angle)}°</td>
                    <td>{num(b.radius)}</td>
                    <td>{t(b.direction === 'up' ? 'flat.up' : 'flat.down')}</td>
                    <td>{num(b.allowance)}</td>
                    <td>
                      {num((b.a[0] + b.b[0]) / 2)}, {num((b.a[1] + b.b[1]) / 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted">{t('flat.hint')}</p>
        </>
      )}
      <Checks />
    </div>
  );
}
