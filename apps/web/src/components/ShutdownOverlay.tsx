import { t } from '@3db/i18n';
import { useStore } from '../state/store';

/**
 * The screen left once 「關閉伺服器」 has been pressed (ADR 0135). The dev server and the geometry kernel are gone, so this
 * page can no longer do anything: it only says the system has been shut down, and stays there (it is not interactive) until
 * the tab is closed and `npm run dev` is run again.
 */
export function ShutdownOverlay() {
  const shuttingDown = useStore((s) => s.shuttingDown);
  if (!shuttingDown) return null;
  return (
    <div className="modal-backdrop shutdown-overlay" role="status">
      <div className="modal" role="dialog" aria-label={t('shutdown.closedTitle')}>
        <h3>{t('shutdown.closedTitle')}</h3>
        <p className="muted">{t('shutdown.closedBody')}</p>
      </div>
    </div>
  );
}
