import { t } from '@3db/i18n';
import { baseName } from './paths';
import { componentPatternLabels, componentPatternProblem } from './componentPatterns';
import type { SourceTree } from './assemblyTree';
import type { Id } from './ids';
import type { AssemblyDoc } from './schema';

/**
 * The parts list of an assembly (C15.16): what the assembly is made of, counted. Derived from the document and the files it uses, never stored.
 * Suppressed components are not in it (they are left out of the assembly, C15.5); hidden ones are (they are in it, only not drawn); the instances of
 * a pattern count as the parts they are, and a mirrored component is a part of its own, the mirror of its part (C15.13).
 */

/** One line of the parts list. */
export interface BomRow {
  /** "1", "2" … in the flat list; "1", "1.1", "1.2" … in the indented one. */
  item: string;
  /** 0 for the top; the indented list goes one deeper for what is inside a sub-assembly. */
  level: number;
  kind: 'part' | 'assembly';
  /** The file's name without its extension (and the mirror suffix for a mirror). */
  name: string;
  /** The file in the project folder. */
  path: string;
  /** How many: all together in the flat list, in one of its parent in the indented one. */
  qty: number;
  mirrored: boolean;
  vendor: string;
  partNo: string;
  /** Every property of the part's file, for the columns beyond these. */
  properties: Record<string, string>;
}

/** The names a part's vendor and part number go by in the file properties (B8.3): in either language. */
export const BOM_VENDOR_NAMES = [String.fromCharCode(0x5ee0, 0x5546), 'Vendor', 'Manufacturer']; // the Chinese name is written as character codes: it is a name in the data, not text of the app
export const BOM_PART_NO_NAMES = [String.fromCharCode(0x6599, 0x865f), 'Part Number', 'PartNo'];

const pick = (props: Record<string, string>, names: readonly string[]): string => {
  for (const n of names) {
    const v = Object.entries(props).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1];
    if (v !== undefined) return v.trim();
  }
  return '';
};

/** The name of a file as a parts list shows it: without folders and extension. */
export const bomName = (path: string): string => baseName(path).replace(/\.(3dbx|3dba|3db\.json|json|step|stp)$/i, '');

export interface BomInput {
  doc: AssemblyDoc;
  /** What each component is (as the worker is told, with file paths); components not read have no entry and are not counted. */
  trees: Readonly<Record<Id, SourceTree>>;
  /** The properties of a part, by its content key (null: not known). */
  propsOf: (key: string) => Record<string, string> | undefined;
  /** Whether a part (by its content key) is only reference bodies (C7.1): a design aid such as the workpiece, which is not a part to buy or make and is left out of the list. */
  isReference?: (key: string) => boolean;
  /** Patterns that have no instances because of a problem (`patternProblems`): they add nothing to the count. */
  problems?: ReadonlyMap<Id, string>;
}

/** How many of a component there are at the top (the seed and the instances of its patterns), and how many mirrors of it. */
function copies(input: BomInput, seed: Id): { plain: number; mirrors: number } {
  let plain = 1;
  let mirrors = 0;
  for (const p of input.doc.patterns ?? []) {
    if (p.seed !== seed || input.problems?.has(p.id) || componentPatternProblem(p)) continue;
    if (p.kind === 'mirror') mirrors += 1;
    else plain += componentPatternLabels(p).length - (p.skip?.length ?? 0);
  }
  return { plain, mirrors };
}

interface Counted {
  tree: SourceTree;
  mirrored: boolean;
  qty: number;
}

/** What a document's components are, counted by file (and by mirror): in the order they first appear. */
function group(components: AssemblyDoc['components'], trees: Readonly<Record<Id, SourceTree>>, times: (id: Id) => { plain: number; mirrors: number }, skip?: (tree: SourceTree) => boolean): Counted[] {
  const out = new Map<string, Counted>();
  const add = (tree: SourceTree, mirrored: boolean, qty: number) => {
    if (qty <= 0 || skip?.(tree)) return;
    const key = `${tree.path ?? (tree.kind === 'part' ? tree.key : '')}|${mirrored}`;
    const known = out.get(key);
    if (known) known.qty += qty;
    else out.set(key, { tree, mirrored, qty });
  };
  for (const c of components) {
    const tree = trees[c.id];
    if (c.suppressed || !tree) continue;
    const n = times(c.id);
    add(tree, false, n.plain);
    add(tree, true, n.mirrors);
  }
  return [...out.values()];
}

/** The parts list, flat (every part once, however many times it is used, in any assembly) and indented (a sub-assembly with what is in it). */
export function buildBom(input: BomInput): { flat: BomRow[]; indented: BomRow[] } {
  const skip = (tree: SourceTree) => tree.kind === 'part' && input.isReference?.(tree.key) === true;
  const rowOf = (tree: SourceTree, mirrored: boolean, qty: number, item: string, level: number): BomRow => {
    const path = tree.path ?? '';
    const props = tree.kind === 'part' ? (input.propsOf(tree.key) ?? {}) : tree.doc.properties;
    const name = bomName(path) || (tree.kind === 'part' ? tree.key.slice(0, 8) : '');
    return {
      item,
      level,
      kind: tree.kind,
      name: mirrored ? `${name}${t('pattern.mirrorSuffix')}` : name,
      path,
      qty,
      mirrored,
      vendor: pick(props, BOM_VENDOR_NAMES),
      partNo: pick(props, BOM_PART_NO_NAMES),
      properties: { ...props },
    };
  };

  // Flat: parts only, counted through the sub-assemblies (a sub-assembly used three times with two pins has six).
  const flat = new Map<string, { tree: SourceTree; mirrored: boolean; qty: number }>();
  const spread = (list: Counted[], factor: number) => {
    for (const c of list) {
      if (c.tree.kind === 'part') {
        const key = `${c.tree.path ?? c.tree.key}|${c.mirrored}`;
        const known = flat.get(key);
        if (known) known.qty += c.qty * factor;
        else flat.set(key, { tree: c.tree, mirrored: c.mirrored, qty: c.qty * factor });
      } else {
        // what is inside counts once for each use; a mirrored sub-assembly is made of mirrored parts
        const inside = group(c.tree.doc.components, c.tree.children, () => ({ plain: 1, mirrors: 0 }), skip);
        spread(inside.map((i) => ({ ...i, mirrored: i.mirrored || c.mirrored })), c.qty * factor);
      }
    }
  };
  spread(group(input.doc.components, input.trees, (id) => copies(input, id), skip), 1);
  const flatRows = [...flat.values()].map((f, i) => rowOf(f.tree, f.mirrored, f.qty, String(i + 1), 0));

  // Indented: each sub-assembly once with its own, per use.
  const down = (list: Counted[], prefix: string, level: number): BomRow[] =>
    list.flatMap((c, i) => {
      const item = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const row = rowOf(c.tree, c.mirrored, c.qty, item, level);
      if (c.tree.kind !== 'assembly') return [row];
      const inside = group(c.tree.doc.components, c.tree.children, () => ({ plain: 1, mirrors: 0 }), skip).map((x) => ({ ...x, mirrored: x.mirrored || c.mirrored }));
      return [row, ...down(inside, item, level + 1)];
    });
  const indented = down(group(input.doc.components, input.trees, (id) => copies(input, id), skip), '', 0);
  return { flat: flatRows, indented };
}
