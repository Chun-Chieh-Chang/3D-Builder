import { t } from '@3db/i18n';
import { store, useStore } from '../state/store';

/**
 * 「關閉伺服器」 (dev only, ADR 0135): the one button that stops the whole running system — the dev server, the Node
 * process behind it, and the geometry kernel worker's connection to the page. A production build (and the Tauri desktop
 * app) has no dev server to stop, so the button is not shown there: `import.meta.env.DEV` is false in those.
 */
export function ShutdownButton() {
  const shuttingDown = useStore((s) => s.shuttingDown);
  if (!import.meta.env.DEV) return null;
  return (
    <button className="tool" data-shutdown disabled={shuttingDown} title={t('shutdown.tip')} onClick={() => void store.shutdown()}>
      {t('shutdown.button')}
    </button>
  );
}
