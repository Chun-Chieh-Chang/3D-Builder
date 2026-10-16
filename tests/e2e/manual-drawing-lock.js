// B2.1 (2026-10-18): locking a view. The 「鎖定」 checkbox of the view's properties: checked, the view keeps the place and the scale it is
// drawn at now — it no longer follows the arrangement, the sheet's shift or the sheet's scale — and dragging it or changing its scale is
// refused, saying 「這個視圖已鎖定」; its dimensions and annotations stay editable. Unchecked again, it can be dragged once more. Replayed in
// the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-drawing-lock.js?' + Date.now());   // in a freshly loaded page
//   await __manualDrawingLock.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualDrawingLock = {});

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
const drw = () => store.getState().drw;
const d = () => store.drawingStore;
const placed = (id) => d().scene().placed.get(id);
const viewOf = (dir) => drw().doc.views.find((v) => v.direction === dir);
const canvas = () => document.querySelector('[data-drawing-canvas]');
const toClient = ([x, y]) => {
  const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
  return [r.left + (x / 420) * r.width, r.top + ((297 - y) / 297) * r.height];
};
const send = (type, at, init = {}) => {
  const [cx, cy] = toClient(at);
  canvas().dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 52, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...init }));
};
const hoverAt = async (at, init = {}) => {
  const [cx, cy] = toClient(at);
  canvas().dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true, pointerId: 52, button: 0, buttons: 0, ...init }));
  await H.wait(60);
};
const click = async (at, init = {}) => {
  await hoverAt(at, init);
  send('pointerdown', at, init);
  await H.wait(60);
  send('pointerup', at, init);
  await H.wait(200);
};
const drag = async (from, to) => {
  await hoverAt(from);
  send('pointerdown', from);
  for (let i = 1; i <= 6; i++) {
    send('pointermove', [from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6]);
    await H.wait(30);
  }
  send('pointerup', to);
  await H.wait(300);
};
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
/** The notice the app is showing now, with the last one dismissed first so what is read is this action's. */
const noticeAfter = async () => {
  await H.wait(80);
  return store.getState().notice?.text ?? '';
};
const dismiss = () => {
  document.querySelector('.status-bar .notice')?.click();
};
const lockBox = () => panel('[data-field="viewLock"]');

M.run = async () => {
  let top;
  await step('1 a new drawing of the plate; the top view chosen, and the panel offers the lock, unchecked', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx` });
    await H.open('定位板.3dbx');
    await H.waitFor(() => store.getState().result?.mesh, 20000, 'the part');
    await H.newDrawing();
    await H.waitFor(() => drw() && drw().doc.views.length === 3 && [...drw().lines.values()].filter(Boolean).length === 3, 30000, 'the three views');
    await H.wait(300);
    top = viewOf('top').id;
    await click(placed(top).at);
    const offered = !!lockBox();
    const unchecked = offered && lockBox().checked === false;
    const chosen = drw().selected === top;
    return { pass: offered && unchecked && chosen, offered, unchecked, chosen };
  });

  await step('2 the lock checked: the view keeps the place and the scale it is drawn at, and it is said', async () => {
    const was = placed(top);
    const wasAt = [was.at[0], was.at[1]];
    const wasScale = was.scale;
    lockBox().click();
    await H.waitFor(() => viewOf('top').locked, 5000, 'the lock');
    const v = viewOf('top');
    const note = await noticeAfter();
    const now = placed(top);
    const stayed = Math.hypot(now.at[0] - wasAt[0], now.at[1] - wasAt[1]) < 0.5 && now.scale === wasScale;
    return { pass: !!v.locked && !!v.at && !!v.scale && stayed && note.includes('已鎖定'), locked: !!v.locked, at: v.at, scale: v.scale, stayed, note };
  });

  await step('3 the locked view is chosen but not dragged: the drag says it is locked, it stays where it was, and there is no scale handle on it', async () => {
    dismiss();
    const before = placed(top).at;
    await drag(before, [before[0] + 60, before[1] + 40]);
    const note = await noticeAfter();
    const after = placed(top).at;
    const stayed = Math.hypot(after[0] - before[0], after[1] - before[1]) < 1e-9;
    const noHandle = !document.querySelector('[data-scale-handle]');
    return { pass: note.includes('這個視圖已鎖定') && stayed && noHandle, note, stayed, noHandle };
  });

  await step('4 the scale of a locked view is refused too: the panel scale keeps what it shows and says the view is locked', async () => {
    dismiss();
    const sel = panel('[data-field="viewScale"]');
    const shown = sel.value;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, shown === '2:1' ? '1:1' : '2:1');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const note = await noticeAfter();
    const still = panel('[data-field="viewScale"]').value === shown && viewOf('top').scale !== undefined;
    return { pass: note.includes('這個視圖已鎖定') && still, note, shown, still };
  });

  await step('5 the lock taken back: the view is dragged to where the pointer takes it', async () => {
    dismiss();
    lockBox().click();
    await H.waitFor(() => !viewOf('top').locked, 5000, 'the unlock');
    const note = await noticeAfter();
    const before = placed(top).at;
    await drag(before, [before[0] + 60, before[1] + 40]);
    const after = placed(top).at;
    const moved = Math.hypot(after[0] - before[0] - 60, after[1] - before[1] - 40) <= 0.5;
    return { pass: note.includes('已解鎖') && moved, note, moved };
  });

  return { name: 'drawing-lock', steps, pass: steps.every((s) => s.pass) };
};
