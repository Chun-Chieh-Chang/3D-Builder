import { describe, expect, it } from 'vitest';
import { isShutdownRequest, SHUTDOWN_PATH } from '../../apps/web/dev/shutdown.ts';

// 「關閉伺服器」 (apps/web/dev/shutdown.ts, ADR 0135): the page POSTs to SHUTDOWN_PATH and the dev server stops. The decision
// of whether a request is that one is a pure function of the method and URL, so it is tested here without a server.
describe('the page can ask the dev server to stop', () => {
  it('a POST to the shutdown path is the request', () => {
    expect(isShutdownRequest('POST', SHUTDOWN_PATH)).toBe(true);
  });

  it('a POST with a query string still counts (the browser may add one)', () => {
    expect(isShutdownRequest('POST', `${SHUTDOWN_PATH}?t=1`)).toBe(true);
  });

  it('only a POST: a GET (a link, a prefetch, a reload) does not stop the server', () => {
    expect(isShutdownRequest('GET', SHUTDOWN_PATH)).toBe(false);
    for (const method of ['get', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) expect(isShutdownRequest(method, SHUTDOWN_PATH)).toBe(false);
  });

  it('a POST to any other path is left to the rest of the server', () => {
    expect(isShutdownRequest('POST', '/')).toBe(false);
    expect(isShutdownRequest('POST', '/src/main.tsx')).toBe(false);
    // a path that merely starts with the shutdown path is a different request
    expect(isShutdownRequest('POST', `${SHUTDOWN_PATH}extra`)).toBe(false);
  });

  it('a request without a method or URL is not it (defensive: the page always sends both)', () => {
    expect(isShutdownRequest(undefined, SHUTDOWN_PATH)).toBe(false);
    expect(isShutdownRequest('POST', undefined)).toBe(false);
  });
});
