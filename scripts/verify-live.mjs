// Real MCP stdio + headless browser + app Worker. Uses the same CDP approach as verify-ui, without an extra browser dependency.
// Run after npm run mcp:build. Ports are separate from verify-ui; downloads and browser data stay in a temporary directory.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://127.0.0.1:5395';
const debug = 9335;
const temp = mkdtempSync(join(tmpdir(), '3db-live-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 30000) => {
  const start = Date.now();
  while (!(await fn())) { if (Date.now() - start > ms) throw new Error(`Timed out: ${label}`); await pause(50); }
};
const kill = (p) => { if (!p || p.exitCode !== null) return; if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); else p.kill(); };
let dev, chrome, ws;
const client = new Client({ name: 'verify-live', version: '1' });
const errors = [];
let log = '';
try {
  for (const url of [origin, `http://127.0.0.1:${debug}/json/version`]) {
    let occupied = false;
    try { await fetch(url); occupied = true; } catch { /* no listener */ }
    assert(!occupied, `Test port occupied: ${url}`);
  }
  dev = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5395', '--strictPort'], { cwd: join(root, 'apps/web'), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  dev.stdout.on('data', (s) => { log += s; }); dev.stderr.on('data', (s) => { log += s; });
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, 'Vite');
  const binary = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
  assert(binary, 'Set CHROME_PATH');
  chrome = spawn(binary, [`--remote-debugging-port=${debug}`, `--user-data-dir=${join(temp, 'profile')}`, '--headless=new', '--no-first-run', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,800', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${debug}/json/version`)).ok; } catch { return false; } }, 'Chrome');
  const target = await (await fetch(`http://127.0.0.1:${debug}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true });
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(n, (m) => { clearTimeout(timer); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(temp, 'downloads') });
  await send('Page.navigate', { url: origin });
  await until(() => evaluate('!!document.querySelector(".status-bar")'), 'app');
  await evaluate(`(async()=>{ window.S = (await import('/src/state/store.ts')).store; window.A = (await import('/src/actions.ts')).ACTIONS; })()`);
  await until(() => evaluate('!!S.getState().result && !S.getState().rebuilding'), 'real WASM rebuild');
  assert(!/expected magic word/i.test(log), 'WASM was served as HTML');
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'apps/mcp/dist/server.mjs')], env: { ...process.env, THREEDB_WORKSPACE: join(temp, 'workspace') }, stderr: 'ignore' }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  const live = await call('live_status');
  assert(live.listening);
  await evaluate(`A.find(a=>a.id==='ai-control').run()`);
  await until(() => evaluate('!!document.querySelector("[data-ai-code]")'), 'dialog');
  // Input through the DOM setter and native input event, then submit the actual form.
  await evaluate(`(()=>{ const e=document.querySelector('[data-ai-code]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(live.code)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await evaluate(`document.querySelector('[data-ai-code]').closest('form').requestSubmit()`);
  await until(() => evaluate(`S.getState().ai.state==='on'`), 'connection');
  mkdirSync(resolve(root, 'out/live'), { recursive: true });
  writeFileSync(resolve(root, 'out/live/connected.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate('S.openDialog(null)');
  const commands = [
    { type: 'insertFeature', index: 0, feature: { id: 'live-sketch', name: 'Live circle', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:top' }, entities: [{ id: 'p', type: 'point', x: 0, y: 0 }, { id: 'c', type: 'circle', center: 'p', radius: 10 }], constraints: [] } },
    { type: 'insertFeature', index: 1, feature: { id: 'live-body', name: 'Live cylinder', type: 'extrude', suppressed: false, sketch: 'live-sketch', op: 'boss', dir1: { type: 'blind', depth: '5' } } },
  ];
  assert((await call('apply_commands', { commands })).committed);
  await until(() => evaluate(`!S.getState().rebuilding && Math.abs((S.getState().result?.mass?.volume ?? 0)-Math.PI*500)<1e-6 && document.querySelector('.feature-tree')?.textContent.includes('Live cylinder')`), 'feature tree and physical volume');
  await evaluate(`A.find(a=>a.id==='undo').run()`);
  await until(() => evaluate('S.getState().doc.features.length===0'), 'single undo');
  await pause(350);
  assert.equal((await call('part_summary')).features.length, 0);
  assert((await call('apply_commands', { commands })).committed);
  assert(await evaluate(`S.execute({type:'renameFeature',featureId:'live-body',name:'User cylinder'})`));
  await pause(350);
  assert((await call('part_summary')).features.some((f) => f.name === 'User cylinder'));
  await evaluate(`(async()=>{window.oldHistory=S.history; S.newPart(); if(S.getState().unsaved) await S.answerUnsaved('discard');})()`);
  await until(() => evaluate('S.history!==oldHistory && S.getState().doc.features.length===0'), 'new part');
  await pause(350);
  assert.equal((await call('part_summary')).features.length, 0);
  assert((await call('apply_commands', { commands })).committed);
  assert(await evaluate(`oldHistory.doc.features.some(f=>f.name==='User cylinder') && S.getState().doc.features.some(f=>f.name==='Live cylinder')`));
  await evaluate(`S.history.begin('editing')`);
  const busy = await client.callTool({ name: 'apply_commands', arguments: { commands: [{ type: 'renameFeature', featureId: 'live-body', name: 'Rejected' }] } });
  assert(busy.isError); assert(await evaluate(`S.getState().doc.features.some(f=>f.name==='Live cylinder')`));
  await evaluate(`S.history.rollback()`);
  // An assembly is not a part: the same batch is refused. 「新組合件」 is the product's own path (the folder prompt it leaves is not answered).
  await evaluate(`(async()=>{ S.newAssembly(); if(S.getState().unsaved) await S.answerUnsaved('discard'); })()`);
  await until(() => evaluate(`S.getState().active==='assembly'`), 'assembly');
  const asm = await client.callTool({ name: 'apply_commands', arguments: { commands: [{ type: 'addVariable', variable: { id: 'asm-var', name: 'AsmVar', expr: '1' } }] } });
  assert(asm.isError); assert.match(asm.content[0].text, /assembly or a drawing/);
  // A drawing is not a part either. The real drawing store is put in place with an empty drawing (the file-handle steps of 「新工程圖」 need a project folder).
  await evaluate(`(async()=>{ const M = await import('/@id/@3db/model'); S.showDrawing({ doc: M.createEmptyDrawing(), handle: null, fileName: null, folder: '', untitled: 'Drawing1', project: null }); })()`);
  await until(() => evaluate(`S.getState().active==='drawing'`), 'drawing');
  const drw = await client.callTool({ name: 'apply_commands', arguments: { commands: [{ type: 'addVariable', variable: { id: 'drw-var', name: 'DrwVar', expr: '1' } }] } });
  assert(drw.isError); assert.match(drw.content[0].text, /assembly or a drawing/);
  assert(await evaluate(`S.getState().doc.variables.length===0`));
  await evaluate(`S.disconnectAi()`);
  await until(() => evaluate(`S.getState().ai.state==='off'`), 'disconnect');
  assert.deepEqual(errors, []);
  console.log('PASS: GUI connection, real geometry/tree, batch undo, user edits, new document, busy/assembly/drawing refusal and disconnect');
} finally {
  await client.close(); ws?.close(); kill(chrome); kill(dev);
  writeFileSync(join(temp, 'vite.log'), log);
  console.log(`Test logs and isolated browser data: ${temp}`);
}
