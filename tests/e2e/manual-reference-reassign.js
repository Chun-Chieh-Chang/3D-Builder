// G15 (P4, 診斷、關係與參照): model references end to end. A boss on a block; a sketch on the block's top face converts one of the
// boss's top edges, so a line follows the edge (聯動: widening the boss lengthens it). Deleting the boss takes the edge away: the rebuild
// fails **located at the reference** (the feature's own unresolved entry names it) and the line does not silently become a plain one. The
// sketch's 「模型參照」 list shows the broken row with the reason; 重新指定 trials the candidate through the real reference pipeline and
// shows the outcome — 取消 leaves the document exactly as it was — and 「確認」 re-points the reference, which the rebuild then follows.
// Saved and opened again, the re-specified reference is still the new one. Replayed in the app's page (http://127.0.0.1:5391, 1280×720;
// `npm run verify:ui` does it). Not a Vitest test.
//
//   await import('/@fs/<checkout>/tests/e2e/manual-reference-reassign.js?' + Date.now());   // in a freshly loaded page
//   await __refReassign.run();   // -> { name, steps: [{ name, pass }], pass }

const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'manual-support.js?' + Date.now());
const S = window.__man;
const { H, store, step } = S;
const P = (window.__refReassign = {});

const state = () => store.getState();
const failed = () => state().result.features.filter((f) => f.status !== 'ok' && f.status !== 'suppressed' && f.status !== 'rolledBack').map((f) => `${f.id}:${f.message}`);
const docSketch = (name) => state().doc.features.find((f) => f.type === 'sketch' && f.name === name);
const sketchFeatureStatus = (id) => state().result.features.find((f) => f.id === id);
/** The one entity of the sketch that follows the model. */
const refEntity = (name) => docSketch(name).entities.find((e) => e.pierce || e.ref);
const modelRefs = (name) => docSketch(name).entities.flatMap((e) => (e.pierce ? [e.pierce] : e.ref ? [e.ref] : []));
/** The rows of the 「模型參照」 list, as their text. */
const refRows = () => [...document.querySelectorAll('[data-sketch-references] .relation-list li')].map((li) => li.textContent);

P.run = async () => {
  let ids = {};
  await step('1 the block, a 6 × 4 boss 5 high on its top face, the boss rectangle held by a driving 6', async () => {
    await window.__man.fresh();
    await S.box(20, 10, 10).catch((e) => {
      const root = document.getElementById('root') ?? document.querySelector('#app');
      throw new Error(`box failed: ${e.message}; canvas=${!!H.canvas()} canvases=${document.querySelectorAll('canvas').length} viewer=${!!store.viewer} pm=${!!S.pm()} root=${root ? root.children.length : 'none'} href=${location.href} ready=${document.readyState} ui=${!!window.__ui}`);
    });
    const top = S.planeFace(1, 10);
    await H.at(top.center);
    await H.action('草圖', '草圖');
    await H.frameSketch(3, 2, 10);
    await H.tool('邊角矩形');
    await H.sk(0, 0);
    await H.sk(6, 4, { ctrlKey: true });
    await H.solved();
    const boss = H.sketch();
    const width = boss.entities.find((e) => e.type === 'line' && Math.abs((H.geom().get(e.id)?.a[1] ?? 99) - (H.geom().get(e.id)?.b[1] ?? 98)) < 1e-9 && (H.geom().get(e.id)?.a[1] ?? 1) === 0);
    await H.dim([width.id], [3, -1.5], 6);
    ids.bossSketch = boss.name;
    await H.selectTool();
    await H.exitSketch();
    await S.extrude(ids.bossSketch, 5);
    return { pass: S.near(S.volume(), 20 * 10 * 10 + 6 * 4 * 5), volume: S.volume() };
  });

  await step('2 a sketch on the block\'s top face converts the boss\'s top edge: a line that follows it (length 6)', async () => {
    const top = S.planeFace(1, 10);
    await H.at(top.center);
    await H.action('草圖', '草圖');
    ids.convert = H.sketch().name;
    ids.convertId = H.sketch().id;
    await H.tool('轉換實體引用');
    // the boss's top edges lie 5 above this plane; the one of length 6 runs along the boss's width
    const edge = state().result.edgeFingerprints.find((fp) => fp.type === 'line' && Math.abs(fp.center[1] - 15) < 1e-6 && Math.abs(fp.size - 6) < 1e-6);
    await H.at(edge.center);
    await H.solved();
    await H.selectTool();
    const e = refEntity(ids.convert);
    const g = H.geom().get(e.id);
    return { pass: !!e && !!e.ref && g?.type === 'line' && Math.abs(Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) - 6) < 1e-6, ref: e?.ref ?? null, length: g ? Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) : null };
  });

  await step('3 聯動: the boss widened to 8 lengthens the converted line to 8', async () => {
    await window.__man.treeEdit(ids.bossSketch);
    const row = [...document.querySelectorAll('.pm-row')].find((r) => r.querySelector('span')?.textContent?.includes('距離'));
    if (!row) throw new Error('no width dimension row in the boss sketch');
    await window.__man.type(row.querySelector('input'), '8');
    await H.selectTool();
    await H.exitSketch();
    await H.settle();
    await window.__man.treeEdit(ids.convert);
    await H.solved();
    const e = refEntity(ids.convert);
    const g = H.geom().get(e.id);
    const len = g ? Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) : null;
    await H.selectTool();
    await H.exitSketch();
    return { pass: len !== null && Math.abs(len - 8) < 1e-6, length: len };
  });

  await step('4 deleting the boss takes the edge: the rebuild fails located at the reference, which the document still holds', async () => {
    ids.refName = modelRefs(ids.convert)[0].name;
    await window.__man.treeMenu(state().doc.features.filter((f) => f.type === 'extrude').at(-1).name, '刪除…');
    const modal = [...document.querySelectorAll('.modal button')].find((b) => (b.textContent ?? '').includes('刪除'));
    if (modal) modal.click();
    await H.settle();
    const status = sketchFeatureStatus(ids.convertId);
    return {
      pass: failed().length > 0 && status?.status === 'error' && (status?.unresolved ?? []).some((u) => u.ref.name === ids.refName) && !!refEntity(ids.convert)?.ref,
      failed: failed(),
      stillAReference: !!refEntity(ids.convert)?.ref,
    };
  });

  await step('5 the 「模型參照」 list shows the broken row with the reason', async () => {
    await window.__man.treeEdit(ids.convert);
    await H.settle();
    const rows = refRows();
    const entry = sketchFeatureStatus(docSketch(ids.convert).id);
    return {
      pass: rows.length === 1 && rows[0].includes('失效') && rows[0].includes(ids.refName) && rows[0].includes('來源不見了'),
      rows,
      entryStatus: entry?.status,
      entryUnresolved: entry?.unresolved ? entry.unresolved.map((u) => u.ref.name) : null,
      docId: docSketch(ids.convert).id,
    };
  });

  await step('6 重新指定: the trial succeeds and 「取消」 changes nothing — the row is broken again, the rebuild still failing', async () => {
    const row = document.querySelector('[data-sketch-references] .relation-list li');
    [...row.querySelectorAll('button')].find((b) => b.textContent === '重新指定').click();
    await H.waitFor(() => [...document.querySelectorAll('.reassign-trial button')].length > 0, 5000, 'the candidates');
    [...document.querySelectorAll('.reassign-trial button')].find((b) => b.textContent === '重新指定').click();
    await H.waitFor(() => document.querySelector('.reassign-trial .ok-text') !== null, 20000, 'the trial to succeed');
    const candidateName = document.querySelector('.reassign-trial code')?.textContent ?? '';
    const cancel = [...document.querySelectorAll('.reassign-trial button')].find((b) => b.textContent === '取消');
    cancel.click();
    await H.settle();
    const rows = refRows();
    return {
      pass: rows[0].includes('失效') && rows[0].includes(ids.refName) && modelRefs(ids.convert)[0].name === ids.refName,
      candidateName,
    };
  });

  await step('7 重新指定 again and 「確認」: the reference is re-pointed, the rebuild follows it, and the list says 聯動中', async () => {
    const row = document.querySelector('[data-sketch-references] .relation-list li');
    [...row.querySelectorAll('button')].find((b) => b.textContent === '重新指定').click();
    await H.waitFor(() => [...document.querySelectorAll('.reassign-trial button')].length > 0, 5000, 'the candidates again');
    [...document.querySelectorAll('.reassign-trial button')].find((b) => b.textContent === '重新指定').click();
    await H.waitFor(() => document.querySelector('.reassign-trial .ok-text') !== null, 20000, 'the trial to succeed again');
    const candidateName = document.querySelector('.reassign-trial code')?.textContent ?? '';
    [...document.querySelectorAll('.reassign-trial button')].find((b) => b.textContent.includes('確認')).click();
    await H.waitFor(() => failed().length === 0, 20000, 'the rebuild to succeed');
    await H.solved();
    const rows = refRows();
    const e = refEntity(ids.convert);
    const g = H.geom().get(e.id);
    const diag = {
      nameMatch: modelRefs(ids.convert)[0].name === candidateName,
      noFailed: failed().length === 0,
      linked: rows[0].includes('聯動中'),
      isLine: g ? g.type === 'line' : null,
      failedList: failed().length,
      problems: JSON.stringify(state().referenceProblems ?? {}).slice(0, 150),
      rowTail: rows[0].slice(-50),
    };
    return {
      diag,
      pass: diag.nameMatch && diag.noFailed && diag.linked && diag.isLine,
    };
  });

  await step('8 saved and opened again, the re-specified reference is still the new one and the sketch rebuilds', async () => {
    await H.selectTool();
    await H.exitSketch();
    const file = await H.saveAs('ref-reassign.3dbx');
    const bytes = Uint8Array.from(atob(file), (c) => c.charCodeAt(0));
    window.showOpenFilePicker = async () => [{ name: 'ref-reassign.3dbx', kind: 'file', getFile: async () => new File([bytes], 'ref-reassign.3dbx') }];
    await H.action('檔案', '開啟舊檔');
    await H.waitFor(() => state().fileName === 'ref-reassign.3dbx', 20000, 'the part to open');
    await H.settle();
    const kept = modelRefs(ids.convert)[0].name;
    const status = sketchFeatureStatus(ids.convertId);
    await window.__man.treeEdit(ids.convert);
    await H.settle();
    const rows = refRows();
    return {
      pass: kept !== ids.refName && rows[0].includes(kept) && rows[0].includes('聯動中') && (status?.status ?? 'ok') === 'ok',
      kept,
      status: status?.status ?? 'ok',
    };
  });

  return window.__man.result('reference-reassign');
};
