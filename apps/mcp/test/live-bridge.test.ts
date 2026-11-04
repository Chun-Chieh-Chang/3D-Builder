/** Both ends of the live link (ADR 0238) over a real WebSocket: the server's LiveBridge and the app's AiBridge with a real DocHistory. */
import { afterEach, expect, it } from 'vitest';
import { createEmptyPart, DocHistory } from '@3db/model';
import { LiveBridge } from '../src/bridge';
import { AiBridge, type AiBridgeStatus } from '../../web/src/state/aiBridge';

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
  const app = new AiBridge({ history, blobs: () => new Map(), isPart: () => true, onStatus: (s) => statuses.push(s) });
  app.connect(code ? code(server) : server.code);
  return { history, app, statuses, server };
}
const addVar = (id: string, name: string) => ({ type: 'addVariable', variable: { id, name, expr: '1' } }) as never;

it('connects, applies a batch as one undo step, and takes it back', async () => {
  const { history, statuses, server: s } = await linked();
  await wait(() => statuses.some((x) => x.state === 'on'));
  expect(s.takePending()?.doc.variables).toEqual([]);
  const r = await s.request({ kind: 'apply', commands: [addVar('v1', 'A'), addVar('v2', 'B')], label: 'AI: 2 commands' });
  expect(r.ok).toBe(true);
  expect(history.doc.variables.map((v) => v.name)).toEqual(['A', 'B']);
  expect((await s.request({ kind: 'undo' })).ok).toBe(true);
  expect(history.doc.variables).toEqual([]);
});

it('refuses a batch when the user changed the part, and sends the part first', async () => {
  const { history, statuses, server: s } = await linked();
  await wait(() => statuses.some((x) => x.state === 'on'));
  s.takePending();
  history.execute(addVar('u1', 'U'));
  const r = await s.request({ kind: 'apply', commands: [addVar('v1', 'A')], label: 'AI' });
  expect(r).toMatchObject({ ok: false, reason: 'conflict' });
  expect(history.doc.variables.map((v) => v.name)).toEqual(['U']);
  await wait(() => { const p = s.takePending(); return !!p && p.doc.variables.length === 1; });
});

it('refuses while the user is editing, and a wrong code', async () => {
  const { history, statuses, server: s } = await linked();
  await wait(() => statuses.some((x) => x.state === 'on'));
  history.begin('sketch');
  expect(await s.request({ kind: 'apply', commands: [addVar('v1', 'A')], label: 'AI' })).toMatchObject({ ok: false, reason: 'busy' });
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
  const app = new AiBridge({ get history() { return history; }, blobs: () => new Map(), isPart: () => true, onStatus: (s) => statuses.push(s) });
  app.connect(server.code);
  await wait(() => statuses.some((x) => x.state === 'on'));
  server.takePending();
  const old = history;
  history = new DocHistory(createEmptyPart());
  app.historyReplaced();
  await wait(() => server!.takePending() !== null);
  expect((await server.request({ kind: 'apply', commands: [addVar('v1', 'A')], label: 'AI' })).ok).toBe(true);
  expect(history.doc.variables.map((v) => v.name)).toEqual(['A']);
  expect(old.doc.variables).toEqual([]);
});
