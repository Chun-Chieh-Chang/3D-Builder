import { t } from '@3db/i18n';
import { formatMass, partBody, principalMoments, type MassItem, type Physical } from '@3db/model';
import { store, useStore } from '../state/store';

/** Six significant digits, no trailing zeros; a value under 1e-9 of `scale` (the biggest entry it sits beside) is rounding noise and reads 0. */
const num = (v: number, scale = 1) => String(Number((Math.abs(v) < 1e-9 * scale ? 0 : v).toPrecision(6)));

/** What the dialog shows, for a part or for an assembly: the same figures in the same order. */
interface Report {
  physical: Physical | null;
  total: MassItem;
  volume: number;
  area: number;
  /** A part without a material has no mass: only its volume, area and center are shown. */
  hasMass: boolean;
}

/**
 * 「物質特性」 (E1.2): mass, volume, surface area, center of mass, matrix of inertia and principal moments of the open part or assembly.
 * Worked out from the parts' kernel properties and their poses every time it is drawn, so it follows whatever was changed.
 */
export function PhysicalDialog() {
  const open = useStore((s) => s.dialog === 'physical');
  const active = useStore((s) => s.active);
  const result = useStore((s) => s.result);
  const material = useStore((s) => s.doc.material);
  const asm = useStore((s) => s.asm);
  if (!open) return null;
  const close = () => store.openDialog(null);
  let report: Report | null = null;
  if (active === 'assembly' && asm && store.assembly) {
    const physical = store.assembly.physical();
    report = { physical, total: physical.total, volume: physical.volume, area: physical.area, hasMass: physical.total.mass > 0 };
  } else if (active === 'part' && result?.mass) {
    const body = partBody({ ...result.mass, density: material?.density ?? null });
    report = { physical: null, total: body ?? { mass: 0, center: result.mass.center, inertia: result.mass.inertia }, volume: result.mass.volume, area: result.mass.area, hasMass: body !== null };
  }
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide parameters" role="dialog" aria-label={t('physical.title')} onPointerDown={(e) => e.stopPropagation()}>
        <h3>{t('physical.title')}</h3>
        {!report ? <p className="muted">{t('physical.noBody')}</p> : <Body report={report} />}
        <p className="hint">{t('physical.unitNote')}</p>
        <div className="modal-actions">
          <button onClick={close}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function Body({ report }: { report: Report }) {
  const { physical, total } = report;
  // without a material the inertia would be that of a density of one (mm⁵): not shown as grams
  const principal = report.hasMass ? principalMoments(total.inertia) : null;
  return (
    <div className="shortcut-list" data-physical>
      <table className="eq-table">
        <tbody>
          <tr>
            <th>{t('physical.mass')}</th>
            <td data-field="mass">{report.hasMass ? formatMass(total.mass) : '–'}</td>
          </tr>
          <tr>
            <th>{t('physical.volume')}</th>
            <td data-field="volume">{num(report.volume)}</td>
          </tr>
          <tr>
            <th>{t('physical.area')}</th>
            <td data-field="area">{num(report.area)}</td>
          </tr>
          <tr>
            <th>{t('physical.center')}</th>
            <td data-field="center">{report.hasMass || !physical ? total.center.map(num).join('  ') : '–'}</td>
          </tr>
        </tbody>
      </table>
      {report.hasMass && principal && (
        <>
          <h4>{t('physical.inertia')}</h4>
          <table className="eq-table" data-field="inertia">
            <tbody>
              {[0, 1, 2].map((r) => (
                <tr key={r}>
                  {[0, 1, 2].map((c) => (
                    <td key={c}>{num(total.inertia[3 * r + c]!, Math.max(total.inertia[0]!, total.inertia[4]!, total.inertia[8]!))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <h4>{t('physical.principal')}</h4>
          <table className="eq-table" data-field="principal">
            <tbody>
              {principal.moments.map((m, i) => (
                <tr key={i}>
                  <td>{num(m)}</td>
                  <td className="muted">{principal.axes[i]!.map((v) => num(v, 1e3)).join('  ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {physical && physical.lines.length > 0 && (
        <>
          <h4>{t('physical.parts')}</h4>
          <table className="eq-table" data-field="lines">
            <thead>
              <tr>
                <th>{t('bom.name')}</th>
                <th>{t('physical.qty')}</th>
                <th>{t('physical.each')}</th>
                <th>{t('physical.volume')}</th>
              </tr>
            </thead>
            <tbody>
              {physical.lines.map((l) => (
                <tr key={l.name}>
                  <td>{l.name}</td>
                  <td>{l.qty}</td>
                  <td>{l.mass === null ? '–' : formatMass(l.mass)}</td>
                  <td>{num(l.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {physical && physical.withoutMaterial.length > 0 && <p className="hint" data-field="noMaterial">{t('physical.noMaterial', { names: physical.withoutMaterial.join(', ') })}</p>}
      {physical && physical.unknown.length > 0 && <p className="hint" data-field="unknown">{t('physical.unknown', { names: physical.unknown.join(', ') })}</p>}
      {physical && <p className="hint">{t('physical.areaNote')}</p>}
      {physical && <p className="hint">{t('physical.assemblyIs')}</p>}
    </div>
  );
}
