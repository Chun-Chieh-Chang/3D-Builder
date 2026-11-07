import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import type { MassProps } from '@3db/kernel';
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

/** A part's integrated figures, or that they could not be had. */
type Exact = MassProps | 'failed';

/**
 * The integrated centre and inertia of the open part (`null`) or of parts of the assembly by key (ADR 0241), asked of the worker when the dialog needs them, in seconds on spline
 * faces. What was got is kept until `generation` changes: the open part's figures hold for one result, a part's key is its content.
 */
function useExactMass(keys: (string | null)[], generation: unknown): ReadonlyMap<string | null, Exact> {
  const [got, setGot] = useState({ generation, masses: new Map<string | null, Exact>() as ReadonlyMap<string | null, Exact> });
  const masses = got.generation === generation ? got.masses : EMPTY;
  const wanted = JSON.stringify(keys);
  useEffect(() => {
    let live = true;
    const put = (key: string | null, value: Exact) => {
      if (live) setGot((g) => ({ generation, masses: new Map(g.generation === generation ? g.masses : EMPTY).set(key, value) }));
    };
    for (const key of keys) {
      if (masses.has(key)) continue;
      store.exactMass(key).then(
        (m) => put(key, m ?? 'failed'),
        () => put(key, 'failed'),
      );
    }
    return () => {
      live = false;
    };
    // `keys` and `masses` are read as they are when what is wanted changes: a result that comes in must not ask again
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, generation]);
  return masses;
}

const EMPTY: ReadonlyMap<string | null, Exact> = new Map();

/**
 * 「物質特性」 (E1.2): mass, volume, surface area, center of mass, matrix of inertia and principal moments of the open part or assembly.
 * Worked out from the parts' kernel properties and their poses every time it is drawn, so it follows whatever was changed.
 */
export function PhysicalDialog() {
  const open = useStore((s) => s.dialog === 'physical');
  return open ? <OpenDialog /> : null;
}

function OpenDialog() {
  const active = useStore((s) => s.active);
  const result = useStore((s) => s.result);
  const material = useStore((s) => s.doc.material);
  const asm = useStore((s) => s.asm);
  const assembly = active === 'assembly' && asm ? store.assembly : null;
  const part = active === 'part' && result?.mass ? result : null;
  const keys: (string | null)[] = assembly ? assembly.physicalKeys() : part ? [null] : [];
  const exact = useExactMass(keys, assembly ? assembly : part);
  const pending = keys.some((key) => !exact.has(key));
  const failed = keys.some((key) => exact.get(key) === 'failed');
  const close = () => store.openDialog(null);
  let report: Report | null = null;
  if (assembly) {
    const physical = assembly.physical(new Map(keys.flatMap((key) => { const m = exact.get(key); return key !== null && m && m !== 'failed' ? [[key, m] as const] : []; })));
    report = { physical, total: physical.total, volume: physical.volume, area: physical.area, hasMass: physical.total.mass > 0 };
  } else if (part?.mass) {
    const got = exact.get(null);
    const mass = got && got !== 'failed' ? got : part.mass;
    const body = partBody({ ...mass, density: material?.density ?? null });
    report = { physical: null, total: body ?? { mass: 0, center: mass.center, inertia: mass.inertia }, volume: mass.volume, area: mass.area, hasMass: body !== null };
  }
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide parameters" role="dialog" aria-label={t('physical.title')} onPointerDown={(e) => e.stopPropagation()}>
        <h3>{t('physical.title')}</h3>
        {!report ? <p className="muted">{t('physical.noBody')}</p> : <Body report={report} pending={pending} />}
        {report && failed && <p className="hint" data-field="exactFailed">{t('physical.exactFailed')}</p>}
        <p className="hint">{t('physical.unitNote')}</p>
        <div className="modal-actions">
          <button onClick={close}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

function Body({ report, pending }: { report: Report; pending: boolean }) {
  const { physical, total } = report;
  // without a material the inertia would be that of a density of one (mm⁵): not shown as grams; while the exact figures are on their way there is nothing to show yet
  const principal = report.hasMass && !pending ? principalMoments(total.inertia) : null;
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
            <td data-field="center">{!report.hasMass && physical ? '–' : pending ? t('physical.computing') : total.center.map(num).join('  ')}</td>
          </tr>
        </tbody>
      </table>
      {principal && (
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
