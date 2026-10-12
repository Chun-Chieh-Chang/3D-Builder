/**
 * Part schema 55: a sketch dimension may keep where its text was dragged (`labelPosition`). The file says so with its version, so a program that does not know
 * the field refuses it instead of dropping where the user put the text; a file of version 54 reads as it was.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, parsePart, SCHEMA_VERSION, serializePart, type SketchFeature } from '@3db/model';
import { build, front, sketch } from '../phase1/builders';

const doc = () =>
  build(
    sketch('sk1', front, {
      entities: [
        { id: 'p1', type: 'point', x: 0, y: 0 },
        { id: 'p2', type: 'point', x: 20, y: 0 },
        { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
      ],
      constraints: [{ id: 'd1', type: 'distance', a: 'l1', value: '20' }],
    }),
  );
const dimension = (d: ReturnType<typeof doc>) => (d.features[0] as SketchFeature).constraints.find((c) => c.id === 'd1') as { labelPosition?: [number, number] };

describe('the place of a dimension text in the file (schema 55)', () => {
  it('is written and read back as it was', () => {
    expect(SCHEMA_VERSION).toBe(55);
    const moved = applyCommand(doc(), { type: 'setDimensionPosition', featureId: 'sk1', constraintId: 'd1', position: [18, 16] });
    const back = parsePart(serializePart(moved));
    expect(back.schemaVersion).toBe(55);
    expect(dimension(back).labelPosition).toEqual([18, 16]);
    // taken away again: the automatic place
    const reset = applyCommand(back, { type: 'setDimensionPosition', featureId: 'sk1', constraintId: 'd1', position: null });
    expect(dimension(reset).labelPosition).toBeUndefined();
  });

  it('a file of version 54 reads as it was; one newer than this program is refused', () => {
    const old = JSON.parse(serializePart(doc())) as { schemaVersion: number };
    old.schemaVersion = 54;
    const read = parsePart(JSON.stringify(old));
    expect(read.schemaVersion).toBe(55);
    expect(dimension(read).labelPosition).toBeUndefined();
    const future = JSON.parse(serializePart(doc())) as { schemaVersion: number };
    future.schemaVersion = SCHEMA_VERSION + 1;
    expect(() => parsePart(JSON.stringify(future))).toThrow();
  });

  it('refuses a place that is not a finite number, with the reason', () => {
    expect(() => applyCommand(doc(), { type: 'setDimensionPosition', featureId: 'sk1', constraintId: 'd1', position: [Number.NaN, 0] })).toThrow(/有限/);
  });
});
