import { canBeSeed, explosionSteps, isDatumPlaneName, type DatumPlaneName, type Ref } from '@3db/model';
import { store, type UiState } from './state/store';
import { t } from '@3db/i18n';
import { TOOL_LABEL } from './strings';
import { effective, matchesShortcut, overrides } from './shortcuts';
import type { ToolId } from './sketcher/controller';

/**
 * UI action registry (D3.1): the single definition of every command's label, shortcut and
 * enablement. Toolbars, menus and keyboard handling all read from here.
 */
export interface UiAction {
  id: string;
  label: string;
  shortcut?: string;
  group: 'file' | 'edit' | 'feature' | 'sheet' | 'sketch' | 'sketch-tool' | 'assembly' | 'view' | 'tools';
  enabled(s: UiState): boolean;
  run(): void;
  /** Toggle state for tool buttons (the active sketch tool). */
  active?(): boolean;
}

/** Nothing going on in the open assembly: no PropertyManager, no drag. */
const assemblyFree = (s: UiState) => !s.asm?.insert && !s.asm?.mate && !s.asm?.move && !s.asm?.drag && !s.asm?.pattern && !s.asm?.explode && !s.asm?.formSub && !s.measure && !s.interference && !s.clearance;
/** No PropertyManager session in the open document: file commands may replace or save it. */
const idle = (s: UiState) => (s.active === 'assembly' ? assemblyFree(s) : s.editing === null && !s.measure);
/** A part is open and nothing is being edited in it. */
const partIdle = (s: UiState) => s.active === 'part' && s.editing === null && !s.measure;
/** The measure tool can be turned on (or off, when it is on): nothing else is going on in the open document. */
const canMeasure = (s: UiState) => s.measure !== null || (s.bootMs !== null && (s.active === 'assembly' ? assemblyFree(s) && hasComponents(s) : partIdle(s) && !!s.result?.mesh));
const toggleMeasure = () => (store.getState().measure ? store.stopMeasure() : store.startMeasure());
const assemblyIdle = (s: UiState) => s.active === 'assembly' && assemblyFree(s);
const hasComponents = (s: UiState) => (s.asm?.doc.components.length ?? 0) > 0;
const sketching = (s: UiState) => s.editing?.kind === 'sketch';
const selectedFeature = (s: UiState) => s.doc.features.find((f) => f.id === s.selected);
const sketchSelected = (s: UiState) => partIdle(s) && selectedFeature(s)?.type === 'sketch';
/** A sweep takes a profile (the selected sketch) and a path (another sketch). */
const canSweep = (s: UiState) => sketchSelected(s) && s.doc.features.filter((f) => f.type === 'sketch').length >= 2;
const hasBody = (s: UiState) => partIdle(s) && !!s.result?.mesh;
/** A pattern repeats a feature that adds to or takes from the bodies: there has to be one. */
const canPattern = (s: UiState) => partIdle(s) && s.doc.features.some(canBeSeed);
/** A plane to sketch on: a default or reference plane or a coordinate system in the tree, or a planar face in the graphics area. */
const sketchPlane = (s: UiState): DatumPlaneName | Ref | null => {
  if (s.selected !== null && isDatumPlaneName(s.selected)) return s.selected;
  const type = selectedFeature(s)?.type;
  if (s.selected !== null && (type === 'refPlane' || type === 'coordSys')) return { kind: 'datum', name: s.selected };
  return s.selectedFace?.fingerprint?.type === 'plane' ? s.selectedFace : null;
};

const SKETCH_TOOLS: ToolId[] = ['dimension', 'line', 'centerline', 'rect', 'centerRect', 'circle', 'perimeterCircle', 'arc', 'tangentArc', 'threePointArc', 'slot', 'polygon', 'point', 'sketchFillet', 'sketchChamfer', 'trim', 'extend', 'offset', 'mirror', 'convert', 'pierce'];

export const ACTIONS: UiAction[] = [
  { id: 'new-part', get label() { return t('act.newPart'); }, shortcut: 'Ctrl+N', group: 'file', enabled: idle, run: () => store.newPart() },
  { id: 'new-part-template', get label() { return t('action.newFromTemplate'); }, group: 'file', enabled: idle, run: () => store.openDialog('template') },
  { id: 'new-assembly', get label() { return t('act.newAssembly'); }, group: 'file', enabled: idle, run: () => store.newAssembly() },
  { id: 'new-demo', get label() { return t('act.newDemo'); }, group: 'file', enabled: idle, run: () => store.newDemo() },
  { id: 'open', get label() { return t('act.open'); }, shortcut: 'Ctrl+O', group: 'file', enabled: idle, run: () => store.open() },
  { id: 'save', get label() { return t('act.save'); }, shortcut: 'Ctrl+S', group: 'file', enabled: idle, run: () => void store.save() },
  { id: 'save-as', get label() { return t('act.saveAs'); }, group: 'file', enabled: idle, run: () => void store.saveAs() },
  { id: 'export-step', get label() { return t('export.step'); }, group: 'file', enabled: (s) => (partIdle(s) || (assemblyIdle(s) && hasComponents(s))) && s.bootMs !== null, run: () => store.exportStep() },
  { id: 'export-stl', get label() { return t('export.stl'); }, group: 'file', enabled: (s) => hasBody(s) && s.bootMs !== null, run: () => void store.exportStl() },
  { id: 'export-image', get label() { return t('export.image'); }, group: 'file', enabled: (s) => (s.active === 'assembly' ? assemblyIdle(s) && hasComponents(s) : hasBody(s)), run: () => void store.exportImage() },
  { id: 'new-drawing', get label() { return t('drawing.act'); }, group: 'file', enabled: (s) => s.bootMs !== null && (s.active === 'assembly' ? assemblyIdle(s) && !!s.asm?.fileName && !s.asm.dirty : partIdle(s) && s.fileName !== null && !s.dirty), run: () => void store.newDrawing() },
  { id: 'generate-assembly', get label() { return t('derived.act'); }, group: 'file', enabled: (s) => partIdle(s) && !!s.result?.mesh && s.bootMs !== null, run: () => void store.generateAssembly() },
  { id: 'import-step-assembly', get label() { return t('stepasm.act'); }, group: 'file', enabled: (s) => idle(s) && s.bootMs !== null, run: () => store.importStepAssembly() },
  { id: 'return-assembly', get label() { return t('act.returnAssembly'); }, group: 'file', enabled: (s) => (partIdle(s) || assemblyIdle(s)) && s.returnTo !== null, run: () => store.returnToAssembly() },

  { id: 'equations', get label() { return t('action.equations'); }, group: 'tools', enabled: partIdle, run: () => store.openDialog('equations') },
  { id: 'appearance', get label() { return t('action.appearance'); }, group: 'tools', enabled: partIdle, run: () => store.openDialog('appearance') },
  { id: 'options', get label() { return t('action.options'); }, group: 'tools', enabled: () => true, run: () => store.openDialog('options') },
  { id: 'shortcuts', get label() { return t('action.shortcuts'); }, group: 'tools', enabled: () => true, run: () => store.openDialog('shortcuts') },
  { id: 'measure-part', get label() { return t('measure.act'); }, group: 'tools', enabled: (s) => s.active === 'part' && canMeasure(s), run: toggleMeasure, active: () => store.getState().measure !== null },
  { id: 'draft-analysis', get label() { return t('draftAnalysis.act'); }, group: 'tools', enabled: (s) => s.active === 'part' && hasBody(s) && s.bootMs !== null, run: () => (store.getState().draft ? store.stopDraft() : store.startDraft()), active: () => store.getState().draft !== null },
  { id: 'undercut-analysis', get label() { return t('undercutAnalysis.act'); }, group: 'tools', enabled: (s) => s.active === 'part' && hasBody(s) && s.bootMs !== null, run: () => (store.getState().undercut ? store.stopUndercut() : store.startUndercut()), active: () => store.getState().undercut !== null },
  { id: 'thickness-analysis', get label() { return t('thicknessAnalysis.act'); }, group: 'tools', enabled: (s) => s.active === 'part' && hasBody(s) && s.bootMs !== null, run: () => (store.getState().thickness ? store.stopThickness() : store.startThickness()), active: () => store.getState().thickness !== null },
  { id: 'check-part', get label() { return t('check.act'); }, group: 'tools', enabled: (s) => hasBody(s) && s.bootMs !== null, run: () => void store.startCheck() },
  { id: 'physical-part', get label() { return t('physical.act'); }, group: 'tools', enabled: hasBody, run: () => store.openDialog('physical') },
  { id: 'properties', get label() { return t('action.properties'); }, group: 'tools', enabled: partIdle, run: () => store.openDialog('properties') },

  { id: 'extrude', get label() { return t('act.extrude'); }, group: 'feature', enabled: sketchSelected, run: () => store.newExtrude('boss') },
  { id: 'revolve', get label() { return t('act.revolve'); }, group: 'feature', enabled: sketchSelected, run: () => store.newRevolve('boss') },
  { id: 'sweep', get label() { return t('action.sweep'); }, group: 'feature', enabled: canSweep, run: () => store.newSweep('boss') },
  { id: 'loft', get label() { return t('action.loft'); }, group: 'feature', enabled: sketchSelected, run: () => store.newLoft('boss') },
  { id: 'rib', get label() { return t('action.rib'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newRib() },
  { id: 'extrude-cut', get label() { return t('act.extrudeCut'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newExtrude('cut') },
  { id: 'revolve-cut', get label() { return t('act.revolveCut'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newRevolve('cut') },
  { id: 'sweep-cut', get label() { return t('action.sweepCut'); }, group: 'feature', enabled: (s) => canSweep(s) && !!s.result?.mesh, run: () => store.newSweep('cut') },
  { id: 'loft-cut', get label() { return t('action.loftCut'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newLoft('cut') },
  { id: 'thread', get label() { return t('feature.thread'); }, group: 'feature', enabled: (s) => partIdle(s) && (sketchSelected(s) || s.doc.features.some((f) => f.type === 'sketch')), run: () => store.newThread() },
  { id: 'knurl', get label() { return t('feature.knurl'); }, group: 'feature', enabled: hasBody, run: () => store.newKnurl() },
  { id: 'fillet', get label() { return t('act.fillet'); }, group: 'feature', enabled: hasBody, run: () => store.newFillet() },
  { id: 'chamfer', get label() { return t('act.chamfer'); }, group: 'feature', enabled: hasBody, run: () => store.newChamfer() },
  { id: 'delete-face', get label() { return t('feature.deleteFace'); }, group: 'feature', enabled: hasBody, run: () => store.newDeleteFace() },
  { id: 'hole', get label() { return t('feature.hole'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newHole() },
  { id: 'screw-boss', get label() { return t('feature.screwBoss'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newScrewBoss() },
  { id: 'base-flange', get label() { return t('feature.baseFlange'); }, group: 'sheet', enabled: sketchSelected, run: () => store.newBaseFlange() },
  { id: 'mid-bend', get label() { return t('feature.midBend'); }, group: 'sheet', enabled: (s) => hasBody(s) && sketchSelected(s), run: () => store.newMidBend() },
  { id: 'edge-flange', get label() { return t('feature.edgeFlange'); }, group: 'sheet', enabled: hasBody, run: () => store.newEdgeFlange() },
  { id: 'hem', get label() { return t('feature.hem'); }, group: 'sheet', enabled: hasBody, run: () => store.newHem() },
  { id: 'break-corner', get label() { return t('feature.breakCorner'); }, group: 'sheet', enabled: (s) => hasBody(s) && s.doc.features.some((f) => f.type === 'baseFlange'), run: () => store.newBreakCorner() },
  { id: 'flat-pattern', get label() { return t('flat.act'); }, group: 'sheet', enabled: (s) => s.active === 'part' && hasBody(s) && s.bootMs !== null, run: () => (store.getState().flat ? store.stopFlat() : store.startFlat()), active: () => store.getState().flat !== null },
  { id: 'snap-hook', get label() { return t('feature.snapHook'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newSnapHook() },
  { id: 'snap-catch', get label() { return t('feature.snapCatch'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newSnapCatch() },
  { id: 'vent', get label() { return t('feature.vent'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newVent() },
  { id: 'draft', get label() { return t('feature.draftFeature'); }, group: 'feature', enabled: hasBody, run: () => store.newDraft() },
  { id: 'shell', get label() { return t('feature.shell'); }, group: 'feature', enabled: hasBody, run: () => store.newShell() },
  { id: 'move-face', get label() { return t('feature.moveFace'); }, group: 'feature', enabled: hasBody, run: () => store.newMoveFace() },
  { id: 'offset-surface', get label() { return t('feature.offsetSurface'); }, group: 'feature', enabled: hasBody, run: () => store.newOffsetSurface() },
  { id: 'split-line', get label() { return t('feature.splitLine'); }, group: 'feature', enabled: (s) => hasBody(s) && s.doc.features.some((f) => f.type === 'sketch'), run: () => store.newSplitLine() },
  { id: 'knit', get label() { return t('feature.knit'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface), run: () => store.newKnit() },
  { id: 'fill-surface', get label() { return t('feature.fillSurface'); }, group: 'feature', enabled: hasBody, run: () => store.newSurfaceEdges('fillSurface') },
  { id: 'flat-surface', get label() { return t('feature.flatSurface'); }, group: 'feature', enabled: hasBody, run: () => store.newSurfaceEdges('flatSurface') },
  { id: 'trim-surface', get label() { return t('feature.trimSurface'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface) && s.doc.features.some((f) => f.type === 'sketch'), run: () => store.newTrimSurface() },
  { id: 'mutual-trim', get label() { return t('feature.mutualTrim'); }, group: 'feature', enabled: (s) => hasBody(s) && (s.result?.bodies.filter((b) => b.surface).length ?? 0) > 1, run: () => store.newMutualTrim() },
  { id: 'extend-surface', get label() { return t('feature.extendSurface'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface), run: () => store.newSurfaceEdges('extendSurface') },
  { id: 'thicken', get label() { return t('feature.thicken'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface), run: () => store.newThicken() },
  { id: 'cut-with-surface', get label() { return t('feature.cutWithSurface'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface) && !!s.result?.bodies.some((b) => !b.surface), run: () => store.newCutWithSurface() },
  { id: 'lip-groove', get label() { return t('feature.lipGroove'); }, group: 'feature', enabled: hasBody, run: () => store.newLipGroove() },
  { id: 'combine', get label() { return t('feature.combine'); }, group: 'feature', enabled: (s) => hasBody(s) && (s.result?.bodies.length ?? 0) > 1, run: () => store.newCombine() },
  { id: 'linear-pattern', get label() { return t('action.linearPattern'); }, group: 'feature', enabled: canPattern, run: () => store.newPattern('linear') },
  { id: 'circular-pattern', get label() { return t('action.circularPattern'); }, group: 'feature', enabled: canPattern, run: () => store.newPattern('circular') },
  { id: 'mirror', get label() { return t('action.mirror'); }, group: 'feature', enabled: (s) => canPattern(s) || (partIdle(s) && (s.result?.bodies.length ?? 0) > 0), run: () => store.newMirror() },
  { id: 'ref-plane', get label() { return t('act.refPlane'); }, group: 'feature', enabled: partIdle, run: () => store.newRefPlane() },
  { id: 'ref-axis', get label() { return t('action.refAxis'); }, group: 'feature', enabled: partIdle, run: () => store.newRefAxis() },
  { id: 'ref-point', get label() { return t('action.refPoint'); }, group: 'feature', enabled: partIdle, run: () => store.newRefPoint() },
  { id: 'coord-sys', get label() { return t('action.coordSys'); }, group: 'feature', enabled: partIdle, run: () => store.newCoordSys() },
  { id: 'import-step', get label() { return t('act.importStep'); }, group: 'feature', enabled: (s) => partIdle(s) && s.bootMs !== null, run: () => void store.importStep() },

  { id: 'insert-component', get label() { return t('act.insertComponent'); }, group: 'assembly', enabled: assemblyIdle, run: () => void store.assembly?.startInsert() },
  { id: 'mate', get label() { return t('act.mate'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startMate() },
  { id: 'move-component', get label() { return t('act.moveComponent'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startMove('move') },
  { id: 'rotate-component', get label() { return t('act.rotateComponent'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startMove('rotate') },
  { id: 'form-sub-assembly', get label() { return t('subassembly.form.act'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && (s.asm?.doc.components.length ?? 0) >= 2, run: () => store.assembly?.startFormSub() },
  { id: 'explode', get label() { return t('explode.act'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startExplode() },
  { id: 'measure-assembly', get label() { return t('measure.act'); }, group: 'assembly', enabled: (s) => s.active === 'assembly' && canMeasure(s), run: toggleMeasure, active: () => store.getState().measure !== null },
  { id: 'clearance', get label() { return t('clearance.act'); }, group: 'assembly', enabled: (s) => s.bootMs !== null && assemblyIdle(s) && hasComponents(s), run: () => store.startClearance() },
  { id: 'interference', get label() { return t('interference.act'); }, group: 'assembly', enabled: (s) => s.bootMs !== null && assemblyIdle(s) && hasComponents(s), run: () => store.startInterference() },
  { id: 'check-assembly', get label() { return t('check.act'); }, group: 'assembly', enabled: (s) => s.bootMs !== null && assemblyIdle(s) && hasComponents(s), run: () => void store.startCheck() },
  { id: 'physical-assembly', get label() { return t('physical.act'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.openDialog('physical') },
  { id: 'bom', get label() { return t('bom.act'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.openDialog('bom') },
  { id: 'pattern-linear', get label() { return t('pattern.actLinear'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startPattern('linear') },
  { id: 'pattern-circular', get label() { return t('pattern.actCircular'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startPattern('circular') },
  { id: 'mirror-component', get label() { return t('pattern.actMirror'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startPattern('mirror') },
  { id: 'fix-component', get label() { return t('act.fixComponent'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && selectedComponent(s)?.fixed === false, run: () => setFixed(true) },
  { id: 'float-component', get label() { return t('act.floatComponent'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && selectedComponent(s)?.fixed === true, run: () => setFixed(false) },

  {
    id: 'sketch',
    get label() {
      return t('act.sketch');
    },
    group: 'sketch',
    enabled: (s) => partIdle(s) && sketchPlane(s) !== null,
    run: () => {
      const plane = sketchPlane(store.getState());
      if (plane) store.newSketch(plane);
    },
  },
  { id: 'offset-sketch', get label() { return t('act.offsetSketch'); }, group: 'sketch', enabled: (s) => partIdle(s) && sketchPlane(s) !== null, run: () => store.newOffsetSketch() },
  { id: 'angle-sketch', get label() { return t('act.angleSketch'); }, group: 'sketch', enabled: (s) => partIdle(s) && sketchPlane(s) !== null, run: () => store.newAngleSketch() },
  { id: 'sketch-picture', get label() { return t('act.sketchPicture'); }, group: 'sketch-tool', enabled: sketching, run: () => void store.addSketchPicture() },
  ...SKETCH_TOOLS.map(
    (tool): UiAction => ({
      id: `tool-${tool}`,
      get label() {
        return TOOL_LABEL[tool];
      },
      group: 'sketch-tool',
      enabled: sketching,
      run: () => store.sketcher?.setTool(store.sketcher.getView().tool === tool ? 'select' : tool),
      active: () => store.sketcher?.getView().tool === tool,
    }),
  ),
  { id: 'construction', get label() { return t('act.construction'); }, group: 'sketch-tool', enabled: sketching, run: () => toggleConstruction() },
  { id: 'exit-sketch', get label() { return t('act.exitSketch'); }, group: 'sketch-tool', enabled: sketching, run: () => store.commitEdit() },

  { id: 'undo', get label() { return t('act.undo'); }, shortcut: 'Ctrl+Z', group: 'edit', enabled: (s) => (s.drw ? s.drw.canUndo : s.asm ? s.asm.canUndo && idle(s) : s.canUndo), run: () => store.undo() },
  { id: 'redo', get label() { return t('act.redo'); }, shortcut: 'Ctrl+Y', group: 'edit', enabled: (s) => (s.drw ? s.drw.canRedo : s.asm ? s.asm.canRedo && idle(s) : s.canRedo), run: () => store.redo() },
  { id: 'rebuild', get label() { return t('act.rebuild'); }, shortcut: 'Ctrl+B', group: 'edit', enabled: () => true, run: () => store.rebuild() },

  { id: 'fit', get label() { return t('act.fit'); }, shortcut: 'F', group: 'view', enabled: () => true, run: () => store.viewer?.fitAll() },
  { id: 'view-front', get label() { return t('act.front'); }, shortcut: 'Ctrl+1', group: 'view', enabled: () => true, run: () => store.viewer?.setView('front') },
  { id: 'view-top', get label() { return t('act.top'); }, shortcut: 'Ctrl+5', group: 'view', enabled: () => true, run: () => store.viewer?.setView('top') },
  { id: 'view-right', get label() { return t('act.right'); }, shortcut: 'Ctrl+4', group: 'view', enabled: () => true, run: () => store.viewer?.setView('right') },
  { id: 'view-iso', get label() { return t('act.iso'); }, shortcut: 'Ctrl+7', group: 'view', enabled: () => true, run: () => store.viewer?.setView('iso') },
  { id: 'view-normal', get label() { return t('act.normal'); }, shortcut: 'Ctrl+8', group: 'view', enabled: sketching, run: () => lookAtSketch() },
];

export const action = (id: string): UiAction => {
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown action ${id}`);
  return a;
};

function selectedComponent(s: UiState) {
  const id = s.asm?.selected;
  return id ? s.asm!.doc.components.find((c) => c.id === id) : undefined;
}

function setFixed(value: boolean): void {
  const c = selectedComponent(store.getState());
  if (c) store.assembly?.setFixed([c.id], value);
}

function lookAtSketch(): void {
  const sketch = store.editedSketch();
  const frame = sketch && store.frameOf(sketch);
  if (frame) store.viewer?.lookAt(frame);
}

/** Construction geometry (C1.14): toggles the selected curves; all become construction unless all already are. */
function toggleConstruction(): void {
  const sketcher = store.sketcher;
  const sketch = store.editedSketch();
  if (!sketcher || !sketch) return;
  const curves = sketch.entities.filter((e) => e.type !== 'point' && sketcher.getView().selection.includes(e.id));
  if (curves.length === 0) {
    sketcher.notice(t('sketch.selectCurves'));
    return store.notify(t('sketch.selectCurves'));
  }
  sketcher.setConstruction(!curves.every((e) => 'construction' in e && e.construction));
}

/** The shortcut an action has now: the user's choice (D3.3), else the one the registry gives. */
export const shortcutOf = (a: UiAction): string | undefined => effective(a.id, a.shortcut, overrides());

/** Global shortcuts; ignored while typing into inputs. */
export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const s = store.getState();
    // An open dialog owns the keyboard (Esc closes it; its focused button takes Enter).
    if (s.confirmDelete || s.whatsWrong || s.unsaved || s.folderRequest || s.asm?.confirmDelete || s.asm?.relink) {
      if (e.key === 'Escape') {
        store.requestDelete(null);
        store.showWhatsWrong(false);
        void store.answerUnsaved('cancel');
        store.cancelFolder();
        store.assembly?.requestDelete(null);
        store.assembly?.closeRelink();
      }
      return;
    }
    // Measuring owns the keyboard too: Esc turns it off, and nothing is deleted meanwhile
    if (s.measure && (e.key === 'Escape' || e.key === 'Delete')) return void (e.key === 'Escape' && store.stopMeasure());
    if (s.check) return void (e.key === 'Escape' && store.stopCheck());
    if (s.interference && (e.key === 'Escape' || e.key === 'Delete')) return void (e.key === 'Escape' && store.stopInterference());
    if (s.clearance && (e.key === 'Escape' || e.key === 'Delete')) return void (e.key === 'Escape' && store.stopClearance());
    if (s.asm) {
      const a = store.assembly;
      const selected = s.asm.selected;
      if (s.asm.drag) {
        // A drag owns the keyboard: Esc puts everything back where it was.
        if (e.key === 'Escape') store.viewer?.cancelComponentDrag();
        return;
      }
      if (s.asm.move) {
        if (e.key === 'Escape' || e.key === 'Enter') return void a?.closeMove();
      } else if (s.asm.formSub) {
        if (e.key === 'Escape') return void a?.cancelFormSub();
      } else if (s.asm.explode) {
        // Esc first stops picking a direction in the view, then closes the PropertyManager
        if (e.key === 'Escape' || e.key === 'Enter') return void (s.asm.explode.picking && e.key === 'Escape' ? a?.pickExplodeAxis(false) : a?.closeExplode());
      } else if (s.asm.pattern) {
        // Esc first stops picking an axis in the view, then closes the PropertyManager
        if (e.key === 'Escape') return void (s.asm.pattern.picking ? a?.pickPatternAxis(null) : a?.cancelPattern());
      } else if (s.asm.mate) {
        if (e.key === 'Escape') return void a?.cancelMate();
        if (e.key === 'Enter') return void a?.applyMate();
      } else if (s.asm.insert) {
        if (e.key === 'Escape') return void a?.cancelInsert();
        if (e.key === 'Enter') return void a?.place(null);
      } else if (e.key === 'Delete' && selected && explosionSteps(s.asm.doc).some((x) => x.id === selected)) {
        return void a?.deleteExplodeSteps([selected]);
      } else if (e.key === 'Delete' && selected && s.asm.doc.patterns?.some((p) => p.id === selected)) {
        return void a?.deletePatterns([selected]); // a pattern's instances are derived: nothing else goes with it
      } else if (e.key === 'Delete' && selected && (selectedComponent(s) || s.asm.doc.mates.some((m) => m.id === selected))) {
        return void a?.requestDelete([selected]);
      }
    } else if (s.editing?.kind === 'sketch') {
      // Inside a sketch, Esc ends the current tool and Delete removes the selection (SolidWorks);
      // leaving the sketch is the confirmation corner or 「離開草圖」.
      if (e.key === 'Escape') return void store.sketcher?.escape();
      if (e.key === 'Delete') return void store.sketcher?.deleteSelection();
    } else if (s.editing) {
      if (e.key === 'Enter') return void store.commitEdit();
      if (e.key === 'Escape') return void store.cancelEdit();
    } else if (e.key === 'Delete' && s.doc.features.some((f) => f.id === s.selected)) {
      return void store.requestDelete(s.selected); // 「確認刪除」 for the feature selected in the tree
    }
    for (const a of ACTIONS) {
      const shortcut = shortcutOf(a);
      if (shortcut && matchesShortcut(e, shortcut) && a.enabled(s)) {
        e.preventDefault();
        a.run();
        return;
      }
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
