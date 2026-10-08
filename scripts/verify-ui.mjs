// Runs every browser script of tests/e2e in a headless Chrome (or Edge) and reports which pass: the part of the manual checklist
// (docs/manual-verification.html) that a machine can do. No dependency: Chrome is driven over the DevTools protocol with Node's own WebSocket.
//
//   npm run verify:ui                       all scripts
//   npm run verify:ui -- --only "mirror|hole"   the scripts whose file name matches
//   npm run verify:ui -- --shots out/shots  also a screenshot of the page after each script (png)
//   npm run verify:ui -- --json out/ui.json the result as JSON as well
//
// Each script gets a fresh page and an empty browser storage (no recovery copy, no remembered project folder). The dev server is started
// when nothing answers on its port, and stopped again at the end. Exit code 1 when a script fails or the page logs an error.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://127.0.0.1:5391';
const DEBUG_PORT = 9333;
/** Helper files of the scripts, not scripts of their own. */
const NOT_SCRIPTS = new Set(['phase1-demo-parts.js', 'phase3-subassembly.js', 'desktop-probe.mjs', 'manual-support.js']);
/** Errors the page logs that mean nothing (the browser asks for a favicon the dev server has none of). */
const IGNORED_ERRORS = [/favicon/i];

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = option('only') ? new RegExp(option('only')) : null;
const shotsDir = option('shots');
const jsonFile = option('json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kill = (child) => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
};

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error('no Chrome or Edge found: set CHROME_PATH');
  return found;
}

/** The scripts and the calls that run them, read from the usage lines in each file's header (`await __x.run();`). */
function jobs() {
  const dir = join(ROOT, 'tests', 'e2e');
  const out = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.js') || NOT_SCRIPTS.has(file) || (only && !only.test(file))) continue;
    const header = readFileSync(join(dir, file), 'utf8').split('\n').slice(0, 40).filter((l) => l.startsWith('//')).join('\n');
    const calls = [...new Set([...header.matchAll(/await\s+(__\w+\.\w+)\(/g)].map((m) => m[1]))].filter((c) => !c.startsWith('__sub.'));
    out.push({ file, calls });
  }
  return out;
}

/** The STEP samples of tests/fixtures/step, served read-only on the port some scripts read them from (127.0.0.1:5393). */
function serveSamples() {
  const dir = join(ROOT, 'tests', 'fixtures', 'step');
  const samples = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0]);
    const file = join(dir, name);
    if (!name || name.includes('..') || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' }).end(readFileSync(file));
  });
  samples.listen(5393, '127.0.0.1');
  return samples;
}

let server = null;
async function ensureServer() {
  const up = async () => {
    try {
      return (await fetch(ORIGIN)).ok;
    } catch {
      return false;
    }
  };
  if (await up()) return;
  server = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '-w', '@3db/web'], { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 150 && !(await up()); i++) await sleep(200);
  if (!(await up())) throw new Error('the dev server did not start');
}

async function main() {
  await ensureServer();
  const samples = serveSamples();
  const profile = mkdtempSync(join(tmpdir(), '3db-verify-'));
  const chrome = spawn(
    findBrowser(),
    [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720', 'about:blank'],
    { stdio: 'ignore' },
  );
  const cleanup = () => {
    samples.close();
    kill(chrome);
    kill(server);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // the browser may still hold a file
    }
  };
  process.on('exit', cleanup);

  try {
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
        break;
      } catch {
        await sleep(200);
      }
    }
    const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let nextId = 0;
    const pending = new Map();
    let errors = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d);
        pending.delete(d.id);
      } else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      else if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
      else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push(`${d.params.entry.text} ${d.params.entry.url ?? ''}`);
      else if (d.method === 'Runtime.bindingCalled' && d.params.name === '__capture') void takeShot(JSON.parse(d.params.payload));
    };
    /** The folder the screenshots of the script that runs go to (`--shots`), and what a script asked for with `await window.__shot('label')`. */
    let jobShots = null;
    const takeShot = async ({ n, label }) => {
      if (jobShots) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        mkdirSync(jobShots, { recursive: true });
        if (shot.result?.data) writeFileSync(join(jobShots, `${String(n).padStart(2, '0')}-${String(label).replace(/[^\w.-]+/g, '_').slice(0, 80)}.png`), Buffer.from(shot.result.data, 'base64'));
      }
      await send('Runtime.evaluate', { expression: `window.__shotDone = ${n}` });
    };
    const send = (method, params = {}) =>
      new Promise((res) => {
        const id = ++nextId;
        pending.set(id, res);
        ws.send(JSON.stringify({ id, method, params }));
      });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    // `window.__shot(label)` for the scripts: the page asks, this process takes the screenshot (the page cannot), and the page goes on when it is saved
    await send('Runtime.addBinding', { name: '__capture' });
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__shotN = 0; window.__shotDone = 0;
window.__shot = async (label) => { const n = ++window.__shotN; window.__capture(JSON.stringify({ n, label })); for (let i = 0; i < 600 && window.__shotDone < n; i++) await new Promise((r) => setTimeout(r, 25)); };`,
    });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }); // a headless page is not the focused window: without this a field never gets or loses focus (blur, autofocus)
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 600000 });
      return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text } : { value: r.result?.result?.value };
    };
    /** A fresh load of the page; the browser storage is emptied only when `clear` (a script that runs in two loads, like the recovery one, needs what the first left). */
    const freshPage = async (clear = true) => {
      await send('Page.navigate', { url: 'about:blank' });
      await sleep(300);
      if (clear) await send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' });
      await send('Page.navigate', { url: `${ORIGIN}/` });
      await sleep(1500);
      for (let i = 0; i < 100 && !((await evaluate('document.querySelectorAll("canvas").length')).value >= 1); i++) await sleep(200);
      await sleep(2500);
    };
    /** Where a script's result says it failed: a `pass: false`, a non-empty `failed`; a part it left out (`skipped`) is no pass either. */
    const failures = (value, known = []) => {
      const bad = [];
      const walk = (x, path) => {
        if (x === null || typeof x !== 'object') return;
        const before = bad.length;
        if (typeof x.knownIssue === 'string') known.push(x.knownIssue); // a defect that is written down: listed at every run, not a failure
        for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`);
        // the innermost object that says `pass: false` is the one to show: what it holds is the reason
        if (x.pass === false && bad.length === before) bad.push(`${path || '(result)'} ${JSON.stringify(x).slice(0, 400)}`);
        if (x.skipped) bad.push(`${path}.skipped = ${String(x.skipped).slice(0, 100)}`);
        if (Array.isArray(x.failed) && x.failed.length > 0) bad.push(`${path}.failed = ${JSON.stringify(x.failed).slice(0, 120)}`);
      };
      walk(value, '');
      return bad;
    };

    const results = [];
    for (const { file, calls } of jobs()) {
      if (calls.length === 0) {
        results.push({ file, call: '-', status: 'NO ENTRY', detail: 'no `await __x.run();` line in the header' });
        continue;
      }
      for (const [k, call] of calls.entries()) {
        await freshPage(k === 0);
        errors = [];
        jobShots = shotsDir ? join(shotsDir, file.replace(/\.js$/, ''), call.replace(/\W+/g, '_')) : null;
        if (jobShots) rmSync(jobShots, { recursive: true, force: true }); // what an earlier run left
        const started = Date.now();
        const row = { file, call, status: 'PASS', detail: '' };
        const imported = await evaluate(`import('/@fs/${ROOT.replaceAll('\\', '/')}/tests/e2e/${file}?' + Date.now()).then(() => new Promise((r) => setTimeout(r, 1500))).then(() => 'ok')`);
        if (imported.error) Object.assign(row, { status: 'ERROR', detail: `import: ${imported.error.split('\n')[0]}` });
        else {
          const ran = await evaluate(`(async () => JSON.stringify(await ${call}(), (k, x) => (typeof x === 'string' && x.length > 2000 ? x.slice(0, 2000) : x)))()`);
          if (ran.error) Object.assign(row, { status: 'ERROR', detail: ran.error.split('\n')[0] });
          else {
            let value = ran.value;
            try {
              value = JSON.parse(ran.value);
            } catch {
              // not JSON: a plain return value
            }
            const known = [];
            const bad = failures(value, known);
            if (bad.length > 0) Object.assign(row, { status: 'FAIL', detail: bad.slice(0, 3).join('; ') });
            else if (known.length > 0) Object.assign(row, { status: 'KNOWN', detail: `known: ${known.join(' | ')}`, known });
          }
        }
        const logged = errors.filter((e) => !IGNORED_ERRORS.some((re) => re.test(e)));
        if (logged.length > 0) {
          row.consoleErrors = logged.slice(0, 3);
          if (row.status === 'PASS') Object.assign(row, { status: 'CONSOLE', detail: `${logged.length} console error(s): ${logged[0].slice(0, 120)}` });
        }
        row.seconds = Math.round((Date.now() - started) / 100) / 10;
        if (jobShots) {
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          mkdirSync(jobShots, { recursive: true });
          if (shot.result?.data) writeFileSync(join(jobShots, '99-end.png'), Buffer.from(shot.result.data, 'base64'));
        }
        results.push(row);
        console.log(`${row.status.padEnd(8)} ${file} ${call}  ${row.seconds}s${row.detail ? `  ${row.detail}` : ''}`);
      }
    }
    ws.close();

    const count = (s) => results.filter((r) => r.status === s).length;
    console.log(`\n${count('PASS')} of ${results.length} pass; ${count('KNOWN')} pass with a known defect written down; ${results.length - count('PASS') - count('KNOWN')} do not.`);
    if (jsonFile) {
      mkdirSync(dirname(resolve(jsonFile)), { recursive: true });
      writeFileSync(jsonFile, JSON.stringify(results, null, 1));
    }
    process.exitCode = results.every((r) => r.status === 'PASS' || r.status === 'KNOWN') ? 0 : 1;
  } finally {
    cleanup();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
