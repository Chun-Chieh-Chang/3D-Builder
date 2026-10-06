import { ACTIONS, shortcutOf, type UiAction } from '../actions';
import { store, type UiState } from '../state/store';
import { allTopics, contextTopic, helpTopic, tooltipOf, type HelpContext, type HelpTopic } from './topics';

/** What the program is doing now, read from the store (the help itself holds none of this). */
export function currentContext(s: UiState = store.getState()): HelpContext {
  const feature = s.editing ? s.doc.features.find((f) => f.id === s.editing!.featureId) : undefined;
  const op = feature && 'op' in feature ? (feature as { op?: string }).op : undefined;
  const analysis = s.measure ? 'measure' : s.draft ? 'draft' : s.undercut ? 'undercut' : s.thickness ? 'thickness' : s.check ? 'check' : s.interference ? 'interference' : s.clearance ? 'clearance' : null;
  const asm = s.asm;
  return {
    active: s.active,
    sketching: s.editing?.kind === 'sketch',
    sketchTool: s.editing?.kind === 'sketch' ? (store.sketcher?.getView().tool ?? null) : null,
    feature: feature && feature.type !== 'sketch' ? { type: feature.type, ...(op ? { op } : {}), ...(feature.type === 'pattern' ? { patternKind: feature.def.mode } : {}) } : null,
    assembly: asm?.mate ? 'mate' : asm?.insert ? 'insert' : asm?.move ? 'move' : asm?.pattern ? 'pattern' : asm?.explode ? 'explode' : null,
    analysis,
  };
}

/** The topic for what is going on now. */
export const currentTopicId = (): string => contextTopic(currentContext());

const actionLikes = (): UiAction[] => ACTIONS;

export const topics = (): HelpTopic[] => allTopics(actionLikes());
export const topicOf = (id: string): HelpTopic | null => helpTopic(id, actionLikes());

/** The tooltip of an action's button: read from the topic, like everything the help says. */
export function actionTooltip(a: UiAction): string {
  const topic = topicOf(a.id);
  return topic ? tooltipOf(topic, shortcutOf(a)) : a.label;
}
