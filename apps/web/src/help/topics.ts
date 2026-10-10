import { t, textOf } from '@3db/i18n';

/**
 * The help topics (docs/help-plan.md). A topic is the id of an action (the sketch tools are `tool-<tool>`) or `concept.<name>`; its texts
 * live in the catalog (`help.<topic>.*`, see packages/i18n/src/zh-TW/help.ts) and nowhere else, so the tooltip, the help window and
 * 「這是什麼？」 all show the same words. Nothing here knows the store: the actions are handed in.
 */

export type HelpGroup = 'concept' | 'file' | 'edit' | 'feature' | 'sheet' | 'sketch' | 'sketch-tool' | 'assembly' | 'view' | 'tools';

/** The part of an action a topic needs. */
export interface ActionLike {
  id: string;
  label: string;
  group: Exclude<HelpGroup, 'concept'>;
}

export interface HelpTopic {
  id: string;
  group: HelpGroup;
  title: string;
  summary: string;
  /** The paragraphs of the text (apart by an empty line), or none when the topic only has its sentence. */
  body: string[];
  keywords: string;
  /** Topics to look at next (ids that exist). */
  see: string[];
}

/** The topics that are not an action. */
export const CONCEPTS = ['concept.overview', 'concept.selection', 'concept.feature-tree', 'concept.property-manager', 'concept.sketch-snaps', 'concept.drawing-dimensions'] as const;

/** The tab (a group of actions) a topic is listed under in the contents, as the command bar names it. */
export const GROUP_TITLE: Record<HelpGroup, () => string> = {
  concept: () => t('help.group.concept'),
  file: () => t('tab.file'),
  edit: () => t('tab.features'),
  feature: () => t('tab.features'),
  sheet: () => t('tab.sheet'),
  sketch: () => t('tab.sketch'),
  'sketch-tool': () => t('tab.sketch'),
  assembly: () => t('tab.assembly'),
  view: () => t('tab.view'),
  tools: () => t('tab.tools'),
};

/** The catalog key of a topic's text: `extrude-cut` and `summary` make `help.extrudeCut.summary` (a key is words joined without a dash, see the i18n test). */
export const helpKey = (id: string, part: 'summary' | 'body' | 'title' | 'keywords' | 'see'): string =>
  `help.${id
    .split(/[-.]/)
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('')}.${part}`;

const text = (id: string, part: 'summary' | 'body' | 'title' | 'keywords' | 'see'): string | undefined => textOf(helpKey(id, part));

/** The topic with this id, or null when it is neither an action nor a concept. */
export function helpTopic(id: string, actions: readonly ActionLike[]): HelpTopic | null {
  const action = actions.find((a) => a.id === id);
  const concept = (CONCEPTS as readonly string[]).includes(id);
  if (!action && !concept) return null;
  const body = text(id, 'body');
  return {
    id,
    group: action ? action.group : 'concept',
    title: action ? action.label : (text(id, 'title') ?? id),
    summary: text(id, 'summary') ?? '',
    body: body ? body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== '') : [],
    keywords: text(id, 'keywords') ?? '',
    see: (text(id, 'see') ?? '').split(/\s+/).filter((x) => x !== '' && (actions.some((a) => a.id === x) || (CONCEPTS as readonly string[]).includes(x))),
  };
}

/** Every topic: the concepts first, then the actions in the order of the registry. */
export function allTopics(actions: readonly ActionLike[]): HelpTopic[] {
  const seen = new Set<string>();
  const ids = [...CONCEPTS, ...actions.map((a) => a.id)].filter((id) => !seen.has(id) && !!seen.add(id));
  return ids.flatMap((id) => {
    const topic = helpTopic(id, actions);
    return topic ? [topic] : [];
  });
}

/** The words of a query (apart by spaces); a topic has to have all of them. */
const words = (query: string): string[] => query.toLowerCase().split(/\s+/).filter((w) => w !== '');

/**
 * The topics a query finds, best first: a word in the title counts most, then the keywords and the sentence, then the text.
 * Not case sensitive; every word must be somewhere in the topic; an empty query finds nothing.
 */
export function searchTopics(topics: readonly HelpTopic[], query: string): HelpTopic[] {
  const ws = words(query);
  if (ws.length === 0) return [];
  const scored = topics.flatMap((topic, order) => {
    const parts = { title: topic.title.toLowerCase(), keywords: topic.keywords.toLowerCase(), summary: topic.summary.toLowerCase(), body: topic.body.join('\n').toLowerCase() };
    let score = 0;
    for (const w of ws) {
      const here = (parts.title.includes(w) ? 8 : 0) + (parts.keywords.includes(w) ? 4 : 0) + (parts.summary.includes(w) ? 3 : 0) + (parts.body.includes(w) ? 1 : 0);
      if (here === 0) return [];
      score += here;
    }
    return [{ topic, score, order }];
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.topic);
}

/** The topics grouped as the contents shows them, in the order of the groups. */
export function contents(topics: readonly HelpTopic[]): { group: HelpGroup; title: string; topics: HelpTopic[] }[] {
  const order: HelpGroup[] = ['concept', 'file', 'feature', 'sheet', 'sketch', 'tools', 'assembly', 'view'];
  const merged = (g: HelpGroup): HelpGroup => (g === 'sketch-tool' ? 'sketch' : g === 'edit' ? 'feature' : g);
  return order.flatMap((group) => {
    const list = topics.filter((x) => merged(x.group) === group);
    return list.length > 0 ? [{ group, title: GROUP_TITLE[group](), topics: list }] : [];
  });
}

/** What the program is doing, as far as the help cares. */
export interface HelpContext {
  /** The sketch tool in use (a drawing tool, not 「選取」), when a sketch is edited. */
  sketchTool?: string | null;
  /** Whether a sketch is being edited. */
  sketching?: boolean;
  /** The feature a PropertyManager is open on. */
  feature?: { type: string; op?: string; patternKind?: string } | null;
  /** What an assembly is busy with. */
  assembly?: 'insert' | 'mate' | 'move' | 'pattern' | 'explode' | null;
  /** The analysis or check that is on. */
  analysis?: 'measure' | 'draft' | 'undercut' | 'thickness' | 'check' | 'interference' | 'clearance' | null;
  active?: 'part' | 'assembly' | 'drawing';
}

/** The action a feature of this type is made with. */
const FEATURE_ACTION: Record<string, string> = {
  sketch: 'sketch',
  fillet: 'fillet',
  chamfer: 'chamfer',
  refPlane: 'ref-plane',
  refAxis: 'ref-axis',
  refPoint: 'ref-point',
  coordSys: 'coord-sys',
  importedBody: 'import-step',
  deleteFace: 'delete-face',
  offsetSurface: 'offset-surface',
  splitLine: 'split-line',
  knit: 'knit',
  fillSurface: 'fill-surface',
  flatSurface: 'flat-surface',
  trimSurface: 'trim-surface',
  mutualTrim: 'mutual-trim',
  extendSurface: 'extend-surface',
  thicken: 'thicken',
  cutWithSurface: 'cut-with-surface',
  lipGroove: 'lip-groove',
  screwBoss: 'screw-boss',
  baseFlange: 'base-flange',
  midBend: 'mid-bend',
  edgeFlange: 'edge-flange',
  hem: 'hem',
  breakCorner: 'break-corner',
  snapHook: 'snap-hook',
  snapCatch: 'snap-catch',
  vent: 'vent',
  shell: 'shell',
  rib: 'rib',
  mirror: 'mirror',
  hole: 'hole',
  draft: 'draft',
  moveFace: 'move-face',
  combine: 'combine',
  thread: 'thread',
};

/** The topic for what is going on now: the tool in use, else the feature open, else the sketch, else the start. */
export function contextTopic(c: HelpContext): string {
  if (c.analysis === 'measure') return c.active === 'assembly' ? 'measure-assembly' : 'measure-part';
  if (c.analysis === 'draft') return 'draft-analysis';
  if (c.analysis === 'undercut') return 'undercut-analysis';
  if (c.analysis === 'thickness') return 'thickness-analysis';
  if (c.analysis === 'check') return c.active === 'assembly' ? 'check-assembly' : 'check-part';
  if (c.analysis === 'interference') return 'interference';
  if (c.analysis === 'clearance') return 'clearance';
  if (c.sketching) return c.sketchTool && c.sketchTool !== 'select' ? `tool-${c.sketchTool}` : 'sketch';
  if (c.feature) {
    const f = c.feature;
    const cut = f.op === 'cut';
    if (f.type === 'extrude') return cut ? 'extrude-cut' : 'extrude';
    if (f.type === 'revolve') return cut ? 'revolve-cut' : 'revolve';
    if (f.type === 'sweep') return cut ? 'sweep-cut' : 'sweep';
    if (f.type === 'loft') return cut ? 'loft-cut' : 'loft';
    if (f.type === 'pattern') return f.patternKind === 'circular' ? 'circular-pattern' : 'linear-pattern';
    const action = FEATURE_ACTION[f.type];
    if (action) return action;
  }
  if (c.assembly === 'insert') return 'insert-component';
  if (c.assembly === 'mate') return 'mate';
  if (c.assembly === 'move') return 'move-component';
  if (c.assembly === 'pattern') return 'pattern-linear';
  if (c.assembly === 'explode') return 'explode';
  return 'concept.overview';
}

/** A button's tooltip: its name and shortcut, the sentence about it, and where to read more. */
export function tooltipOf(topic: Pick<HelpTopic, 'title' | 'summary'>, shortcut?: string): string {
  const head = shortcut ? `${topic.title} (${shortcut})` : topic.title;
  return topic.summary ? `${head}\n${topic.summary}\n${t('helpui.pressF1')}` : head;
}
