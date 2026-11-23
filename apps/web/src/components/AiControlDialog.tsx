import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@3db/i18n';
import { LIVE_SETUP_PORT } from '@3db/io';
import { store, useStore } from '../state/store';
import type { AiBridgeStatus } from '../state/aiBridge';
import { discoverMcp, loopbackPermission, type McpDiscovery } from '../state/mcpDiscovery';

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
  const [discovery, setDiscovery] = useState<McpDiscovery | 'ask' | 'denied' | 'checking'>('ask');
  const probe = useRef<AbortController | null>(null);
  const webSetup = window.isSecureContext && !('__TAURI_INTERNALS__' in window);
  const linked = ai.state === 'on' || ai.state === 'connecting';
  const checkMcp = useCallback(() => {
    probe.current?.abort();
    const check = new AbortController();
    probe.current = check;
    setDiscovery('checking');
    void discoverMcp(check.signal).then(async (result) => {
      const status = result === 'unreachable' && await loopbackPermission() === 'denied' ? 'denied' : result;
      if (!check.signal.aborted) {
        probe.current = null;
        setDiscovery(status);
      }
    });
  }, []);

  useEffect(() => {
    if (!webSetup) return;
    let cancelled = false;
    void loopbackPermission().then((permission) => {
      if (cancelled || probe.current) return;
      if (permission === 'granted') checkMcp();
      else if (permission === 'denied') setDiscovery('denied');
    });
    return () => {
      cancelled = true;
      probe.current?.abort();
      probe.current = null;
    };
  }, [checkMcp, webSetup]);

  useEffect(() => {
    if (!open || !webSetup || linked || discovery === 'ready') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void loopbackPermission().then((permission) => {
        if (!cancelled && !probe.current && permission === 'granted') checkMcp();
      });
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [checkMcp, discovery, linked, open, webSetup]);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    void queryBundledMcp().then(setMcpInfo);
  }, [open]);

  if (!open) return null;
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
      <form className="modal parameters ai-control-dialog" role="dialog" aria-modal="true" aria-label={t('ai.title')} onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); if (!linked && active === 'part') store.connectAi(code); }}>
        <h3>{t('ai.title')}</h3>
        {webSetup && (
          <section className="ai-mcp-setup" aria-label={t('ai.setup.title')}>
            <div className="ai-mcp-check">
              <p role="status" data-mcp-discovery={discovery}>{t(`ai.setup.${discovery}`)}</p>
              <button type="button" data-mcp-check disabled={discovery === 'checking' || linked} onClick={checkMcp}>{t('ai.setup.check')}</button>
            </div>
            <details>
              <summary>{t('ai.setup.title')}</summary>
              <ol>
                <li><a href="https://github.com/Chun-Chieh-Chang/3D-Builder/releases/latest" target="_blank" rel="noopener noreferrer">{t('ai.setup.download')}</a>{t('ai.setup.install')}</li>
                <li>{t('ai.setup.configure')}
                  <pre>{JSON.stringify({ env: { THREEDB_LIVE_PORT: String(LIVE_SETUP_PORT), THREEDB_LIVE_ORIGINS: window.location.origin } }, null, 2)}</pre>
                </li>
                <li>{t('ai.setup.start')}</li>
              </ol>
              <a href="https://github.com/Chun-Chieh-Chang/3D-Builder/tree/main/apps/mcp#readme" target="_blank" rel="noopener noreferrer">{t('ai.setup.docs')}</a>
            </details>
          </section>
        )}
        <p>{t('ai.instructions')}</p>
        <label>{t('ai.code')}<input data-ai-code autoFocus autoComplete="off" spellCheck={false} value={code} disabled={linked} onChange={(e) => setCode(e.target.value)} /></label>
        <p role="status" data-ai-connection>{statusText(ai)}</p>
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
