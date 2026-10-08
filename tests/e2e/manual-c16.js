// Manual checklist C16 (docs/manual-verification.html): 「鏡射」 of a feature (the post, across the right plane), then the same 鏡射1 edited into a mirror of the body (joined, then a body of
// its own), and a mirror plane put outside the plate (the message), replayed the way a person does it in the app's page (http://127.0.0.1:5391, 1280×720; `npm run verify:ui` does it).
// Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-c16.js?' + Date.now());   // in a freshly loaded page
//   await __manualC16.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step, state, near, shot } = S;
const M = (window.__manualC16 = {});

const PLATE = 6000;
const POST = Math.PI * 4 * 5;
const chip = async (label) => {
  const b = [...document.querySelectorAll('.property-manager .datum-picker button')].find((x) => x.title === label || x.textContent === label);
  if (!b) throw new Error(`no button ${label}`);
  b.click();
  await H.settle();
};
const tick = async (label, on) => {
  const row = [...document.querySelectorAll('.property-manager .selection-box li')].find((li) => li.textContent.includes(label));
  const box = row.querySelector('input');
  if (box.checked !== on) box.click();
  await H.settle();
};

M.run = async () => {
  let post;
  await step('1 a plate 60 × 20 × 5 centred on the origin with a post of radius 2 at the left edge', async () => {
    await S.box(60, 20, 5, { center: true });
    await S.iso();
    await H.at(S.planeFace(1, 5).center);
    await H.action('草圖', '草圖');
    await H.frameSketch(0, 0, 8);
    await H.tool('圓');
    await H.sk(-25, 0);
    await H.sk(-23, 0.01);
    await H.solved();
    const name = H.sketch().name;
    await H.selectTool();
    await H.exitSketch();
    await S.extrude(name, 5);
    post = state().doc.features.filter((f) => f.type === 'extrude').at(-1);
    // a plane 50 from the right plane (x = 50, beyond the plate), made now so that the mirror, which comes after it in the tree, can name it in step 5
    await H.treeClick('右基準面');
    await H.action('特徵', '基準面');
    await H.pmInput('偏移距離', '50');
    await H.pmOk();
    return { volume: S.volume(), pass: near(S.volume(), PLATE + POST, 1e-3) && S.treeRows().includes('基準面1') };
  });
  await step('2 the post selected, 「鏡射」 with 鏡射什麼 = 特徵: the plane is 右基準面 and the other half has a post; ✔', async () => {
    await H.treeClick(post.name);
    await H.action('特徵', '鏡射');
    const text = S.pmText();
    await S.iso();
    await shot('2-mirror-preview');
    const volume = S.volume();
    await H.pmOk();
    return { volume, plane: /右基準面/.test(text), pass: /鏡射什麼/.test(text) && /右基準面/.test(text) && near(volume, PLATE + 2 * POST, 1e-3) && S.failed().length === 0 };
  });
  await step('3 鏡射1 edited: 本體 with the body ticked, joined: one body again (the plate is its own image)', async () => {
    await S.treeEdit('鏡射1');
    await H.pmSelect('bodies');
    await tick(state().result.bodies[0].name, true);
    return { volume: S.volume(), bodies: state().result.bodies.length, pass: near(S.volume(), PLATE + 2 * POST, 1e-3) && state().result.bodies.length === 1 };
  });
  await step('4 合併結果 off: the image is a body of its own, 實體(2) in the tree; ✔', async () => {
    await H.pmCheck('合併結果', false);
    const bodies = state().result.bodies.length;
    await H.pmOk();
    await S.iso();
    await shot('4-two-bodies');
    return { bodies, tree: S.treeRows().filter((r) => /實體/.test(r)), pass: bodies === 2 && S.treeRows().some((r) => /實體\(2\)/.test(r)) && near(S.volume(), 2 * (PLATE + POST), 1e-3) };
  });
  await step('5 (選做) the mirror plane moved outside the plate: the message says the image does not touch the body', async () => {
    await S.treeEdit('鏡射1');
    await H.pmSelect('features');
    const clear = [...S.pm().querySelectorAll('.selection-box li')].find((x) => x.textContent.startsWith('鏡射面') && x.querySelector('.link'));
    clear?.querySelector('.link').click();
    await H.settle();
    const chips = [...document.querySelectorAll('.property-manager .datum-picker button')].map((x) => x.title || x.textContent);
    await chip(chips.find((x) => /基準面\d/.test(x)) ?? '基準面1');
    const message = document.querySelector('.property-manager .pm-message')?.textContent ?? '';
    const failed = S.failed();
    await shot('5-mirror-plane-outside');
    document.querySelector('.property-manager .pm-cancel')?.click();
    await H.settle();
    return { message, failed, pass: /鏡射出來的.*沒有接觸到本體/.test(message) && failed.length === 1 };
  });
  return S.result('C16');
};
