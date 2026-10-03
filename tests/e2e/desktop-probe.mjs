// Phase 3b-6: what the desktop shell's web view (WebView2 in Tauri) can do. Run the built app with a debugging port, then this script:
//
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
//   & apps\desktop\src-tauri\target\release\desktop.exe        (or: npm run dev -w @3db/desktop)
//   node tests/e2e/desktop-probe.mjs [expression ...]
//
// With no argument it prints the probe below; each argument is a JavaScript expression run in the page instead (its value is printed as JSON).

const port = process.env.DEBUG_PORT ?? '9222';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page');
if (!page) throw new Error('no page on the debugging port');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) waiting.get(msg.id)(msg);
};
const evaluate = (expression) =>
  new Promise((resolve) => {
    const n = ++id;
    waiting.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  }).then((r) => (r.result.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : r.result.result.value));

const PROBE = `(async () => {
  const out = {
    url: location.href,
    secureContext: isSecureContext,
    showOpenFilePicker: typeof window.showOpenFilePicker,
    showSaveFilePicker: typeof window.showSaveFilePicker,
    showDirectoryPicker: typeof window.showDirectoryPicker,
    userAgent: navigator.userAgent,
    crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer,
    wasm: typeof WebAssembly,
    title: document.title,
    bootOverlay: !!document.querySelector('.boot-overlay'),
    resources: [...new Set(performance.getEntriesByType('resource').map((r) => new URL(r.name).origin))],
  };
  try {
    const root = await navigator.storage.getDirectory();
    const h = await root.getFileHandle('probe.txt', { create: true });
    const w = await h.createWritable();
    await w.write('probe');
    await w.close();
    out.opfs = await (await h.getFile()).text();
    await root.removeEntry('probe.txt');
  } catch (e) {
    out.opfs = 'FAILED ' + e;
  }
  try {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('probe', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    db.close();
    indexedDB.deleteDatabase('probe');
    out.indexedDB = 'ok';
  } catch (e) {
    out.indexedDB = 'FAILED ' + e;
  }
  try { out.persist = await navigator.storage.persisted(); out.estimate = await navigator.storage.estimate(); } catch (e) { out.persist = 'FAILED ' + e; }
  return out;
})()`;

// --run script.js:__name.method ...  runs the browser scripts of this folder in the window (the dev build, which serves /@fs/): the page is reloaded
// before each one, as the scripts expect a freshly loaded page.
const args = process.argv.slice(2);
if (args[0] === '--run') {
  const root = new URL('../..', import.meta.url).pathname.replace(/^\//, '').replace(/\/$/, '');
  let failed = 0;
  for (const spec of args.slice(1)) {
    const [file, call] = spec.split(':');
    await evaluate('location.reload()');
    await new Promise((r) => setTimeout(r, 6000));
    const started = Date.now();
    const result = await evaluate(`(async () => { try { await import('/@fs/${root}/tests/e2e/${file}?' + Date.now()); return { ok: true, value: JSON.stringify(await ${call}()).slice(0, 300) }; } catch (e) { return { ok: false, value: String(e && e.message || e) }; } })()`);
    const good = result?.ok === true;
    if (!good) failed++;
    console.log(`${good ? 'PASS' : 'FAIL'}  ${spec}  (${((Date.now() - started) / 1000).toFixed(1)} s)  ${result?.value ?? JSON.stringify(result)}`);
  }
  ws.close();
  process.exit(failed ? 1 : 0);
}
const expressions = args;
if (expressions.length === 0) console.log(JSON.stringify(await evaluate(PROBE), null, 2));
else for (const e of expressions) console.log(JSON.stringify(await evaluate(e), null, 2));
ws.close();
