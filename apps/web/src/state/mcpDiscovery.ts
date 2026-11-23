import { LIVE_CLOSE, LIVE_PROBE_PATH, LIVE_PROBE_REPLY, LIVE_SETUP_PORT } from '@3db/io';

export type McpDiscovery = 'ready' | 'origin' | 'unreachable';

/** Chrome may not recognize this permission name. An explicit check can still attempt the connection. */
export async function loopbackPermission(): Promise<PermissionState | 'unknown'> {
  try {
    return (await navigator.permissions.query({ name: 'loopback-network' as PermissionName })).state;
  } catch {
    return 'unknown';
  }
}

/** Check one configured loopback endpoint, without sending a token or opening a CAD session. */
export function discoverMcp(signal: AbortSignal, port = LIVE_SETUP_PORT, Socket: typeof WebSocket = WebSocket): Promise<McpDiscovery> {
  return new Promise((resolve) => {
    if (signal.aborted || !Number.isInteger(port) || port < 1024 || port > 65535) {
      resolve('unreachable');
      return;
    }
    let ws: WebSocket;
    try {
      ws = new Socket(`ws://127.0.0.1:${port}${LIVE_PROBE_PATH}`);
    } catch {
      resolve('unreachable');
      return;
    }
    const finish = (result: McpDiscovery) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', aborted);
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
      resolve(result);
    };
    const aborted = () => finish('unreachable');
    const timeout = setTimeout(aborted, 8000);
    signal.addEventListener('abort', aborted, { once: true });
    // The bundled v0.7.0 sidecar replies with "hello first" before it checks any token.
    ws.onopen = () => ws.send('{"type":"probe"}');
    ws.onmessage = ({ data }) => finish(data === LIVE_PROBE_REPLY ? 'ready' : 'unreachable');
    ws.onclose = ({ code, reason }) => {
      if (code === LIVE_CLOSE.badOrigin) finish('origin');
      else finish(code === LIVE_CLOSE.badMessage && reason === 'hello first' ? 'ready' : 'unreachable');
    };
    ws.onerror = aborted;
  });
}
