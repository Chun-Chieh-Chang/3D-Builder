import type { Plugin } from 'vite';

/**
 * `npm run dev:auto`: the dev server stops by itself when the last browser page connected to it is gone. Vite keeps one WebSocket per open page (for hot updates), so "no page" is "no client".
 * A reload or a computer asleep for a moment drops the connection for a few seconds, so the server waits `graceSeconds` before it stops; until the first page has ever connected it waits
 * `firstConnectSeconds`, because a browser can take a while to start.
 */
export interface IdleOptions {
  graceSeconds: number;
  firstConnectSeconds: number;
}

export const DEFAULT_GRACE_SECONDS = 30;
export const DEFAULT_FIRST_CONNECT_SECONDS = 120;

/** The decision alone, with the clock given to it: the time (ms) since which no page has been connected, or null when there is one. */
export function idleWatcher(options: IdleOptions) {
  let since: number | null = null;
  let everConnected = false;
  return {
    /** Called now and then with the number of connected pages; true when the server should stop. */
    tick(now: number, clients: number): boolean {
      if (clients > 0) {
        everConnected = true;
        since = null;
        return false;
      }
      since ??= now;
      const limit = everConnected ? options.graceSeconds : options.firstConnectSeconds;
      return now - since >= limit * 1000;
    },
  };
}

/** The seconds in an environment value (`DEV_AUTO_CLOSE_SECONDS`); anything that is not a positive number is the default. */
export function graceFromEnv(value: string | undefined): number {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n > 0 ? n : DEFAULT_GRACE_SECONDS;
}

export function autoClose(options: Partial<IdleOptions> = {}): Plugin {
  const full: IdleOptions = { graceSeconds: options.graceSeconds ?? DEFAULT_GRACE_SECONDS, firstConnectSeconds: options.firstConnectSeconds ?? DEFAULT_FIRST_CONNECT_SECONDS };
  return {
    name: '3db-auto-close',
    apply: 'serve',
    configureServer(server) {
      const watcher = idleWatcher(full);
      const timer = setInterval(() => {
        if (!watcher.tick(Date.now(), server.ws.clients.size)) return;
        clearInterval(timer);
        server.config.logger.info(`\nNo page has been connected for ${full.graceSeconds} seconds: the dev server stops (npm run dev:auto).`);
        void server.close().finally(() => process.exit(0));
      }, 1000);
      timer.unref();
      server.httpServer?.on('close', () => clearInterval(timer));
    },
  };
}
