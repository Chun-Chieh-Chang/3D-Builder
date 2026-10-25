import { isShown, bodyKey } from '@3db/model';
import { t } from '@3db/i18n';
import type { Id, SketchFeature } from '@3db/model';
import { SNAP_ITEMS } from '@3db/sketch/snaps';
import { ACTIONS } from './actions';
import { relationsOffered } from './sketcher/relationsOffered';
import type { TriadPart } from '@3db/render';
import { TRANSFORM_TOOLS, type SketchController, type ToolId } from './sketcher/controller';
import { store, type UiState } from './state/store';
import { RELATION_LABEL } from './strings';

/**
 * The right-click menus of the graphics area (ADR 0176): the part (a face, an edge, a vertex, or nothing under the pointer), the sketch being edited (an
 * entity, nothing, or a tool that is on) and the assembly (a component, or nothing). Every command is one of the registry's (`actions.ts`): its name and
 * whether it can be done now are the registry's, so the tree's menus, the CommandManager and these menus are one set of commands. The thing under the
 * pointer is chosen before the menu is built; the commands work on what is chosen.
 */

/** One line of a menu: a command, a line between groups, or one that opens more lines in its place. */
export type MenuEntry =
  | { kind: 'command'; id: string; label: string; disabled: boolean; run: () => void }
  | { kind: 'submenu'; id: string; label: string; items: MenuEntry[] }
  | { kind: 'separator' };

export const SEPARATOR: MenuEntry = { kind: 'separator' };

/** A command of the registry, as a line of a menu; `run` does it another way (from what the right click chose) when it is given. */
export function command(s: UiState, id: string, run?: () => void): MenuEntry {
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown action ${id}`);
  return { kind: 'command', id, label: a.label, disabled: !a.enabled(s), run: run ?? (() => a.run()) };
}

/** A line that is not a command of the registry (a relation, a quick snap, a face of 「選取其他」): it says what it is in its id. */
export const entry = (id: string, label: string, run: () => void, disabled = false): MenuEntry => ({ kind: 'command', id, label, disabled, run });

/** Lines between groups only where both sides have something, never two together, none first or last. */
export function tidy(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const item of items) {
    if (item.kind === 'separator' && (out.length === 0 || out[out.length - 1]!.kind === 'separator')) continue;
    out.push(item);
  }
  while (out.length > 0 && out[out.length - 1]!.kind === 'separator') out.pop();
  return out;
}

/** The ids of a menu's lines, submenus' lines after their own (what the e2e scripts and the tests compare). */
export const menuIds = (items: MenuEntry[]): string[] => items.flatMap((i) => (i.kind === 'separator' ? [] : i.kind === 'submenu' ? [i.id, ...menuIds(i.items)] : [i.id]));

const STANDARD_VIEWS = ['view-front', 'view-back', 'view-top', 'view-bottom', 'view-left', 'view-right', 'view-iso'];

/** Nothing under the pointer in the part or the assembly: the view. */
function viewItems(s: UiState): MenuEntry[] {
  return [command(s, 'fit'), command(s, 'view-normal'), { kind: 'submenu', id: 'standard-views', label: t('ctx.standardViews'), items: STANDARD_VIEWS.map((id) => command(s, id)) }, SEPARATOR, command(s, 'filter-bar')];
}

/** What is under the pointer in the part's graphics area: an element of the model (its number in the mesh on show), or nothing. */
export type PartTarget = { kind: 'face' | 'edge' | 'vertex'; index: number } | null;

/**
 * The part (ADR 0176): on a face, edge or vertex, what SolidWorks offers there — the feature that made it (edit, its sketch, suppress), a sketch on a planar
 * face, a fillet or chamfer of an edge, hiding the body, its appearance (a face), measuring; on nothing, the view. Only while nothing is edited or measured: in a PropertyManager
 * session the right click is for the selection tools (`selection`), which come last.
 */
export function partMenu(s: UiState, at: PartTarget, selection: MenuEntry[] = []): MenuEntry[] {
  const idle = s.editing === null && !s.measure;
  if (!idle) return tidy(selection);
  if (!at) return tidy([...viewItems(s), ...(s.result?.bodies.some(b => !isShown(s.doc, bodyKey(b.id))) ? [SEPARATOR, entry('show-hidden-bodies', t('tree.showHiddenBodies'), () => store.showHiddenBodies())] : []), SEPARATOR, ...selection]);
  const measure = command(s, 'measure-part', () => {
    store.startMeasure();
    store.measurePick(at.kind, at.index, null);
  });
  const feature = [command(s, 'edit-feature'), ...(at.kind === 'vertex' ? [] : [command(s, 'edit-feature-sketch')])];
  const items: MenuEntry[] =
    at.kind === 'face'
      ? [...feature, command(s, 'sketch'), SEPARATOR, command(s, 'toggle-visibility'), command(s, 'appearance'), command(s, 'suppress-feature'), SEPARATOR, measure]
      : at.kind === 'edge'
        ? [...feature, SEPARATOR, command(s, 'fillet'), command(s, 'chamfer'), SEPARATOR, command(s, 'toggle-visibility'), command(s, 'suppress-feature'), SEPARATOR, measure]
        : [...feature, SEPARATOR, measure];
  return tidy([...items, SEPARATOR, ...selection]);
}

/** The tools that put points down, the ones a 快速抓取 can be chosen for (S-4). */
export const QUICK_SNAP_TOOLS: ReadonlySet<ToolId> = new Set(['line', 'centerline', 'rect', 'centerRect', 'circle', 'perimeterCircle', 'arc', 'tangentArc', 'threePointArc', 'point', 'slot', 'polygon']);

/** What a right click in a sketch with nothing under the pointer starts: the tools drawn most. */
const SKETCH_START_TOOLS = ['tool-line', 'tool-rect', 'tool-circle', 'tool-arc', 'tool-dimension'];

/**
 * The sketch being edited (ADR 0176). A drawing tool on: end it, and the 快速抓取 for the tools that place points. The select tool on an entity (made the
 * selection by `contextPick`): the relations the selection can still take, 智慧型尺寸 from it, construction, the chain, delete; on nothing, the tools drawn
 * most. Leaving the sketch and looking straight at it are always there.
 */
export function sketchMenu(s: UiState, sketcher: SketchController, sketch: SketchFeature, hit: Id | null): MenuEntry[] {
  const view = sketcher.getView();
  if (view.tool !== 'select') {
    const chosen = view.quickSnap;
    const quick: MenuEntry[] = QUICK_SNAP_TOOLS.has(view.tool)
      ? [
          SEPARATOR,
          {
            kind: 'submenu',
            id: 'quick-snap',
            label: t('snap.quickHeading'),
            items: [...SNAP_ITEMS.map((k) => entry(`snap-${k}`, `${chosen === k ? '✔ ' : ''}${t(`snap.name.${k}`)}`, () => sketcher.setQuickSnap(k))), ...(chosen ? [entry('snap-off', t('snap.quickOff'), () => sketcher.setQuickSnap(null))] : [])],
          },
        ]
      : [];
    return tidy([command(s, 'sketch-end-tool'), ...quick]);
  }
  const leave = [SEPARATOR, command(s, 'view-normal'), command(s, 'exit-sketch')];
  if (hit === null) return tidy([...SKETCH_START_TOOLS.map((id) => command(s, id)), ...leave]);
  const { offered } = relationsOffered(sketch, s.sketchSolve, view.selection);
  const relations: MenuEntry[] = offered.length > 0 ? [{ kind: 'submenu', id: 'add-relation', label: t('ctx.addRelation'), items: offered.map((r) => entry(`relation-${r.type}`, RELATION_LABEL[r.type], () => void sketcher.addRelation(r))) }] : [];
  // 移動／複製／旋轉／縮放圖元, the sketch patterns and the mirror (ADR 0178): they start with the selection the right click made
  const transforms: MenuEntry = { kind: 'submenu', id: 'transform-entities', label: t('ctx.transform'), items: [...TRANSFORM_TOOLS, 'mirror'].map((tool) => command(s, `tool-${tool}`)) };
  return tidy([...relations, command(s, 'tool-dimension', () => sketcher.startDimension()), command(s, 'construction'), SEPARATOR, transforms, SEPARATOR, command(s, 'sketch-select-chain'), command(s, 'sketch-delete'), ...leave]);
}

const AXIS_NAME = ['X', 'Y', 'Z'] as const;

/**
 * A right click on a handle of the triad (以座標軸移動, ADR 0179): on a ring, turning 90° either way or 180° about its axis (as SolidWorks offers on the
 * triad's rings); on any handle, 「移至 XYZ 座標…」 and ending the triad.
 */
export function triadMenu(part: TriadPart): MenuEntry[] {
  const a = store.assembly;
  const end = entry('triad-close', t('triad.close'), () => a?.hideTriad());
  const moveTo = entry('triad-move-to', t('triad.moveTo'), () => a?.triadMoveTo());
  if (part.kind !== 'ring') return tidy([moveTo, SEPARATOR, end]);
  const axis = AXIS_NAME[part.axis];
  const turns = [90, -90, 180].map((deg) => entry(`triad-turn-${axis}${deg}`, t('triad.turn', { axis, angle: String(deg) }), () => void a?.triadTurn(part.axis, deg)));
  return tidy([...turns, SEPARATOR, moveTo, SEPARATOR, end]);
}

/**
 * The assembly (ADR 0176): on a component (chosen first), what the tree's row offers — open its part, mate, move, turn, fix or float, hide, see-through,
 * suppress, delete; on nothing, inserting and mating and the view.
 */
export function assemblyMenu(s: UiState, component: Id | null): MenuEntry[] {
  if (component === null) return tidy([command(s, 'insert-component'), command(s, 'mate'), ...(s.asm?.doc.components.some(c => c.hidden) ? [entry('show-hidden-components', t('tree.showHiddenComponents'), () => store.assembly?.showHiddenComponents())] : []), SEPARATOR, ...viewItems(s)]);
  const c = s.asm?.doc.components.find((x) => x.id === component);
  if (!c) return [];
  return tidy([
    command(s, 'open-component'),
    command(s, 'relink-component'),
    SEPARATOR,
    command(s, 'mate'),
    command(s, 'move-component'),
    command(s, 'rotate-component'),
    command(s, 'move-with-triad'),
    SEPARATOR,
    command(s, c.fixed ? 'float-component' : 'fix-component'),
    SEPARATOR,
    command(s, 'hide-component'),
    command(s, 'transparent-component'),
    command(s, 'suppress-component'),
    SEPARATOR,
    command(s, 'delete-component'),
  ]);
}
