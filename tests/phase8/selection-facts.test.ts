import { describe, expect, it } from 'vitest';
import { elementIndexOf, measureTargetsOf, partSelection, pickKey, sameFingerprint } from '../../apps/web/src/state/selectionFacts';
import type { Fingerprint, Ref } from '@3db/model';

// The rules behind the selection panel's pick (E1 §2.2). They live in a plain module, not in the component, so they can be exercised here: this
// project's vitest runs in `node` and mounts no DOM.
const face = (name: string, fingerprint?: Fingerprint): Ref => ({ kind: 'face', name, ...(fingerprint ? { fingerprint } : {}) });
const edge = (name: string): Ref => ({ kind: 'edge', name });

describe('the pick the panel is about (E1 §2.2)', () => {
  it('keeps the one pick the store keeps exclusive, in the order the graphics area outranks the tree', () => {
    expect(partSelection('f1', null, [])).toEqual({ kind: 'feature', id: 'f1' });
    expect(partSelection('f1', face('a:1'), [])).toEqual({ kind: 'face', ref: face('a:1') });
    expect(partSelection('f1', null, [edge('a:2')])).toEqual({ kind: 'elements', refs: [edge('a:2')] });
    expect(partSelection('f1', face('a:1'), [edge('a:2')])).toEqual({ kind: 'face', ref: face('a:1') });
    expect(partSelection(null, null, [])).toEqual({ kind: 'none' });
  });

  it('moves the key for a pick in the view, and not for a pick in the tree', () => {
    expect(pickKey(null, [])).toBe('');
    expect(pickKey(face('a:1'), [])).toBe('face:a:1');
    expect(pickKey(null, [edge('a:2'), edge('a:3')])).toBe('edge:a:2,edge:a:3');
    // a tree click changes none of these: the panel tells the two apart by this key
    expect(pickKey(null, [])).toBe('');
  });
});

describe('resolving a picked reference against the model', () => {
  const names = {
    faceNames: ['a:1', 'a:2', 'b:1'],
    edgeNames: ['a:1', 'a:2'],
    vertexNames: ['a:1'],
  };

  it('answers for a name that fits exactly one element', () => {
    expect(elementIndexOf(face('a:2'), names)).toBe(1);
    expect(elementIndexOf(edge('a:2'), names)).toBe(1);
    expect(elementIndexOf({ kind: 'vertex', name: 'a:1' }, names)).toBe(0);
  });

  it('says nothing for a name the model no longer has', () => {
    expect(elementIndexOf(face('gone'), names)).toBeNull();
    expect(elementIndexOf({ kind: 'vertex', name: 'a:2' }, names)).toBeNull();
  });

  it('will not guess which element a repeated name is: the fingerprint settles it, or nothing is answered', () => {
    const twice = {
      faceNames: ['a:1', 'a:1'],
      faceFingerprints: [
        { type: 'plane', size: 100, center: [0, 0, 0] as [number, number, number] },
        { type: 'plane', size: 200, center: [10, 0, 0] as [number, number, number] },
      ],
      edgeNames: [] as string[],
      vertexNames: [] as string[],
    };
    const second = { type: 'plane', size: 200, center: [10, 0, 0] as [number, number, number] };
    expect(elementIndexOf(face('a:1'), twice)).toBeNull(); // no fingerprint on the reference: cannot be told apart
    expect(elementIndexOf(face('a:1', second), twice)).toBe(1);
    expect(elementIndexOf(face('a:1', { type: 'plane', size: 999, center: [0, 0, 0] }), twice)).toBeNull();
  });

  it('compares fingerprints by kind, size and place', () => {
    const a: Fingerprint = { type: 'cylinder', size: 50, center: [1, 2, 3] };
    expect(sameFingerprint(a, { type: 'cylinder', size: 50, center: [1, 2, 3] })).toBe(true);
    expect(sameFingerprint(a, { type: 'plane', size: 50, center: [1, 2, 3] })).toBe(false);
    expect(sameFingerprint(a, { type: 'cylinder', size: 50.5, center: [1, 2, 3] })).toBe(false);
    expect(sameFingerprint(a, { type: 'cylinder', size: 50, center: [1, 2, 4] })).toBe(false);
    expect(sameFingerprint(a, undefined)).toBe(false);
  });
});

describe('asking the kernel about the pick', () => {
  const names = { faceNames: ['a:1', 'a:2'], edgeNames: ['b:1'], vertexNames: ['c:1'] };

  it('asks for the open part, measured as it is, in the order picked', () => {
    const { targets, keys, unresolved } = measureTargetsOf([edge('b:1'), face('a:2')], names);
    expect(targets).toEqual([
      { part: null, mirrored: false, pose: null, kind: 'edge', index: 0 },
      { part: null, mirrored: false, pose: null, kind: 'face', index: 1 },
    ]);
    expect(keys).toEqual(['b:1', 'a:2']);
    expect(unresolved).toEqual([]);
  });

  it('names back the elements the model no longer has, and asks about the rest', () => {
    const { targets, keys, unresolved } = measureTargetsOf([face('a:1'), face('gone'), { kind: 'vertex', name: 'c:1' }], names);
    expect(unresolved).toEqual(['gone']);
    expect(keys).toEqual(['a:1', 'c:1']);
    expect(targets.map((x) => x.kind)).toEqual(['face', 'vertex']);
  });

  it('never asks about a datum or a body: those are the tree\u2019s to show', () => {
    const { targets, unresolved } = measureTargetsOf([{ kind: 'datum', name: 'plane:front' }, { kind: 'body', name: 'b1' }], names);
    expect(targets).toEqual([]);
    expect(unresolved).toEqual(['plane:front', 'b1']);
  });
});
