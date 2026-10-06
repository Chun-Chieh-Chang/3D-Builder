/**
 * The help (docs/help-plan.md): every action and sketch tool has its sentence in the catalog, the catalog has nothing for what is not there, and the
 * four ways in (tooltip, help window, F1, 這是什麼？) read the same words from the same place.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { en, registerTranslation, setLocale, zhTW } from '@3db/i18n';
import { installHelp, topicAt, type HelpDeps } from '../../apps/web/src/help/install';
import { closeHelp, goBack, helpState, openHelp, resetHelp, setPicking, setQuery, showContents, showTopic } from '../../apps/web/src/help/state';
import { CONCEPTS, allTopics, contents, contextTopic, helpKey, helpTopic, searchTopics, tooltipOf, type ActionLike } from '../../apps/web/src/help/topics';

const source = readFileSync(new URL('../../apps/web/src/actions.ts', import.meta.url), 'utf8');
/** The ids of the action registry: the ones written out, and `tool-<tool>` for each sketch tool. */
function actionIds(): string[] {
  const written = [...source.matchAll(/\bid: '([a-z0-9-]+)'/g)].map((m) => m[1]!);
  const tools = /const SKETCH_TOOLS: ToolId\[\] = \[([^\]]*)\]/.exec(source)![1]!.match(/'(\w+)'/g)!.map((x) => `tool-${x.slice(1, -1)}`);
  return [...new Set([...written, ...tools])];
}
const IDS = actionIds();

const catalogKeys = Object.keys(zhTW).filter((k) => k.startsWith('help.') && !k.startsWith('help.group.'));
type Part = 'summary' | 'body' | 'title' | 'keywords' | 'see';
const PARTS: Part[] = ['summary', 'body', 'title', 'keywords', 'see'];
/** Which topic and part a key is for, among the topics there are. */
const KNOWN = [...IDS, ...CONCEPTS];
const parts = (key: string) => {
  for (const id of KNOWN) for (const part of PARTS) if (helpKey(id, part) === key) return { id, part };
  return null;
};
const has = (id: string, part: Part) => helpKey(id, part) in zhTW;
const textIn = (id: string, part: Part) => (zhTW as Record<string, string>)[helpKey(id, part)]!;

describe('the help covers what is there (a command added without its help does not pass)', () => {
  it('reads the registry: tens of actions and the sketch tools', () => {
    expect(IDS.length).toBeGreaterThan(100);
    expect(IDS).toContain('extrude');
    expect(IDS).toContain('tool-line');
    expect(IDS).toContain('tool-pierce');
  });

  it('has a sentence for every action and every sketch tool', () => {
    const missing = IDS.filter((id) => !has(id, 'summary'));
    expect(missing).toEqual([]);
  });

  it('has a title and a sentence for every concept', () => {
    for (const id of CONCEPTS) {
      expect(has(id, 'title'), id).toBe(true);
      expect(has(id, 'summary'), id).toBe(true);
    }
  });

  it('has nothing for a topic that is not there: every key belongs to an action, a tool or a concept', () => {
    expect(catalogKeys.filter((k) => parts(k) === null)).toEqual([]);
  });

  it('gives each topic a key of its own (two ids never make the same words)', () => {
    const keys = KNOWN.map((id) => helpKey(id, 'summary'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps a title only on a concept: an action is called what its button says', () => {
    const titled = catalogKeys.filter((k) => parts(k)?.part === 'title').map((k) => parts(k)!.id);
    expect(titled.every((id) => (CONCEPTS as readonly string[]).includes(id))).toBe(true);
  });

  it('points only to topics that exist', () => {
    const known = new Set<string>([...IDS, ...CONCEPTS]);
    for (const k of catalogKeys.filter((x) => parts(x)?.part === 'see')) {
      for (const id of (zhTW as Record<string, string>)[k]!.split(/\s+/).filter(Boolean)) expect(known.has(id), `${k} -> ${id}`).toBe(true);
    }
  });

  it('says each thing in one line: a sentence has no line break and is not long', () => {
    for (const k of catalogKeys.filter((x) => parts(x)?.part === 'summary')) {
      const s = (zhTW as Record<string, string>)[k]!;
      expect(s.includes('\n'), k).toBe(false);
      expect(s.length, k).toBeLessThanOrEqual(80);
    }
  });
});

/** A small registry to try the help on (the real one needs the whole app). */
const ACTIONS: ActionLike[] = [
  { id: 'extrude', label: '伸長填料/基材', group: 'feature' },
  { id: 'fit', label: '全部顯示', group: 'view' },
  { id: 'tool-line', label: '直線', group: 'sketch-tool' },
  { id: 'sketch', label: '草圖', group: 'sketch' },
  { id: 'shell', label: '薄殼', group: 'feature' },
  { id: 'undo', label: '復原', group: 'edit' },
];

describe('topics', () => {
  it('take the title from the action and the texts from the catalog', () => {
    const t = helpTopic('extrude', ACTIONS)!;
    expect(t.title).toBe('伸長填料/基材');
    expect(t.summary).toBe(textIn('extrude', 'summary'));
    expect(t.body.length).toBeGreaterThan(1);
    expect(t.keywords).toContain('終止型態');
    expect(t.see).toEqual(expect.arrayContaining(['sketch']));
    expect(t.see).not.toContain('extrude-cut'); // not in this registry: left out rather than a dead link
  });

  it('give a concept its own title, and an action without a body no body', () => {
    expect(helpTopic('concept.sketch-snaps', ACTIONS)!.title).toBe('草圖的吸附與推斷');
    const fit = helpTopic('fit', ACTIONS)!;
    expect(fit.body).toEqual([]);
    expect(fit.summary).not.toBe('');
  });

  it('are not made for what is not an action or a concept', () => {
    expect(helpTopic('nonsense', ACTIONS)).toBeNull();
    expect(helpTopic('concept.nonsense', ACTIONS)).toBeNull();
  });

  it('list the concepts first, then the actions in order, once each', () => {
    const ids = allTopics(ACTIONS).map((t) => t.id);
    expect(ids.slice(0, CONCEPTS.length)).toEqual([...CONCEPTS]);
    expect(ids.slice(CONCEPTS.length)).toEqual(ACTIONS.map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('are grouped as the tabs are, the sketch tools with the sketch and edit with the features', () => {
    const groups = contents(allTopics(ACTIONS));
    expect(groups.map((g) => g.group)).toEqual(['concept', 'feature', 'sketch', 'view']);
    expect(groups.find((g) => g.group === 'sketch')!.topics.map((t) => t.id)).toEqual(['tool-line', 'sketch']);
    expect(groups.find((g) => g.group === 'feature')!.topics.map((t) => t.id)).toEqual(['extrude', 'shell', 'undo']);
  });
});

describe('search', () => {
  const topics = allTopics(ACTIONS);
  const ids = (q: string) => searchTopics(topics, q).map((t) => t.id);

  it('finds by the title, by the sentence, by a keyword and by the text', () => {
    expect(ids('薄殼')[0]).toBe('shell');
    expect(ids('挖空')).toContain('shell'); // in its sentence
    expect(ids('大過形狀')).toContain('shell'); // only in its text
  });

  it('finds by a keyword the title does not have', () => {
    expect(ids('終止型態')).toContain('extrude');
    expect(ids('抽殼')).toContain('shell');
  });

  it('wants every word of the query, in any order, not minding capitals', () => {
    expect(ids('直線 水平')).toContain('tool-line');
    expect(ids('水平 直線')).toContain('tool-line');
    expect(ids('直線 不存在的字')).toEqual([]);
    const upper = searchTopics(allTopics([{ id: 'fit', label: 'Zoom To Fit', group: 'view' }]), 'zoom to FIT');
    expect(upper.map((t) => t.id)).toEqual(['fit']);
  });

  it('puts a title match before a text match', () => {
    const r = ids('草圖');
    expect(r.indexOf('sketch')).toBeLessThan(r.indexOf('extrude')); // 草圖 is the title of one and only in the text of the other
  });

  it('finds nothing for nothing', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });
});

describe('what the help opens on (F1)', () => {
  it('is the sketch tool in use, else the sketch, else the feature, else the start', () => {
    expect(contextTopic({ sketching: true, sketchTool: 'line' })).toBe('tool-line');
    expect(contextTopic({ sketching: true, sketchTool: 'select' })).toBe('sketch');
    expect(contextTopic({ sketching: true, sketchTool: null })).toBe('sketch');
    expect(contextTopic({ feature: { type: 'shell' } })).toBe('shell');
    expect(contextTopic({})).toBe('concept.overview');
  });

  it('tells a cut from a boss, and a circular pattern from a linear one', () => {
    expect(contextTopic({ feature: { type: 'extrude', op: 'cut' } })).toBe('extrude-cut');
    expect(contextTopic({ feature: { type: 'extrude', op: 'boss' } })).toBe('extrude');
    expect(contextTopic({ feature: { type: 'sweep', op: 'cut' } })).toBe('sweep-cut');
    expect(contextTopic({ feature: { type: 'pattern', patternKind: 'circular' } })).toBe('circular-pattern');
    expect(contextTopic({ feature: { type: 'pattern', patternKind: 'linear' } })).toBe('linear-pattern');
  });

  it('follows an assembly in the middle of a command, and an analysis that is on', () => {
    expect(contextTopic({ assembly: 'mate' })).toBe('mate');
    expect(contextTopic({ assembly: 'explode' })).toBe('explode');
    expect(contextTopic({ analysis: 'draft' })).toBe('draft-analysis');
    expect(contextTopic({ analysis: 'measure', active: 'assembly' })).toBe('measure-assembly');
    expect(contextTopic({ analysis: 'measure', active: 'part' })).toBe('measure-part');
  });

  it('puts the tool before the analysis only when no analysis is on', () => {
    expect(contextTopic({ sketching: true, sketchTool: 'line', analysis: null })).toBe('tool-line');
  });

  it('has a topic in the real catalog for every thing a feature can be', () => {
    const types = ['sketch', 'fillet', 'chamfer', 'refPlane', 'refAxis', 'refPoint', 'coordSys', 'importedBody', 'deleteFace', 'offsetSurface', 'splitLine', 'knit', 'fillSurface', 'flatSurface', 'trimSurface', 'extendSurface', 'thicken', 'cutWithSurface', 'lipGroove', 'screwBoss', 'baseFlange', 'edgeFlange', 'hem', 'snapHook', 'snapCatch', 'vent', 'shell', 'rib', 'mirror', 'hole', 'draft', 'moveFace', 'combine', 'extrude', 'revolve', 'sweep', 'loft', 'pattern'];
    for (const type of types) {
      for (const op of ['boss', 'cut']) {
        const id = contextTopic({ feature: { type, op } });
        expect(IDS, `${type}/${op} -> ${id}`).toContain(id);
      }
    }
  });
});

afterEach(() => {
  setLocale('zh-TW');
  resetHelp();
});

describe('one source: the tooltip, the window and 這是什麼？ say what the catalog says', () => {
  it('follows a change of the sentence in all of them at once', () => {
    const a: ActionLike[] = [{ id: 'fit', label: 'Zoom To Fit', group: 'view' }];
    const before = helpTopic('fit', a)!;
    expect(tooltipOf(before, 'F')).toContain(textIn('fit', 'summary'));
    setLocale('en');
    registerTranslation('en', { [helpKey('fit', 'summary')]: 'Frames everything: zoomzoom.' } as never);
    const after = helpTopic('fit', a)!;
    expect(after.summary).toBe('Frames everything: zoomzoom.');
    expect(tooltipOf(after, 'F')).toContain('Frames everything: zoomzoom.');
    expect(tooltipOf(after, 'F')).not.toContain(textIn('fit', 'summary'));
    expect(searchTopics(allTopics(a), 'zoomzoom').map((t) => t.id)).toEqual(['fit']); // and the search finds by the new words
    registerTranslation('en', {});
  });

  it('puts the name, the key, the sentence and where to read more in a tooltip, in that order', () => {
    const tip = tooltipOf({ title: '復原', summary: '復原上一個修改。' }, 'Ctrl+Z');
    expect(tip.split('\n')).toEqual(['復原 (Ctrl+Z)', '復原上一個修改。', zhTW['helpui.pressF1']]);
    expect(tooltipOf({ title: '復原', summary: '' })).toBe('復原');
  });
});

/** A page to try F1 and 這是什麼？ on: events go to the handlers that were added, in the order they were. */
function fakePage() {
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  const classes = new Set<string>();
  const root = {
    body: { classList: { toggle: (n: string, on?: boolean) => void ((on ?? !classes.has(n)) ? classes.add(n) : classes.delete(n)), remove: (n: string) => void classes.delete(n) } },
    addEventListener: (type: string, fn: (e: unknown) => void) => void handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: (e: unknown) => void) => void handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== fn)),
  };
  const fire = (type: string, extra: Record<string, unknown> = {}) => {
    const e = { type, preventDefault: () => (e.prevented = true), stopPropagation: () => (e.stopped = true), prevented: false, stopped: false, ...extra };
    for (const h of handlers.get(type) ?? []) h(e);
    return e as { prevented: boolean; stopped: boolean };
  };
  return { root: root as unknown as Document, fire, classes, count: () => [...handlers.values()].reduce((n, l) => n + l.length, 0) };
}
/** An element that says what it is (`data-help`), inside the ancestors given. */
const element = (help: string | null, inside: string[] = []) => ({
  closest: (selector: string) => {
    if (selector === '[data-help]') return help === null ? null : { getAttribute: () => help };
    return inside.some((cls) => selector.includes(`.${cls}`)) ? { getAttribute: () => null } : null;
  },
});

describe('F1 and 這是什麼？', () => {
  const deps: HelpDeps = { currentTopic: () => 'tool-line', hasTopic: (id) => id !== 'nonsense' };

  it('opens the help on what is going on when F1 is pressed, and stops the browser from showing its own', () => {
    const page = fakePage();
    installHelp(deps, page.root);
    const e = page.fire('keydown', { key: 'F1' });
    expect(helpState()).toMatchObject({ open: true, topic: 'tool-line' });
    expect(e.prevented).toBe(true);
  });

  it('turns the next click into a question about what was clicked, and stops the click doing what it does', () => {
    const page = fakePage();
    installHelp(deps, page.root);
    setPicking(true);
    expect(page.classes.has('help-picking')).toBe(true);
    const down = page.fire('pointerdown', { target: element('extrude') });
    expect(down.stopped).toBe(true); // the press does not start anything either
    expect(helpState().open).toBe(false);
    const click = page.fire('click', { target: element('extrude') });
    expect(click.stopped).toBe(true);
    expect(click.prevented).toBe(true);
    expect(helpState()).toMatchObject({ open: true, topic: 'extrude', picking: false });
    expect(page.classes.has('help-picking')).toBe(false);
  });

  it('asks about the nearest thing that says what it is, and goes on asking when what was clicked says nothing', () => {
    const page = fakePage();
    installHelp(deps, page.root);
    setPicking(true);
    page.fire('click', { target: element(null) });
    expect(helpState()).toMatchObject({ open: false, picking: true });
    page.fire('click', { target: element('nonsense') });
    expect(helpState()).toMatchObject({ open: false, picking: true }); // a name that is not a topic is not one
    expect(topicAt(element('fit'), deps.hasTopic)).toBe('fit');
    expect(topicAt(null, deps.hasTopic)).toBeNull();
  });

  it('leaves the help window and its buttons working while 這是什麼？ is on', () => {
    const page = fakePage();
    installHelp(deps, page.root);
    setPicking(true);
    const e = page.fire('click', { target: element('extrude', ['help-panel']) });
    expect(e.stopped).toBe(false);
    expect(e.prevented).toBe(false);
    expect(helpState().picking).toBe(true);
  });

  it('does not touch a click when 這是什麼？ is off', () => {
    const page = fakePage();
    installHelp(deps, page.root);
    const e = page.fire('click', { target: element('extrude') });
    expect(e.stopped).toBe(false);
    expect(e.prevented).toBe(false);
    expect(helpState().open).toBe(false);
  });

  it('ends 這是什麼？ with Esc, once', () => {
    const page = fakePage();
    installHelp(deps, page.root);
    setPicking(true);
    const e = page.fire('keydown', { key: 'Escape' });
    expect(e.prevented).toBe(true);
    expect(helpState().picking).toBe(false);
    const again = page.fire('keydown', { key: 'Escape' });
    expect(again.prevented).toBe(false); // Esc belongs to everything else again
  });

  it('takes its listeners off again', () => {
    const page = fakePage();
    const off = installHelp(deps, page.root);
    expect(page.count()).toBeGreaterThan(5);
    off();
    expect(page.count()).toBe(0);
  });
});

describe('the texts (H-B)', () => {
  it('has a text of its own for at least 25 topics, in both languages, and the two say the same topics', () => {
    const own = (catalog: Record<string, string>) => Object.keys(catalog).filter((k) => k.startsWith('help.') && k.endsWith('.body')).sort();
    expect(own(zhTW as Record<string, string>).length).toBeGreaterThanOrEqual(25);
    expect(own(en as Record<string, string>)).toEqual(own(zhTW as Record<string, string>));
  });
});

describe('the window', () => {
  it('opens on a topic or on the contents, and closes', () => {
    openHelp('extrude');
    expect(helpState()).toMatchObject({ open: true, topic: 'extrude' });
    openHelp();
    expect(helpState().topic).toBeNull();
    closeHelp();
    expect(helpState().open).toBe(false);
  });

  it('remembers where a link came from, and goes back to it', () => {
    openHelp('extrude');
    showTopic('sketch');
    showTopic('tool-line');
    expect(helpState().back).toEqual(['sketch', 'extrude']);
    goBack();
    expect(helpState().topic).toBe('sketch');
    goBack();
    expect(helpState().topic).toBe('extrude');
    goBack();
    expect(helpState().topic).toBeNull();
  });

  it('shows the results of a query in place of a topic, and the contents when it is emptied', () => {
    openHelp('extrude');
    setQuery('草圖');
    expect(helpState().topic).toBeNull();
    expect(helpState().query).toBe('草圖');
    showContents();
    expect(helpState()).toMatchObject({ topic: null, query: '' });
  });
});

describe('the manual of verification points to the help (docs/help-links.json)', () => {
  const links = JSON.parse(readFileSync(new URL('../../docs/help-links.json', import.meta.url), 'utf8')) as Record<string, string[] | string>;
  const manual = readFileSync(new URL('../../docs/manual-verification.html', import.meta.url), 'utf8');
  const items = new Set([...manual.matchAll(/data-id="([A-Z]\d+)"/g)].map((m) => m[1]!));
  const entries = Object.entries(links).filter(([k]) => !k.startsWith('_')) as [string, string[]][];
  const known = new Set<string>([...IDS, ...CONCEPTS]);

  it('names items that are in the manual', () => {
    expect(entries.map(([k]) => k).filter((k) => !items.has(k))).toEqual([]);
  });

  it('names topics that exist', () => {
    const dead = entries.flatMap(([item, ids]) => ids.filter((id) => !known.has(id)).map((id) => `${item}: ${id}`));
    expect(dead).toEqual([]);
  });

  it('says why, for a topic it leaves out (and only for one that is there)', () => {
    const untied = Object.keys((links._untied ?? {}) as Record<string, string>);
    expect(untied.filter((id) => !known.has(id))).toEqual([]);
    const covered = new Set(entries.flatMap(([, ids]) => ids));
    expect(untied.filter((id) => covered.has(id))).toEqual([]); // no longer untied once an item has it
  });

  it('covers every topic that has a text of its own, so that a corrected item can be traced to it', () => {
    const covered = new Set([...entries.flatMap(([, ids]) => ids), ...Object.keys((links._untied ?? {}) as Record<string, string>)]); // _untied says why a topic has no item
    const withText = catalogKeys.filter((k) => parts(k)?.part === 'body').map((k) => parts(k)!.id);
    expect(withText.filter((id) => !covered.has(id))).toEqual([]);
  });
});
