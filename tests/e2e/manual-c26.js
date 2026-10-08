// Manual checklist C26 (docs/manual-verification.html): the snaps of the sketch with the cursor over the places the text names: the quarter point of a circle, the crossing of two lines,
// the tangent from a point to a circle, the foot of a square line, the options (the quarter point off, 啟用抓取 off), the grid, the angle step, Shift for the length, 快速抓取 from the
// right-hand menu; replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
// The cursor is a pointer move over the place; what it shows is the name beside it (what a person reads) and the point that a click then makes.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c26.js?' + Date.now());   // in a freshly loaded page
//   await __manualC26.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC26 = {});

const dialog = () => document.querySelector('.modal');
/** The cursor over a sketch place (no click): what the name beside it says. */
async function hover(u, v, extra = {}) {
  const { x, y } = H.toClient(u, v);
  H.ptr('pointermove', x, y, extra);
  await H.wait(150);
  return [...document.querySelectorAll('.overlay-label.hint')].map((e) => e.textContent).join('|');
}
const pointNear = (u, v) => {
  const id = H.pointAt(u, v);
  const g = H.geom().get(id);
  return { id, p: g?.p };
};
const snapOption = async (label, on) => {
  await H.action('工具', '系統選項…');
  const l = [...dialog().querySelectorAll('.snap-options label')].find((x) => x.textContent.trim().startsWith(label));
  const box = l.querySelector('input');
  if (box.checked !== on) box.click();
  await H.wait(150);
  [...dialog().querySelectorAll('button')].find((b) => b.classList.contains('primary')).click();
  await H.wait(200);
};
const optionNumber = async (label, value) => {
  await H.action('工具', '系統選項…');
  const l = [...dialog().querySelectorAll('.snap-options label')].find((x) => x.textContent.trim().startsWith(label));
  await S.type(l.querySelector('input'), value, { enter: false });
  [...dialog().querySelectorAll('button')].find((b) => b.classList.contains('primary')).click();
  await H.wait(200);
};
const constraints = () => H.sketch().constraints.map((c) => c.type);

M.run = async () => {
  await step('1 a new sketch on the top plane; a circle of radius 6 at (10, 10)', async () => {
    await S.fresh();
    await H.treeClick('上基準面');
    await H.action('草圖', '草圖');
    await H.frameSketch(10, 0, 9);
    await H.tool('圓');
    await H.sk(10, 10);
    await H.sk(16, 10.01);
    await H.solved();
    return { circles: H.sketch().entities.filter((e) => e.type === 'circle').length, pass: H.sketch().entities.filter((e) => e.type === 'circle').length === 1 };
  });
  await step('2 「點」 with the cursor near the top of the circle: 四分之一點; the click makes a point on the circle straight above the centre', async () => {
    await H.tool('點');
    const label = await hover(10.15, 15.8);
    await shot('2-quarter-point');
    await H.sk(10.15, 15.8);
    await H.key('Escape');
    await H.solved();
    const made = pointNear(10, 16);
    return { label, made, cons: constraints(), pass: label === '四分之一點' && !!made.p && Math.hypot(made.p[0] - 10, made.p[1] - 16) < 1e-4 && constraints().includes('vertical') && constraints().includes('pointOnCurve') };
  });
  await step('3 two crossing slanted lines and 「點」 near the crossing: 交點; the click is at the crossing', async () => {
    // they cross at 0.3 of the first and 0.65 of the second: not at the middle of either (that would be named 中點)
    await H.tool('直線');
    await H.sk(-4, -4);
    await H.sk(14, -10);
    await H.key('Escape');
    await H.sk(-3.8, -14.9);
    await H.sk(4.2, -0.9);
    await H.key('Escape');
    await H.solved();
    const lineFrom = (u, v) => [...H.geom()].map(([, g]) => g).find((g) => g.type === 'line' && Math.hypot(g.a[0] - u, g.a[1] - v) < 0.5);
    const a = lineFrom(-4, -4);
    const b = lineFrom(-3.8, -14.9);
    const det = (a.b[0] - a.a[0]) * (b.b[1] - b.a[1]) - (a.b[1] - a.a[1]) * (b.b[0] - b.a[0]);
    const t = ((b.a[0] - a.a[0]) * (b.b[1] - b.a[1]) - (b.a[1] - a.a[1]) * (b.b[0] - b.a[0])) / det;
    const cross = [a.a[0] + t * (a.b[0] - a.a[0]), a.a[1] + t * (a.b[1] - a.a[1])];
    await H.tool('點');
    const label = await hover(cross[0] + 0.1, cross[1] + 0.1);
    await shot('3-intersection');
    await H.sk(cross[0] + 0.1, cross[1] + 0.1);
    await H.key('Escape');
    await H.solved();
    const made = pointNear(cross[0], cross[1]);
    return { label, cross, made, pass: label === '交點' && !!made.p && Math.hypot(made.p[0] - cross[0], made.p[1] - cross[1]) < 1e-4 };
  });
  await step('4 a circle of radius 5 and a line from a point outside it: near the tangent point 相切; the line is tangent', async () => {
    await H.tool('圓');
    await H.sk(-12, 14);
    await H.sk(-7, 14.01);
    await H.solved();
    const c = [...H.geom()].filter(([, g]) => g.type === 'circle').at(-1)[1];
    const s = [-27, 14];
    const d = Math.hypot(c.c[0] - s[0], c.c[1] - s[1]);
    const len = Math.sqrt(d * d - c.r * c.r);
    const ang = Math.asin(c.r / d);
    const base = Math.atan2(c.c[1] - s[1], c.c[0] - s[0]);
    const T = [s[0] + len * Math.cos(base + ang), s[1] + len * Math.sin(base + ang)];
    await H.tool('直線');
    await H.sk(...s);
    const label = await hover(T[0] + 0.1, T[1] + 0.1);
    await shot('4-tangent');
    await H.sk(T[0] + 0.1, T[1] + 0.1);
    await H.key('Escape');
    await H.solved();
    return { label, T, cons: constraints(), pass: label === '相切' && constraints().includes('tangent') };
  });
  await step('5 a horizontal line and a line started 8 above it, the cursor over the foot: 互相垂直; the line is square to it', async () => {
    await H.tool('直線');
    await H.sk(-8, -20);
    await H.sk(30, -20);
    await H.key('Escape');
    await H.solved();
    await H.sk(14, -12);
    const label = await hover(14.1, -19.9);
    await shot('5-perpendicular');
    await H.sk(14.1, -19.9);
    await H.key('Escape');
    await H.solved();
    return { label, cons: constraints(), pass: label === '互相垂直' && constraints().includes('perpendicular') };
  });
  await step('6 the option 四分之一點 off: the same place gives no quarter point; ticked again, it does', async () => {
    // the left side of the circle: the top already has the point of step 2 (and would be named 重合)
    await snapOption('四分之一點', false);
    await H.tool('點');
    const off = await hover(3.85, 10.2);
    await snapOption('四分之一點', true);
    await H.tool('點');
    const on = await hover(3.85, 10.2);
    return { off, on, pass: off !== '四分之一點' && on === '四分之一點' };
  });
  await step('7 啟用抓取 off: a line near horizontal has no relation added and nothing shows; ticked again', async () => {
    await snapOption('啟用抓取', false);
    await H.tool('直線');
    await H.sk(30, 20);
    const label = await hover(40, 20.8);
    const before = H.sketch().constraints.length;
    await H.sk(40, 20.8);
    await H.key('Escape');
    await H.solved();
    const added = H.sketch().constraints.length - before;
    const end = [...H.geom()].filter(([, g]) => g.type === 'point').at(-1)[1].p;
    await snapOption('啟用抓取', true);
    return { label, added, end, pass: label === '' && added === 0 && Math.abs(end[1] - 20.8) < 1e-6 };
  });
  await step('8 網格 on with 間距 5: 「點」 near (42.4, 7.6) lands on (40, 10); off again', async () => {
    await H.frameSketch(50, 0, 6); // the places of the next steps are to the right of what has been drawn
    await snapOption('網格', true);
    await H.tool('點');
    await H.sk(42.4, 7.6);
    await H.key('Escape');
    await H.solved();
    const p = pointNear(40, 10);
    await snapOption('網格', false);
    return { p, pass: !!p.p && Math.hypot(p.p[0] - 40, p.p[1] - 10) < 1e-6 };
  });
  await step('9 角度 on with 間隔 15: a line about 13.5° from its start is turned to exactly 15°; off again', async () => {
    // not 17°: a line that comes near the direction of another line of the sketch (the tangent one is at 19.5°) is named 平行 first and follows that line
    await snapOption('角度（', true);
    await H.tool('直線');
    await H.sk(95, -40);
    await H.sk(95 + 20 * Math.cos((13.5 * Math.PI) / 180), -40 + 20 * Math.sin((13.5 * Math.PI) / 180));
    await H.key('Escape');
    await H.solved();
    const l = [...H.geom()].filter(([, g]) => g.type === 'line').at(-1)[1];
    const angle = (Math.atan2(l.b[1] - l.a[1], l.b[0] - l.a[0]) * 180) / Math.PI;
    await snapOption('角度（', false);
    return { angle, pass: Math.abs(angle - 15) < 1e-6 };
  });
  await step('10 Shift while the end of a line is put: the length is a whole number of the grid spacing (5)', async () => {
    // away from the lines up to now, so that nothing lines up with them on the way (a point in line with another would take the cursor before Shift does)
    await H.tool('直線');
    // and in a direction no line of the sketch has (within 3°), or the line would be named 平行 and follow that one
    await H.sk(75, -30);
    await H.sk(75 + 13.3 * Math.cos((40 * Math.PI) / 180), -30 + 13.3 * Math.sin((40 * Math.PI) / 180), { shiftKey: true });
    await H.key('Escape');
    await H.solved();
    const l = [...H.geom()].filter(([, g]) => g.type === 'line').at(-1)[1];
    const length = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    return { length, pass: Math.abs(length / 5 - Math.round(length / 5)) < 1e-6 && length >= 5 };
  });
  await step('11 right-click with 「點」: 快速抓取 → 交點: only the crossing snaps (an end point does not); the panel says so', async () => {
    await H.tool('點');
    const { x, y } = H.toClient(30, -5);
    H.ptr('pointermove', x, y);
    await H.wait(80);
    H.canvas().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
    await H.wait(200);
    const top = [...document.querySelectorAll('.ctx-menu button')].map((b) => b.textContent);
    [...document.querySelectorAll('.ctx-menu button')].find((b) => /快速抓取/.test(b.textContent)).click();
    await H.wait(150);
    const choices = [...document.querySelectorAll('.ctx-menu button')].map((b) => b.textContent);
    [...document.querySelectorAll('.ctx-menu button')].find((b) => b.textContent.replace('✔ ', '') === '交點').click();
    await H.wait(200);
    const panel = S.pmText();
    const atEnd = await hover(-4.05, -4.05); // near the end point of the first slanted line
    await shot('11-quick-snap');
    await S.pmClick('取消快速抓取');
    return { top, choices, panel: panel.slice(0, 160), atEnd, pass: top.includes('快速抓取') && choices.includes('交點') && /快速抓取：只留「交點」/.test(panel) && atEnd === '' };
  });
  // (the picture of a sketch, 草圖圖片, is phase3-sketch-picture.js, which verify:ui runs in a page of its own)
  return S.result('C26');
};
