import { useState } from 'react';
import { t } from '@3db/i18n';
import { store, useStore } from '../state/store';
import type { AiBridgeStatus } from '../state/aiBridge';

function statusText(ai: AiBridgeStatus): string {
  if (ai.state === 'on') return t('ai.on', { n: ai.batches });
  if (ai.state === 'error') return t(`ai.error.${ai.reason}`);
  return t(`ai.${ai.state}`);
}

export function AiConnectionStatus() {
  const ai = useStore((s) => s.ai);
  if (ai.state === 'off') return null;
  return <button data-ai-status onClick={() => store.openDialog('aiControl')}>{statusText(ai)}</button>;
}

/** Closing the dialog leaves the connection active; Disconnect ends it explicitly. */
export function AiControlDialog() {
  const open = useStore((s) => s.dialog === 'aiControl');
  const ai = useStore((s) => s.ai);
  const active = useStore((s) => s.active);
  const [code, setCode] = useState('');
  if (!open) return null;
  const linked = ai.state === 'on' || ai.state === 'connecting';
  const close = () => store.openDialog(null);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <form className="modal parameters" role="dialog" aria-modal="true" aria-label={t('ai.title')} onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (!linked && active === 'part') store.connectAi(code); }}>
        <h3>{t('ai.title')}</h3>
        <p>{t('ai.instructions')}</p>
        <label>{t('ai.code')}<input data-ai-code autoFocus autoComplete="off" spellCheck={false} value={code} disabled={linked} onChange={(e) => setCode(e.target.value)} /></label>
        <p role="status">{statusText(ai)}</p>
        <p className="hint">{t('ai.scope')}</p>
        <div className="modal-actions">
          <button type="submit" disabled={linked || active !== 'part' || !code.trim()}>{t('ai.connect')}</button>
          <button type="button" disabled={!linked} onClick={() => { store.disconnectAi(); setCode(''); }}>{t('ai.disconnect')}</button>
          <button type="button" onClick={close}>{t('ai.close')}</button>
        </div>
      </form>
    </div>
  );
}
