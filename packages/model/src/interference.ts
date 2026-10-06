import type { Leaf } from './assemblyTree';
import type { Pose } from './schema';

/**
 * Interference (E2.1): which parts are compared with which. The unit is the component the user sees in the tree: a sub-assembly counts as one (the parts
 * inside it are not compared with each other), and every instance of a pattern and every mirror copy is a component of its own, apart from its seed.
 */
export interface InterferenceGroup {
  /** The component's id, for an instance of a pattern or mirror the id of its seed followed by what makes it ("comp2@pat1#2"). */
  id: string;
  /** The component of the assembly it is (or, for an instance, the seed's). */
  top: string;
  /** What makes it, when it is an instance: the pattern or mirror, and the number of the instance in a pattern (null for a mirror). */
  instance: { pattern: string; label: string | null } | null;
  leaves: Leaf[];
}

/**
 * The leaves as the components they make up, in the order they first appear. With `parts` every leaf is a component of its own (the parts inside a
 * sub-assembly are compared with each other too); its `top` still says which component of the assembly it is in.
 */
export function interferenceGroups(leaves: readonly Leaf[], options: { parts?: boolean } = {}): InterferenceGroup[] {
  const out = new Map<string, InterferenceGroup>();
  for (const l of leaves) {
    let id = options.parts ? l.id : l.top;
    let instance: InterferenceGroup['instance'] = null;
    if (l.instanceOf) {
      // the id of an instance's leaf is the seed's leaf id, "@", the pattern, and for a pattern "#" and the number of the instance
      const rest = l.id.slice(l.id.indexOf('@') + 1);
      const hash = rest.indexOf('#');
      id = options.parts ? l.id : `${l.top}@${rest}`;
      instance = { pattern: l.instanceOf, label: hash < 0 ? null : rest.slice(hash + 1) };
    }
    const group = out.get(id) ?? { id, top: l.top, instance, leaves: [] };
    group.leaves.push(l);
    out.set(id, group);
  }
  return [...out.values()];
}

/** A part of a component as the worker is asked about it: the part's file by its key (a mirror: the file's own, with `mirrored`) and where it is. */
export interface InterferencePart {
  part: string;
  mirrored: boolean;
  pose: Pose;
}

export interface InterferenceComponent {
  id: string;
  parts: InterferencePart[];
}

/** The part of a leaf that is asked about: a mirror copy is the file's part (its key without the mirror's suffix) reflected. */
export const interferencePart = (leaf: Leaf, unmirror: (key: string) => string): InterferencePart => ({ part: leaf.mirrored ? unmirror(leaf.key) : leaf.key, mirrored: !!leaf.mirrored, pose: leaf.pose });

/** The smallest overlap that is reported, mm³: below it two parts are only touching (the kernel's tolerance gives a touching pair a sliver of volume). */
export const MIN_INTERFERENCE_VOLUME = 1e-3;
