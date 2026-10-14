import type { Plugin } from 'vite';

/**
 * 「關閉伺服器」 (dev only, ADR 0135): the page asks the whole system to stop. A browser cannot end a Node process by
 * itself, so it POSTs to {@link SHUTDOWN_PATH}; this answers by dropping every hot-update socket (Vite keeps one per open
 * page) and closing the server, then ending the process — the same close-then-exit as the idle watcher (ADR 0118), but on
 * the page's request instead of after a grace. `apply: 'serve'` keeps it out of a production build, which has no dev
 * server to stop. The path is a contract the page and this plugin share (the fetch in `store.shutdown`).
 */

/** The one request the page makes to stop the dev server (a POST, so a link or a prefetch cannot fire it by accident). */
export const SHUTDOWN_PATH = '/__3db/shutdown';

/** Whether a request is that one: the decision alone, with the method and URL given to it, so it can be tested without a server. */
export function isShutdownRequest(method: string | undefined, url: string | undefined): boolean {
  if (method !== 'POST') return false;
  if (url === undefined) return false;
  return url === SHUTDOWN_PATH || url.startsWith(`${SHUTDOWN_PATH}?`);
}

export function shutdown(): Plugin {
  return {
    name: '3db-shutdown',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isShutdownRequest(req.method, req.url)) return next();
        // Answer first: the page is about to lose the server, and a reply it can read says the request was understood.
        res.statusCode = 200;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end('ok');
        server.config.logger.info('\nThe page asked to stop: the dev server closes (「關閉伺服器」).');
        // Drop every connection the page holds — Vite keeps one hot-update socket per open page — before the server closes.
        for (const client of server.ws.clients) client.socket.terminate();
        void server.close().finally(() => process.exit(0));
      });
    },
  };
}
