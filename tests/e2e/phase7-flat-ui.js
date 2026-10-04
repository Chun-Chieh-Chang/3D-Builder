// Phase 7-5: the flat pattern window. Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase7-flat-ui.js?' + Date.now());
//   await __flatUi.run();
//
// A plate 100 × 50 × 1.5 with an edge flange (90°, 30 from the outside, material inside, radius 2, K 0.5) is opened. 「鈑金」→「平板型式」: the window says 127.319 × 50, the area 6365.98,
// and has one bend of 90° bending up, drawn dashed; the DXF button hands over a file with OUTLINE and BEND; the K-factor made 0.4 in the base flange and the window follows (127.084); closed again.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__flatUi = {});

const doc = () =>
  build(sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' }, {
    id: 'ef',
    type: 'edgeFlange',
    name: 'ef',
    suppressed: false,
    edge: { kind: 'edge', name: '{bf:cap:end|bf:side:sk.rl1}' },
    length: '30',
  });
const result = () => store.getState().result;
const panel = () => document.querySelector('[data-flat]');
const text = (field) => panel()?.querySelector(`[data-field="${field}"]`)?.textContent ?? '';
const near = (a, b, what) => H.check(Math.abs(a - b) < 2e-3, `${what}: ${a} (expected ${b})`);
const BA = (Math.PI / 2) * 2.75;

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('板.3dbx', await io.writePartFile(doc()));
  await H.open('板.3dbx');
  await H.waitFor(() => result()?.features?.every((f) => f.status === 'ok') && result().mesh, 20000, 'the plate with its flange');

  await H.action('鈑金', '平板型式');
  await H.waitFor(() => panel() && text('size') !== '', 10000, 'the flat pattern window');
  const [w, h] = text('size').match(/[\d.]+/g).map(Number);
  near(w, 100 - 7 + 30 + BA, 'the length of the pattern');
  near(h, 50, 'the width of the pattern');
  H.check(Math.abs(Number(text('area').match(/[\d.]+/)[0]) - 50 * (100 - 7 + 30 + BA)) < 1e-2, `the area: ${text('area')}`);
  H.check(panel().querySelectorAll('[data-bend]').length === 1 && /90°/.test(panel().querySelector('[data-bend]').textContent) && /往上/.test(panel().querySelector('[data-bend]').textContent), 'one bend of 90° bending up');
  H.check(panel().querySelectorAll('svg line').length >= 5, 'the outline and the bend line are drawn');

  // the K-factor changes the length and the window follows
  const flange = store.getState().doc.features.find((f) => f.type === 'baseFlange');
  store.execute({ type: 'setBaseFlange', featureId: flange.id, flange: { thickness: '1.5', radius: '2', kFactor: '0.4' } });
  await H.waitFor(() => Math.abs(Number(text('size').match(/[\d.]+/g)[0]) - (100 - 7 + 30 + (Math.PI / 2) * 2.6)) < 2e-3, 10000, 'the pattern follows the K-factor');
  H.check(true, 'K 0.4 shortens the pattern');

  // the DXF: what the download is handed is a file with the outline and the bend line on their own layers
  let captured = null;
  const make = URL.createObjectURL;
  URL.createObjectURL = (blob) => {
    captured = blob;
    return make.call(URL, blob);
  };
  panel().querySelector('[data-action="exportFlatDxf"]').click();
  await H.settle();
  URL.createObjectURL = make;
  H.check(!!captured, 'the DXF is handed to the browser');
  const dxf = await captured.text();
  H.check(dxf.includes('AC1015') && dxf.includes('OUTLINE') && dxf.includes('BEND') && dxf.includes('DASHED'), 'the DXF has the layers of the pattern');

  // closing it
  panel().querySelector('button.primary').click();
  await H.settle();
  H.check(!panel(), 'the window closes');

  await H.tidy();
  console.log('phase7-flat-ui: all checks passed');
  return true;
};
