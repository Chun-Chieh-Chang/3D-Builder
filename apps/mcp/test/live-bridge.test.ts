/** Both ends of the live link (ADR 0238) over a real WebSocket: the server's LiveBridge and the app's AiBridge with a real DocHistory. */
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createEmptyAssembly, createEmptyPart, DocHistory } from '@3db/model';
import { LiveBridge } from '../src/bridge';
import { AiBridge, type AiBridgeStatus } from '../../web/src/state/aiBridge';
import { WebSocket as NodeSocket } from 'ws';
import { LIVE_PROTOCOL, toBase64 } from '@3db/io';

const wait = (ok: () => boolean) => new Promise<void>((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => (ok() ? resolve() : Date.now() - t0 > 5000 ? reject(new Error('timed out waiting')) : setTimeout(tick, 10));
  tick();
});
let server: LiveBridge | null = null;
afterEach(async () => { await server?.stop(); server = null; });

async function linked(code?: (s: LiveBridge) => string) {
  server = new LiveBridge({});
  await server.start();
  const history = new DocHistory(createEmptyPart());
  const statuses: AiBridgeStatus[] = [];
  const app = new AiBridge({ history, blobs: () => new Map(), assembly: () => null, isPart: () => true, onStatus: (s) => statuses.push(s) });
  app.connect(code ? code(server) : server.code);
  return { history, app, statuses, server };
}
const addVar = (id: string, name: string) => ({ type: 'addVariable', variable: { id, name, expr: '1' } }) as never;

it('rejects a foreign Origin before accepting its hello', async () => {
  server = new LiveBridge({});
  await server.start();
  const ws = new NodeSocket(`ws://127.0.0.1:${server.listeningPort}`, { origin: 'https://example.com' });
  const closed = new Promise<number>((resolve) => ws.on('close', resolve));
  expect(await closed).toBe(4403);
  expect(server.connected).toBe(false);
});

it('keeps the first app when another tries to connect', async () => {
  const first = await linked();
  await wait(() => first.statuses.some((s) => s.state === 'on'));
  const states: AiBridgeStatus[] = [];
  const second = new AiBridge({ history: new DocHistory(createEmptyPart()), blobs: () => new Map(), assembly: () => null, isPart: () => true, onStatus: (s) => states.push(s) });
  second.connect(first.server.code);
  await wait(() => states.some((s) => s.state === 'error'));
  expect(states.at(-1)).toMatchObject({ state: 'error', reason: 'refused' });
  expect((await first.server.request({ kind: 'apply', target: 'part', commands: [addVar('one', 'One')], label: 'AI' })).ok).toBe(true);
  expect(first.history.doc.variables[0]?.name).toBe('One');
});

it('closes a connection that never answers a batch', async () => {
  server = new LiveBridge({ answerMs: 30 });
  await server.start();
  const ws = new NodeSocket(`ws://127.0.0.1:${server.listeningPort}`);
  const closed = new Promise<number>((resolve) => ws.on('close', resolve));
  await new Promise<void>((resolve) => ws.on('open', resolve));
  ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token: server.token, version: 0, doc: createEmptyPart(), open: { kind: 'part' }, blobs: {} }));
  await wait(() => server!.connected);
  await expect(server.request({ kind: 'apply', target: 'part', commands: [addVar('one', 'One')], label: 'AI' })).rejects.toThrow('did not answer');
  expect(await closed).toBe(4408);
});

it('refuses mutation outside a part and resets the batch count on reconnect', async () => {
  server = new LiveBridge({});
  await server.start();
  let part = true;
  const history = new DocHistory(createEmptyPart());
  const states: AiBridgeStatus[] = [];
  const app = new AiBridge({ history, blobs: () => new Map(), assembly: () => null, isPart: () => part, onStatus: (s) => states.push(s) });
  app.connect(server.code);
  await wait(() => states.at(-1)?.state === 'on');
  expect((await server.request({ kind: 'apply', target: 'part', commands: [addVar('one', 'One')], label: 'AI' })).ok).toBe(true);
  expect(states.at(-1)).toEqual({ state: 'on', batches: 1 });
  part = false;
  expect(await server.request({ kind: 'undo', target: 'part' })).toMatchObject({ ok: false, reason: 'notPart' });
  expect(history.doc.variables).toHaveLength(1);
  app.disconnect();
  await wait(() => !server!.connected);
  app.connect(server.code);
  await wait(() => states.at(-1)?.state === 'on');
  expect(states.at(-1)).toEqual({ state: 'on', batches: 0 });
  expect(await server.request({ kind: 'apply', target: 'part', commands: [addVar('two', 'Two')], label: 'AI' })).toMatchObject({ ok: false, reason: 'notPart' });
});

it('connects, applies a batch as one undo step, and takes it back', async () => {
  const { history, statuses, server: s } = await linked();
  await wait(() => statuses.some((x) => x.state === 'on'));
  expect(s.takePending()?.doc.variables).toEqual([]);
  const r = await s.request({ kind: 'apply', target: 'part', commands: [addVar('v1', 'A'), addVar('v2', 'B')], label: 'AI: 2 commands' });
  expect(r.ok).toBe(true);
  expect(history.doc.variables.map((v) => v.name)).toEqual(['A', 'B']);
  expect((await s.request({ kind: 'undo', target: 'part' })).ok).toBe(true);
  expect(history.doc.variables).toEqual([]);
});

it('refuses a batch when the user changed the part, and sends the part first', async () => {
  const { history, statuses, server: s } = await linked();
  await wait(() => statuses.some((x) => x.state === 'on'));
  s.takePending();
  history.execute(addVar('u1', 'U'));
  const r = await s.request({ kind: 'apply', target: 'part', commands: [addVar('v1', 'A')], label: 'AI' });
  expect(r).toMatchObject({ ok: false, reason: 'conflict' });
  expect(history.doc.variables.map((v) => v.name)).toEqual(['U']);
  await wait(() => { const p = s.takePending(); return !!p && p.doc.variables.length === 1; });
});

it('refuses while the user is editing, and a wrong code', async () => {
  const { history, statuses, server: s } = await linked();
  await wait(() => statuses.some((x) => x.state === 'on'));
  history.begin('sketch');
  expect(await s.request({ kind: 'apply', target: 'part', commands: [addVar('v1', 'A')], label: 'AI' })).toMatchObject({ ok: false, reason: 'busy' });
  await s.stop();
  const bad = await linked((b) => `${b.listeningPort}-${'x'.repeat(16)}`);
  await wait(() => bad.statuses.some((x) => x.state === 'error'));
  expect(bad.statuses.at(-1)).toMatchObject({ state: 'error', reason: 'refused' });
  expect(bad.server.connected).toBe(false);
});

it('follows a history the store put in place: the next batch goes to the part now open', async () => {
  server = new LiveBridge({});
  await server.start();
  let history = new DocHistory(createEmptyPart());
  const statuses: AiBridgeStatus[] = [];
  const app = new AiBridge({ get history() { return history; }, blobs: () => new Map(), assembly: () => null, isPart: () => true, onStatus: (s) => statuses.push(s) });
  app.connect(server.code);
  await wait(() => statuses.some((x) => x.state === 'on'));
  server.takePending();
  const old = history;
  history = new DocHistory(createEmptyPart());
  app.historyReplaced();
  await wait(() => server!.takePending() !== null);
  expect((await server.request({ kind: 'apply', target: 'part', commands: [addVar('v1', 'A')], label: 'AI' })).ok).toBe(true);
  expect(history.doc.variables.map((v) => v.name)).toEqual(['A']);
  expect(old.doc.variables).toEqual([]);
});

/** A raw app end that says hello with `open` and then answers as `answer` says (ADR 0253). */
async function rawApp(answerMs: number, open: unknown, answer: (msg: { type: string; id: number; path?: string }, ws: NodeSocket) => void) {
  server = new LiveBridge({ answerMs });
  await server.start();
  const ws = new NodeSocket(`ws://127.0.0.1:${server.listeningPort}`);
  const closed = new Promise<number>((resolve) => ws.on('close', resolve));
  await new Promise<void>((resolve) => ws.on('open', resolve));
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type !== 'welcome') answer(msg, ws);
  });
  ws.send(JSON.stringify({ type: 'hello', protocol: LIVE_PROTOCOL, token: server.token, version: 0, doc: createEmptyPart(), open, blobs: {} }));
  return { ws, closed };
}

it('takes a part file the app reads only when its hash matches, and keeps the link when a read gets no answer', async () => {
  const bytes = new TextEncoder().encode('part bytes');
  const sha = createHash('sha256').update(bytes).digest('hex');
  let forge = false;
  let silent = false;
  const { closed } = await rawApp(50, { kind: 'assembly', doc: createEmptyAssembly(), sources: {} }, (msg, ws) => {
    if (msg.type !== 'read' || silent) return;
    ws.send(JSON.stringify({ type: 'file', id: msg.id, ok: true, sha: forge ? 'f'.repeat(64) : sha, data: toBase64(bytes) }));
  });
  await wait(() => server!.connected);
  expect(server!.open).toMatchObject({ kind: 'assembly' });
  const read = await server!.readFile('../parts/a.3dbx');
  expect(read.sha).toBe(sha);
  expect([...read.data]).toEqual([...bytes]);
  expect(server!.received.get(sha)).toBeDefined();
  forge = true;
  await expect(server!.readFile('../parts/a.3dbx')).rejects.toThrow('does not match');
  silent = true;
  await expect(server!.readFile('../parts/a.3dbx')).rejects.toThrow('did not answer');
  // reading changes nothing in the app: the link stays, and the next read is answered
  silent = false;
  forge = false;
  expect((await server!.readFile('../parts/a.3dbx')).sha).toBe(sha);
  expect(server!.connected).toBe(true);
  server!.stop();
  await closed;
});

it('closes a hello without the open document, and refuses an assembly batch while the app shows a part', async () => {
  const bad = await rawApp(1000, undefined, () => undefined);
  expect(await bad.closed).toBe(4400);
  await server!.stop();
  const { statuses, server: s } = await linked();
  await wait(() => statuses.some((x) => x.state === 'on'));
  expect(await s.request({ kind: 'apply', target: 'assembly', commands: [], label: 'AI' })).toMatchObject({ ok: false, reason: 'wrongDocument' });
  expect(await s.request({ kind: 'undo', target: 'assembly' })).toMatchObject({ ok: false, reason: 'wrongDocument' });
  expect(s.connected).toBe(true);
});
