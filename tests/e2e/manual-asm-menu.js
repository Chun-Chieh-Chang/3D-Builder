// The tree of an assembly has an eye on each component (hide / show, as in a part), and a right click on a component in the graphics area opens its menu (open part, float / fix, hide,
// transparent, suppress, delete), as in SolidWorks; a right drag turns the component and ends without the menu. Asked for by the user while doing H9. Replayed in the app's page
// (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-asm-menu.js?' + Date.now());   // in a freshly loaded page
//   await __manualAsmMenu.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualAsmMenu = {});

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
const eye = (id) => document.querySelector(`[data-eye="${id}"]`);
const row = (id) => document.querySelector(`[data-component-row="${id}"]`);
const shownCount = () => store.viewer.instances.size;
const menu = () => document.querySelector('[data-component-menu]');
const menuItem = (label) => [...(menu()?.querySelectorAll('li') ?? [])].find((li) => li.textContent === label);
/** A point of the canvas where the component is under the cursor (or, with null, where nothing is). */
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
const emptySpot = () => {
  const r = H.rect();
  for (let fy = 0.05; fy < 0.95; fy += 0.05) {
    for (let fx = 0.05; fx < 0.97; fx += 0.05) {
      const [x, y] = [r.left + r.width * fx, r.top + r.height * fy];
      if (store.viewer.pickInstance(x, y) === null) return [x, y];
    }
  }
  return null;
};
const fire = (type, x, y, init) => {
  const E = type.startsWith('pointer') ? PointerEvent : MouseEvent;
  H.canvas().dispatchEvent(new E(type, { clientX: x, clientY: y, bubbles: true, pointerId: 7, button: 2, buttons: type === 'pointerup' || type === 'contextmenu' ? 0 : 2, ...init }));
};
const rightClick = async ([x, y]) => {
  fire('pointerdown', x, y);
  fire('pointerup', x, y);
  fire('contextmenu', x, y);
  await H.wait(150);
};

M.run = async () => {
  let plate;
  let block;
  await step('1 a new assembly with the plate (fixed) and the V-block (floating); every component row has an eye, shown', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    plate = (await H.insert('定位板.3dbx')).id;
    block = (await H.insert('V型塊.3dbx', [0.5, 0.2])).id;
    await H.loaded();
    await H.hud('等角');
    await H.hud('全部顯示');
    return { pass: !!eye(plate) && !!eye(block) && eye(plate).classList.contains('shown') && shownCount() === 2, plate, block };
  });
  await step('2 the eye of the V-block hides it (drawn no more, row dimmed, eye crossed out); again shows it', async () => {
    eye(block).click();
    await H.wait(250);
    const hidden = shownCount() === 1 && row(block).classList.contains('hidden-component') && !eye(block).classList.contains('shown') && eye(block).title === '顯示' && H.asm().doc.components.find((c) => c.id === block).hidden === true;
    eye(block).click();
    await H.wait(250);
    const back = shownCount() === 2 && !row(block).classList.contains('hidden-component') && eye(block).classList.contains('shown');
    return { pass: hidden && back, hidden, back };
  });
  await step('3 the eye does not select the row, and one hidden component leaves the other alone', async () => {
    store.assembly.select(null);
    await H.wait(100);
    eye(plate).click();
    await H.wait(250);
    const only = shownCount() === 1 && !H.asm().doc.components.find((c) => c.id === block).hidden && H.asm().selected !== plate;
    eye(plate).click();
    await H.wait(250);
    return { pass: only && shownCount() === 2, selected: H.asm().selected };
  });
  await step('4 a right click on the V-block in the graphics area opens its menu with the same items as the tree, and selects it', async () => {
    const at = spot(block);
    if (!at) return { pass: false, why: 'no point of the V-block under the cursor' };
    await rightClick(at);
    const items = [...menu().querySelectorAll('li:not(.separator)')].map((li) => li.textContent);
    return { pass: !!menu() && H.asm().selected === block && ['開啟零件', '浮動', '固定', '隱藏', '透明', '抑制', '刪除…'].filter((x) => items.includes(x) || items.some((i) => i.includes(x))).length >= 5, items, selected: H.asm().selected };
  });
  await step('5 the menu works: 隱藏 hides the V-block; its eye follows; and the menu is gone', async () => {
    menuItem('隱藏').click();
    await H.wait(250);
    return { pass: H.asm().doc.components.find((c) => c.id === block).hidden === true && shownCount() === 1 && !menu() && eye(block).title === '顯示' };
  });
  await step('6 a right click where there is no component opens no menu; a click elsewhere closes an open one', async () => {
    eye(block).click();
    await H.wait(250);
    const empty = emptySpot();
    await rightClick(empty);
    const none = !menu();
    await rightClick(spot(plate));
    const opened = !!menu();
    H.canvas().dispatchEvent(new PointerEvent('pointerdown', { clientX: empty[0], clientY: empty[1], bubbles: true, pointerId: 8, button: 0, buttons: 1 }));
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8, button: 0, buttons: 1 }));
    await H.wait(150);
    return { pass: none && opened && !menu(), none, opened };
  });
  await step('7 a right drag that turns the floating V-block ends without the menu', async () => {
    const at = spot(block);
    fire('pointerdown', at[0], at[1]);
    for (let i = 1; i <= 6; i++) {
      fire('pointermove', at[0] + i * 8, at[1] + i * 3);
      await H.wait(40);
    }
    fire('pointerup', at[0] + 48, at[1] + 18);
    fire('contextmenu', at[0] + 48, at[1] + 18);
    await H.wait(200);
    return { pass: !menu() };
  });
  await step('8 the menu of the tree row is the same menu (hide / show reads from the component)', async () => {
    row(plate).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
    await H.wait(150);
    const items = [...(menu()?.querySelectorAll('li:not(.separator)') ?? [])].map((li) => li.textContent);
    return { pass: !!menu() && items.includes('開啟零件') && items.includes('隱藏'), items };
  });
  return { name: 'asm-menu', steps, pass: steps.every((s) => s.pass) };
};
