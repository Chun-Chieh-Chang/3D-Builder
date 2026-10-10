// Phase 3 T-3: the thread feature PropertyManager and action through UI.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-thread.js?' + Date.now());
//   await __thread.run();

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const T = (window.__thread = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed').map((f) => `${f.id}:${f.message}`);
const pm = () => document.querySelector('.property-manager');

T.run = async () => {
  H.ready();
  await H.action('檔案', '新零件');

  // 1. Create a base cylinder or block so cut has a body to subtract from
  await H.treeClick('上基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(0, 0, 6);
  await H.tool('邊角矩形');
  await H.sk(-20, -20);
  await H.sk(20, 20);
  await H.solved();
  const baseSketch = H.sketch().name;
  await H.exitSketch();
  await H.treeClick(baseSketch);
  await H.action('特徵', '伸長填料/基材');
  await H.pmInput('深度', '30');
  await H.pmOk();
  await H.settle();

  // 2. Draw a triangular tooth sketch on Front Plane
  await H.treeClick('前基準面');
  await H.action('草圖', '草圖');
  await H.frameSketch(10, 0, 10);
  await H.tool('直線');
  await H.sk(10, 5);
  await H.sk(9, 5.5);
  await H.sk(9, 4.5);
  await H.sk(10, 5);
  await H.key('Escape');
  await H.solved();
  const toothSketch = H.sketch().name;
  await H.exitSketch();

  // 3. Select tooth sketch and open Thread PropertyManager
  await H.treeClick(toothSketch);
  await H.action('特徵', '螺牙');

  const pmEl = pm();
  const opened = pmEl !== null && state().editing?.kind === 'feature';
  const threadFeature = state().doc.features.find((f) => f.id === state().editing?.featureId);

  // Check inputs exist in PropertyManager
  const hasRows = pmEl ? pmEl.querySelectorAll('.pm-row').length >= 4 : false;

  // Confirm via PropertyManager OK (✔)
  await H.pmOk();
  await H.settle();

  const committed = state().editing === null;
  const inTree = [...document.querySelectorAll('.feature-tree *')].some((e) => e.textContent?.includes('螺牙') && e.children.length === 0);

  return {
    name: 'thread feature PropertyManager creation and commit',
    opened,
    hasRows,
    committed,
    inTree,
    threadType: threadFeature?.type,
    failed: failed(),
    pass: opened && hasRows && committed && inTree && failed().length === 0,
  };
};
