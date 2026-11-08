// await __sectionClearance.check();
const here = import.meta.url.slice(0, import.meta.url.lastIndexOf('/') + 1);
await import(here + 'phase1-demo-parts.js?' + Date.now());
const H = window.__ui;
const { store } = H;
const state = () => store.getState();
const check = (ok, message) => { if (!ok) throw new Error(message); };
const status = (id) => state().result?.features.find((f) => f.id === id);

window.__sectionClearance = {
  async check() {
    H.ready();
    await H.action('檔案', '新零件');
    const sketch = {
      id: 'sketch1', type: 'sketch', name: 'Circle', suppressed: false, plane: { kind: 'datum', name: 'plane:front' },
      entities: [{ type: 'point', id: 'center', x: 0, y: 0 }, { type: 'circle', id: 'circle', center: 'center', radius: 6 }],
      constraints: [],
    };
    store.execute({ type: 'insertFeature', index: 0, feature: sketch });
    store.execute({ type: 'insertFeature', index: 1, feature: {
      id: 'extrude1', type: 'extrude', name: 'Cylinder', suppressed: false, op: 'boss', sketch: sketch.id, dir1: { type: 'blind', depth: '10' },
    } });
    await H.settle();
    check(Math.abs(state().result.bodies[0].volume - Math.PI * 360) < 1e-6, 'native cylinder fixture');

    H.tab('特徵');
    await H.wait(80);
    H.btn('截面間隙');
    await Promise.resolve();
    const stop = [...document.querySelectorAll('[data-section-clearance-panel] button')].find((b) => b.textContent === '停止計算');
    check(stop, 'real worker rebuild exposes the stop button');
    stop.click();
    await H.settle();
    const id = state().doc.features.at(-1).id;
    check(status(id)?.status === 'incomplete', 'the cancelled feature remains incomplete');
    check(state().result.bodies.length === 1, 'recovery rebuild retains the preceding geometry');
    await H.hud('等角');
    await H.hud('全部顯示');
    const pick = [...document.querySelectorAll('[data-section-clearance-panel] button')].find((b) => b.textContent === '選取模型平面');
    check(pick, 'the feature offers an explicit face pick');
    pick.click();
    const cap = state().result.faceFingerprints.findIndex((face) => face.type === 'plane' && Math.abs(face.center[2] - 10) < 1e-7);
    check(cap >= 0, 'the source has a planar end cap at z=10');
    await H.at([0, 0, 10]);
    await H.settle();
    check(state().doc.features.at(-1).plane.name === state().result.faceNames[cap], 'viewport picked the source cap for the section plane');
    await H.pmInput('平面偏移', '-3');
    const retry = [...document.querySelectorAll('[data-section-clearance-panel] button')].find((b) => b.textContent === '重新計算');
    check(retry, 'retry is offered in the feature panel');
    retry.click();
    await H.settle();
    check(status(id)?.status === 'ok', JSON.stringify(status(id)));

    await H.pmInput('間隙', '0.75');
    await H.pmInput('深度', '2');
    const expected = 2 * Math.PI * 6.75 ** 2;
    check(Math.abs(state().result.bodies.find((b) => b.id === id).volume - expected) < 1e-6, 'new body volume from the edited clearance');
    check(document.querySelector('[data-section-clearance-panel] output')?.textContent.includes('0 mm'), 'panel reports the analytic approximation bound');
    await window.__shot?.('section-clearance-panel');
    await H.pmOk();
    const file = await H.saveAs('section-clearance.3dbx');
    const bytes = Uint8Array.from(atob(file), (c) => c.charCodeAt(0));
    window.showOpenFilePicker = async () => [{ name: 'section-clearance.3dbx', kind: 'file', getFile: async () => new File([bytes], 'section-clearance.3dbx') }];
    await H.action('檔案', '開啟舊檔');
    await H.waitFor(() => state().fileName === 'section-clearance.3dbx', 20000, 'saved part to reopen');
    await H.settle();
    check(status(id)?.status === 'ok', 'reopened feature rebuilt');
    check(Math.abs(state().result.bodies.find((b) => b.id === id).volume - expected) < 1e-6, 'reopened solid volume');
    return { pass: true, volume: expected };
  },
};
