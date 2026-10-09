// Measuring as eDrawings shows it, and a drawing in inches (asked for by the user): two elements picked in a part draw the shortest line in black with the distance on it and the
// distances along the axes in red, green and blue (dX, dY, dZ) with their labels, on the model; the result says it in words (parallel, the distance, Delta X/Y/Z, the total
// length) and can be copied; the unit is millimetres or inches (decimal, or as fractions with a denominator and the nearest asked for), the angle degrees or radians, and the
// choice is kept; two holes are measured from centre to centre, the shortest way or the farthest; the same in an assembly; a drawing's dimensions are written in inches when
// the sheet says so. Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-measure-view.js?' + Date.now());   // in a freshly loaded page
//   await __manualMeasureView.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualMeasureView = {});

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await window.__shot?.(name);
  steps.push({ name, pass: r?.pass === true, detail: r?.pass === true ? undefined : r });
  return r;
};
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
const panel = () => document.querySelector('[data-measure]');
const result = () => panel()?.querySelector('[data-field="result"] pre')?.textContent ?? '';
const labels = () => [...store.viewer.measureLabels.values()].map((l) => l.el.textContent);
const settled = async (picks) => {
  await H.waitFor(() => {
    const m = store.getState().measure;
    return m && m.picks.length === picks && (m.report || m.error);
  }, 8000, 'the measurement');
  await H.wait(150);
};
const choose = async (field, value) => {
  const el = panel().querySelector(`[data-field="${field}"]`);
  if (el.type === 'checkbox') el.click();
  else {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await H.wait(150);
};
/** The n-th cylinder face with this area: the walls of the Ø9 holes of the plate are 9π × 15 = 424.115 mm² (the corners of the plate are quarters of cylinders, with another area). */
const faceOfType = (type, nth, area) => {
  const fps = store.getState().result.faceFingerprints;
  return fps.map((f, i) => ({ f, i })).filter((x) => x.f.type === type && Math.abs(x.f.size - area) < 0.01)[nth].i;
};

M.run = async () => {
  const trim = (v, places) => String(Math.round(v * 10 ** places) / 10 ** places + 0);
  const gcd = (x, y) => (y === 0 ? x : gcd(y, x % y));
  /** A length (mm) as the nearest fraction of an inch at a denominator, reduced, as it is written. */
  const fraction = (mm, den) => {
    const parts = Math.round((mm / 25.4) * den);
    const whole = Math.floor(parts / den);
    const rest = parts - whole * den;
    const g = rest === 0 ? 1 : gcd(rest, den);
    return `${rest === 0 ? whole : whole === 0 ? `${rest / g}/${den / g}` : `${whole} ${rest / g}/${den / g}`}in`;
  };
  let d; // the distance measured, in millimetres, as the kernel gave it
  await step('1 two corners of the part picked draw the black line with the distance, and the legs along the axes in red, green and blue (one that is nothing is not drawn); the result says it in words', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.action('檔案', '新示範件');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the demo part');
    await H.hud('等角');
    await H.hud('全部顯示');
    await H.action('工具', '測量');
    await H.waitFor(() => panel(), 5000, 'the measure window');
    store.measurePick('vertex', 0, null);
    store.measurePick('vertex', 3, null);
    await settled(2);
    d = store.getState().measure.report.distance;
    const legs = [0, 1, 2].filter((k) => Math.abs(d.delta[k]) > 1e-9).map((k) => 'dX:dY:dZ:'.split(':')[k] + ':');
    const names = labels();
    const drawn = names.filter((n) => /^d[XYZ]:/.test(n)).map((n) => n.slice(0, 3));
    return { pass: names.some((n) => n.startsWith('距離:')) && JSON.stringify(drawn) === JSON.stringify(legs) && !!store.viewer.measureGroup && result().includes('總長度'), names, legs, result: result() };
  });
  await step('2 the numbers are the kernels own: the distance, Delta X, Y and Z to a thousandth, the total length along the axes', async () => {
    const r = result();
    const total = d.delta.reduce((a, v) => a + Math.abs(v), 0);
    return { pass: r.includes(`距離: ${trim(d.value, 3)}mm`) && r.includes(`Delta X: ${trim(Math.abs(d.delta[0]), 3)}mm`) && r.includes(`Delta Y: ${trim(Math.abs(d.delta[1]), 3)}mm`) && r.includes(`Delta Z: ${trim(Math.abs(d.delta[2]), 3)}mm`) && r.includes(`總長度: ${trim(total, 3)}mm`), r };
  });
  await step('3 inches: 25.4 mm to the inch, four decimals; the labels on the model say it too', async () => {
    await choose('lengthUnit', 'in');
    const want = `${trim(d.value / 25.4, 4)}in`;
    return { pass: result().includes(`距離: ${want}`) && result().includes(`Delta X: ${trim(Math.abs(d.delta[0]) / 25.4, 4)}in`) && labels().some((n) => n.includes(want)), want, r: result(), l: labels() };
  });
  await step('4 as fractions: a number that is not one stays a decimal; with the nearest asked for it is the nearest sixteenth; a denominator of 4 changes it to the nearest quarter', async () => {
    await choose('fraction', null);
    const exact = Math.abs(Math.round((d.value / 25.4) * 16) / 16 - d.value / 25.4) < 1e-6;
    const plain = exact || result().includes(`距離: ${trim(d.value / 25.4, 4)}in`);
    await choose('nearest', null);
    const sixteenth = result().includes(`距離: ${fraction(d.value, 16)}`) && labels().some((n) => n.includes(fraction(d.value, 16)));
    await choose('denominator', '4');
    return { pass: plain && sixteenth && result().includes(`距離: ${fraction(d.value, 4)}`), plain, sixteenth, want16: fraction(d.value, 16), want4: fraction(d.value, 4), r: result() };
  });
  await step('5 the choice is kept in the browser; back to millimetres; the angle unit is chosen too', async () => {
    const kept = JSON.parse(localStorage.getItem('3db-measure-options')).unit === 'in';
    await choose('lengthUnit', 'mm');
    await choose('angleUnit', 'rad');
    const rad = store.getState().measureOptions.angle === 'rad';
    await choose('angleUnit', 'deg');
    return { pass: kept && rad && result().includes(`距離: ${trim(d.value, 3)}mm`) && store.getState().measureOptions.unit === 'mm' };
  });
  await step('6 the copy button puts the result into the clipboard text', async () => {
    let copied = null;
    const real = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => (copied = t) } });
    panel().querySelector('[data-field="result"] button').click();
    await H.wait(150);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: real });
    return { pass: typeof copied === 'string' && copied.includes(`距離: ${trim(d.value, 3)}mm`) && copied.includes('總長度'), copied };
  });
  await step('7 two holes of the plate (cylinders, axes alike): centre to centre first, the farthest is the centre distance + both radii, the shortest is it − both radii; the line and its label move with the choice', async () => {
    store.stopMeasure();
    await H.open('定位板.3dbx');
    if (store.getState().unsaved) await H.modalButton('不儲存');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the plate');
    await H.hud('等角');
    await H.action('工具', '測量');
    await H.waitFor(() => panel(), 5000, 'the measure window');
    const [c1, c2] = [faceOfType('cylinder', 0, 424.115), faceOfType('cylinder', 1, 424.115)];
    store.measurePick('face', c1, null);
    store.measurePick('face', c2, null);
    await settled(2);
    const select = panel().querySelector('[data-field="roundMode"]');
    const modes = [...select.options].map((o) => o.value);
    const number = () => Number(/距離: ([\d.]+)mm/.exec(result())[1]);
    const centre = number();
    await choose('roundMode', 'max');
    const max = number();
    await choose('roundMode', 'min');
    const min = number();
    const r1 = store.getState().measure.report.elements[0].radius;
    const r2 = store.getState().measure.report.elements[1].radius;
    return { pass: modes.join() === 'centre,min,max' && near(max - centre, r1 + r2, 0.002) && near(centre - min, r1 + r2, 0.002) && labels().some((n) => n.startsWith('距離:')), modes, centre, max, min, r1, r2 };
  });
  await step('8 a face and a vertex: no round modes (the option is greyed out), the shortest distance is the one drawn', async () => {
    store.measurePick('vertex', 0, null);
    await settled(1);
    store.measurePick('face', 0, null);
    await settled(2);
    const select = panel().querySelector('[data-field="roundMode"]');
    return { pass: select.disabled && select.options.length === 1 };
  });
  await step('9 leaving the tool takes the drawing away from the model', async () => {
    store.stopMeasure();
    await H.wait(200);
    return { pass: !store.viewer.measureGroup && store.viewer.measureLabels.size === 0 };
  });
  // ------------------------------------------------------------ the second part: places, several measurements, labels moved
  const nearly = (p, q, tol = 1e-3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tol;
  /** A place of the plate of this kind, found where the pointer would take it (the first of the candidates that is not hidden and is not taken for a nearer kind). */
  const place = (kind, candidates) => {
    const v = store.viewer;
    for (const c of candidates) {
      const at = H.worldToClient(c);
      if (at.x < 0 || at.y < 0) continue;
      const snap = v.snapAt(at.x, at.y);
      if (snap && snap.kind === kind && nearly(snap.world, c, 0.05)) return { at, snap, world: c };
    }
    return null;
  };
  const clickAt = async (at) => {
    H.ptr('pointermove', at.x, at.y);
    await H.wait(60);
    H.canvas().dispatchEvent(new MouseEvent('click', { clientX: at.x, clientY: at.y, bubbles: true }));
    await H.wait(120);
  };
  const topFirst = (list) => list.slice().sort((a, b) => b[1] - a[1] || b[0] + b[2] - (a[0] + a[2]));
  let found;
  await step('10 the way of picking places: the pointer takes an end, a centre, a middle, a place of an edge, a point of a face, each as itself (the models own numbers)', async () => {
    store.stopMeasure();
    await H.action('工具', '測量');
    await H.waitFor(() => panel(), 5000, 'the measure window');
    panel().querySelector('[data-field="pickPoint"]').click();
    await H.wait(200);
    await H.hud('等角');
    await H.hud('全部顯示');
    const v = store.viewer;
    const data = v.snapData(v.snapSolids()[0]);
    const edgeCandidates = [...data.lines.values()]
      .filter((pts) => pts.length >= 2)
      .map((pts) => [0.3, 0.37, 0.63].map((k) => [pts[0][0] + (pts[pts.length - 1][0] - pts[0][0]) * k, pts[0][1] + (pts[pts.length - 1][1] - pts[0][1]) * k, pts[0][2] + (pts[pts.length - 1][2] - pts[0][2]) * k]))
      .flat();
    found = {
      vertex: place('vertex', topFirst(data.ends)),
      centre: place('centre', topFirst(data.centres)),
      midpoint: place('midpoint', topFirst(data.middles)),
      edge: place('edge', topFirst(edgeCandidates.filter((c) => data.ends.every((e) => Math.hypot(e[0] - c[0], e[1] - c[1], e[2] - c[2]) > 8))).slice(0, 40)),
      face: place('face', [[10, 15, 5], [-10, 15, 5], [10, 15, -5], [0, 15, 12], [20, 15, 15]]),
    };
    return { pass: Object.values(found).every(Boolean), missing: Object.entries(found).filter(([, x]) => !x).map(([k]) => k) };
  });
  await step('11 the pointer over a place marks it and says what it is', async () => {
    const out = {};
    for (const [kind, name] of [['centre', '圓心'], ['vertex', '端點'], ['midpoint', '中點']]) {
      H.ptr('pointermove', found[kind].at.x, found[kind].at.y);
      await H.wait(80);
      out[kind] = store.viewer.measureLabels.get('__snap')?.el.textContent;
      if (out[kind] !== name) return { pass: false, out };
    }
    H.ptr('pointermove', 5, 5);
    await H.wait(80);
    return { pass: true, out };
  });
  await step('12 two places clicked are two points measured: the exact distance, the differences, the line and the labels on the model', async () => {
    await clickAt(found.vertex.at);
    await clickAt(found.centre.at);
    await settled(2);
    const d = store.getState().measure.report.distance;
    const want = Math.hypot(found.vertex.world[0] - found.centre.world[0], found.vertex.world[1] - found.centre.world[1], found.vertex.world[2] - found.centre.world[2]);
    return { pass: near(d.value, want, 1e-3) && store.getState().measure.picks.every((p) => p.point) && labels().some((n) => n.startsWith('距離:')) && result().includes('Delta X'), d: d.value, want };
  });
  await step('13 a place and a face: the exact distance from the point to the face (the plate is 15 thick: a point of its top face is 15 from the bottom face)', async () => {
    store.clearMeasure();
    await H.wait(100);
    await clickAt(found.face.at);
    const bottom = store.getState().result.faceFingerprints.map((f, i) => ({ f, i })).find((x) => x.f.type === 'plane' && x.f.dir && Math.abs(x.f.dir[1] + 1) < 1e-6);
    store.measurePick('face', bottom.i, null);
    await settled(2);
    return { pass: near(store.getState().measure.report.distance.value, 15, 1e-3), d: store.getState().measure.report.distance.value };
  });
  await step('14 keep it: it stays on the model and in the list, and a new measurement starts; the next one is drawn with it', async () => {
    panel().querySelector('[data-action="keep"]').click();
    await H.wait(200);
    const kept = store.getState().measure.saved.length === 1 && store.getState().measure.picks.length === 0;
    const m1 = [...store.viewer.measureLabels.keys()].filter((k) => k.startsWith('m1:'));
    await clickAt(found.vertex.at);
    await clickAt(found.centre.at);
    await settled(2);
    const keys = [...store.viewer.measureLabels.keys()];
    return { pass: kept && m1.length >= 1 && keys.some((k) => k.startsWith('m1:')) && keys.includes('distance') && !!panel().querySelector('[data-field="saved"]'), keys };
  });
  await step('15 a label is taken with the pointer and moved: 20 pixels right and 10 down is what is kept, and it is where it is drawn next time', async () => {
    const entry = store.viewer.measureLabels.get('distance');
    const r = entry.el.getBoundingClientRect();
    const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
    entry.el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 41 }));
    for (let i = 1; i <= 4; i++) {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 5 * i, clientY: y + 2.5 * i, bubbles: true, pointerId: 41 }));
      await H.wait(30);
    }
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 20, clientY: y + 10, bubbles: true, pointerId: 41 }));
    await H.wait(200);
    const off = store.getState().measure.offsets.distance;
    const drawn = store.viewer.measureLabels.get('distance').offset;
    return { pass: !!off && near(off[0], 20, 0.5) && near(off[1], 10, 0.5) && near(drawn[0], 20, 0.5) && near(drawn[1], 16 + 10, 0.5), off, drawn };
  });
  await step('16 copy all: every kept measurement in words; delete one: it is off the list and off the model', async () => {
    let copied = null;
    const real = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => (copied = t) } });
    panel().querySelector('[data-action="copyAll"]').click();
    await H.wait(150);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: real });
    panel().querySelector('[data-field="saved"] li button').click();
    await H.wait(200);
    return { pass: typeof copied === 'string' && copied.startsWith('1.') && copied.includes('距離:') && store.getState().measure.saved.length === 0 && ![...store.viewer.measureLabels.keys()].some((k) => k.startsWith('m1:')), copied };
  });
  await step('17 back to elements: a click takes a face again, and the places are not taken any more', async () => {
    panel().querySelector('[data-field="pickElement"]').click();
    await H.wait(200);
    store.clearMeasure();
    store.measurePick('face', 0, null);
    await settled(1);
    return { pass: store.getState().measure.mode === 'element' && store.getState().measure.picks.length === 1 && store.viewer.snapPicking === false };
  });
  await step('18 a drawing in inches: the sheet\'s unit takes the dimensions, the tolerance and the hole table with it (120 mm is 4.724)', async () => {
    store.stopMeasure();
    await H.action('檔案', '新工程圖');
    await H.waitFor(() => store.getState().drw && store.getState().drw.doc.views.length === 3 && [...store.getState().drw.lines.values()].filter(Boolean).length === 3 && store.getState().drw.features.size === 3, 30000, 'the drawing');
    await H.wait(300);
    const front = store.getState().drw.doc.views.find((v) => v.direction === 'front').id;
    document.querySelector(`[data-drawing-panel] [data-view="${front}"]`).click();
    await H.waitFor(() => store.getState().drw.features.get(front), 30000, 'the elements');
    await H.wait(150);
    document.querySelector('[data-drawing-panel] [data-action="autoDimension"]').click();
    await H.waitFor(() => store.getState().drw.doc.dimensions.length > 0 && store.getState().drw.elements.size >= store.getState().drw.doc.dimensions.length, 30000, 'the dimensions');
    const texts = () => [...store.drawingStore.scene().dimensions.values()].map((o) => o.text);
    const mm = texts();
    const unit = document.querySelector('[data-drawing-panel] [data-field="unit"]');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(unit, 'in');
    unit.dispatchEvent(new Event('change', { bubbles: true }));
    await H.wait(300);
    const inch = texts();
    return { pass: mm.includes('120') && inch.includes('4.724') && !inch.includes('120') && store.getState().drw.doc.sheet.unit === 'in', mm, inch };
  });
  return { name: 'measure-view', steps, pass: steps.every((s) => s.pass) };
};
