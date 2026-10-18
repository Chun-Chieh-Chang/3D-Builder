import type { Fingerprint, MeasureElement, MeasureTarget, Ref } from '@3db/model';

/**
 * What is picked in a part with no session open (plan §2.2), as the PropertyManager sees it. The store keeps exactly one of these at a time — `select`
 * clears the face and the elements, `selectFace` and `selectElement` clear the tree item — but the pick is derived rather than trusted, so a future
 * caller that sets two of them still gets one answer, in the order the graphics area outranks the tree.
 */
export type PartSelection =
  | { kind: 'face'; ref: Ref }
  | { kind: 'elements'; refs: Ref[] }
  | { kind: 'feature'; id: string }
  | { kind: 'none' };

/** The one pick of `selected` (a tree item), `selectedFace` and `selectedElements`, in the order the store keeps them exclusive. */
export function partSelection(selected: string | null, selectedFace: Ref | null, selectedElements: readonly Ref[]): PartSelection {
  if (selectedFace) return { kind: 'face', ref: selectedFace };
  if (selectedElements.length > 0) return { kind: 'elements', refs: [...selectedElements] };
  if (selected) return { kind: 'feature', id: selected };
  return { kind: 'none' };
}

/**
 * A key that changes exactly when what the graphics area has picked changes: the face, or the list of edges and vertices. A tree click does not move
 * it, which is how the panel tells a pick in the view (that brings the properties forward) from a pick in the tree (that stays in the tree, plan §2.2).
 */
export function pickKey(selectedFace: Ref | null, selectedElements: readonly Ref[]): string {
  if (selectedFace) return `face:${selectedFace.name}`;
  return selectedElements.map((r) => `${r.kind}:${r.name}`).join(',');
}

/**
 * The elements of a rebuild as the UI holds them (the `RebuildPayload` columns a reference is resolved against): a persistent name for every face,
 * edge and vertex of the kernel's topology, in the mesh's own order, and the fingerprints that tell two elements with the same name apart.
 */
export interface ElementIndex {
  faceNames: readonly string[];
  edgeNames: readonly string[];
  vertexNames: readonly string[];
  faceFingerprints?: readonly (Fingerprint | undefined)[];
  edgeFingerprints?: readonly (Fingerprint | undefined)[];
  vertexFingerprints?: readonly (Fingerprint | undefined)[];
}

/** Whether two fingerprints say the same element: the same kind of surface, the same size, the same place. Absent fingerprints cannot be compared. */
export function sameFingerprint(a: Fingerprint | undefined, b: Fingerprint | undefined): boolean {
  if (!a || !b) return false;
  return a.type === b.type && Math.abs(a.size - b.size) < 1e-6 && a.center.every((v, i) => Math.abs(v - (b.center[i] ?? NaN)) < 1e-6);
}

/**
 * The element's number in the order of the kernel's topology (what the mesh's face, edge and vertex numbers are), or null when the model cannot point
 * at it: the name is gone, or it fits more than one element and none of them carries the fingerprint the reference was picked with. A name that fits
 * exactly one element answers for it — persistent names are unique for all but a handful of shapes, and the fingerprint settles those.
 */
export function elementIndexOf(ref: Ref, names: ElementIndex): number | null {
  const list = ref.kind === 'face' ? names.faceNames : ref.kind === 'edge' ? names.edgeNames : ref.kind === 'vertex' ? names.vertexNames : null;
  if (!list) return null;
  const at: number[] = [];
  list.forEach((name, i) => {
    if (name === ref.name) at.push(i);
  });
  if (at.length === 0) return null;
  if (at.length === 1) return at[0]!;
  const prints = ref.kind === 'face' ? names.faceFingerprints : ref.kind === 'edge' ? names.edgeFingerprints : names.vertexFingerprints;
  const printed = prints && at.filter((i) => sameFingerprint(ref.fingerprint, prints[i]));
  if (printed && printed.length === 1) return printed[0]!;
  return null;
}

/**
 * The picked elements as the kernel is asked about them (the measure tool's own request shape: the open part, measured as it is). Elements whose name
 * the model no longer answers for are named back instead of guessed at, so the panel can say so rather than show another element's numbers. `keys`
 * holds the persistent names of the elements that were asked about, in the same order as `targets` (and so as the answer's `elements`), which is how
 * the panel pairs a measurement with the element it belongs to.
 */
export function measureTargetsOf(refs: readonly Ref[], names: ElementIndex): { targets: MeasureTarget[]; unresolved: string[]; keys: string[] } {
  const targets: MeasureTarget[] = [];
  const unresolved: string[] = [];
  const keys: string[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'face' && ref.kind !== 'edge' && ref.kind !== 'vertex') {
      // a datum or a body is the tree's to show, not the kernel's to measure (the viewport never picks one here)
      unresolved.push(ref.name);
      continue;
    }
    const index = elementIndexOf(ref, names);
    if (index === null) unresolved.push(ref.name);
    else {
      targets.push({ part: null, mirrored: false, pose: null, kind: ref.kind, index });
      keys.push(ref.name);
    }
  }
  return { targets, unresolved, keys };
}

/** What the panel shows for the current pick, once the kernel has answered: the elements in the order they were picked, or why it could not. */
export interface SelectionFacts {
  /** The pick this is about (`pickKey`): a late answer for an older pick is dropped. */
  key: string;
  /** The persistent names of `elements`, in the same order (the ones the kernel answered for). */
  keys: string[];
  elements: MeasureElement[];
  unresolved: string[];
  error: string | null;
}
