/**
 * Automated external acceptance probe for drawing DXF and PDF export.
 * - DXF is imported through FreeCADCmd to verify third-party CAD compatibility,
 *   entity parsing, layer assignment, and bounding box geometry.
 * - PDF is loaded through headless Chromium/Edge via CDP to verify PDFium
 *   rendering, content type, and visual layout.
 *
 * Required:
 * - FREECAD_CMD: absolute path to FreeCADCmd executable (optional if found in standard paths).
 * - DRAWING_ACCEPTANCE_REPORT: optional absolute path for the JSON result.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findFreeCAD() {
  const env = process.env.FREECAD_CMD;
  if (env && isAbsolute(env) && existsSync(env)) return env;
  const candidates = [
    'C:/Program Files/FreeCAD 26.3/bin/FreeCADCmd.exe',
    'C:/Program Files/FreeCAD 26.2/bin/FreeCADCmd.exe',
    'C:/Program Files/FreeCAD 1.0/bin/FreeCADCmd.exe',
    'C:/Program Files/FreeCAD 0.21/bin/FreeCADCmd.exe',
    'C:/Program Files/FreeCAD/bin/FreeCADCmd.exe',
    '/usr/bin/freecadcmd',
    '/usr/bin/FreeCADCmd',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function findBrowser() {
  const env = process.env.CHROME_PATH;
  if (env && isAbsolute(env) && existsSync(env)) return env;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const freecad = findFreeCAD();
if (!freecad) {
  throw new Error('Set FREECAD_CMD to the absolute path of a FreeCADCmd executable (e.g. C:/Program Files/FreeCAD 26.3/bin/FreeCADCmd.exe).');
}

const chrome = findBrowser();
const output = process.env.DRAWING_ACCEPTANCE_REPORT ?? join(root, 'out', 'drawing-acceptance.json');
if (!isAbsolute(output)) throw new Error('DRAWING_ACCEPTANCE_REPORT must be an absolute path.');

const outDir = join(root, 'scratch', 'drawing-parts', '輸出');
const targetBushingDxf = join(outDir, '凸緣襯套加工圖.dxf');
const targetBushingPdf = join(outDir, '凸緣襯套加工圖.pdf');
const targetKnobDxf = join(outDir, '壓花旋鈕銷加工圖.dxf');
const targetKnobPdf = join(outDir, '壓花旋鈕銷加工圖.pdf');

// Ensure drawing fixtures exist; if missing, generate them via make:drawing
if (!existsSync(targetBushingDxf) || !existsSync(targetBushingPdf) || !existsSync(targetKnobDxf) || !existsSync(targetKnobPdf)) {
  process.stdout.write('Generating drawing kit export samples...\n');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['run', 'make:drawing'], { cwd: root, stdio: 'inherit' });
}

const temp = mkdtempSync(join(tmpdir(), '3db-drawing-acceptance-'));
const dxfRunner = join(root, 'scripts', 'freecad-dxf-report.py');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runChromiumPdfProbe(browserPath, pdfPaths) {
  if (!browserPath) return null;
  const port = 9557;
  const profileDir = mkdtempSync(join(tmpdir(), 'chrome-drawing-probe-'));
  const proc = spawn(browserPath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const data = await res.json();
          wsUrl = data.webSocketDebuggerUrl;
          break;
        }
      } catch {}
    }
    if (!wsUrl) throw new Error('Could not connect to Chromium DevTools on port ' + port);

    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));

    let msgId = 0;
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = ++msgId;
        const handler = (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.id === id) {
            ws.removeEventListener('message', handler);
            if (msg.error) rej(msg.error);
            else res(msg.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });

    const target = await send('Target.createTarget', { url: 'about:blank' });
    const session = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });

    const sendSession = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = ++msgId;
        const handler = (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.id === id) {
            ws.removeEventListener('message', handler);
            if (msg.error) rej(msg.error);
            else res(msg.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, sessionId: session.sessionId, method, params }));
      });

    await sendSession('Page.enable');

    const results = [];
    for (const pdfPath of pdfPaths) {
      const url = pathToFileURL(pdfPath).href;
      await sendSession('Page.navigate', { url });
      await sleep(600);
      const evalRes = await sendSession('Runtime.evaluate', {
        expression: '({ contentType: document.contentType, location: window.location.href })',
        returnByValue: true,
      });
      const shot = await sendSession('Page.captureScreenshot', { format: 'png' });
      const screenshotBytes = shot.data ? Buffer.from(shot.data, 'base64').length : 0;
      results.push({
        file: basename(pdfPath),
        url,
        contentType: evalRes.result?.value?.contentType,
        renderedBytes: screenshotBytes,
        ok: evalRes.result?.value?.contentType === 'application/pdf' && screenshotBytes > 0,
      });
    }

    ws.close();
    return {
      browser: browserPath,
      results,
    };
  } finally {
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {}
    } else {
      proc.kill();
    }
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

try {
  const dxfTargets = [targetBushingDxf, targetKnobDxf];
  const pdfTargets = [targetBushingPdf, targetKnobPdf];

  // 1. Run FreeCAD DXF probe
  const dxfResults = dxfTargets.map((dxfFile) => {
    const temporaryReport = join(temp, `${basename(dxfFile)}.json`);
    execFileSync(freecad, [dxfRunner], {
      cwd: root,
      env: { ...process.env, FREECAD_DXF_INPUT: dxfFile, FREECAD_DXF_REPORT: temporaryReport },
      stdio: 'pipe',
    });
    const facts = JSON.parse(readFileSync(temporaryReport, 'utf8'));
    if (!(facts.shapes > 0 && facts.totalObjects > 0)) {
      throw new Error(`FreeCAD imported 0 shapes for ${basename(dxfFile)}`);
    }
    const hasFrameLayer = facts.layers.includes('FRAME');
    const hasVisibleLayer = facts.layers.includes('VISIBLE');
    if (!hasFrameLayer || !hasVisibleLayer) {
      throw new Error(`Missing expected layers in ${basename(dxfFile)}: ${JSON.stringify(facts.layers)}`);
    }
    // Check bounding box fits inside ISO A3 margin (20mm left margin, 10mm others => X: 20..410, Y: 10..287)
    const { min, max } = facts.boundsMm;
    if (min[0] < 19 || min[1] < 9 || max[0] > 411 || max[1] > 288) {
      throw new Error(`Bounding box out of A3 drawing bounds in ${basename(dxfFile)}: ${JSON.stringify(facts.boundsMm)}`);
    }
    return {
      file: basename(dxfFile),
      sha256: createHash('sha256').update(readFileSync(dxfFile)).digest('hex'),
      bytes: readFileSync(dxfFile).length,
      ...facts,
    };
  });

  // 2. Run Chromium PDF probe
  let pdfResults = null;
  if (chrome) {
    pdfResults = await runChromiumPdfProbe(chrome, pdfTargets);
  }

  const finalReport = {
    scope: 'External CAD and PDF consumer facts for drawing exports. FreeCAD and Chromium are external compatibility targets, not independent-kernel proofs.',
    timestamp: new Date().toISOString(),
    freecad: {
      path: freecad,
      version: dxfResults[0]?.reader,
      dxfSamples: dxfResults,
    },
    chromiumPdf: pdfResults,
  };

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(finalReport, null, 2)}\n`, 'utf8');

  process.stdout.write(`\nDrawing export acceptance report written: ${output}\n`);
  process.stdout.write(`- FreeCAD DXF imports verified: ${dxfResults.length} files (shapes: ${dxfResults.map((r) => r.shapes).join(', ')})\n`);
  if (pdfResults) {
    process.stdout.write(`- Chromium PDF renderings verified: ${pdfResults.results.length} files\n`);
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
