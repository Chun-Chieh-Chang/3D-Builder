/**
 * Starts the 3D-Builder MCP server on stdin/stdout (ADR 0237). The workspace folder, where parts are read and written, is `THREEDB_WORKSPACE`, else the
 * folder the server was started in. `THREEDB_LOCALE` is `zh-TW` (the default) or `en`: the language of the program's own messages.
 * The live link to the open app (ADR 0238) listens on 127.0.0.1 (`THREEDB_LIVE_PORT`, else a free port; `THREEDB_LIVE=off` turns it off;
 * `THREEDB_LIVE_ORIGINS` adds allowed page origins, comma-separated). Nothing but MCP messages may go to stdout, so the log goes to stderr.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CadSession } from './session';
import { createServer, serial } from './server';
import { LiveBridge } from './bridge';

const VERSION = '0.1.0';

async function main(): Promise<void> {
  const locale = process.env.THREEDB_LOCALE ?? 'zh-TW';
  if (locale !== 'zh-TW' && locale !== 'en') throw new Error(`THREEDB_LOCALE must be zh-TW or en, not ${locale}`);
  const root = resolve(process.env.THREEDB_WORKSPACE ?? process.cwd());
  await mkdir(root, { recursive: true });
  const began = Date.now();
  const session = await CadSession.create({ root, locale });
  const run = serial();
  const log = (text: string) => process.stderr.write(`${text}\n`);
  let live: LiveBridge | null = null;
  if (process.env.THREEDB_LIVE !== 'off') {
    const port = Number(process.env.THREEDB_LIVE_PORT ?? 0);
    if (!(Number.isInteger(port) && port >= 0 && port <= 65535)) throw new Error(`THREEDB_LIVE_PORT must be a port number, not ${process.env.THREEDB_LIVE_PORT}`);
    live = new LiveBridge({
      port,
      origins: (process.env.THREEDB_LIVE_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
      log,
      onClose: () => log('live link: the app disconnected'),
    });
    await live.start();
  }
  const server = createServer(session, VERSION, live, run);
  await server.connect(new StdioServerTransport());
  log(`3d-builder MCP ${VERSION}: kernel ready in ${Date.now() - began} ms, workspace ${root}${live ? `, live link code ${live.code}` : ''}`);
}

main().catch((e) => {
  process.stderr.write(`3d-builder MCP failed to start: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
