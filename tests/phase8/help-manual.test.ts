/**
 * H-C (docs/help-plan.md): the manual of verification shows, at each item, the help topics it verifies (docs/help-links.json), by the names the program shows,
 * so that whoever finds a fault in an item knows which help text to correct with it. The lines are written into the manual by
 *
 *   SYNC_MANUAL_HELP=1 npx vitest run tests/phase8/help-manual.test.ts
 *
 * and this test fails when the manual and the links do not say the same.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { zhTW } from '@3db/i18n';
import { CONCEPTS, helpKey } from '../../apps/web/src/help/topics';

const root = new URL('../../', import.meta.url);
const links = JSON.parse(readFileSync(new URL('docs/help-links.json', root), 'utf8')) as Record<string, string[] | Record<string, string>>;
const actions = readFileSync(new URL('apps/web/src/actions.ts', root), 'utf8');
const catalog = zhTW as Record<string, string>;

/** The actions whose label the program picks at the moment (the right button says hide or show), so it shows one of these two names. */
const RUNTIME_LABELS: Record<string, [string, string]> = {
  'toggle-visibility': ['tree.hide', 'tree.show'],
  'hide-component': ['subassembly.hide', 'subassembly.show'],
  'transparent-component': ['subassembly.transparent', 'subassembly.opaque'],
  'suppress-component': ['tree.suppress', 'tree.unsuppress'],
};

/** The name the program shows for a topic: the label of the action (or the sketch tool), or the title of the concept. */
function nameOf(id: string): string {
  if ((CONCEPTS as readonly string[]).includes(id)) return catalog[helpKey(id, 'title')] ?? id;
  const runtime = RUNTIME_LABELS[id];
  if (runtime) return runtime.map((k) => catalog[k] ?? id).join('／');
  const own = new RegExp(String.raw`id: '${id}',\s*get label\(\)\s*\{\s*return t\('([\w.]+)'\)`).exec(actions);
  if (own) return catalog[own[1]!] ?? id;
  if (id.startsWith('tool-')) return catalog[`tool.${id.slice(5)}`] ?? id;
  return id;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const lineOf = (ids: string[]) => `<p class="why helpref"><b>程式內的說明（按 F1，或功能列最右的「說明」搜尋）：</b>${[...new Set(ids.map((id) => escape(nameOf(id))))].join('、')}。這一項驗出問題、修好時，這些說明也要一起改。</p>`;

function synced(manual: string): string {
  let out = manual.replace(/<p class="why helpref">.*?<\/p>\n?/g, '');
  for (const [item, ids] of Object.entries(links)) {
    if (item.startsWith('_') || !Array.isArray(ids) || ids.length === 0) continue;
    const at = out.indexOf(`data-id="${item}"`);
    expect(at, `item ${item} is in the manual`).toBeGreaterThan(-1);
    const why = out.indexOf('<p class="why">', at);
    const end = out.indexOf('</p>', why) + 4;
    out = `${out.slice(0, end)}\n${lineOf(ids)}${out.slice(end)}`;
  }
  return out;
}

describe('the manual of verification shows the help topics of its items', () => {
  const path = new URL('docs/manual-verification.html', root);
  const manual = readFileSync(path, 'utf8');

  it('names every linked topic by something the program shows (not by its id)', () => {
    const ids = Object.entries(links).filter(([k]) => !k.startsWith('_')).flatMap(([, v]) => v as string[]);
    expect(ids.filter((id) => nameOf(id) === id)).toEqual([]);
    expect(Object.keys(RUNTIME_LABELS).filter((id) => !actions.includes(`id: '${id}'`))).toEqual([]); // the ones whose label is picked at the moment are still actions
    expect(Object.values(RUNTIME_LABELS).flat().filter((k) => catalog[k] === undefined)).toEqual([]);
  });

  it('says what the links say', () => {
    const want = synced(manual);
    if (process.env.SYNC_MANUAL_HELP) {
      writeFileSync(path, want);
      return;
    }
    expect(manual === want, 'the manual is out of line with docs/help-links.json: SYNC_MANUAL_HELP=1 npx vitest run tests/phase8/help-manual.test.ts').toBe(true);
  });
});
