// The arguments `npm` is given to start the dev server for `verify:ui` at `origin` (VERIFY_UI_ORIGIN). The default origin is the port
// vite is configured for, so nothing is added; any other port is passed on (`vite --port`), or a second session using its own port
// would find nothing to talk to. An origin that is not a plain http(s) URL with a port is refused, not guessed at.
export const DEFAULT_DEV_PORT = 5391;

export function devServerArgs(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`VERIFY_UI_ORIGIN is not a URL: ${origin}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`VERIFY_UI_ORIGIN must be http(s): ${origin}`);
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`VERIFY_UI_ORIGIN needs a port (1-65535): ${origin}`);
  const base = ['run', 'dev', '-w', '@3db/web'];
  return port === DEFAULT_DEV_PORT ? base : [...base, '--', '--port', String(port)];
}
