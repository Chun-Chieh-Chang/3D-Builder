/**
 * Starts the 3D-Builder MCP server on stdin/stdout (ADR 0237). The workspace folder, where parts are read and written, is `THREEDB_WORKSPACE`, else the
 * folder the server was started in. `THREEDB_LOCALE` is `zh-TW` (the default) or `en`: the language of the program's own messages.
 * Nothing but MCP messages may go to stdout, so the log goes to stderr.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CadSession } from './session';
import { createServer } from './server';

const VERSION = '0.1.0';

async function main(): Promise<void> {
  const locale = process.env.THREEDB_LOCALE ?? 'zh-TW';
  if (locale !== 'zh-TW' && locale !== 'en') throw new Error(`THREEDB_LOCALE must be zh-TW or en, not ${locale}`);
  const root = resolve(process.env.THREEDB_WORKSPACE ?? process.cwd());
  await mkdir(root, { recursive: true });
  const began = Date.now();
  const session = await CadSession.create({ root, locale });
  const server = createServer(session, VERSION);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`3d-builder MCP ${VERSION}: kernel ready in ${Date.now() - began} ms, workspace ${root}\n`);
}

main().catch((e) => {
  process.stderr.write(`3d-builder MCP failed to start: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
