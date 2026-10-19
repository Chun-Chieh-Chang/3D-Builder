// E1 側邊欄比照工程圖（docs/sidebar-parity-plan.md、ADR 0155）§2.2 的組合件一半：圖面點到的零組件自動切到屬性頁（標題列＋識別群組框：
// 名稱、零組件／子組合件、固定／浮動、零件檔）、✓ 清除回樹頁、樹上點選留在樹頁只讓屬性頁可達、結合的識別與「編輯結合」。右鍵選單與左鍵拖曳
// 維持原行為（拖曳仍可移動零組件）。Replayed in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-asm-selection.js?' + Date.now());   // in a freshly loaded page
//   await __manualAsmSelection.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const M = (window.__manualAsmSelection = {});

const steps = [];
const step = async (name, fn) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, error: String(e?.message ?? e) };
  }
  await window.__shot?.(name);
  steps.push({ name, pass: r?.pass === true, measured: r, detail: r?.pass === true ? undefined : r });
  return r;
};
const asm = () => H.asm(); // the open assembly's UI state (its store is `store.assembly`)
const nameOf = (c) => io.componentName(asm().doc.files.find((f) => f.id === c.file)?.path, c.instance);
/** The two tab buttons of the part/assembly sidebar, in the order the panel draws them. */
const tabEls = () => [...document.querySelectorAll('.left-panel .sw-tabs [role="tab"]')];
const tabs = () => tabEls().map((b) => ({ text: b.textContent, selected: b.getAttribute('aria-selected'), disabled: b.disabled }));
/** The two panes of the sidebar: [0] the tree, [1] the properties — with whether the page currently shows them. */
const panes = () => [...document.querySelectorAll('.left-panel .sw-pane')].map((p) => ({ hidden: p.hasAttribute('hidden'), display: getComputedStyle(p).display }));
const selPanel = () => document.querySelector('.sw-pane:not([hidden]) [data-selection-panel]');
const row = (name) => [...document.querySelectorAll('.feature-tree .tree-row')].find((r) => H.rowName(r) === name);
/** A point of the canvas where the component is under the cursor. */
const spot = (id) => {
  const r = H.rect();
  for (let fy = 0.1; fy < 0.95; fy += 0.04) {
    for (let fx = 0.05; fx < 0.97; fx += 0.04) {
      const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
      if (store.viewer.pickInstance(x, y) === id) return [x, y];
    }
  }
  return null;
};
/** A left click at a point of the canvas (the cursor comes in, so the preview follows it). */
const clickAtPoint = async ([x, y]) => {
  const c = H.canvas();
  for (let i = 3; i >= 0; i--) c.dispatchEvent(new PointerEvent('pointermove', { clientX: x - i * 7, clientY: y - i * 5, bubbles: true, pointerId: 1 }));
  c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: 1 }));
  c.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: 0 }));
  c.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  await H.wait(120);
};
/** A new assembly with the plate (the first, fixed) and the V-block (floating), nothing picked. */
const openAssembly = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
  await H.action('檔案', '新組合件');
  if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
  const plate = await H.insert('定位板.3dbx');
  const block = await H.insert('V型塊.3dbx', [0.5, 0.2]);
  await H.loaded();
  await H.hud('等角');
  await H.hud('全部顯示');
  store.assembly?.select(null); // as clicking nothing (Esc) does: nothing picked to start from
  await H.wait(100);
  return { plate, block };
};

M.run = async () => {
  let plate;
  let block;
  await step('1 nothing picked: the two tabs are there, the tree is the page shown, the PropertyManager tab is off', async () => {
    ({ plate, block } = await openAssembly());
    const t = tabs();
    const p = panes();
    return {
      pass: t.length === 2 && t[0].text === 'FeatureManager' && t[1].text === 'PropertyManager' && t[0].selected === 'true' && t[1].selected === 'false' && t[1].disabled === true && p[0].hidden === false && p[1].hidden === true && !!document.querySelector('.sw-pane:not([hidden]) [data-component-row]'),
      tabs: t,
      panes: p,
    };
  });

  await step('2 the plate clicked in the graphics area brings the properties page forward (§2.2): its name, kind, state and file', async () => {
    const at = spot(plate.id);
    if (!at) return { pass: false, why: 'no point of the plate under the cursor' };
    await clickAtPoint(at);
    const st = asm();
    const t = tabs();
    const p = panes();
    const panel = selPanel();
    if (!panel) return { pass: false, why: 'the selection panel is not the page shown' };
    const c = st.doc.components.find((x) => x.id === plate.id);
    const info = nameOf(plate);
    return {
      pass:
        t[1].selected === 'true' && t[1].disabled === false && p[1].hidden === false && p[1].display !== 'none' &&
        st.viewPick === plate.id && st.selected === plate.id &&
        panel.querySelector('.sw-pm-title strong')?.textContent === '零組件' &&
        panel.querySelector('.sw-pm-title span')?.textContent === info &&
        panel.querySelector('[data-field="name"]')?.textContent === info &&
        panel.querySelector('[data-field="kind"]')?.textContent === '零組件' &&
        panel.querySelector('[data-field="state"]')?.textContent === (c.fixed ? '固定' : '浮動') &&
        panel.querySelector('[data-field="file"]')?.textContent === '定位板.3dbx',
      tabs: t,
      panes: p,
      viewPick: st.viewPick,
    };
  });

  await step('3 the V-block clicked in the view: the same page, now about it (a floating component)', async () => {
    const at = spot(block.id);
    if (!at) return { pass: false, why: 'no point of the V-block under the cursor' };
    await clickAtPoint(at);
    const st = asm();
    const panel = selPanel();
    if (!panel) return { pass: false, why: 'the selection panel is not the page shown' };
    const info = nameOf(block);
    return {
      pass: st.viewPick === block.id && panel.querySelector('.sw-pm-title span')?.textContent === info && panel.querySelector('[data-field="state"]')?.textContent === '浮動',
      viewPick: st.viewPick,
    };
  });

  await step('4 ✓ lets go of the pick: the tree page is back and the tab goes off again', async () => {
    selPanel().querySelector('[data-action="clearSelection"]').click();
    await H.waitFor(() => asm().selected === null && asm().viewPick === null, 5000, 'the pick to be let go');
    await H.wait(150);
    const t = tabs();
    const p = panes();
    return { pass: t[0].selected === 'true' && t[1].disabled === true && p[0].hidden === false && p[1].hidden === true && !document.querySelector('[data-selection-panel]'), tabs: t, panes: p };
  });

  await step('5 a click in the tree stays in the tree; the properties page can still be opened for the component', async () => {
    const r = row('定位板<1>');
    if (!r) return { pass: false, why: 'no 定位板<1> row in the tree' };
    r.click();
    await H.wait(150);
    const afterTreeClick = tabs();
    tabEls()[1].click();
    await H.wait(250);
    const panel = selPanel();
    if (!panel) return { pass: false, why: 'the selection panel is not the page shown' };
    return {
      pass:
        afterTreeClick[0].selected === 'true' && afterTreeClick[1].disabled === false && asm().viewPick === null &&
        panel.querySelector('[data-field="name"]')?.textContent === nameOf(plate),
      afterTreeClick,
      viewPick: asm().viewPick,
    };
  });

  await step('6 a left drag still moves the floating V-block (the pick in the view changes nothing about dragging)', async () => {
    store.assembly?.select(null);
    await H.wait(100);
    const from = H.onComponent(block.id);
    if (!from) return { pass: false, why: 'no point of the V-block to drag' };
    const before = asm().doc.components.find((c) => c.id === block.id).placement.position;
    await H.drag(H.line(from, { x: from.x + 120, y: from.y + 40 }));
    const after = asm().doc.components.find((c) => c.id === block.id).placement.position;
    const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
    return { pass: !asm().drag && moved > 0.5, before, after, moved };
  });

  await step('7 a mate picked in the tree: the same panel about it — its name, kind, the two elements — and 「編輯結合」 opens its session', async () => {
    await H.action('組合件', '結合');
    await H.mate(['定位板<1>', 'datum', '右基準面'], ['V型塊<1>', 'datum', '右基準面']);
    document.querySelector('.property-manager .pm-ok').click(); // ✓ with nothing chosen: done
    await H.waitFor(() => !H.asm().mate, 5000, 'the mate PropertyManager to close');
    await H.solved();
    await H.wait(150);
    const t = tabs();
    const m = asm().doc.mates[0];
    const mateRow = document.querySelector(`[data-mate-row="${m.id}"]`);
    if (!mateRow) return { pass: false, why: 'no mate row in the tree', rows: [...document.querySelectorAll('[data-mate-row] .name')].map((n) => n.textContent) };
    mateRow.click();
    await H.wait(150);
    const afterTreeClick = tabs();
    tabEls()[1].click();
    await H.wait(250);
    const panel = selPanel();
    if (!panel) return { pass: false, why: 'the selection panel is not the page shown' };
    const refs = [panel.querySelector('[data-field="referenceA"]')?.textContent ?? '', panel.querySelector('[data-field="referenceB"]')?.textContent ?? ''];
    panel.querySelector('[data-action="editMate"]').click();
    await H.waitFor(() => asm().mate?.editing === m.id, 5000, 'the mate session');
    const title = document.querySelector('.sw-pane:not([hidden]) .property-manager .pm-title')?.textContent ?? '';
    document.querySelector('.sw-pane:not([hidden]) .property-manager .pm-ok').click();
    await H.waitFor(() => !H.asm().mate, 5000, 'the mate session to end');
    await H.wait(150);
    return {
      pass:
        afterTreeClick[0].selected === 'true' && afterTreeClick[1].disabled === false && t[0].selected === 'true' &&
        panel.querySelector('.sw-pm-title strong')?.textContent === '結合' &&
        panel.querySelector('.sw-pm-title span')?.textContent === m.name &&
        panel.querySelector('[data-field="kind"]')?.textContent === '重合' &&
        panel.querySelector('[data-field="state"]')?.textContent === '正常' &&
        refs.every((x) => x.includes('右基準面@')) &&
        title.includes('編輯結合'),
      afterTreeClick,
      refs,
      title,
    };
  });

  const pass = steps.every((s) => s.pass);
  return { name: 'manual-asm-selection', steps, pass };
};
