// The picture of a sketch (ADR 0116). Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-sketch-picture.js?' + Date.now());
//   await __sketchPicture.run();
//
// A part with an empty sketch on the front plane is opened and the sketch edited. An image (a 40 × 20 pixel PNG made in the page) is added: 100 mm wide, 50 high, 60 % opaque, drawn in the 3D
// view; the panel has its numbers. The scale from two points: (−10, 0) and (30, 0) are 40 apart and are really 80: the picture is 200 × 100 and its centre is at (10, 0); undo puts it back.
// The width typed in the panel keeps the proportions. A file that is not an image is refused in words. Deleted, the picture and its data go; accepted, the sketch keeps what is left.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, front, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__sketchPicture = {});

const sketchFeature = () => store.getState().doc.features.find((f) => f.id === 'sk');
const pictures = () => sketchFeature().pictures ?? [];
const near = (a, b, what) => H.check(Math.abs(a - b) < 1e-6, `${what}: ${a} (expected ${b})`);
const png = async () => {
  const c = document.createElement('canvas');
  c.width = 40;
  c.height = 20;
  const x = c.getContext('2d');
  x.fillStyle = '#c0392b';
  x.fillRect(0, 0, 40, 20);
  x.fillStyle = '#ffffff';
  x.fillRect(5, 5, 10, 10);
  return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer());
};

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('圖.3dbx', await io.writePartFile(build(sketch('sk', front))));
  await H.open('圖.3dbx');
  await H.waitFor(() => store.getState().result?.features?.every((f) => f.status === 'ok'), 20000, 'the part');
  store.beginEdit('sk');
  await H.waitFor(() => store.getState().editing?.kind === 'sketch', 5000, 'the sketch session');
  await H.settle();
  H.check(document.querySelector('[data-field="addPicture"]'), 'the panel has the button to add a picture');

  // a file that is not an image is refused
  H.check((await store.addPictureData('notes.txt', new TextEncoder().encode('hello'))) === false && pictures().length === 0, 'a text file is refused');

  H.check(await store.addPictureData('trace.png', await png()), 'the PNG is added');
  await H.settle();
  const p = pictures()[0];
  near(p.width, 100, 'the picture is 100 wide');
  near(p.height, 50, 'and 50 high (40 × 20 pixels)');
  near(p.opacity, 0.6, 'and 60 % opaque');
  await H.waitFor(() => store.viewer.picturesGroup?.children.length === 1, 5000, 'the picture drawn in the 3D view');
  H.check(!!document.querySelector(`[data-picture="${p.id}"]`), 'the panel lists it');
  H.check(store.getState().doc.blobs.length === 1 && store.getState().doc.blobs[0].kind === 'png', 'its data is in the document as a png');

  // the scale from two points
  store.startPictureScale(p.id);
  store.pictureScaleClick([-10, 0]);
  store.pictureScaleClick([30, 0]);
  await H.settle();
  H.check(!!document.querySelector('[data-field="distance"]'), 'the panel asks for the real distance');
  store.finishPictureScale(80);
  await H.settle();
  const q = pictures()[0];
  near(q.width, 200, 'the picture grew to 200');
  near(q.height, 100, 'and 100');
  near(q.x, 10, 'its centre is at x = 10');
  near(q.y, 0, 'and y = 0');
  store.undo();
  await H.settle();
  near(pictures()[0].width, 100, 'undone, it is 100 wide again');
  store.redo();
  await H.settle();
  near(pictures()[0].width, 200, 'and redone 200');

  // a width typed keeps the proportions
  store.setSketchPicture(p.id, { width: 80, height: (80 * pictures()[0].height) / pictures()[0].width });
  await H.settle();
  near(pictures()[0].height / pictures()[0].width, 0.5, 'the proportions are kept');

  // deleted: the picture and its data go
  store.removeSketchPicture(p.id);
  await H.settle();
  H.check(pictures().length === 0 && store.getState().doc.blobs.length === 0, 'deleted, the picture and its data are gone');
  await H.waitFor(() => !store.viewer.picturesGroup, 5000, 'nothing drawn any more');
  store.undo();
  await H.settle();
  H.check(pictures().length === 1 && store.getState().doc.blobs.length === 1, 'undone, both are back');
  store.commitEdit();
  await H.settle();
  H.check(pictures().length === 1, 'accepted, the sketch keeps the picture');
  await H.tidy();
  console.log('phase3-sketch-picture: all checks passed');
  return true;
};
