/** `History.applyBatch` (ADR 0238): a batch from an AI agent is one undo step, all or nothing, refused inside an edit session, heard once. */
import { describe, expect, it } from 'vitest';
import { createEmptyPart, DocHistory, serializePart, type Command } from '../src';

const variable = (id: string, name: string, expr: string): Command => ({ type: 'addVariable', variable: { id, name, expr } });

describe('applyBatch', () => {
  it('applies every command as one undo step, and the listeners hear of it once', () => {
    const h = new DocHistory(createEmptyPart());
    let heard = 0;
    h.subscribe(() => heard++);
    h.applyBatch([variable('v1', 'A', '1'), variable('v2', 'B', '2')], 'AI: 2 commands');
    expect(h.doc.variables.map((v) => v.name)).toEqual(['A', 'B']);
    expect(heard).toBe(1);
    h.undo();
    expect(h.doc.variables).toEqual([]);
    h.redo();
    expect(h.doc.variables.map((v) => v.name)).toEqual(['A', 'B']);
  });

  it('changes nothing when one command fails', () => {
    const h = new DocHistory(createEmptyPart());
    const before = serializePart(h.doc);
    let heard = 0;
    h.subscribe(() => heard++);
    expect(() => h.applyBatch([variable('v1', 'A', '1'), variable('v2', 'A', '2')], 'AI')).toThrow();
    expect(serializePart(h.doc)).toBe(before);
    expect(h.canUndo).toBe(false);
    expect(heard).toBe(0);
  });

  it('is refused inside an edit session', () => {
    const h = new DocHistory(createEmptyPart());
    h.begin('sketch');
    expect(() => h.applyBatch([variable('v1', 'A', '1')], 'AI')).toThrow();
    expect(h.doc.variables).toEqual([]);
  });
});
