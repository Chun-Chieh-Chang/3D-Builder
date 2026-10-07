// Edges and vertices can be selected with nothing being edited (ADR 0117). Run it in a freshly loaded app page (http://127.0.0.1:5391, viewport 1280×720):
//
//   await import('/@fs/<checkout>/tests/e2e/phase3-select-elements.js?' + Date.now());
//   await __selectElements.run();
//
// A block 40 × 30 × 20 is opened. With nothing edited the viewer lets edges and vertices be picked (they were not); the three boxes of the selection filter turn each kind on and off.
// The edge click that the viewer gives goes to the selection (not to a command), Ctrl adds, a click on nothing lets go; the edges are drawn selected, and a fillet started now begins with them.

const here = new URL(import.meta.url).pathname;
const root = here.replace(/tests\/e2e\/[^/]*$/, '');
await import(`${root}tests/e2e/phase2-assembly.js?` + Date.now());
const H = window.__ui2;
const { store } = H;
const io = await import(`${root}packages/io/src/index.ts`);
const { build, extrude, front, rectangle, sketch } = await import(`${root}tests/phase1/builders.ts`);
const g = (window.__selectElements = {});

g.run = async () => {
  H.ready();
  await H.project({});
  await H.writeAt('塊.3dbx', await io.writePartFile(build(sketch('s1', front, rectangle('r', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }))));
  await H.open('塊.3dbx');
  await H.waitFor(() => store.getState().result?.mesh, 20000, 'the block');
  const v = store.viewer;
  const st = () => store.getState();
  await H.settle();

  H.check(st().editing === null, 'nothing is being edited');
  H.check(v.edgesOn && v.facesOn && v.verticesOn, 'edges, faces and vertices can all be picked');
  store.setPickFilter('edges', false);
  await H.settle();
  H.check(!v.edgesOn && v.facesOn && v.verticesOn, 'the edges box off: edges are not picked, faces and vertices are');
  store.setPickFilter('vertices', false);
  store.setPickFilter('faces', false);
  await H.settle();
  H.check(!v.edgesOn && !v.facesOn && !v.verticesOn, 'all three off: nothing is picked');
  for (const k of ['faces', 'edges', 'vertices']) store.setPickFilter(k, true);
  await H.settle();

  // an edge, then a second with Ctrl, then the first again with Ctrl (ticked out), then a click on nothing
  const names = st().result.edgeNames;
  const [a, b] = [names[0], names[1]];
  v.events.onEdgeClick(0, false);
  await H.settle();
  H.check(st().selectedElements.length === 1 && st().selectedElements[0].name === a && st().selectedElements[0].kind === 'edge', `the edge is selected: ${JSON.stringify(st().selectedElements.map((x) => x.name))}`);
  H.check(st().selectedFace === null && st().selected === null, 'the face and the tree item are not');
  H.check(v.selected.size === 1 && v.selected.has(0), 'the viewer draws it selected');
  v.events.onEdgeClick(1, true);
  await H.settle();
  H.check(st().selectedElements.map((x) => x.name).join() === [a, b].join(), 'Ctrl adds a second edge');
  v.events.onEdgeClick(0, true);
  await H.settle();
  H.check(st().selectedElements.map((x) => x.name).join() === b, 'Ctrl on the first again takes it out');
  v.events.onVertexClick(0, true);
  await H.settle();
  H.check(st().selectedElements.length === 2 && st().selectedElements[1].kind === 'vertex' && v.selectedVertices.size === 1, 'a vertex joins them');

  // a fillet started now takes the edges (not the vertex)
  store.newFillet();
  await H.waitFor(() => st().editing?.kind === 'feature', 5000, 'the fillet session');
  await H.settle();
  const fillet = st().doc.features.find((f) => f.type === 'fillet');
  H.check(fillet.edges.length === 1 && fillet.edges[0].name === b, `the fillet begins with the selected edge: ${JSON.stringify(fillet.edges.map((e) => e.name))}`);
  H.check(st().selectedElements.length === 0, 'and the selection is let go');
  store.cancelEdit();
  await H.settle();

  // a face clears the elements, a click on nothing too
  v.events.onEdgeClick(0, false);
  await H.settle();
  v.events.onFaceClick(0, false);
  await H.settle();
  H.check(st().selectedElements.length === 0 && st().selectedFace !== null, 'a face click takes the selection from the edges');
  v.events.onEdgeClick(0, false);
  await H.settle();
  v.events.onFaceClick(-1, false);
  await H.settle();
  H.check(st().selectedElements.length === 0 && st().selectedFace === null, 'a click on nothing lets go of everything');
  await H.tidy();
  console.log('phase3-select-elements: all checks passed');
  return true;
};
