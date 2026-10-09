// Phase 5-4b: the drawing of an assembly in the browser. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase5-assembly.js?' + Date.now());
//   await __asmdrw.run();
//
// The project folder is OPFS, as in phase2-assembly.js, whose helpers come with it. The assembly is written here with the model and io packages: the golden locating
// plate and two golden diamond pins, side by side, no mates (each stays where it is placed). 「新工程圖」 from the open assembly makes its front and isometric views
// with the parts list and the balloons; the balloons are switched off and on and the table put back, the drawing saved and opened again.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const model = await import(`${root}packages/model/src/index.ts`);
const io = await import(`${root}packages/io/src/index.ts`);
const x = (window.__asmdrw = {});

const drw = () => store.getState().drw;
const panel = (sel) => document.querySelector(`[data-drawing-panel] ${sel}`);
const click = async (el) => {
  el.click();
  await H.wait(150);
};
const scene = () => store.drawingStore.scene();
const texts = () => scene().scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
const balloons = () => scene().scene.items.filter((i) => i.kind === 'polyline' && i.style === 'thin' && i.closed && !i.filled && i.points.length === 72).length;

x.run = async () => {
  H.ready();
  await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, '削邊銷.3dbx': `${H.GOLDEN}diamond-pin.3dbx` });
  const at = (px) => ({ position: [px, 0, 0], rotation: [0, 0, 0, 1] });
  const comp = (id, file, instance, px) => ({ id, file, instance, fixed: true, placement: at(px) });
  let doc = model.createEmptyAssembly();
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '定位板.3dbx' }, component: comp('p1', 'file1', 1, 0) });
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: '削邊銷.3dbx' }, component: comp('pa', 'file2', 1, 100) });
  doc = model.applyAssemblyCommand(doc, { type: 'insertComponent', component: comp('pb', 'file2', 2, -100) });
  await H.writeAt('夾具.3dba', await io.writeAssemblyFile(doc));

  await H.open('夾具.3dba');
  await H.loaded();
  H.check(store.getState().active === 'assembly', 'the assembly is open');

  // 「新工程圖」 from the assembly
  await H.action('檔案', '新工程圖');
  await H.waitFor(() => drw() && drw().doc.views.length === 2, 10000, 'the drawing');
  await H.waitFor(() => drw().boms.size === 2 && [...drw().lines.values()].filter(Boolean).length === 2, 60000, 'the lines of both views');
  H.check(JSON.stringify(drw().doc.views.map((v) => [v.direction, v.source])) === JSON.stringify([['front', '夾具.3dba'], ['isometric', '夾具.3dba']]), 'front and isometric views of the assembly');
  H.check(drw().doc.tables.length === 1 && drw().doc.tables[0].kind === 'bom' && drw().doc.tables[0].balloons === true, 'a parts list with balloons');
  H.check(drw().doc.title.drawingName === '夾具', `the title is the assembly's name: ${drw().doc.title.drawingName}`);

  // the parts list: the plate once and the pin twice
  const rows = drw().boms.get(drw().doc.views[0].id).rows;
  H.check(JSON.stringify(rows.map((r) => [r.item, r.name, r.qty])) === JSON.stringify([['1', '定位板', 1], ['2', '削邊銷', 2]]), `the parts list: ${JSON.stringify(rows.map((r) => [r.item, r.name, r.qty]))}`);
  // the front view has all three parts: the plate 120 wide between the pins 100 either side of it
  const front = drw().lines.get(drw().doc.views[0].id);
  H.check(front.box.max[0] - front.box.min[0] > 200 && front.anchors?.length === 3, `the front view shows the three parts: ${JSON.stringify(front.box)}, ${front.anchors?.length} anchors`);
  H.check(Math.abs(front.anchors[0][0]) < 1e-6 && Math.abs(front.anchors[1][0] - 100) < 1e-6 && Math.abs(front.anchors[2][0] + 100) < 1e-6, `where the parts are: ${JSON.stringify(front.anchors)}`);

  // drawn: the table and two balloons for the two items
  await H.waitFor(() => document.querySelector('[data-svg] svg'), 5000, 'the SVG');
  H.check(texts().includes('定位板') && texts().includes('削邊銷') && texts().includes('數量'), 'the table is drawn');
  H.check(balloons() === 2, `a balloon for each item: ${balloons()}`);
  const svg = document.querySelector('[data-svg] svg');
  H.check([...svg.querySelectorAll('text')].some((t) => t.textContent === '削邊銷'), 'on the sheet');

  // through the panel: the balloons off and on, the table deleted and made again, moved and put back
  await click(panel(`[data-view="${drw().doc.views[0].id}"]`));
  await click(panel('[data-field="balloons"]'));
  await H.waitFor(() => balloons() === 0, 3000, 'no balloons');
  await click(panel('[data-field="balloons"]'));
  await H.waitFor(() => balloons() === 2, 3000, 'balloons again');
  await click(panel('[data-action="deleteTable"]'));
  await H.waitFor(() => drw().doc.tables.length === 0, 3000, 'the table deleted');
  H.check(!texts().includes('削邊銷') && balloons() === 0, 'nothing of it is left on the sheet');
  await click(panel('[data-action="addBomTable"]'));
  await H.waitFor(() => drw().doc.tables.length === 1 && balloons() === 2, 3000, 'the table again');
  store.drawingStore.setTable(drw().doc.tables[0].id, { at: [40, 260] });
  await H.waitFor(() => drw().doc.tables[0].at, 3000, 'moved');
  await click(panel('[data-action="tableHome"]'));
  await H.waitFor(() => !drw().doc.tables[0].at, 3000, 'back in the corner');

  // a balloon and the table are taken with the pointer and put where the user wants them (schema 9)
  {
    const canvas = document.querySelector('[data-drawing-canvas]');
    const toClient = ([sx, sy]) => {
      const r = document.querySelector('[data-svg] svg').getBoundingClientRect();
      return [r.left + (sx / 420) * r.width, r.top + ((297 - sy) / 297) * r.height];
    };
    const send = (type, at) => {
      const [cx, cy] = toClient(at);
      canvas.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, bubbles: true, cancelable: true, pointerId: 33, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
    };
    const drag = async (from, to) => {
      send('pointerdown', from);
      for (let i = 1; i <= 6; i++) {
        send('pointermove', [from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6]);
        await H.wait(25);
      }
      send('pointerup', to);
      await H.wait(250);
    };
    const tableId = drw().doc.tables[0].id;
    const one = scene().balloons.get(tableId).find((s) => s.item === '1');
    const target = [one.centre[0] + 25, one.centre[1] - 30];
    await drag(one.centre, target);
    const kept = drw().doc.tables[0].balloonAt?.['1'];
    H.check(kept && Math.abs(kept[0] - target[0]) < 0.1 && Math.abs(kept[1] - target[1]) < 0.1, `the balloon is where it was put: ${JSON.stringify(kept)} for ${JSON.stringify(target)}`);
    const now = scene().balloons.get(tableId).find((s) => s.item === '1');
    H.check(Math.abs(now.centre[0] - target[0]) < 0.1 && Math.abs(now.centre[1] - target[1]) < 0.1 && Math.abs(now.anchor[0] - one.anchor[0]) < 1e-9, 'drawn there, the leader still on the part');
    H.check(!drw().doc.tables[0].at, 'the table did not move with it');
    await click(panel('[data-action="balloonsAuto"]'));
    await H.waitFor(() => !drw().doc.tables[0].balloonAt, 3000, 'balloons arranged again');
    const box = scene().tableBoxes.get(tableId);
    await drag([box.x + box.w / 2, box.y + box.h / 2], [box.x + box.w / 2 - 60, box.y + box.h / 2 + 40]);
    const at = drw().doc.tables[0].at;
    H.check(at && Math.abs(at[0] - (box.x - 60)) < 0.1 && Math.abs(at[1] - (box.y + box.h + 40)) < 0.1, `the table is where it was put: ${JSON.stringify(at)}`);
    await click(panel('[data-action="tableHome"]'));
    await H.waitFor(() => !drw().doc.tables[0].at, 3000, 'back in the corner');
  }

  // a dimension on a view of an assembly says it cannot be made (yet) instead of drawing something
  store.drawingStore.addRound(drw().doc.views[0].id, 'diameter', { kind: 'face', name: 'x' });
  await H.waitFor(() => drw().doc.dimensions.length === 1 && drw().elements.size === 1, 10000, 'the dimension');
  H.check(scene().dimensions.get(drw().doc.dimensions[0].id).error?.includes('組合件'), `says why: ${JSON.stringify(scene().dimensions.get(drw().doc.dimensions[0].id))}`);
  store.drawingStore.deleteDimensions([drw().doc.dimensions[0].id]);

  // saved and opened again: the parts list is made again from the assembly
  H.next.save = '夾具.3dbd';
  await H.action('檔案', '儲存檔案');
  await H.waitFor(() => !drw().dirty, 10000, 'the save');
  await H.open('夾具.3dbd');
  await H.waitFor(() => drw() && drw().fileName === '夾具.3dbd' && drw().boms.size === 2 && [...drw().lines.values()].filter(Boolean).length === 2, 60000, 'the drawing to open');
  H.check(texts().includes('削邊銷') && balloons() === 2, 'the same drawing');
  console.log('phase5-assembly: all checks passed');
  return true;
};
