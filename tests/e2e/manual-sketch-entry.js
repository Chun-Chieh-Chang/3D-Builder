// Values typed while drawing (P1, G01; docs/design/sketch-interaction/plan.md B01–B04, T09), replayed in the app's page the way a person does it:
// typing in the sketch moves the keyboard into the box next to the cursor, Tab goes to the next box, Enter makes the shape with the typed values as
// driving dimensions (one undo), the IME's own Enter makes nothing, a value that cannot be used is said where it was typed, Esc drops what was typed
// and then ends the step. `npm run verify:ui -- --only manual-sketch-entry`. Not a Vitest test.
//
//   await __sketchEntry.run();
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui, { store } = H;
const check = (ok, message) => { if (!ok) throw new Error(message); };
const box = () => document.querySelector('[data-sketch-entry]');
const field = (key) => document.querySelector(`[data-sketch-entry] input[data-entry="${key}"]`);
/** Types into a box as the keyboard would: React reads the value from an input event. */
const type = (input, text) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
/** A key pressed in the box that has the keyboard. */
const keyIn = async (input, key, init = {}) => {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  await H.wait(80);
};
const move = async (u, v) => {
  const c = H.toClient(u, v);
  H.ptr('pointermove', c.x, c.y);
  await H.wait(80);
};
/** A sketch click that says which one failed, with the view state at that moment. */
const sk = async (u, v, label) => {
  const t = H.toClient(u, v);
  try {
    await H.sk(u, v);
  } catch (e) {
    const r = H.rect();
    throw new Error(`${label}: toClient(${Math.round(t.x)}, ${Math.round(t.y)}) rect(${Math.round(r.left)}, ${Math.round(r.top)}, w ${Math.round(r.width)}, h ${Math.round(r.height)}) pxPerMm ${H.pxPerMm().toFixed(2)} | ${e.message}`);
  }
};
const dims = () => H.sketch().constraints.filter((c) => ['distance', 'angle', 'radius', 'diameter'].includes(c.type));

window.__sketchEntry = { run: async () => {
  const steps = [];
  const step = async (name, fn) => {
    try {
      steps.push({ name, pass: true, ...((await fn()) ?? {}) });
    } catch (e) {
      steps.push({ name, pass: false, error: String(e?.message ?? e) });
    }
  };
  H.ready(); await H.action('檔案', '新零件'); await H.treeClick('前基準面'); await H.action('草圖', '草圖');
  await H.frameSketch(15, 5, 12);

  await step('B01 a line from the origin: typing moves the keyboard into the length box, Tab to the angle, Enter makes it 30 long at 30° with two driving dimensions', async () => {
    await H.tool('直線');
    check(!box(), 'no box before the start is clicked');
    await H.sk(0, 0);
    await move(20, 9);
    check(box() && field('length') && field('angle'), 'length and angle boxes next to the cursor');
    check(field('length').placeholder !== '' && field('angle').placeholder !== '', 'the cursor values shown while nothing is typed');
    const r = box().getBoundingClientRect(), c = H.toClient(20, 9);
    check(r.left >= c.x && r.top >= c.y && r.left - c.x < 40 && r.top - c.y < 40, `box beside the cursor (${r.left - c.x}, ${r.top - c.y})`);
    await H.key('3');
    check(document.activeElement === field('length') && field('length').value === '3', 'the first digit starts the length box, which has the keyboard');
    type(field('length'), '30');
    await keyIn(field('length'), 'Tab');
    check(document.activeElement === field('angle'), 'Tab moves to the angle box');
    type(field('angle'), '30');
    await keyIn(field('angle'), 'Enter');
    await H.solved();
    const line = H.sketch().entities.find((e) => e.type === 'line');
    check(line, 'a line was made');
    const made = dims();
    check(made.length === 2 && made.some((d) => d.type === 'distance' && d.a === line.id && d.value === '30') && made.some((d) => d.type === 'angle' && d.b === line.id && d.value === '30'), `length and angle dimensions: ${JSON.stringify(made)}`);
    const g = H.geom().get(line.id);
    const length = Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]), angle = Math.atan2(g.b[1] - g.a[1], g.b[0] - g.a[0]);
    check(Math.abs(length - 30) <= 1e-6 && Math.abs(angle - Math.PI / 6) <= 1e-6, `solved ${length} at ${(angle * 180) / Math.PI}°`);
    check(document.activeElement !== field('length') && document.activeElement !== field('angle'), 'Enter gives the keyboard back to the sketch');
    return { length, angle: (angle * 180) / Math.PI };
  });

  await step('B04 / T09 the IME composing Enter makes nothing; Esc in the box drops what was typed and keeps the chain; Esc again ends it, then the tool', async () => {
    await move(40, 0);
    const before = JSON.stringify(H.sketch());
    await H.key('1');
    const input = field('length');
    check(document.activeElement === input, 'typing starts the next segment\'s length');
    await keyIn(input, 'Enter', { isComposing: true });
    await keyIn(input, 'Enter', { keyCode: 229 });
    await H.wait(150);
    check(JSON.stringify(H.sketch()) === before, 'an Enter while composing made nothing');
    await keyIn(input, 'Escape');
    check(H.view().tool === 'line' && box() && field('length').value === '', 'Esc dropped the typed value; the chain goes on');
    await H.key('Escape');
    check(H.view().tool === 'line' && !box(), 'the next Esc ended the chain');
    await H.key('Escape');
    check(H.view().tool === 'select', 'and the next one the tool');
    check(JSON.stringify(H.sketch()) === before, 'what was drawn stays as it was');
  });

  await step('B01 the line and both dimensions are one undo step, and come back with one redo', async () => {
    const before = H.sketch().entities.length;
    store.undo(); await H.solved();
    check(H.sketch().entities.length === 0 && H.sketch().constraints.length === 0, `undo left ${JSON.stringify(H.sketch())}`);
    store.redo(); await H.solved();
    check(H.sketch().entities.length === before && dims().length === 2, 'redo restored the line and both dimensions');
  });

  await step('B03 a circle typed Ø8, switched to R with the button: one radius dimension of 4', async () => {
    await H.tool('圓');
    await H.sk(40, 10);
    await move(43, 10);
    await H.key('8');
    check(field('diameter')?.value === '8', 'the diameter box took the 8');
    document.querySelector('[data-sketch-entry] [data-entry-mode]').click();
    await H.wait(80);
    check(field('radius')?.value === '4', `switched to R4 (${field('radius')?.value})`);
    await keyIn(field('radius'), 'Enter');
    await H.solved();
    const circle = H.sketch().entities.find((e) => e.type === 'circle');
    const added = dims().filter((d) => d.circle === circle?.id);
    check(added.length === 1 && added[0].type === 'radius' && added[0].value === '4', `one radius dimension: ${JSON.stringify(added)}`);
    check(Math.abs(H.geom().get(circle.id).r - 4) <= 1e-6, 'solved radius 4');
    await H.selectTool();
  });

  await step('T09 a rectangle width typed 0 is refused where it is typed and makes nothing; a center rectangle typed 40 × 25 is made', async () => {
    await H.tool('中心矩形');
    await H.sk(-5, -12);
    await move(5, -8);
    const before = JSON.stringify(H.sketch());
    await H.key('0');
    await keyIn(field('width'), 'Enter');
    await H.wait(150);
    const alert = document.querySelector('[data-sketch-entry] .entry-error');
    check(alert && alert.textContent.includes('0') && field('width').classList.contains('invalid'), 'the box says why 0 cannot be used');
    check(JSON.stringify(H.sketch()) === before, 'nothing made');
    type(field('width'), '40');
    await keyIn(field('width'), 'Tab');
    type(field('height'), '25');
    await keyIn(field('height'), 'Enter');
    await H.solved();
    const sides = H.sketch().entities.filter((e) => e.type === 'line' && !e.construction).slice(-4).map((e) => H.geom().get(e.id));
    const xs = sides.flatMap((g) => [g.a[0], g.b[0]]), ys = sides.flatMap((g) => [g.a[1], g.b[1]]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    check(Math.abs(w - 40) <= 1e-6 && Math.abs(h - 25) <= 1e-6, `solved ${w} × ${h}`);
    await H.selectTool();
    return { w, h };
  });

  await step('B05 slot typed length 30 at 0° and width 10: driving distance, angle, and width dimensions; Esc tiers and one undo', async () => {
    await H.tool('狹槽');
    // the slot is diffed against a snapshot: earlier steps of this script already drew lines, a circle and a rectangle in the same sketch,
    // so absolute counts would see them too; dims are diffed the same way so a pre-existing distance 30 / angle 30 cannot stand in for the slot's own
    const bEnt = H.sketch().entities, bDims = new Set(dims().map((d) => JSON.stringify(d)));
    const bLines = bEnt.filter((e) => e.type === 'line' && !e.construction).length, bArcs = bEnt.filter((e) => e.type === 'arc').length;
    await sk(0, 20, 'B05 slot stage-1 start');
    await move(25, 20);
    check(box() && field('length') && field('angle'), 'length and angle boxes beside cursor on stage 1');
    await H.key('3');
    type(field('length'), '30');
    await keyIn(field('length'), 'Tab');
    type(field('angle'), '0');
    await keyIn(field('angle'), 'Enter');
    await move(30, 25);
    check(box() && field('width'), 'width box on stage 2');
    type(field('width'), '10');
    await keyIn(field('width'), 'Enter');
    await H.solved();

    const entities = H.sketch().entities;
    const slotArcs = entities.filter((e) => e.type === 'arc').length - bArcs;
    const slotLines = entities.filter((e) => e.type === 'line' && !e.construction).length - bLines;
    check(slotArcs === 2 && slotLines === 2, `slot arcs (+${slotArcs}) and lines (+${slotLines})`);
    const slotDims = dims().filter((d) => !bDims.has(JSON.stringify(d)));
    check(slotDims.some((d) => d.type === 'distance' && d.value === '30'), `slot length dimension 30: ${JSON.stringify(slotDims)}`);
    check(slotDims.some((d) => d.type === 'angle' && d.value === '0'), 'slot angle dimension 0°');
    check(slotDims.some((d) => (d.type === 'diameter' && d.value === '10') || (d.type === 'radius' && d.value === '5')), 'slot width dimension 10');

    // Esc tiering check (a start click inside the canvas: at this framing v=35 would be above the visible canvas)
    await sk(0, 28, 'B05 esc-tier click');
    await move(20, 35);
    await H.key('2');
    check(field('length')?.value === '2', 'stage 1 typed length');
    await keyIn(field('length'), 'Escape');
    check(field('length')?.value === '', 'first Esc clears input text');
    await H.key('Escape');
    check(!box(), 'second Esc cancels start point');
    await H.key('Escape');
    check(H.view().tool === 'select', 'third Esc exits tool');

    // Undo / Redo
    const countBefore = H.sketch().entities.length;
    store.undo(); await H.solved();
    check(H.sketch().entities.length < countBefore, 'one undo removed slot and its dimensions');
    store.redo(); await H.solved();
    check(H.sketch().entities.length === countBefore, 'one redo restored slot');
    await H.selectTool();
  });

  await step('B06 polygon typed radius 15 at 30°: radius and ray angle dimensions; mode toggle between R and L; one undo', async () => {
    await H.tool('多邊形');
    // a snapshot baseline as in B05: the five lines and slot already in the sketch must not count as the hexagon's sides,
    // and B01's angle 30° must not stand in for the ray's angle dimension
    const bEnt = H.sketch().entities, bDims = new Set(dims().map((d) => JSON.stringify(d)));
    const bLines = bEnt.filter((e) => e.type === 'line' && !e.construction).length, bRays = bEnt.filter((e) => e.type === 'line' && e.construction).length;
    await sk(-20, 20, 'B06 polygon start');
    await move(-10, 25);
    check(box() && field('radius') && field('angle'), 'radius and angle boxes beside cursor');
    // Test mode toggle button
    const toggleBtn = document.querySelector('[data-sketch-entry] [data-entry-mode]');
    check(toggleBtn, 'mode toggle button present');
    toggleBtn.click();
    await H.wait(80);
    check(field('edge') && !field('radius'), 'toggled to edge length mode');
    toggleBtn.click();
    await H.wait(80);
    check(field('radius') && !field('edge'), 'toggled back to radius mode');

    await H.key('1');
    type(field('radius'), '15');
    await keyIn(field('radius'), 'Tab');
    type(field('angle'), '30');
    await keyIn(field('angle'), 'Enter');
    await H.solved();

    const entities = H.sketch().entities;
    const polyLines = entities.filter((e) => e.type === 'line' && !e.construction).length - bLines;
    const rays = entities.filter((e) => e.type === 'line' && e.construction).length - bRays;
    check(polyLines === 6, `hexagon created with +${polyLines} sides`);
    check(rays >= 1, `orientation ray created (+${rays})`);

    const polyDims = dims().filter((d) => !bDims.has(JSON.stringify(d)));
    check(polyDims.some((d) => d.type === 'radius' && d.value === '15'), `polygon radius dimension 15: ${JSON.stringify(polyDims)}`);
    check(polyDims.some((d) => d.type === 'angle' && d.value === '30'), 'ray angle dimension 30°');

    // Undo / Redo
    const countBefore = H.sketch().entities.length;
    store.undo(); await H.solved();
    check(H.sketch().entities.length < countBefore, 'one undo removed polygon and its dimensions');
    store.redo(); await H.solved();
    check(H.sketch().entities.length === countBefore, 'one redo restored polygon');
    await H.selectTool();
  });

  return { steps, pass: steps.every((s) => s.pass) };
} };
