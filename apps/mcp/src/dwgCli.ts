/** Narrow stdin/stdout bridge used by the desktop shell; no paths or shell commands supplied by the webview. */
import { dxfToDwg, dwgToDxf } from './dwg';
import { installDwg } from './dwgSetup';

try {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 90 * 1024 * 1024) throw new Error('DWG request exceeds 90 MiB.');
    chunks.push(Buffer.from(chunk));
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof request.data !== 'string') throw new Error('Missing DWG payload.');
  let bytes: Uint8Array;
  if (request.direction === 'export') bytes = await dxfToDwg(request.data);
  else if (request.direction === 'setup') { await installDwg(); bytes = new Uint8Array(); }
  else if (request.direction === 'import') bytes = Buffer.from(await dwgToDxf(Buffer.from(request.data, 'base64')), 'utf8');
  else throw new Error('Unknown DWG conversion direction.');
  process.stdout.write(JSON.stringify({ base64: Buffer.from(bytes).toString('base64') }));
} catch (e) {
  process.stderr.write(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
