import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [launcher, version, previousVersion] = process.argv.slice(2);
assert.ok(launcher && version && previousVersion, 'Provide the installed launcher, version and previous version');
const port = 38923;
const workspace = await mkdtemp(join(tmpdir(), '3db-windows-upgrade-'));

function isListening() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

const cycles = [];
for (let cycle = 1; cycle <= 2; cycle++) {
  assert.equal(await isListening(), false, 'Live port must be free before launch');
  const client = new Client({ name: 'windows-upgrade-acceptance', version: '1' });
  const transport = new StdioClientTransport({
    command: launcher,
    args: ['--workspace', workspace],
    env: { ...process.env, THREEDB_LIVE: 'on', THREEDB_LIVE_PORT: String(port) },
    stderr: 'pipe',
  });
  transport.stderr?.resume();
  try {
    await client.connect(transport);
    assert.deepEqual(client.getServerVersion(), { name: '3d-builder', version });
    const response = await client.callTool({ name: 'live_status', arguments: {} });
    const { listening, connected } = JSON.parse(response.content[0].text);
    assert.equal(listening, true);
    assert.equal(connected, false);
    assert.equal(await isListening(), true);
  } finally {
    await client.close();
  }
  assert.equal(await isListening(), false, 'Installed sidecar left its port open after client shutdown');
  cycles.push({ cycle, port, released: true });
}
const report = { previousVersion, version, upgradedInPlace: true, cycles };
await writeFile('out/windows-release/upgrade-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
