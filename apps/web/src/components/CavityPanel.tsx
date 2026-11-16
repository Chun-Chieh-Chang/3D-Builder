import { t } from '@3db/i18n';
import { CAVITY_COLORS } from '../state/analysis';
import { store, useStore } from '../state/store';

/**
 * Cavity distribution panel in the graphics area (ADR 0246):
 * Lists identified internal closed cavities, individual volumes, swatches, and total volume.
 */
export function CavityPanel() {
  const cavity = useStore((s) => s.cavityDistribution);
  const doc = useStore((s) => s.doc);
  if (!cavity) return null;
  const { status, graphics, error } = cavity;
  const total = graphics.reduce((sum, g) => sum + g.volume, 0);

  return (
    <div className="measure-panel draft-panel" role="region" aria-label={t('cavity.distribution')} data-cavity-panel>
      <div className="measure-head">
        <strong>{t('cavity.distribution')}</strong>
        <span className="spacer" />
        <button className="primary" onClick={() => store.stopCavityDistribution()}>
          {t('draftAnalysis.done')}
        </button>
      </div>
      {status === 'running' && <p className="muted">{t('physical.computing')}</p>}
      {error && <p className="error" data-field="error">{error}</p>}
      {status === 'done' && graphics.length === 0 && (
        <p className="muted" data-field="none">{t('cavity.none')}</p>
      )}
      {status === 'done' && graphics.length > 0 && (
        <>
          <table className="eq-table" data-field="totals">
            <thead>
              <tr>
                <th>{''}</th>
                <th>{t('sel.feature')}</th>
                <th>{t('cavity.volume')} (mm³)</th>
              </tr>
            </thead>
            <tbody>
              {graphics.map(({ id, volume }, i) => {
                const name = doc.features.find((f) => f.id === id)?.name ?? id;
                return (
                  <tr key={id} data-cavity={id}>
                    <td>
                      <span className="swatch" style={{ background: CAVITY_COLORS[i % CAVITY_COLORS.length], display: 'inline-block', width: 10, height: 10, marginRight: 6 }} />
                    </td>
                    <td>{name}</td>
                    <td data-field="volume">{Math.round(volume * 100) / 100}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p data-field="totalVolume">
            {t('cavity.total')}: <strong>{Math.round(total * 100) / 100} mm³</strong>
          </p>
        </>
      )}
    </div>
  );
}
