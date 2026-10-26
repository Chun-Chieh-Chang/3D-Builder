import { activeSheetUnfold } from '@3db/model';
import { initialLoftSections } from './state/loftSections';
import { absorbedSketches, bodyKey, bodyFeature, canBeSeed, explosionSteps, isDatumPlaneName, isHideable, isShown, page, type DatumPlaneName, type Feature, type PlaneFrame, type Ref } from '@3db/model';
import { ownerFeatures } from '@3db/naming';
import { topologyOf } from './state/selectionSets';
import { OPPOSITE_VIEW } from '@3db/render';
import type { DimensionMode } from '@3db/drawing';
import { store, type UiState } from './state/store';
import type { DimensionSeed } from './state/drawing';
import { t } from '@3db/i18n';
import { TOOL_LABEL } from './strings';
import { effective, matchesShortcut, overrides } from './shortcuts';
import type { ToolId } from './sketcher/controller';
import { takesSpace, viewKeyCommand, type ViewKeyCommand } from './viewKeys';

/**
 * UI action registry (D3.1): the single definition of every command's label, shortcut and
 * enablement. Toolbars, menus and keyboard handling all read from here.
 */
export interface UiAction {
  id: string;
  label: string;
  shortcut?: string;
  group: 'file' | 'edit' | 'feature' | 'sheet' | 'sketch' | 'sketch-tool' | 'assembly' | 'view' | 'tools' | 'drawing' | 'annotation';
  enabled(s: UiState): boolean;
  run(): void;
  /** Toggle state for tool buttons (the active sketch tool). */
  active?(): boolean;
  /** The action whose button this one drops down from, instead of being a button of its own (智慧型尺寸 and the kinds of dimension, ADR 0177). */
  parent?: string;
  /**
   * A command of the right-click menus only (ADR 0176): it works on what the right click chose (the feature of a face, the body of an edge, the component under
   * the pointer), so it has no button on the CommandManager; the tree's menu and the graphics area's run the same one.
   */
  menuOnly?: boolean;
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
const loftReady = (s: UiState) => partIdle(s) && (sketchSelected(s) || initialLoftSections(s.doc, s.selected).length >= 2);
/** A sweep takes a profile (the selected sketch) and a path (another sketch). */
/** A profile sketch selected and a path to take it along: another sketch, or a helix curve (ADR 0169). */
const canSweep = (s: UiState) => sketchSelected(s) && (s.doc.features.filter((f) => f.type === 'sketch').length >= 2 || s.doc.features.some((f) => f.type === 'helix'));
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

/**
 * The feature a right-click command works on (ADR 0176): the one selected in the tree, else the one that made the face, edge or vertex selected in the
 * graphics area (the right click selects what is under the pointer first).
 */
export const contextFeature = (s: UiState): Feature | undefined => {
  const tree = selectedFeature(s);
  if (tree) return tree;
  const name = s.selectedFace?.name ?? s.selectedElements[0]?.name;
  const id = name ? ownerFeatures(name)[0] : undefined;
  return id ? s.doc.features.find((f) => f.id === id) : undefined;
};
/** Above the rollback bar: what can be edited. */
const beforeRollback = (s: UiState, f: Feature) => s.doc.features.indexOf(f) < (s.doc.rollbackIndex ?? s.doc.features.length);
/** The sketch the feature of the right click was made from (the first, for a sweep or a loft); none for a sketch itself. */
const contextSketch = (s: UiState): Feature | undefined => {
  const f = contextFeature(s);
  const id = f && f.type !== 'sketch' ? absorbedSketches(f)[0] : undefined;
  return id ? s.doc.features.find((x) => x.id === id) : undefined;
};
/**
 * What 「隱藏／顯示」 of a right click works on (ADR 0176): the body selected in the tree, else the body of the face or edge selected in the graphics area, else a
 * sketch, reference geometry or plane selected in the tree.
 */
export const contextVisibilityKey = (s: UiState): string | null => {
  if (s.selected?.startsWith('body:')) return s.selected;
  const r = s.result;
  const edge = s.selectedElements[0]?.kind === 'edge' ? s.selectedElements[0] : undefined;
  if (r && (s.selectedFace || edge)) {
    const faces = s.selectedFace ? [r.faceNames.indexOf(s.selectedFace.name)] : (topologyOf(r)?.edgeFaces[r.edgeNames.indexOf(edge!.name)] ?? []);
    const body = r.bodies.find((b) => faces.some((f) => f >= b.face0 && f < b.face0 + b.faces));
    return body ? bodyKey(body.id) : null;
  }
  if (s.selected !== null && isHideable(s.doc, s.selected)) return s.selected;
  if (s.selected && r) {
    // Hidden bodies cannot be clicked in the viewport. Resolve a tree feature only when
    // its surviving faces / source identify exactly one body, including hidden material.
    const bodies = r.bodies.filter(b => bodyFeature(b.id) === s.selected || r.faceNames.slice(b.face0, b.face0 + b.faces).some(name => ownerFeatures(name).includes(s.selected!)));
    if (bodies.length === 1) return bodyKey(bodies[0]!.id);
  }
  return null;
};
/** What is selected in the sketch being edited. */
const sketchSelection = (): string[] => store.sketcher?.getView().selection ?? [];
/** A line, arc or circle among what is selected in the sketch: what a chain is grown from. */
const sketchCurveSelected = (s: UiState): boolean => {
  const sketch = s.editing?.kind === 'sketch' ? s.doc.features.find((f) => f.id === s.editing?.featureId) : undefined;
  const chosen = new Set(sketchSelection());
  return sketch?.type === 'sketch' && sketch.entities.some((e) => (e.type === 'line' || e.type === 'arc' || e.type === 'circle') && chosen.has(e.id));
};

/** A drawing is open (D-I1b): its tools are on the CommandManager's 視圖配置 and 註記 tabs, as SolidWorks has them. */
const drawingOn = (s: UiState) => s.active === 'drawing' && !!s.drw;
const drawingTool = (s: UiState) => s.drw?.tool ?? null;
/** The view chosen in the drawing (or the only one), for the commands that work on a view. */
const chosenView = (s: UiState) => (s.drw ? page(s.drw.doc).views.find((v) => v.id === s.drw?.selected) ?? (page(s.drw.doc).views.length === 1 ? page(s.drw.doc).views[0] : undefined) : undefined);
/** Turns a drawing tool on, or off when it is the one on. */
const toggleTool = (same: (t: NonNullable<ReturnType<typeof drawingTool>>) => boolean, make: () => Parameters<NonNullable<typeof store.drawingStore>['setTool']>[0]) => () => {
  const d = store.drawingStore;
  const on = drawingTool(store.getState());
  if (d) d.setTool(on && same(on) ? null : make());
};
/** 「開啟零件」 of the drawing (ADR 0146): the part of the view chosen, else of the first view; 「返回工程圖」 in the part comes back. */
export function openDrawingPart(): void {
  const path = store.drawingStore?.partToOpen();
  if (path) store.openPartOfDrawing(path);
  else store.drawingStore?.notifyInfo(t('drawingUi.openPartNone'));
}
const toolIs = (same: (t: NonNullable<ReturnType<typeof drawingTool>>) => boolean) => () => {
  const on = drawingTool(store.getState());
  return !!on && same(on);
};
/** The drawing has a view on its sheet: there is something to dimension or annotate. */
const hasViews = (s: UiState) => drawingOn(s) && (s.drw ? page(s.drw.doc).views.length : 0) > 0;

/** The action of each kind of dimension the tool makes (ADR 0177): the button, the drop-down and the right-click menu all name the same one. */
export const DIMENSION_ACTION: Record<DimensionMode, string> = {
  smart: 'drw-dimension',
  horizontal: 'drw-dim-horizontal',
  vertical: 'drw-dim-vertical',
  aligned: 'drw-dim-aligned',
  angle: 'drw-dim-angle',
  radius: 'drw-dim-radius',
  diameter: 'drw-dim-diameter',
  chamfer: 'drw-dim-chamfer',
};
const isDimensionTool = (mode: DimensionMode) => (x: NonNullable<ReturnType<typeof drawingTool>>) => x.kind === 'dimension' && (x.mode ?? 'smart') === mode;
/**
 * Starts the dimension tool for this kind (ADR 0177), with what was already pointed at when it is given (the right-click menu of an element starts from that
 * element, so that the next click places the dimension or picks the second element).
 */
export function startDimension(mode: DimensionMode, seed: readonly DimensionSeed[] = []): void {
  store.drawingStore?.setTool({ kind: 'dimension', picks: [...seed], ...(mode === 'smart' ? {} : { mode }) });
}
const dimensionTool = (mode: DimensionMode) => ({ active: toolIs(isDimensionTool(mode)), run: () => (toolIs(isDimensionTool(mode))() ? store.drawingStore?.setTool(null) : startDimension(mode)) });

const SKETCH_TOOLS: ToolId[] = ['dimension', 'line', 'centerline', 'rect', 'centerRect', 'ellipse', 'bezier', 'circle', 'perimeterCircle', 'arc', 'tangentArc', 'threePointArc', 'slot', 'polygon', 'point', 'text', 'sketchFillet', 'sketchChamfer', 'trim', 'extend', 'offset', 'mirror', 'convert', 'pierce', 'intersect', 'silhouette', 'stretchEntities', 'moveEntities', 'copyEntities', 'rotateEntities', 'scaleEntities', 'linearPattern', 'circularPattern'];

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
  // the way from a drawing to its part (ADR 0146): in the 檔案 menu as well as on the drawing's tree and its 視圖配置 menu
  { id: 'open-drawing-part', get label() { return t('drawingUi.openPartButton'); }, group: 'file', enabled: (s) => drawingOn(s) && !!store.drawingStore?.partToOpen(), run: () => openDrawingPart() },

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
  { id: 'gear', get label() { return t('feature.gear'); }, group: 'feature', enabled: partIdle, run: () => store.newGear('gear') },
  { id: 'rack', get label() { return t('feature.rack'); }, group: 'feature', enabled: partIdle, run: () => store.newGear('rack') },
  { id: 'loft', get label() { return t('action.loft'); }, group: 'feature', enabled: loftReady, run: () => store.newLoft('boss') },
  { id: 'rib', get label() { return t('action.rib'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newRib() },
  { id: 'extrude-cut', get label() { return t('act.extrudeCut'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newExtrude('cut') },
  { id: 'revolve-cut', get label() { return t('act.revolveCut'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newRevolve('cut') },
  { id: 'sweep-cut', get label() { return t('action.sweepCut'); }, group: 'feature', enabled: (s) => canSweep(s) && !!s.result?.mesh, run: () => store.newSweep('cut') },
  { id: 'loft-cut', get label() { return t('action.loftCut'); }, group: 'feature', enabled: (s) => loftReady(s) && !!s.result?.mesh, run: () => store.newLoft('cut') },
  { id: 'thread', get label() { return t('feature.thread'); }, group: 'feature', enabled: (s) => partIdle(s) && (sketchSelected(s) || s.doc.features.some((f) => f.type === 'sketch')), run: () => store.newThread() },
  { id: 'knurl', get label() { return t('feature.knurl'); }, group: 'feature', enabled: hasBody, run: () => store.newKnurl() },
  { id: 'cosmetic-thread', get label() { return t('feature.cosmeticThread'); }, group: 'feature', enabled: hasBody, run: () => store.newCosmeticThread() },
  { id: 'ruled-surface', get label() { return t('feature.ruledSurface'); }, group: 'feature', enabled: hasBody, run: () => store.newSurfaceTool('ruledSurface') },
  { id: 'radiated-surface', get label() { return t('feature.radiatedSurface'); }, group: 'feature', enabled: hasBody, run: () => store.newSurfaceTool('radiatedSurface') },
  { id: 'replace-face', get label() { return t('feature.replaceFace'); }, group: 'feature', enabled: hasBody, run: () => store.newSurfaceTool('replaceFace') },
  { id: 'projected-curve', get label() { return t('feature.projectedCurve'); }, group: 'feature', enabled: (s) => partIdle(s) && s.doc.features.some(f=>f.type === 'sketch'), run: () => store.newProjectedCurve() },
  { id: 'helix', get label() { return t('feature.helix'); }, group: 'feature', enabled: (s) => partIdle(s) && (s.doc.features.some((f) => f.type === 'sketch') || hasBody(s)), run: () => store.newHelix() },
  { id: 'fillet', get label() { return t('act.fillet'); }, group: 'feature', enabled: hasBody, run: () => store.newFillet() },
  { id: 'chamfer', get label() { return t('act.chamfer'); }, group: 'feature', enabled: hasBody, run: () => store.newChamfer() },
  { id: 'delete-face', get label() { return t('feature.deleteFace'); }, group: 'feature', enabled: hasBody, run: () => store.newDeleteFace() },
  { id: 'thread-entrance', get label() { return t('entrance.title'); }, group: 'feature', enabled: (s) => hasBody(s) && (!!s.selectedFace || s.selectedElements.some(r => r.kind === 'edge' || r.kind === 'face')), run: () => void store.newEntrance() },
  { id: 'hole', get label() { return t('feature.hole'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newHole() },
  { id: 'screw-boss', get label() { return t('feature.screwBoss'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newScrewBoss() },
  { id: 'base-flange', get label() { return t('feature.baseFlange'); }, group: 'sheet', enabled: sketchSelected, run: () => store.newBaseFlange() },
  { id: 'sheet-unfold', get label() { return t('feature.sheetUnfold'); }, group: 'sheet', enabled: s => hasBody(s) && s.doc.features.some(f => f.type === 'baseFlange' && !f.suppressed) && !activeSheetUnfold(s.doc.features), run: () => store.newSheetState('sheetUnfold') },
  { id: 'sheet-unfold-selected', get label() { return t('feature.sheetPartialUnfold'); }, group: 'sheet', enabled: s => hasBody(s) && !activeSheetUnfold(s.doc.features) && s.doc.features.some(f => !f.suppressed && ['midBend','jog','edgeFlange','hem'].includes(f.type)), run: () => store.newSheetUnfoldSelected() },
  { id: 'sheet-refold', get label() { return t('feature.sheetRefold'); }, group: 'sheet', enabled: s => hasBody(s) && !!activeSheetUnfold(s.doc.features), run: () => store.newSheetState('sheetRefold') },
  { id: 'mid-bend', get label() { return t('feature.midBend'); }, group: 'sheet', enabled: (s) => hasBody(s) && sketchSelected(s), run: () => store.newMidBend() },
  { id: 'jog', get label() { return t('feature.jog'); }, group: 'sheet', enabled: (s) => hasBody(s) && sketchSelected(s), run: () => store.newJog() },
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
  { id: 'knit', get label() { return t('feature.knit'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface && !b.curve), run: () => store.newKnit() },
  { id: 'fill-surface', get label() { return t('feature.fillSurface'); }, group: 'feature', enabled: hasBody, run: () => store.newSurfaceEdges('fillSurface') },
  { id: 'flat-surface', get label() { return t('feature.flatSurface'); }, group: 'feature', enabled: hasBody, run: () => store.newSurfaceEdges('flatSurface') },
  { id: 'trim-surface', get label() { return t('feature.trimSurface'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface && !b.curve) && s.doc.features.some((f) => f.type === 'sketch'), run: () => store.newTrimSurface() },
  { id: 'mutual-trim', get label() { return t('feature.mutualTrim'); }, group: 'feature', enabled: (s) => hasBody(s) && (s.result?.bodies.filter((b) => b.surface && !b.curve).length ?? 0) > 1, run: () => store.newMutualTrim() },
  { id: 'extend-surface', get label() { return t('feature.extendSurface'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface && !b.curve), run: () => store.newSurfaceEdges('extendSurface') },
  { id: 'thicken', get label() { return t('feature.thicken'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface && !b.curve), run: () => store.newThicken() },
  { id: 'cut-with-surface', get label() { return t('feature.cutWithSurface'); }, group: 'feature', enabled: (s) => hasBody(s) && !!s.result?.bodies.some((b) => b.surface && !b.curve) && !!s.result?.bodies.some((b) => !b.surface), run: () => store.newCutWithSurface() },
  { id: 'lip-groove', get label() { return t('feature.lipGroove'); }, group: 'feature', enabled: hasBody, run: () => store.newLipGroove() },
  { id: 'combine', get label() { return t('feature.combine'); }, group: 'feature', enabled: (s) => hasBody(s) && (s.result?.bodies.length ?? 0) > 1, run: () => store.newCombine() },
  { id: 'split', get label() { return t('feature.split'); }, group: 'feature', enabled: (s) => hasBody(s) && (s.result?.bodies.length ?? 0) >= 1, run: () => store.newSplit() },
  { id: 'move-copy-body', get label() { return t('feature.moveCopyBody'); }, group: 'feature', enabled: (s) => hasBody(s) && (s.result?.bodies.length ?? 0) >= 1, run: () => store.newMoveCopyBody() },
  { id: 'delete-keep-body', get label() { return t('feature.deleteKeepBody'); }, group: 'feature', enabled: (s) => hasBody(s) && (s.result?.bodies.length ?? 0) >= 1, run: () => store.newDeleteKeepBody() },
  { id: 'linear-pattern', get label() { return t('action.linearPattern'); }, group: 'feature', enabled: canPattern, run: () => store.newPattern('linear') },
  { id: 'circular-pattern', get label() { return t('action.circularPattern'); }, group: 'feature', enabled: canPattern, run: () => store.newPattern('circular') },
  { id: 'curve-pattern', get label() { return t('action.curvePattern'); }, group: 'feature', enabled: canPattern, run: () => store.newPattern('curve') },
  { id: 'mirror', get label() { return t('action.mirror'); }, group: 'feature', enabled: (s) => canPattern(s) || (partIdle(s) && (s.result?.bodies.length ?? 0) > 0), run: () => store.newMirror() },
  { id: 'ref-plane', get label() { return t('act.refPlane'); }, group: 'feature', enabled: partIdle, run: () => store.newRefPlane() },
  { id: 'ref-axis', get label() { return t('action.refAxis'); }, group: 'feature', enabled: partIdle, run: () => store.newRefAxis() },
  { id: 'ref-point', get label() { return t('action.refPoint'); }, group: 'feature', enabled: partIdle, run: () => store.newRefPoint() },
  { id: 'coord-sys', get label() { return t('action.coordSys'); }, group: 'feature', enabled: partIdle, run: () => store.newCoordSys() },
  { id: 'import-step', get label() { return t('act.importStep'); }, group: 'feature', enabled: (s) => partIdle(s) && s.bootMs !== null, run: () => void store.importStep() },
  // what a right click on a feature in the tree, or on a face, edge or vertex it made in the graphics area, offers (ADR 0176)
  { id: 'edit-feature', get label() { return t('tree.editFeature'); }, group: 'edit', menuOnly: true, enabled: (s) => { const f = contextFeature(s); return partIdle(s) && !!f && beforeRollback(s, f); }, run: () => { const f = contextFeature(store.getState()); if (f) store.beginEdit(f.id); } },
  { id: 'edit-feature-sketch', get label() { return t('tree.editSketch'); }, group: 'edit', menuOnly: true, enabled: (s) => { const k = contextSketch(s); return partIdle(s) && !!k && beforeRollback(s, k); }, run: () => { const k = contextSketch(store.getState()); if (k) store.beginEdit(k.id); } },
  { id: 'suppress-feature', get label() { return t('tree.suppress'); }, group: 'edit', menuOnly: true, enabled: (s) => partIdle(s) && contextFeature(s)?.suppressed === false, run: () => { const f = contextFeature(store.getState()); if (f) store.suppress(f.id, 'suppress'); } },
  {
    id: 'toggle-visibility',
    get label() {
      const s = store.getState();
      const key = contextVisibilityKey(s);
      const shown = key !== null && isShown(s.doc, key);
      return key?.startsWith('body:') ? t(shown ? 'ctx.hideBody' : 'ctx.showBody') : t(shown ? 'tree.hide' : 'tree.show');
    },
    group: 'edit',
    menuOnly: true,
    enabled: (s) => partIdle(s) && contextVisibilityKey(s) !== null,
    run: () => {
      const s = store.getState();
      const key = contextVisibilityKey(s);
      if (key) store.setVisibility([key], !isShown(s.doc, key));
    },
  },
  { id: 'delete-feature', get label() { return t('tree.delete'); }, group: 'edit', menuOnly: true, enabled: (s) => partIdle(s) && !!contextFeature(s), run: () => { const f = contextFeature(store.getState()); if (f) store.requestDelete(f.id); } },

  { id: 'insert-component', get label() { return t('act.insertComponent'); }, group: 'assembly', enabled: assemblyIdle, run: () => void store.assembly?.startInsert() },
  { id: 'mate', get label() { return t('act.mate'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startMate() },
  { id: 'move-component', get label() { return t('act.moveComponent'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startMove('move') },
  { id: 'rotate-component', get label() { return t('act.rotateComponent'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startMove('rotate') },
  // 以座標軸移動 (ADR 0179): the triad on the selected component; a second press takes it away
  { id: 'move-with-triad', get label() { return t('act.moveWithTriad'); }, group: 'assembly', enabled: (s) => assemblyIdle(s) && !!s.asm?.selected && s.asm.doc.components.some((c) => c.id === s.asm!.selected), active: () => !!store.getState().asm?.triad, run: () => (store.getState().asm?.triad ? store.assembly?.hideTriad() : store.assembly?.showTriad()) },
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
  // what a right click on a component offers, in the tree and in the graphics area alike (ADR 0176): they work on the component selected
  { id: 'open-component', get label() { const c = selectedComponent(store.getState()); return c && store.assembly?.isSubAssembly(c.id) ? t('subassembly.open') : t('ctx.openPart'); }, group: 'assembly', menuOnly: true, enabled: (s) => assemblyIdle(s) && !!selectedComponent(s), run: () => { const c = selectedComponent(store.getState()); if (c) store.openComponentPart(c.id); } },
  { id: 'relink-component', get label() { return t('ctx.relink'); }, group: 'assembly', menuOnly: true, enabled: (s) => assemblyIdle(s) && !!selectedComponent(s), run: () => { const c = selectedComponent(store.getState()); if (c) void store.assembly?.browseRelink(c.file); } },
  { id: 'hide-component', get label() { return t(selectedComponent(store.getState())?.hidden ? 'subassembly.show' : 'subassembly.hide'); }, group: 'assembly', menuOnly: true, enabled: (s) => assemblyIdle(s) && !!selectedComponent(s), run: () => toggleComponent('hidden') },
  { id: 'transparent-component', get label() { return t(selectedComponent(store.getState())?.transparent ? 'subassembly.opaque' : 'subassembly.transparent'); }, group: 'assembly', menuOnly: true, enabled: (s) => assemblyIdle(s) && !!selectedComponent(s), run: () => toggleComponent('transparent') },
  { id: 'suppress-component', get label() { return t(selectedComponent(store.getState())?.suppressed ? 'tree.unsuppress' : 'tree.suppress'); }, group: 'assembly', menuOnly: true, enabled: (s) => assemblyIdle(s) && !!selectedComponent(s), run: () => toggleComponent('suppressed') },
  { id: 'delete-component', get label() { return t('ctx.deleteComponent'); }, group: 'assembly', menuOnly: true, enabled: (s) => assemblyIdle(s) && !!selectedComponent(s), run: () => { const c = selectedComponent(store.getState()); if (c) store.assembly?.requestDelete(selectedComponentIds()); } },

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
  { id: 'select-underdefined', get label() { return t('sketch.selectUnderdefined'); }, group: 'sketch', enabled: sketching, run: () => store.sketcher?.selectUnderdefined() },
  { id: 'automatic-relations', get label() { return t('sketch.automaticRelations'); }, group: 'sketch', enabled: (s) => s.active === 'part', active: () => store.getState().options.automaticRelations, run: () => store.setOptions({automaticRelations:!store.getState().options.automaticRelations}) },
  { id: 'exit-sketch', get label() { return t('act.exitSketch'); }, group: 'sketch-tool', enabled: sketching, run: () => store.commitEdit() },
  // the sketch's right-click menu (ADR 0176): on what is selected, or on the tool that is on
  { id: 'sketch-delete', get label() { return t('ctx.sketchDelete'); }, group: 'sketch-tool', menuOnly: true, enabled: (s) => sketching(s) && sketchSelection().length > 0, run: () => store.sketcher?.deleteSelection() },
  { id: 'sketch-select-chain', get label() { return t('ctx.selectChain'); }, group: 'sketch-tool', menuOnly: true, enabled: sketchCurveSelected, run: () => store.sketcher?.selectChain() },
  { id: 'sketch-end-tool', get label() { return t('ctx.endTool'); }, group: 'sketch-tool', menuOnly: true, enabled: (s) => sketching(s) && !!store.sketcher && store.sketcher.getView().tool !== 'select', run: () => store.sketcher?.setTool('select') },

  // the drawing (D-I1b): 視圖配置
  { id: 'drw-open-part', get label() { return t('drawingUi.openPartButton'); }, group: 'drawing', enabled: (s) => drawingOn(s) && !!store.drawingStore?.partToOpen(), run: () => openDrawingPart() },
  { id: 'drw-standard', get label() { return t('drawingUi.standardViews'); }, group: 'drawing', enabled: (s) => drawingOn(s) && !!store.drawingStore?.sourceForViews(), run: () => store.drawingStore?.addStandardViews() },
  { id: 'drw-projected', get label() { return t('drawingUi.toolProjected'); }, group: 'drawing', enabled: (s) => drawingOn(s) && (!!chosenView(s) || drawingTool(s)?.kind === 'project'), active: toolIs((x) => x.kind === 'project'), run: () => { const v = chosenView(store.getState()); toggleTool((x) => x.kind === 'project', () => (v ? { kind: 'project', parent: v.id } : null))(); } },
  { id: 'drw-section', get label() { return t('drawingUi.cmd.section'); }, group: 'drawing', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, active: toolIs((x) => x.kind === 'section'), run: toggleTool((x) => x.kind === 'section', () => ({ kind: 'section', vertical: true })) },
  { id: 'drw-detail', get label() { return t('drawingUi.cmd.detail'); }, group: 'drawing', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, active: toolIs((x) => x.kind === 'detail'), run: toggleTool((x) => x.kind === 'detail', () => ({ kind: 'detail' })) },
  { id: 'drw-autoscale', get label() { return t('drawingUi.autoScale'); }, group: 'drawing', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, run: () => store.drawingStore?.autoScale() },
  // 註記
  { id: 'drw-dimension', get label() { return t('drawingUi.toolDimension'); }, group: 'annotation', enabled: hasViews, ...dimensionTool('smart') },
  // the kinds asked for by name, in the drop-down of 智慧型尺寸 (SolidWorks's 水平尺寸, 垂直尺寸, ...); the right-click menu offers the same ones (ADR 0177)
  { id: 'drw-dim-horizontal', get label() { return t('drawingUi.toolDim.horizontal'); }, group: 'annotation', parent: 'drw-dimension', enabled: hasViews, ...dimensionTool('horizontal') },
  { id: 'drw-dim-vertical', get label() { return t('drawingUi.toolDim.vertical'); }, group: 'annotation', parent: 'drw-dimension', enabled: hasViews, ...dimensionTool('vertical') },
  { id: 'drw-dim-aligned', get label() { return t('drawingUi.toolDim.aligned'); }, group: 'annotation', parent: 'drw-dimension', enabled: hasViews, ...dimensionTool('aligned') },
  { id: 'drw-dim-angle', get label() { return t('drawingUi.toolDim.angle'); }, group: 'annotation', parent: 'drw-dimension', enabled: hasViews, ...dimensionTool('angle') },
  { id: 'drw-dim-radius', get label() { return t('drawingUi.toolDim.radius'); }, group: 'annotation', parent: 'drw-dimension', enabled: hasViews, ...dimensionTool('radius') },
  { id: 'drw-dim-diameter', get label() { return t('drawingUi.toolDim.diameter'); }, group: 'annotation', parent: 'drw-dimension', enabled: hasViews, ...dimensionTool('diameter') },
  { id: 'drw-dim-chamfer', get label() { return t('drawingUi.toolDim.chamfer'); }, group: 'annotation', parent: 'drw-dimension', enabled: hasViews, ...dimensionTool('chamfer') },
  { id: 'drw-baseline', get label() { return t('drawingUi.toolBaseline'); }, group: 'annotation', enabled: hasViews, active: toolIs((x) => x.kind === 'baseline'), run: toggleTool((x) => x.kind === 'baseline', () => ({ kind: 'baseline' })) },
  { id: 'drw-ordinate', get label() { return t('drawingUi.toolOrdinate'); }, group: 'annotation', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, active: toolIs((x) => x.kind === 'ordinate'), run: toggleTool((x) => x.kind === 'ordinate', () => ({ kind: 'ordinate', picks: [] })) },
  { id: 'drw-arrange', get label() { return t('drawingUi.arrange'); }, group: 'annotation', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).dimensions.length : 0)) > 0, run: () => { const d = store.drawingStore; if (!d) return; const n = d.arrangeDimensions(page(d.getState().doc).dimensions.map((x) => x.id)); d.notifyInfo(n > 0 ? t('drawingUi.arranged', { n }) : t('drawingUi.arrangedNothing')); } },
  { id: 'drw-note', get label() { return t('drawingUi.toolNote'); }, group: 'annotation', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, active: toolIs((x) => x.kind === 'annotate' && x.what === 'note'), run: toggleTool((x) => x.kind === 'annotate' && x.what === 'note', () => ({ kind: 'annotate', what: 'note' })) },
  { id: 'drw-datum', get label() { return t('drawingUi.toolDatum'); }, group: 'annotation', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, active: toolIs((x) => x.kind === 'annotate' && x.what === 'datum'), run: toggleTool((x) => x.kind === 'annotate' && x.what === 'datum', () => ({ kind: 'annotate', what: 'datum' })) },
  { id: 'drw-fcf', get label() { return t('drawingUi.toolFcf'); }, group: 'annotation', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, active: toolIs((x) => x.kind === 'annotate' && x.what === 'fcf'), run: toggleTool((x) => x.kind === 'annotate' && x.what === 'fcf', () => ({ kind: 'annotate', what: 'fcf' })) },
  { id: 'drw-centre-mark', get label() { return t('drawingUi.toolCentreMark'); }, group: 'annotation', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, active: toolIs((x) => x.kind === 'annotate' && x.what === 'centreMark'), run: toggleTool((x) => x.kind === 'annotate' && x.what === 'centreMark', () => ({ kind: 'annotate', what: 'centreMark' })) },
  { id: 'drw-centre-line', get label() { return t('drawingUi.toolCentreLine'); }, group: 'annotation', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, active: toolIs((x) => x.kind === 'annotate' && x.what === 'centreLine'), run: toggleTool((x) => x.kind === 'annotate' && x.what === 'centreLine', () => ({ kind: 'annotate', what: 'centreLine' })) },
  { id: 'drw-surface', get label() { return t('drawingUi.addSurfaceFinish'); }, group: 'annotation', enabled: (s) => drawingOn(s) && ((s.drw ? page(s.drw.doc).views.length : 0)) > 0, active: toolIs((x) => x.kind === 'surface'), run: toggleTool((x) => x.kind === 'surface', () => ({ kind: 'surface' })) },
  { id: 'drw-hole-table', get label() { return t('drawingUi.addHoleTable'); }, group: 'annotation', enabled: (s) => drawingOn(s) && !!chosenView(s) && !store.drawingStore?.isAssemblyView(chosenView(s)!.id), run: () => { const v = chosenView(store.getState()); if (v) store.drawingStore?.addHoleTable(v.id); } },
  { id: 'drw-bom', get label() { return t('drawingUi.addBomTable'); }, group: 'annotation', enabled: (s) => drawingOn(s) && !!chosenView(s) && !!store.drawingStore?.isAssemblyView(chosenView(s)!.id) && !((s.drw ? page(s.drw.doc).tables : [])).some((x) => x.kind === 'bom'), run: () => { const v = chosenView(store.getState()); if (v) store.drawingStore?.addBomTable(v.id); } },
  // 檔案: what a drawing is written out as
  { id: 'drw-pdf', get label() { return t('drawingUi.exportPdf'); }, group: 'file', enabled: drawingOn, run: () => store.drawingStore?.exportPdf() },
  { id: 'drw-dxf', get label() { return t('drawingUi.exportDxf'); }, group: 'file', enabled: drawingOn, run: () => store.drawingStore?.exportDxf() },
  { id: 'drw-svg', get label() { return t('drawingUi.exportSvg'); }, group: 'file', enabled: drawingOn, run: () => store.drawingStore?.exportSvg() },

  { id: 'undo', get label() { return t('act.undo'); }, shortcut: 'Ctrl+Z', group: 'edit', enabled: (s) => (s.drw ? s.drw.canUndo : s.asm ? s.asm.canUndo && idle(s) : s.canUndo), run: () => store.undo() },
  { id: 'redo', get label() { return t('act.redo'); }, shortcut: 'Ctrl+Y', group: 'edit', enabled: (s) => (s.drw ? s.drw.canRedo : s.asm ? s.asm.canRedo && idle(s) : s.canRedo), run: () => store.redo() },
  { id: 'rebuild', get label() { return t('act.rebuild'); }, shortcut: 'Ctrl+B', group: 'edit', enabled: () => true, run: () => store.rebuild() },

  { id: 'fit', get label() { return t('act.fit'); }, shortcut: 'F', group: 'view', enabled: () => true, run: () => store.viewer?.fitAll() },
  { id: 'view-front', get label() { return t('act.front'); }, shortcut: 'Ctrl+1', group: 'view', enabled: () => true, run: () => store.viewer?.setView('front') },
  { id: 'view-back', get label() { return t('act.back'); }, shortcut: 'Ctrl+2', group: 'view', enabled: () => true, run: () => store.viewer?.setView('back') },
  { id: 'view-top', get label() { return t('act.top'); }, shortcut: 'Ctrl+5', group: 'view', enabled: () => true, run: () => store.viewer?.setView('top') },
  { id: 'view-bottom', get label() { return t('act.bottom'); }, shortcut: 'Ctrl+6', group: 'view', enabled: () => true, run: () => store.viewer?.setView('bottom') },
  { id: 'view-right', get label() { return t('act.right'); }, shortcut: 'Ctrl+4', group: 'view', enabled: () => true, run: () => store.viewer?.setView('right') },
  { id: 'view-left', get label() { return t('act.left'); }, shortcut: 'Ctrl+3', group: 'view', enabled: () => true, run: () => store.viewer?.setView('left') },
  { id: 'view-iso', get label() { return t('act.iso'); }, shortcut: 'Ctrl+7', group: 'view', enabled: () => true, run: () => store.viewer?.setView('iso') },
  { id: 'view-normal', get label() { return t('act.normal'); }, shortcut: 'Ctrl+8', group: 'view', enabled: (s) => sketching(s) || partIdle(s) || s.active === 'assembly', run: () => lookAtNormal() },
  // The filter narrows what a command in progress asks for, so F5/F6 stay on in a PropertyManager session, as in SW (ADR 0145); an assembly has the same bar (ADR 0148).
  { id: 'filter-bar', get label() { return t('act.filterBar'); }, shortcut: 'F5', group: 'view', enabled: (s) => s.active === 'part' || s.active === 'assembly', run: () => store.togglePickFilterBar() },
  { id: 'clear-filters', get label() { return t('act.clearFilters'); }, shortcut: 'F6', group: 'view', enabled: (s) => s.active === 'part' || s.active === 'assembly', run: () => store.clearPickFilter() },
];

// Only creation tools are repeatable; file, delete, undo, view and toggle commands never replace this intent.
let lastRepeatable: { action: UiAction; selected: string|null; face: Ref|null; elements: Ref[]; serial: number } | null = null;
for (const a of ACTIONS) {
  if ((!a.menuOnly && (a.group === 'feature' || a.group === 'sheet')) || a.id.startsWith('tool-') || a.id === 'mate' || a.id === 'insert-component') {
    const run = a.run;
    a.run = () => { if (!a.enabled(store.getState())) return; const s=store.getState(); lastRepeatable = {action:a,selected:s.selected,face:s.selectedFace,elements:s.selectedElements,serial:s.documentSerial}; run(); };
  }
}
export function repeatLastCommand(): boolean {
  const last=lastRepeatable,s=store.getState();
  if(!last || last.serial!==s.documentSerial)return false;
  if(!last.action.enabled(s)) {
    if(last.selected && (isDatumPlaneName(last.selected)||s.doc.features.some(f=>f.id===last.selected))) store.select(last.selected);
    else if(last.face) store.selectFace(last.face);
    else if(last.elements.length) store.selectElements(last.elements,false);
  }
  if(!last.action.enabled(store.getState()))return false;
  last.action.run();return true;
}

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

/** Turns one of the selected component's states over: hidden, see-through, suppressed (C15.5). */
function toggleComponent(state: 'hidden' | 'transparent' | 'suppressed'): void {
  const c = selectedComponent(store.getState());
  if (c) store.assembly?.setComponentState(selectedComponentIds(), state, !c[state]);
}

function selectedComponentIds(): string[] {
  const s=store.getState().asm;
  return s?.selectedComponents.length?s.selectedComponents:s?.selected?[s.selected]:[];
}

/**
 * 「正視於」 (Normal To, C1.2; the full SolidWorks set, 2026-10-14 decision). Inside a sketch it is
 * that sketch's plane, as before. Outside one it looks straight at whatever plane is selected: a
 * default plane, a reference plane or a coordinate system (DatumPicker / the tree), or the planar
 * face the pointer picked. `sketchPlane` already resolves all four to a Ref and `planeFrameOf` turns
 * each into a frame, so this is one path rather than a second copy of the datum/face rule. Pressed
 * again while already looking straight along the plane's normal it flips to the far side — detected
 * from the camera's current direction against the frame, so it needs no per-action state. With no
 * plane to look at (nothing selected, or a curved face) it goes to the standard view the camera is
 * nearest to, and pressed again there to the one from the other side (2026-10-15 decision).
 */
function lookAtNormal(): void {
  const sketch = store.editedSketch();
  const frame = sketch ? store.frameOf(sketch) : store.getState().active === 'assembly' ? (store.assembly?.normalFrame() ?? null) : normalFrame();
  const viewer = store.viewer;
  if (!frame) {
    // nothing to look at straight (D-I-view decision, 2026-10-15): the standard view the camera is nearest to; pressed again there, the one from the other side
    if (!viewer) return;
    const { view, straight } = viewer.nearestPrincipalView();
    viewer.setView(straight ? OPPOSITE_VIEW[view] : view);
    return;
  }
  const dir = viewer?.viewDirection();
  const dot = dir ? dir[0] * frame.normal[0] + dir[1] * frame.normal[1] + dir[2] * frame.normal[2] : 0;
  // Pressed again while already looking straight along ±normal: cross to the far side. Looking at the
  // near side (dot −1) takes the negated normal (0 stays 0: −0 ≠ 0 by Object.is, which the tests use);
  // from the far side (dot +1) the frame's own normal turns the view back.
  const normal: [number, number, number] =
    dot < -0.999 ? (frame.normal.map((x) => (x === 0 ? 0 : -x)) as [number, number, number]) : frame.normal;
  viewer?.lookAt({ ...frame, normal });
}

/** 「正視於」 outside a sketch: the frame of the selected plane, reference plane, coordinate system or face.
 *  Exported because this selection → frame rule is what needs checking; the camera arithmetic it feeds
 *  is `viewer.lookAt`'s own business. */
export function normalFrame(): PlaneFrame | null {
  const plane = sketchPlane(store.getState());
  if (plane === null) return null;
  // A default plane comes back as its bare name; the other three are already Refs.
  const ref: Ref = typeof plane === 'string' ? { kind: 'datum', name: plane } : plane;
  return store.planeFrameOf(ref);
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
/** Does what a view key asks (viewKeys.ts) to the 3D view. */
function runViewKey(c: ViewKeyCommand): void {
  const v = store.viewer;
  if (!v) return;
  switch (c.kind) {
    case 'orbit':
      return v.orbit(c.direction, c.degrees);
    case 'roll':
      return v.roll(c.degrees);
    case 'pan':
      return v.pan(c.fx, c.fy);
    case 'zoom':
      return v.zoom(c.factor);
    case 'previous':
      return void v.previousView();
    case 'orientation':
      return store.openDialog('viewOrientation');
  }
}

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return; // A viewport gesture or local editor already owns this key.
    if (e.key === 'Escape' && store.cancelFeatureGesture) { e.preventDefault(); e.stopImmediatePropagation(); store.cancelFeatureGesture(); return; }
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
        if (e.key === 'Escape') {
          store.viewer?.cancelComponentDrag();
          store.viewer?.cancelTriadDrag();
        }
        return;
      }
      // the triad first (ADR 0179): Esc takes it away, then closes 移動零組件 if that is open
      if (s.asm.triad && e.key === 'Escape') return void a?.hideTriad();
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
        if (e.key === 'Tab') {e.preventDefault();return void a?.flipMateAlignment();}
        if (e.key === 'Enter') return void a?.applyMate();
      } else if (s.asm.insert) {
        if (e.key === 'Escape') return void a?.cancelInsert();
        if (e.key === 'Enter') return void a?.place(null);
      } else if (e.key === 'Escape' && (selected || s.asm.picks.length > 0)) {
        return void a?.select(null); // nothing chosen any more, as SolidWorks clears the selection
      } else if (e.key === 'Delete' && selected && explosionSteps(s.asm.doc).some((x) => x.id === selected)) {
        return void a?.deleteExplodeSteps([selected]);
      } else if (e.key === 'Delete' && selected && s.asm.doc.patterns?.some((p) => p.id === selected)) {
        return void a?.deletePatterns([selected]); // a pattern's instances are derived: nothing else goes with it
      } else if (e.key === 'Delete' && selected && (selectedComponent(s) || s.asm.doc.mates.some((m) => m.id === selected))) {
        return void a?.requestDelete(selectedComponent(s)?selectedComponentIds():[selected]);
      }
    } else if (s.editing?.kind === 'sketch') {
      // Inside a sketch, Esc ends the current tool and Delete removes the selection (SolidWorks);
      // leaving the sketch is the confirmation corner or 「離開草圖」.
      if (e.key === 'Escape') return void store.sketcher?.escape();
      if (e.key === 'Delete') return void store.sketcher?.deleteSelection();
    } else if (s.editing) {
      if (e.key === 'Enter') {const button=document.querySelector<HTMLButtonElement>('[data-floating-parameters] .pm-ok');if(button)return void button.click();return void store.commitEdit();}
      if (e.key === 'Escape') return void store.cancelEdit();
    } else if (e.key === 'Delete' && s.doc.features.some((f) => f.id === s.selected)) {
      return void store.requestDelete(s.selected); // 「確認刪除」 for the feature selected in the tree
    }
    if (e.key === 'Enter' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !s.dialog && !s.editing && !s.drw && (!s.asm || assemblyFree(s))) {
      if (repeatLastCommand()) e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.repeat && s.editing?.kind === 'sketch') {if(repeatLastCommand()) e.preventDefault(); return;}
    // The view from the keyboard (SolidWorks: arrows, Shift/Alt/Ctrl+arrows, Z, Shift+Z, Ctrl+Shift+Z, space): fixed keys, before the shortcuts, so
    // Ctrl+Shift+Z is not taken for undo (a shortcut without Shift also matches with it). Not on a drawing sheet: it has no model to turn.
    // Nor while a dialog is open: its buttons take the space bar and the arrows.
    const view = !s.drw && !s.dialog && store.viewer ? viewKeyCommand(e, s.options.viewArrowStep) : null;
    // The space bar on a focused button (or a face of the view cube) presses it; taking it here would also stop the browser from doing so.
    if (view?.kind === 'orientation' && takesSpace(target)) return;
    if (view) {
      e.preventDefault(); // Alt+Left would go back a page, the space would scroll it
      return void runViewKey(view);
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
