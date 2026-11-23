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

const VERSION = '0.7.0';

function parseCliArgs(argv: readonly string[]): { workspace?: string; locale?: string } {
  const out: { workspace?: string; locale?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if ((a === '--workspace' || a === '--root') && argv[i + 1]) out.workspace = argv[++i]!;
    else if (a === '--locale' && argv[i + 1]) out.locale = argv[++i]!;
  }
  return out;
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const locale = cli.locale ?? process.env.THREEDB_LOCALE ?? 'zh-TW';
  if (locale !== 'zh-TW' && locale !== 'en') throw new Error(`THREEDB_LOCALE must be zh-TW or en, not ${locale}`);
  const root = resolve(cli.workspace ?? process.env.THREEDB_WORKSPACE ?? process.cwd());
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
  process.stdin.once('end', () => {
    // Closing the client pipe must also release the loopback listener. Otherwise the desktop
    // launcher can be killed by the client timeout while its Node child keeps the port.
    void Promise.all([live?.stop(), server.close()]).catch((error) => {
      log(`3d-builder MCP shutdown failed: ${String(error)}`);
      process.exitCode = 1;
    });
  });
  log(`3d-builder MCP ${VERSION}: kernel ready in ${Date.now() - began} ms, workspace ${root}${live ? `, live link code ${live.code}` : ''}`);
}

main().catch((e) => {
  process.stderr.write(`3d-builder MCP failed to start: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
