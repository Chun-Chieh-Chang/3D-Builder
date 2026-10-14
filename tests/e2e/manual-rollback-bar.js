// The rollback bar in the hierarchy view of the tree (the default): a sketch is shown under the feature that uses it, so the order on screen is not
// the history order. Dragged to the top the bar once landed before 草圖1, a row that is not shown on its own, and vanished with nothing left to
// drag it back. Replayed the way a person does it in the app's page (http://127.0.0.1:5391; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-rollback-bar.js?' + Date.now());   // in a freshly loaded page
//   await __manualRollbackBar.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, step, state } = S;
const M = (window.__manualRollbackBar = {});

const bar = () => document.querySelector('.feature-tree .rollback-bar');
/** A row's name without the status of its sketch ((-) under-defined, …). */
const nameIn = (li) => li.querySelector('.name')?.textContent.replace(/^\([-+?]\) /, '');
const rowOf = (name) => [...document.querySelectorAll('.feature-tree [data-feature-row]')].find((r) => nameIn(r) === name);
const rollback = () => state().doc.rollbackIndex;
/** Drags the bar with the pointer to `y` (client coordinates) and lets go. */
const dragBarTo = async (y) => {
  const b = bar();
  if (!b) throw new Error('no rollback bar');
  const r = b.getBoundingClientRect();
  const x = r.left + r.width / 2;
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: r.top + r.height / 2, button: 0 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y }));
  await H.wait(50);
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y }));
  await H.settle();
};
/** The rows on screen, top to bottom, with the bar as '|'. */
const order = () => [...document.querySelectorAll('.feature-tree .tree-list > li')].filter((li) => li.matches('.rollback-bar, [data-feature-row]')).map((li) => (li.matches('.rollback-bar') ? '|' : nameIn(li)));

M.run = async () => {
  S.steps.length = 0;
  let sk1;
  let sk2;
  await step('1 two blocks, each sketch shown under its extrude: 伸長1 ⊃ 草圖1, 伸長2 ⊃ 草圖2, the bar at the end', async () => {
    sk1 = await S.box(20, 20, 10);
    sk2 = await S.rectSketch('前基準面', 6, 6, { center: true });
    await S.extrude(sk2, 30);
    const o = order();
    return { pass: o.join(',') === `伸長1,${sk1},伸長2,${sk2},|` && rollback() === null, order: o, failed: S.failed() };
  });
  await step('2 the bar dragged above every row: everything is rolled back and the bar is still there, at the top', async () => {
    await dragBarTo(rowOf('伸長1').getBoundingClientRect().top - 40);
    const o = order();
    return { pass: rollback() === 0 && o[0] === '|' && document.querySelectorAll('.feature-tree .rollback-bar').length === 1, rollback: rollback(), order: o };
  });
  await step('3 dragged back down from the top, below every row: nothing is rolled back', async () => {
    const last = rowOf(sk2).getBoundingClientRect();
    await dragBarTo(last.bottom + 30);
    const o = order();
    return { pass: rollback() === null && o.at(-1) === '|', rollback: rollback(), order: o };
  });
  await step('4 dropped between the two groups: the bar sits right above 伸長2, which is rolled back with its sketch (the bar goes before 草圖2)', async () => {
    const r = rowOf('伸長2').getBoundingClientRect();
    await dragBarTo(r.top + 2);
    const o = order();
    const iSk = state().doc.features.findIndex((f) => f.name === sk2);
    const greyed = rowOf('伸長2').classList.contains('rolled-back') && rowOf(sk2).classList.contains('rolled-back') && !rowOf('伸長1').classList.contains('rolled-back');
    return { pass: rollback() === iSk && o.join(',') === `伸長1,${sk1},|,伸長2,${sk2}` && greyed, rollback: rollback(), iSk, order: o, greyed };
  });
  await step('5 「回溯」 on a sketch shown under its feature keeps the bar on screen, above that feature', async () => {
    await S.treeMenu('伸長2', '推進至最後');
    await S.treeMenu(sk2, '回溯（到此特徵之前）');
    const o = order();
    const iSk = state().doc.features.findIndex((f) => f.name === sk2);
    return { pass: rollback() === iSk && o.join(',') === `伸長1,${sk1},|,伸長2,${sk2}`, rollback: rollback(), iSk, order: o };
  });
  return S.result('manual-rollback-bar');
};
