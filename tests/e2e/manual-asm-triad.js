// Manual checklist D10 (docs/manual-verification.html, ADR 0179): 以座標軸移動 (Move with Triad). Each handle is taken hold of with real pointer events at the
// place on the screen the viewer reports for it (`triadScreenPoints`), dragged, and let go; the assembly's placements are read afterwards and checked against
// what the handle offers, worked out here from the poses before and after (never written down): an arrow moves along its axis only, a square in its plane
// only, a ring turns about its axis through the middle; steps snap; a mate's locked direction does not move; one drag is one undo step. Replayed in the app's
// page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-asm-triad.js?' + Date.now());   // in a freshly loaded page
//   await __manualAsmTriad.run();   // -> { name, steps: [{ name, pass }], pass }

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const M = (window.__manualAsmTriad = {});

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const TOL = 1e-6; // what the drag solver converges to, with mates solved again after each step (packages/assembly/test/triad.test.ts)

// ---------------------------------------------------------------- reading the assembly
const comp = (id) => H.asm().doc.components.find((c) => c.id === id);
const placement = (id) => comp(id).placement;
/** Where the solved mates put a component now. */
const solvedPose = (id) => H.asm().solution.poses.get(id);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(...v);
const rotate = ([x, y, z, w], v) => {
  const u = [x, y, z];
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const uv = cr(u, v);
  const uuv = cr(u, uv);
  return [v[0] + 2 * (w * uv[0] + uuv[0]), v[1] + 2 * (w * uv[1] + uuv[1]), v[2] + 2 * (w * uv[2] + uuv[2])];
};
/** The angle (radians) between two orientations. */
const turned = (a, b) => {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  const x = aw * bx - ax * bw - ay * bz + az * by;
  const y = aw * by + ax * bz - ay * bw - az * bx;
  const z = aw * bz - ax * by + ay * bx - az * bw;
  return 2 * Math.atan2(Math.hypot(x, y, z), d);
};
/** The turn (radians, about `axis`) that takes orientation a to b, when it is one about that axis. */
const turnAbout = (a, b, axis) => {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  // b · a⁻¹: the turn in the assembly's axes
  const x = bw * -ax + bx * aw + by * -az - bz * -ay;
  const y = bw * -ay - bx * -az + by * aw + bz * -ax;
  const z = bw * -az + bx * -ay - by * -ax + bz * aw;
  const w = bw * aw - bx * -ax - by * -ay - bz * -az;
  const along = [x, y, z][axis];
  return 2 * Math.atan2(along, w);
};
const multipleOf = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-6;

// ---------------------------------------------------------------- the triad on the screen
const points = () => store.viewer.triadScreenPoints();
const handlePoint = (part) => points().find((p) => same(p.part, part)) ?? null;
const origin = (id) => store.assembly.triadOrigin(id);
/** A drag with the left button from `from` along the given client points, as a mouse does it; waits until the drag has been kept. */
async function dragPath(from, path) {
  const c = H.canvas();
  const ev = (type, p, buttons) => new PointerEvent(type, { clientX: p.x, clientY: p.y, bubbles: true, pointerId: 1, button: 0, buttons });
  c.dispatchEvent(ev('pointermove', from, 0));
  c.dispatchEvent(ev('pointerdown', from, 1));
  for (const p of path) {
    c.dispatchEvent(ev('pointermove', p, 1));
    await H.wait(40);
  }
  await H.wait(400);
  c.dispatchEvent(ev('pointerup', path.at(-1), 0));
  c.dispatchEvent(new MouseEvent('click', { clientX: path.at(-1).x, clientY: path.at(-1).y, bubbles: true }));
  await H.waitFor(() => !H.asm().drag, 10000, 'the drag to be kept');
  await H.solved();
  await H.wait(200);
}
/** Where on the screen a world direction from a point goes, as a unit screen vector. */
function screenDir(p, d) {
  const a = H.worldToClient(p);
  const b = H.worldToClient([p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}
const along = (from, dir, px, n = 10) => Array.from({ length: n }, (_, i) => ({ x: from.x + (dir.x * px * (i + 1)) / n, y: from.y + (dir.y * px * (i + 1)) / n }));
/** An arc on the screen about `c` from `from`, turning by `deg` degrees (the screen's y runs down). */
const arc = (c, from, deg, n = 12) => {
  const r = Math.hypot(from.x - c.x, from.y - c.y);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + ((deg * Math.PI) / 180) * ((i + 1) / n);
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
};

// ---------------------------------------------------------------- menus
const gmenu = () => document.querySelector('[data-graphics-menu]');
const gids = () => [...(gmenu()?.querySelectorAll('button[data-action]') ?? [])].map((b) => b.dataset.action);
const gclick = async (action) => {
  const b = gmenu()?.querySelector(`button[data-action="${action}"]`);
  if (!b) throw new Error(`no menu line ${action}: ${gids().join(' | ')}`);
  b.click();
  await H.wait(300);
};
const cmenu = () => document.querySelector('[data-component-menu]');
const cclick = async (action) => {
  const li = cmenu()?.querySelector(`li[data-action="${action}"]`);
  if (!li) {
    const seen = cmenu() ? [...cmenu().querySelectorAll('li[data-action]')].map((x) => x.dataset.action).join(' | ') : gmenu() ? `graphics menu ${gmenu().dataset.graphicsMenu}: ${gids().join(' | ')}` : 'no menu';
    throw new Error(`no menu line ${action}: ${seen}`);
  }
  li.click();
  await H.wait(300);
};
const rightAt = async (p) => {
  const [x, y] = [Math.round(p.x), Math.round(p.y)];
  H.canvas().dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 0, buttons: 0 }));
  await H.wait(60);
  if (window.__triadRightPress) {
    H.canvas().dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 2, buttons: 2 }));
    H.canvas().dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, pointerId: 1, button: 2, buttons: 0 }));
  }
  H.canvas().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  await H.wait(200);
};
/**
 * A point of the canvas well inside the component (and off the triad): whole pixels, as a mouse reports them — a contextmenu event's clientX/Y are whole, so
 * a point found at y = 123.41 on the edge of the part is y = 123 when clicked, off it — with the component under the pointer 3 px round it too.
 */
const spot = (id) => {
  const r = H.rect();
  const on = (x, y) => store.viewer.pickInstance(x, y) === id && !store.viewer.triadPartAt(x, y);
  for (let fy = 0.1; fy < 0.95; fy += 0.03) {
    for (let fx = 0.05; fx < 0.97; fx += 0.03) {
      const [x, y] = [Math.round(r.left + r.width * fx), Math.round(r.top + r.height * fy)];
      if (on(x, y) && on(x - 3, y) && on(x + 3, y) && on(x, y - 3) && on(x, y + 3)) return { x, y };
    }
  }
  return null;
};
/** The view has stopped moving (全部顯示 and the view buttons turn the camera over a few frames): the same pick twice, 200 ms apart. */
async function settleView() {
  const probe = () => JSON.stringify(H.worldToClient([0, 0, 0]));
  for (let i = 0; i < 30; i++) {
    const a = probe();
    await H.wait(200);
    if (probe() === a) return;
  }
}
const pmButton = (name) => document.querySelector(`.property-manager button[name="${name}"]`);
const pmInput = (name) => document.querySelector(`.property-manager input[name="${name}"]`);
const typeInto = async (input, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await H.wait(60);
};

M.run = async () => {
  steps.length = 0;
  let plate;
  let block;

  await step('1 a new assembly: the plate (fixed) and the V-block (floating), in the isometric view', async () => {
    H.ready();
    await H.project({ '定位板.3dbx': `${H.GOLDEN}locating-plate.3dbx`, 'V型塊.3dbx': `${H.GOLDEN}v-block.3dbx` });
    await H.action('檔案', '新組合件');
    if (store.getState().folderRequest) await H.modalButton('選擇資料夾…');
    plate = (await H.insert('定位板.3dbx')).id;
    block = (await H.insert('V型塊.3dbx', [0.5, 0.2])).id;
    await H.loaded();
    await H.solved();
    await H.hud('等角');
    await H.hud('全部顯示');
    await settleView();
    return { pass: !!plate && !!block && comp(plate).fixed && !comp(block).fixed, plate, block };
  });

  await step('2 right click on the V-block → 以座標軸移動: the triad at its middle, every handle on the screen', async () => {
    const at = spot(block);
    if (!at) return { pass: false, why: 'no point of the V-block under the pointer' };
    const under = store.viewer.pickInstance(at.x, at.y);
    await rightAt(at);
    if (!cmenu()) return { pass: false, why: 'no component menu', at, under, after: store.viewer.pickInstance(at.x, at.y), block, menu: gmenu()?.dataset.graphicsMenu, rect: JSON.stringify(H.rect()) };
    await cclick('move-with-triad');
    await H.wait(200);
    const kinds = points().map((p) => p.part.kind);
    const o = origin(block);
    const ball = handlePoint({ kind: 'center' });
    const where = H.worldToClient(o);
    return {
      pass: H.asm().triad?.component === block && kinds.filter((k) => k === 'axis').length === 3 && kinds.filter((k) => k === 'plane').length === 3 && kinds.includes('ring') && !!ball && Math.hypot(ball.x - where.x, ball.y - where.y) < 2,
      kinds,
      ball,
      where,
    };
  });

  await step('3 the red arrow dragged: the V-block moves along X only, not turned; Ctrl+Z puts it back in one step', async () => {
    const before = placement(block);
    const from = handlePoint({ kind: 'axis', axis: 0 });
    if (!from) return { pass: false, why: 'the X arrow is not on the screen' };
    await dragPath(from, along(from, screenDir(origin(block), [1, 0, 0]), 70));
    const after = placement(block);
    const d = sub(after.position, before.position);
    const ok = Math.abs(d[0]) > 1 && Math.abs(d[1]) < TOL && Math.abs(d[2]) < TOL && turned(before.rotation, after.rotation) < TOL;
    await H.ctrl('z');
    await H.solved();
    const back = placement(block);
    return { pass: ok && len(sub(back.position, before.position)) < TOL, d, back: back.position, before: before.position };
  });

  await step('4 the XY square dragged: moved in that plane, not across it, not turned', async () => {
    const before = placement(block);
    const from = handlePoint({ kind: 'plane', axis: 2 });
    if (!from) return { pass: false, why: 'the XY square is not on the screen' };
    await dragPath(from, along(from, { x: 0.8, y: 0.6 }, 60));
    const after = placement(block);
    const d = sub(after.position, before.position);
    return { pass: Math.hypot(d[0], d[1]) > 1 && Math.abs(d[2]) < TOL && turned(before.rotation, after.rotation) < TOL, d };
  });

  await step('5 the Z ring dragged round: turned about Z through its middle, the middle where it was', async () => {
    const before = placement(block);
    const middle = origin(block);
    const from = handlePoint({ kind: 'ring', axis: 2 });
    if (!from) return { pass: false, why: 'the Z ring is not on the screen' };
    await dragPath(from, arc(H.worldToClient(middle), from, 50));
    const after = placement(block);
    const angle = turnAbout(before.rotation, after.rotation, 2);
    const stayed = len(sub(origin(block), middle));
    return { pass: Math.abs(angle) > 0.05 && stayed < TOL && Math.abs(turned(before.rotation, after.rotation) - Math.abs(angle)) < TOL, angle, stayed };
  });

  await step('6 steps 5 mm and 15° (移動零組件 → 座標軸的步進): an arrow moves by a multiple of 5, a ring turns by a multiple of 15°', async () => {
    await H.action('組合件', '移動零組件');
    await typeInto(pmInput('triadMoveStep'), '5');
    await typeInto(pmInput('triadTurnStep'), '15');
    pmButton('applyTriadSteps').click();
    await H.wait(200);
    const set = same(H.asm().triadSteps, { move: 5, turn: 15 });
    let before = placement(block);
    let from = handlePoint({ kind: 'axis', axis: 1 });
    await dragPath(from, along(from, screenDir(origin(block), [0, 1, 0]), 83));
    const dy = sub(placement(block).position, before.position);
    before = placement(block);
    const middle = origin(block);
    from = handlePoint({ kind: 'ring', axis: 2 });
    await dragPath(from, arc(H.worldToClient(middle), from, 47));
    const angle = turnAbout(before.rotation, placement(block).rotation, 2);
    return { pass: set && Math.abs(dy[1]) >= 5 - TOL && multipleOf(dy[1], 5) && Math.abs(dy[0]) < TOL && Math.abs(dy[2]) < TOL && Math.abs(angle) > 0.1 && multipleOf((angle * 180) / Math.PI, 15), dy, deg: (angle * 180) / Math.PI };
  });

  await step('7 a step of −1 or nothing is refused with the reason; the steps stay 5 and 15', async () => {
    const said = [];
    for (const value of ['-1', '']) {
      await typeInto(pmInput('triadMoveStep'), value);
      pmButton('applyTriadSteps').click();
      await H.wait(200);
      said.push(H.notice());
    }
    await typeInto(pmInput('triadMoveStep'), '0');
    await typeInto(pmInput('triadTurnStep'), '0');
    const kept = same(H.asm().triadSteps, { move: 5, turn: 15 });
    pmButton('applyTriadSteps').click();
    await H.wait(200);
    return { pass: said.every((s) => s.includes('移動步進必須是 0 或正的有限數字')) && kept && same(H.asm().triadSteps, { move: 0, turn: 0 }), said, kept };
  });

  await step('8 right click on the Z ring: 90°, −90°, 180°, 移至 XYZ, 結束; 90° turns it exactly a quarter about Z through its middle', async () => {
    store.assembly.closeMove();
    store.assembly.showTriad(block);
    await H.wait(200);
    const before = placement(block);
    const middle = origin(block);
    const p = handlePoint({ kind: 'ring', axis: 2 });
    await rightAt(p);
    const what = gmenu()?.dataset.graphicsMenu;
    const ids = gids();
    await gclick('triad-turn-Z90');
    await H.solved();
    await H.wait(200);
    const angle = turnAbout(before.rotation, placement(block).rotation, 2);
    return { pass: what === 'triad' && same(ids, ['triad-turn-Z90', 'triad-turn-Z-90', 'triad-turn-Z180', 'triad-move-to', 'triad-close', 'toggle-grid']) && Math.abs(angle - Math.PI / 2) < TOL && len(sub(origin(block), middle)) < TOL, ids, angle };
  });

  await step('9 right click on the ball → 移至 XYZ: 移動零組件 opens on 至 XYZ 位置', async () => {
    await rightAt(handlePoint({ kind: 'center' }));
    await gclick('triad-move-to');
    const mode = document.querySelector('.property-manager select[aria-label]')?.value;
    const ok = H.asm().move?.tool === 'move' && mode === 'to';
    store.assembly.closeMove();
    await H.wait(150);
    return { pass: ok, mode };
  });

  await step('10 a mate of the tops (上基準面 on 上基準面, square to Y): the Y arrow does not move it, the X arrow does, along X only', async () => {
    store.assembly.hideTriad();
    await H.action('組合件', '結合');
    await H.mate(['定位板<1>', 'datum', '上基準面'], ['V型塊<1>', 'datum', '上基準面']);
    document.querySelector('.property-manager .pm-ok')?.click();
    await H.waitFor(() => !H.asm().mate, 5000, 'the mate PropertyManager to close');
    await H.solved();
    // where the mate puts it (the stored placement is the one before the mate until a move keeps the solved pose)
    store.assembly.showTriad(block);
    await H.hud('等角');
    await settleView();
    let before = solvedPose(block);
    let from = handlePoint({ kind: 'axis', axis: 1 });
    await dragPath(from, along(from, screenDir(origin(block), [0, 1, 0]), 70));
    const yMove = len(sub(solvedPose(block).position, before.position));
    before = solvedPose(block);
    from = handlePoint({ kind: 'axis', axis: 0 });
    await dragPath(from, along(from, screenDir(origin(block), [1, 0, 0]), 70));
    const d = sub(solvedPose(block).position, before.position);
    const mate = [...H.asm().solution.mates.values()].every((m) => m.status === 'ok');
    return { pass: yMove < TOL && Math.abs(d[0]) > 1 && Math.abs(d[1]) < TOL && Math.abs(d[2]) < TOL && mate, yMove, d, mate };
  });

  await step('11 the fixed plate: 以座標軸移動 says it is fixed and draws no triad; Esc takes the V-block\'s away', async () => {
    store.assembly.hideTriad();
    await H.wait(100);
    const at = spot(plate);
    await rightAt(at);
    await cclick('move-with-triad');
    const said = H.notice();
    const none = points().length === 0 && !H.asm().triad;
    store.assembly.showTriad(block);
    await H.wait(150);
    const shown = points().length > 0;
    await H.key('Escape');
    await H.wait(150);
    return { pass: said.includes('已固定') && none && shown && points().length === 0 && !H.asm().triad, said, none, shown };
  });

  return { name: 'D10 以座標軸移動 (ADR 0179)', steps: [...steps], pass: steps.length > 0 && steps.every((s) => s.pass) };
};
