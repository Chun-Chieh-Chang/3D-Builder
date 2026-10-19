// Variable-radius fillet (C5.2, ADR 0167): the 「變化半徑」 box of the fillet PropertyManager and the control points of a picked edge, replayed the way a person does it in the app's
// page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test. The edge is picked with a click at the screen position of its middle.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-variable-fillet.js?' + Date.now());   // in a freshly loaded page
//   await __manualVariableFillet.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualVariableFillet = {});

const last = (type) => state().doc.features.filter((f) => f.type === type).at(-1);
const points = () => [...S.pm().querySelectorAll('[data-variable-point]')];
const RAMP = 14400 - 148.790607; // ∫₀⁴⁰ (1 − π/4)(2 + 0.1x)² dx taken off the 40 × 30 × 12 block (the ADR's hand value 14251.209393)
const CONSTANT = 14400 - (1 - Math.PI / 4) * 4 * 40;

M.run = async () => {
  await step('1 a 40 × 30 × 12 block (14400 mm³), the isometric view', async () => {
    await S.box(40, 30, 12);
    await S.iso();
    return { volume: S.volume(), pass: near(S.volume(), 14400) };
  });
  await step('2 「圓角」, one long top edge clicked, 半徑 2: no 「變化半徑」 control points yet, the box is on offer', async () => {
    await H.action('特徵', '圓角');
    const edge = state().result.edgeFingerprints.map((fp, i) => ({ fp, i })).filter(({ fp }) => fp.type === 'line' && Math.abs(fp.center[1] - 12) < 1e-6 && Math.abs(fp.size - 40) < 1e-6)[0];
    await H.at(edge.fp.center);
    await H.pmInput('半徑', '2');
    const box = S.pmRow('變化半徑')?.querySelector('input');
    await shot('2-edge-picked');
    return { edges: last('fillet').edges?.length, hasBox: !!box, checked: box?.checked, points: points().length, pass: last('fillet').edges?.length === 1 && !!box && box.checked === false && points().length === 0 };
  });
  await step('3 「變化半徑」 ticked: the edge gets two control points (t 0 and 1, radius 2 each)', async () => {
    await S.pmCheck('變化半徑', true);
    const rows = points().map((r) => [...r.querySelectorAll('input')].map((i) => i.value));
    await shot('3-two-points');
    return { rows, pass: rows.length === 2 && rows[0][0] === '0' && rows[1][0] === '1' && rows.every((r) => r[1] === '2') };
  });
  await step('4 the radius of the last end set to 6, ✔: a ramp R2 → R6, 14251.21 mm³ (the hand-worked integral)', async () => {
    await S.type(points()[1].querySelectorAll('input')[1], '6');
    await H.pmOk();
    await S.iso();
    await shot('4-ramp');
    return { volume: S.volume(), pass: near(S.volume(), RAMP, 1e-6) && S.failed().length === 0 };
  });
  await step('5 圓角1 edited again: the points are there; a control point added in the middle (t 0.5, 3 rows) and taken off again with ×', async () => {
    await S.treeEdit('圓角1');
    const kept = points().length;
    await S.pmClick('＋ 新增控制點');
    const added = points().length;
    const mid = points().find((r) => r.querySelector('input').value === '0.5');
    mid?.querySelector('button')?.click();
    await H.settle();
    return { kept, added, after: points().length, pass: kept === 2 && added === 3 && !!mid && points().length === 2 };
  });
  await step('6 the first point moved off t = 0: the command refuses (red field), the stored points stay', async () => {
    const input = points()[0].querySelector('input');
    await S.type(input, '0.3');
    const refused = input.classList.contains('invalid');
    const stored = last('fillet').variable.map((p) => p.t);
    return { refused, stored, pass: refused && stored.length === 2 && stored[0] === 0 && stored[1] === 1 };
  });
  await step('7 「變化半徑」 unticked, ✔: back to the constant radius 2 on the one edge', async () => {
    await S.pmCheck('變化半徑', false);
    const cleared = last('fillet').variable;
    await H.pmOk();
    await S.iso();
    await shot('7-constant-again');
    return { cleared, volume: S.volume(), pass: (cleared === undefined || cleared.length === 0) && near(S.volume(), CONSTANT, 1e-4) && S.failed().length === 0 };
  });
  return S.result('variable-fillet');
};
