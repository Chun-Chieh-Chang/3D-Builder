/**
 * G15 (P4): the sketch's model references as a list — what each follows, what following it means, and —
 * broken — why, with the candidates near where it used to be; and the reference replacement a trial runs on,
 * which touches nothing else.
 */
import { describe, expect, it } from 'vitest';
import { modelRefOf, type Ref, type SketchEntity, type SketchFeature } from '@3db/model';
import { referenceRows, withReplacedRef } from '../src/sketcher/sketch-references';
import type { UnresolvedRef } from '../src/sketcher/sketch-references';

const edge = (name: string): Ref => ({ kind: 'edge', name });
const entity = (id: string, over: object): SketchEntity => ({ id, type: 'point', x: 0, y: 0, ...over }) as SketchEntity;
const sketch = (entities: SketchEntity[]): SketchFeature =>
  ({ id: 'sk', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities, constraints: [] }) as SketchFeature;

const piercePoint = entity('p1', { pierce: edge('邊線1') });
const vertexPoint = entity('p2', { ref: { kind: 'vertex', name: '頂點1' } });
const plainPoint = entity('p3', {});
const followedLine = entity('l1', { type: 'line', p1: 'pa', p2: 'pb', ref: edge('邊線2') });

describe('the sketch reference list (G15)', () => {
  it('every entity that follows the model is a row, with what following it means; plain ones are not listed', () => {
    const rows = referenceRows(sketch([piercePoint, vertexPoint, followedLine, plainPoint]), []);
    expect(rows.map((r) => [r.entityId, r.semantic, r.state])).toEqual([
      ['p1', 'reference.semantic.pierce', 'ok'],
      ['p2', 'reference.semantic.vertex', 'ok'],
      ['l1', 'reference.semantic.edge', 'ok'],
    ]);
  });

  it('a reference the rebuild could not resolve is the failed row, with the reason and the candidates', () => {
    const unresolved: UnresolvedRef[] = [{ ref: edge('邊線2'), reason: 'missing', candidates: [{ index: 3, name: '邊線7', distance: 2.5, fingerprint: { type: 'line', size: 12, center: [1, 2, 3] } }] }];
    const rows = referenceRows(sketch([piercePoint, followedLine]), unresolved);
    expect(rows.find((r) => r.entityId === 'l1')).toMatchObject({
      state: 'failed',
      reason: 'missing',
      candidates: [{ name: '邊線7' }],
    });
    expect(rows.find((r) => r.entityId === 'p1')?.state).toBe('ok');
  });

  it('a silhouette reference of a face says so', () => {
    const silhouette = entity('l2', { type: 'line', p1: 'pa', p2: 'pb', ref: { kind: 'face', name: '面1', silhouette: 1 } });
    const rows = referenceRows(sketch([silhouette]), []);
    expect(rows[0]!.semantic).toBe('reference.semantic.silhouette');
  });
});

describe('the reference a trial runs on (G15)', () => {
  it('replaces only the named reference, keeping its kind and fingerprint; everything else is untouched', () => {
    const sk = sketch([piercePoint, followedLine]);
    const out = withReplacedRef(sk, edge('邊線2'), { name: '邊線7', fingerprint: { type: 'line', size: 12, center: [1, 2, 3] } });
    const line = out.entities.find((e) => e.id === 'l1')!;
    expect(modelRefOf(line)).toEqual({ kind: 'edge', name: '邊線7', fingerprint: { type: 'line', size: 12, center: [1, 2, 3] } });
    const point = out.entities.find((e) => e.id === 'p1')!;
    expect(modelRefOf(point)).toEqual(edge('邊線1')); // untouched
    expect(out.constraints).toEqual(sk.constraints);
    expect(out.plane).toEqual(sk.plane);
  });

  it('a fingerprint the candidate does not carry stores none', () => {
    const out = withReplacedRef(sketch([followedLine]), edge('邊線2'), { name: '邊線7' });
    const line = out.entities.find((e) => e.id === 'l1')!;
    expect(modelRefOf(line)).toEqual({ kind: 'edge', name: '邊線7' });
  });

  it('a silhouette branch the lost reference carried is not silently kept for a different edge', () => {
    const silhouetteLine = entity('l2', { type: 'line', p1: 'pa', p2: 'pb', ref: { kind: 'face', name: '面1', silhouette: 1 } });
    const out = withReplacedRef(sketch([silhouetteLine]), { kind: 'face', name: '面1', silhouette: 1 }, { name: '面3' });
    const line = out.entities.find((e) => e.id === 'l2')!;
    expect(modelRefOf(line)).toEqual({ kind: 'face', name: '面3' }); // no silhouette: the new edge's numbering starts fresh
  });
});
