import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import { store, useStore } from '../state/store';
import type { AiBridgeStatus } from '../state/aiBridge';

interface McpLauncherInfo {
  launcherPath: string;
  installed: boolean;
}

async function queryBundledMcp(): Promise<McpLauncherInfo | null> {
  const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: <T>(cmd: string) => Promise<T> } }).__TAURI_INTERNALS__;
  if (!tauri?.invoke) return null;
  try {
    return await tauri.invoke<McpLauncherInfo>('mcp_launcher_info');
  } catch {
    return null;
  }
}

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
  const [mcpInfo, setMcpInfo] = useState<McpLauncherInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    void queryBundledMcp().then(setMcpInfo);
  }, [open]);

  if (!open) return null;
  const linked = ai.state === 'on' || ai.state === 'connecting';
  const close = () => store.openDialog(null);
  const mcpSnippet = mcpInfo?.installed
    ? JSON.stringify(
        {
          mcpServers: {
            '3d-builder': {
              command: mcpInfo.launcherPath,
              args: ['--workspace', 'C:\\path\\to\\your\\cad-folder'],
            },
          },
        },
        null,
        2,
      )
    : null;

  const copyMcp = () => {
    if (!mcpSnippet) return;
    void navigator.clipboard?.writeText(mcpSnippet).then(() => setCopied(true));
  };

  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <form className="modal parameters" role="dialog" aria-modal="true" aria-label={t('ai.title')} onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (!linked && active === 'part') store.connectAi(code); }}>
        <h3>{t('ai.title')}</h3>
        <p>{t('ai.instructions')}</p>
        <label>{t('ai.code')}<input data-ai-code autoFocus autoComplete="off" spellCheck={false} value={code} disabled={linked} onChange={(e) => setCode(e.target.value)} /></label>
        <p role="status">{statusText(ai)}</p>
        <p className="hint">{t('ai.scope')}</p>
        {mcpSnippet && (
          <section data-mcp-bundled style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border, #334155)' }}>
            <h4 style={{ margin: '0 0 4px', fontSize: 14 }}>{t('ai.mcpTitle')}</h4>
            <p className="hint" style={{ margin: '0 0 8px' }}>{t('ai.mcpHint')}</p>
            <pre data-mcp-config style={{ margin: '0 0 8px', padding: 8, fontSize: 12, overflowX: 'auto', background: 'rgba(15,23,42,0.06)', borderRadius: 4, userSelect: 'all' }}>{mcpSnippet}</pre>
            <button type="button" data-mcp-copy onClick={copyMcp}>{copied ? t('ai.mcpCopied') : t('ai.mcpCopy')}</button>
          </section>
        )}
        <div className="modal-actions">
          <button type="submit" disabled={linked || active !== 'part' || !code.trim()}>{t('ai.connect')}</button>
          <button type="button" disabled={!linked} onClick={() => { store.disconnectAi(); setCode(''); }}>{t('ai.disconnect')}</button>
          <button type="button" onClick={close}>{t('ai.close')}</button>
        </div>
      </form>
    </div>
  );
}
