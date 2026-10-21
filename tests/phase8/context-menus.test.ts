/**
 * The right-click menus of the graphics area (ADR 0176): what each one offers for the thing under the pointer, what the commands work on (the feature of a
 * face, the body of an edge, the component), the sketch's own picks (contextPick, the chain, 智慧型尺寸 from the selection), and that the tree's menus and the
 * graphics area's are one set of commands from the registry. The real pointer in the real app is replayed in tests/e2e/manual-context-menus.js.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type Command, type Feature, type PartDoc, type Ref, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver } from '@3db/sketch';
import type { UiState } from '../../apps/web/src/state/store';
import type { PointerInput, SketchHost } from '../../apps/web/src/sketcher/controller';
import type { SketchSolvePayload } from '../../apps/web/src/worker/protocol';

// Browser APIs the store and its imports expect in Node (same shims as thread-ui.test.ts).
class MockWorker {
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
  terminate() {}
}
if (typeof (globalThis as unknown as { Worker?: unknown }).Worker === 'undefined') (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;
if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = { addEventListener: () => {}, removeEventListener: () => {}, location: { href: '' }, document: { title: '', addEventListener: () => {}, removeEventListener: () => {}, hidden: false } };
}
if (typeof (globalThis as unknown as { document?: unknown }).document === 'undefined') {
  (globalThis as unknown as { document: unknown }).document = { addEventListener: () => {}, removeEventListener: () => {}, title: '', hidden: false };
}

type Menus = typeof import('../../apps/web/src/contextMenus');
type Actions = typeof import('../../apps/web/src/actions');
let menus: Menus;
let actions: Actions;
let Controller: typeof import('../../apps/web/src/sketcher/controller').SketchController;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  menus = await import('../../apps/web/src/contextMenus');
  actions = await import('../../apps/web/src/actions');
  Controller = (await import('../../apps/web/src/sketcher/controller')).SketchController;
  solver = await PlaneGcsSolver.create();
});

// ------------------------------------------------------------------ the part

const sketch1 = { id: 'sketch1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] } as unknown as Feature;
const extrude1 = { id: 'extrude1', type: 'extrude', name: '伸長1', suppressed: false, sketch: 'sketch1' } as unknown as Feature;
const face = (name: string, plane = true): Ref => ({ kind: 'face', name, fingerprint: { type: plane ? 'plane' : 'cylinder', size: 10, center: [0, 0, 0], dir: [0, 0, 1] } }) as Ref;
/** A part with one extrusion of one sketch: two bodies' worth of faces (b1 faces 0–5, b2 faces 6–8), and two edges (between faces 0|1 and 6|7). */
function part(over: Partial<UiState> = {}): UiState {
  const names = ['extrude1:side1', 'extrude1:side2', 'extrude1:a', 'extrude1:b', 'extrude1:c', 'extrude1:d', 'extrude1:e', 'extrude1:f', 'extrude1:g'];
  return {
    active: 'part',
    editing: null,
    measure: null,
    selected: null,
    selectedFace: null,
    selectedElements: [],
    bootMs: 1,
    doc: { schemaVersion: 70, units: 'mm', features: [sketch1, extrude1], variables: [], blobs: [], visibility: {}, bodies: {}, idCounters: {}, rollbackIndex: null },
    result: {
      mesh: {},
      faceNames: names,
      edgeNames: ['extrude1:side1|extrude1:side2', 'extrude1:e|extrude1:f'],
      vertexNames: ['extrude1:side1|extrude1:side2|extrude1:a'],
      bodies: [
        { id: 'b1', name: '本體1', reference: false, surface: false, shown: true, face0: 0, faces: 6, volume: 1 },
        { id: 'b2', name: '本體2', reference: false, surface: false, shown: true, face0: 6, faces: 3, volume: 1 },
      ],
    },
    ...over,
  } as unknown as UiState;
}

describe('what the commands of a right click work on (ADR 0176)', () => {
  it('the feature: the one selected in the tree, else the one that made the face, edge or vertex selected', () => {
    expect(actions.contextFeature(part({ selected: 'sketch1' }))?.id).toBe('sketch1');
    expect(actions.contextFeature(part({ selectedFace: face('extrude1:a') }))?.id).toBe('extrude1');
    expect(actions.contextFeature(part({ selectedElements: [{ kind: 'edge', name: 'extrude1:side1|extrude1:side2' } as Ref] }))?.id).toBe('extrude1');
    expect(actions.contextFeature(part({ selectedElements: [{ kind: 'vertex', name: 'extrude1:side1|extrude1:side2|extrude1:a' } as Ref] }))?.id).toBe('extrude1');
    expect(actions.contextFeature(part())).toBeUndefined();
  });

  it('hiding: the body of the face (by its range of faces), the body of an edge (by the faces on its sides), a body or sketch of the tree', () => {
    // the edge's faces come from the mesh's topology; an empty mesh has none, so the body of an edge needs the real mesh (the e2e) — the face is checked here
    expect(actions.contextVisibilityKey(part({ selectedFace: face('extrude1:a') }))).toBe('body:b1');
    expect(actions.contextVisibilityKey(part({ selectedFace: face('extrude1:f') }))).toBe('body:b2');
    expect(actions.contextVisibilityKey(part({ selected: 'body:b2' }))).toBe('body:b2');
    expect(actions.contextVisibilityKey(part({ selected: 'sketch1' }))).toBe('sketch1');
    expect(actions.contextVisibilityKey(part({ selected: 'extrude1' }))).toBeNull(); // an extrusion is not hidden: its body is
  });

  it('edit, its sketch, suppress: enabled for the feature of the face, not above the rollback bar, not for a suppressed one', () => {
    const on = part({ selectedFace: face('extrude1:a') });
    expect(actions.action('edit-feature').enabled(on)).toBe(true);
    expect(actions.action('edit-feature-sketch').enabled(on)).toBe(true);
    expect(actions.action('suppress-feature').enabled(on)).toBe(true);
    const rolled = part({ selectedFace: face('extrude1:a'), doc: { ...on.doc, rollbackIndex: 1 } });
    expect(actions.action('edit-feature').enabled(rolled)).toBe(false);
    // a sketch made nothing to edit the sketch of
    expect(actions.action('edit-feature-sketch').enabled(part({ selected: 'sketch1' }))).toBe(false);
    // inside a PropertyManager session none of them
    expect(actions.action('edit-feature').enabled(part({ selectedFace: face('extrude1:a'), editing: { featureId: 'extrude1', kind: 'feature' } }))).toBe(false);
  });
});

describe('the part menu', () => {
  const ids = (s: UiState, at: Parameters<Menus['partMenu']>[1]) => menus.menuIds(menus.partMenu(s, at));
  const VIEW = ['fit', 'view-normal', 'standard-views', 'view-front', 'view-back', 'view-top', 'view-bottom', 'view-left', 'view-right', 'view-iso', 'filter-bar'];

  it('on a face: the feature, its sketch, a sketch on the face, hiding the body, its appearance, suppressing, measuring', () => {
    const s = part({ selectedFace: face('extrude1:a') });
    expect(ids(s, { kind: 'face', index: 2 })).toEqual(['edit-feature', 'edit-feature-sketch', 'sketch', 'toggle-visibility', 'appearance', 'suppress-feature', 'measure-part']);
    const sketchOn = menus.partMenu(s, { kind: 'face', index: 2 }).find((e) => e.kind === 'command' && e.id === 'sketch');
    expect(sketchOn).toMatchObject({ disabled: false });
    // a face that is not flat takes no sketch: the line is there, greyed
    expect(menus.partMenu(part({ selectedFace: face('extrude1:a', false) }), { kind: 'face', index: 2 }).find((e) => e.kind === 'command' && e.id === 'sketch')).toMatchObject({ disabled: true });
  });

  it('on an edge: the same and a fillet and a chamfer; on a vertex: the feature and measuring', () => {
    // no mesh here (the body of an edge is found from the mesh's topology: the e2e has the real one)
    const edge = part({ selectedElements: [{ kind: 'edge', name: 'extrude1:side1|extrude1:side2' } as Ref] });
    edge.result = { ...edge.result!, mesh: null };
    expect(ids(edge, { kind: 'edge', index: 0 })).toEqual(['edit-feature', 'edit-feature-sketch', 'fillet', 'chamfer', 'toggle-visibility', 'suppress-feature', 'measure-part']);
    const vertex = part({ selectedElements: [{ kind: 'vertex', name: 'extrude1:side1|extrude1:side2|extrude1:a' } as Ref] });
    expect(ids(vertex, { kind: 'vertex', index: 0 })).toEqual(['edit-feature', 'measure-part']);
  });

  it('on nothing: the view', () => {
    expect(ids(part(), null)).toEqual(VIEW);
  });

  it('in a PropertyManager session or while measuring: only the selection tools it is given', () => {
    const tools = [menus.entry('select-tangent-edges', 'x', () => {})];
    expect(ids(part({ editing: { featureId: 'extrude1', kind: 'feature' } }), { kind: 'edge', index: 0 })).toEqual([]);
    expect(menus.menuIds(menus.partMenu(part({ editing: { featureId: 'extrude1', kind: 'feature' } }), { kind: 'edge', index: 0 }, tools))).toEqual(['select-tangent-edges']);
    expect(ids(part({ measure: {} as UiState['measure'] }), { kind: 'face', index: 0 })).toEqual([]);
  });

  it('never puts two lines between groups together, nor one first or last', () => {
    const sep = menus.SEPARATOR;
    const a = menus.entry('a', 'a', () => {});
    expect(menus.tidy([sep, a, sep, sep, a, sep])).toEqual([a, sep, a]);
  });
});

// ------------------------------------------------------------------ the assembly

function assembly(over: Record<string, unknown> = {}): UiState {
  return {
    active: 'assembly',
    editing: null,
    measure: null,
    interference: null,
    clearance: null,
    bootMs: 1,
    asm: { selected: 'c1', picks: [], doc: { components: [{ id: 'c1', file: 'f1', fixed: false }, { id: 'c2', file: 'f1', fixed: true }], mates: [] }, ...over },
  } as unknown as UiState;
}

describe('the assembly menu', () => {
  it('on a component: what the tree row offers, with mate, move and rotate; fix or float as it is', () => {
    expect(menus.menuIds(menus.assemblyMenu(assembly(), 'c1'))).toEqual(['open-component', 'relink-component', 'mate', 'move-component', 'rotate-component', 'move-with-triad', 'fix-component', 'hide-component', 'transparent-component', 'suppress-component', 'delete-component']);
    expect(menus.menuIds(menus.assemblyMenu(assembly({ selected: 'c2' }), 'c2'))).toContain('float-component');
  });

  it('on nothing: inserting, mating and the view', () => {
    expect(menus.menuIds(menus.assemblyMenu(assembly({ selected: null }), null)).slice(0, 3)).toEqual(['insert-component', 'mate', 'fit']);
  });

  it('greys the commands out while a PropertyManager of the assembly is open', () => {
    const items = menus.assemblyMenu(assembly({ mate: {} }), 'c1');
    expect(items.filter((e) => e.kind === 'command').every((e) => e.kind === 'command' && e.disabled)).toBe(true);
  });
});

// ------------------------------------------------------------------ the sketch

const EMPTY_SKETCH: Command = { type: 'insertFeature', index: 0, feature: { id: 'sketch1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] } };
class Host implements SketchHost {
  readonly featureId = 'sketch1';
  readonly history = new DocHistory(applyCommand(createEmptyPart(), EMPTY_SKETCH));
  last: SketchSolvePayload | null = null;
  constructor() {
    this.resolve();
  }
  sketch = () => this.history.doc.features.find((f) => f.id === this.featureId) as SketchFeature;
  private payload(s: SketchFeature, doc: PartDoc = this.history.doc): SketchSolvePayload {
    const r = solver.solve(resolveSketch(s, doc), {});
    return { seq: 0, ...r, problems: r.status === 'failed' ? [] : findProfiles(s, r).problems, ms: 0 };
  }
  resolve = () => void (this.last = this.payload(this.sketch()));
  doc = () => this.history.doc;
  solved = () => this.last;
  execute = (cmd: Command) => {
    try {
      this.history.execute(cmd);
      this.resolve();
      return true;
    } catch {
      return false;
    }
  };
  dragPreview: SketchHost['dragPreview'] = () => {};
  trial = async (s: SketchFeature, doc?: PartDoc) => this.payload(s, doc);
  notify = () => {};
  editDimension = () => {};
}
const at = (x: number, y: number): PointerInput => ({ p: [x, y], px: 0.05, ctrl: false, shift: false });
function click(c: InstanceType<typeof Controller>, x: number, y: number): void {
  c.pointerMove(at(x, y), false);
  c.pointerDown(at(x, y));
  c.pointerUp(at(x, y));
}
const flush = () => new Promise((r) => setTimeout(r, 0));
/** A rectangle from (5, 5) to (25, 15), the select tool on. */
function rectangle() {
  const h = new Host();
  const c = new Controller(h);
  c.setTool('rect');
  click(c, 5, 5);
  click(c, 25, 15);
  c.escape();
  c.escape();
  return { h, c, lines: h.sketch().entities.filter((e) => e.type === 'line').map((e) => e.id) };
}
const sketchState = (h: Host): UiState => ({ active: 'part', editing: { featureId: 'sketch1', kind: 'sketch' }, measure: null, doc: h.history.doc, sketchSolve: h.last }) as unknown as UiState;

describe('the sketch: what a right click picks (contextPick)', () => {
  it('an entity under the pointer becomes the selection; one already in it keeps the selection; nothing keeps it too', () => {
    const { c, lines } = rectangle();
    expect(lines).toHaveLength(4);
    const bottom = c.contextPick(at(15, 5));
    expect(bottom).not.toBeNull();
    expect(c.getView().selection).toEqual([bottom]);
    c.select([lines.find((l) => l !== bottom)!], true);
    expect(c.getView().selection).toHaveLength(2);
    expect(c.contextPick(at(15, 5))).toBe(bottom);
    expect(c.getView().selection).toHaveLength(2); // already chosen: kept
    expect(c.contextPick(at(15, 10))).toBeNull(); // the middle of the rectangle: nothing there
    expect(c.getView().selection).toHaveLength(2);
  });

  it('an axis of the sketch under the pointer, when no entity is (ADR 0170)', () => {
    const { c } = rectangle();
    expect(c.contextPick(at(-20, 0))).toBe('@axisH');
  });
});

describe('the sketch: the chain, the dimension from the selection', () => {
  it('選擇鏈 grows one line of the rectangle to all four', () => {
    const { c, lines } = rectangle();
    c.contextPick(at(15, 5));
    c.selectChain();
    expect([...c.getView().selection].sort()).toEqual([...lines].sort());
  });

  it('智慧型尺寸 starts from the selected line: the next click places its length', async () => {
    const { h, c } = rectangle();
    c.contextPick(at(15, 5));
    c.startDimension();
    expect(c.getView().tool).toBe('dimension');
    click(c, 15, 2);
    await flush();
    expect(h.sketch().constraints.at(-1)).toMatchObject({ type: 'distance', value: '20' });
  });
});

describe('the sketch menu', () => {
  it('on an entity: the relations it can still take, 智慧型尺寸, construction, chain, delete, normal to, exit', () => {
    const h = new Host();
    const c = new Controller(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 4); // slanted: neither horizontal nor vertical was inferred
    c.escape();
    c.escape();
    const hit = c.contextPick(at(5, 2));
    expect(hit).not.toBeNull();
    const items = menus.sketchMenu(sketchState(h), c, h.sketch(), hit);
    const ids = menus.menuIds(items);
    expect(ids.slice(0, 1)).toEqual(['add-relation']);
    expect(ids).toEqual(expect.arrayContaining(['relation-horizontal', 'relation-vertical']));
    expect(ids.filter((x) => !x.startsWith('relation-') && x !== 'add-relation')).toEqual([
      'tool-dimension',
      'construction',
      // 移動／複製 (ADR 0178): the transforms, the patterns and the mirror
      'transform-entities',
      'tool-moveEntities',
      'tool-copyEntities',
      'tool-rotateEntities',
      'tool-scaleEntities',
      'tool-linearPattern',
      'tool-circularPattern',
      'tool-mirror',
      'sketch-select-chain',
      'sketch-delete',
      'view-normal',
      'exit-sketch',
    ]);
  });

  it('移動／複製 → 移動圖元 starts the tool on what the right click selected (ADR 0178)', async () => {
    // the registry's command acts on the store's sketcher: this controller is it for the test
    const { store } = await import('../../apps/web/src/state/store');
    const h = new Host();
    const c = new Controller(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 4);
    c.escape();
    c.escape();
    const hit = c.contextPick(at(5, 2));
    const sub = menus.sketchMenu(sketchState(h), c, h.sketch(), hit).find((e) => e.kind === 'submenu' && e.id === 'transform-entities');
    const move = sub?.kind === 'submenu' ? sub.items.find((e) => e.kind === 'command' && e.id === 'tool-moveEntities') : undefined;
    expect(move?.kind === 'command' && !move.disabled).toBe(true);
    const was = store.sketcher;
    store.sketcher = c;
    try {
      if (move?.kind === 'command') move.run();
    } finally {
      store.sketcher = was;
    }
    expect(c.getView().tool).toBe('moveEntities');
    expect(c.getView().picks).toEqual([hit]);
  });

  it('a relation from the menu is added, and is no longer offered', async () => {
    const h = new Host();
    const c = new Controller(h);
    c.setTool('line');
    click(c, 0, 0);
    click(c, 10, 4);
    c.escape();
    c.escape();
    const hit = c.contextPick(at(5, 2));
    const relations = menus.sketchMenu(sketchState(h), c, h.sketch(), hit).find((e) => e.kind === 'submenu' && e.id === 'add-relation');
    const horizontal = relations?.kind === 'submenu' ? relations.items.find((e) => e.kind === 'command' && e.id === 'relation-horizontal') : undefined;
    expect(horizontal?.kind).toBe('command');
    const before = h.sketch().constraints.length;
    if (horizontal?.kind === 'command') horizontal.run();
    await flush();
    expect(h.sketch().constraints.length).toBe(before + 1);
    expect(h.sketch().constraints.at(-1)).toMatchObject({ type: 'horizontal', a: hit });
    expect(menus.menuIds(menus.sketchMenu(sketchState(h), c, h.sketch(), hit))).not.toContain('relation-horizontal');
  });

  it('on nothing: the tools drawn most; with a tool on: end it, and the quick snaps for one that places points', () => {
    const { h, c } = rectangle();
    expect(menus.menuIds(menus.sketchMenu(sketchState(h), c, h.sketch(), null))).toEqual(['tool-line', 'tool-rect', 'tool-circle', 'tool-arc', 'tool-dimension', 'view-normal', 'exit-sketch']);
    c.setTool('line');
    const ids = menus.menuIds(menus.sketchMenu(sketchState(h), c, h.sketch(), null));
    expect(ids.slice(0, 2)).toEqual(['sketch-end-tool', 'quick-snap']);
    expect(ids).toContain('snap-intersection');
    c.setTool('trim');
    expect(menus.menuIds(menus.sketchMenu(sketchState(h), c, h.sketch(), null))).toEqual(['sketch-end-tool']);
  });
});

// ------------------------------------------------------------------ one set of commands

describe('one set of commands: the tree, the graphics area and the CommandManager (ADR 0176)', () => {
  const read = (path: string) => readFileSync(new URL(`../../apps/web/src/${path}`, import.meta.url), 'utf8');

  it('every command a menu names is in the registry', () => {
    const known = new Set(actions.ACTIONS.map((a) => a.id));
    for (const file of ['contextMenus.ts', 'components/FeatureTree.tsx']) {
      const named = [...read(file).matchAll(/command\([^,]+, '([a-z0-9-]+)'/g)].map((m) => m[1]!);
      expect(named.length, file).toBeGreaterThan(0);
      expect(named.filter((id) => !known.has(id)), file).toEqual([]);
    }
  });

  it('the trees no longer do these things themselves: they run the registry\'s command', () => {
    const tree = read('components/FeatureTree.tsx');
    expect(tree).not.toMatch(/store\.suppress\([^)]*'suppress'\)/);
    expect(tree).not.toMatch(/store\.requestDelete\(/);
    expect(tree).not.toMatch(/store\.beginEdit\(menu\./);
    const asm = read('components/AssemblyTree.tsx');
    const componentMenu = asm.slice(asm.indexOf('export function ComponentMenu'), asm.indexOf('export function AssemblyTree'));
    expect(componentMenu).not.toMatch(/setComponentState|setFixed|requestDelete|browseRelink|openComponentPart/);
    expect(componentMenu).toMatch(/assemblyMenu\(/);
  });

  it('the commands of the menus alone have no button on the CommandManager, and each has its help sentence', () => {
    const only = actions.ACTIONS.filter((a) => a.menuOnly).map((a) => a.id);
    expect(only).toEqual(['edit-feature', 'edit-feature-sketch', 'suppress-feature', 'toggle-visibility', 'delete-feature', 'open-component', 'relink-component', 'hide-component', 'transparent-component', 'suppress-component', 'delete-component', 'sketch-delete', 'sketch-select-chain', 'sketch-end-tool']);
    expect(read('components/CommandBar.tsx')).toMatch(/!a\.menuOnly/);
  });
});
