// Manual checklist C9 (docs/manual-verification.html): 「薄殼」 (inward, outward, a wall too thick) and 「拔模」 (the four side faces picked one by one from four views, then reversed),
// replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c9.js?' + Date.now());   // in a freshly loaded page
//   await __manualC9.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC9 = {});

const listed = () => [...S.pm().querySelectorAll('.selection-box li')].map((li) => li.textContent);

M.run = async () => {
  await step('1 a 40 × 30 × 10 block, its top face picked, 「薄殼」 opens with that face in the list', async () => {
    await S.box(40, 30, 10);
    await S.iso();
    await H.at(S.planeFace(1, 10).center);
    await H.action('特徵', '薄殼');
    return { items: listed(), pass: /薄殼/.test(S.pmText()) && listed().some((t) => /extrude1:cap:end|cap/.test(t)) };
  });
  await step('2 壁厚 2 and ✔: an open box, 4512 mm³', async () => {
    await H.pmInput('壁厚', '2');
    await H.pmOk();
    await shot('2-shell-done');
    return { volume: S.volume(), pass: near(S.volume(), 12000 - 36 * 26 * 8) && S.failed().length === 0 };
  });
  await step('3 薄殼1 edited: 向外加厚 gives 5952 mm³, unchecked 4512 again', async () => {
    await S.treeEdit('薄殼1');
    await S.pmCheck('向外加厚（預設往內）', true);
    await H.pmOk();
    const outward = S.volume();
    await S.treeEdit('薄殼1');
    await S.pmCheck('向外加厚（預設往內）', false);
    await H.pmOk();
    return { outward, volume: S.volume(), pass: near(outward, 44 * 34 * 12 - 12000) && near(S.volume(), 4512) };
  });
  await step('4 壁厚 20 (more than half the block): an error with the reason, 2 brings it back', async () => {
    await S.treeEdit('薄殼1');
    await H.pmInput('壁厚', '20');
    await shot('4-shell-too-thick-while-editing');
    await H.pmOk();
    const failed = S.failed();
    const text = (S.notice() + ' ' + failed.join(' ')).trim();
    await shot('4-shell-too-thick');
    await S.treeEdit('薄殼1');
    await H.pmInput('壁厚', '2');
    await H.pmOk();
    return { failed, text, volume: S.volume(), pass: failed.length === 1 && /壁厚大於/.test(failed[0]) && near(S.volume(), 4512) && S.failed().length === 0 };
  });
  await step('5 a 20 × 10 × 10 block, 「拔模」: the top face as the neutral face, the four sides picked from four views', async () => {
    await S.box(20, 10, 10);
    await S.iso();
    await H.action('特徵', '拔模');
    const hint = document.querySelector('.pick-hint, .pick-prompt')?.textContent ?? '';
    await H.at(S.planeFace(1, 10).center); // the first click is the neutral face
    const neutralOnly = listed();
    const r = state().result;
    const verts = S.vertices();
    const mid = [0, 1, 2].map((a) => (Math.min(...verts.map((v) => v[a])) + Math.max(...verts.map((v) => v[a]))) / 2);
    const sides = r.faceFingerprints.map((fp, i) => ({ fp, name: r.faceNames[i] })).filter(({ fp, name }) => fp.type === 'plane' && name.includes(':side:'));
    for (const { fp } of sides) {
      const d = [0, 1, 2].map((a) => fp.center[a] - mid[a]);
      const axis = d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs)));
      const view = axis === 2 ? (d[2] > 0 ? 'front' : 'back') : d[0] > 0 ? 'right' : 'left';
      await S.view(view);
      await H.at(fp.center);
    }
    await shot('5-four-sides-picked');
    await H.pmInput('拔模角度', '3');
    return { hint, neutralOnly, items: listed(), sides: sides.length, pass: sides.length === 4 && listed().length === 5 };
  });
  await step('6 ✔: the walls lean 3° towards the top, 1846.44 mm³', async () => {
    await H.pmOk();
    await S.iso();
    const t = Math.tan((3 * Math.PI) / 180);
    return { volume: S.volume(), pass: near(S.volume(), 2000 - 30 * t * 100 + (4 / 3) * t * t * 1000, 1e-4) && near(S.volume(), 1846.44, 1e-4) && S.failed().length === 0 };
  });
  await step('7 拔模1 edited with 反轉拔模方向: the walls widen away from the top face', async () => {
    await S.treeEdit('拔模1');
    await S.pmCheck('反轉拔模方向（離中立面越遠越寬）', true);
    await H.pmOk();
    await S.iso();
    const t = Math.tan((3 * Math.PI) / 180);
    return { volume: S.volume(), pass: near(S.volume(), 2000 + 30 * t * 100 + (4 / 3) * t * t * 1000, 1e-4) && S.failed().length === 0 };
  });
  return S.result('C9');
};
