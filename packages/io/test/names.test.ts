import { describe, expect, it } from 'vitest';
import { createDemoPart, createEmptyPart } from '@3db/model';
import { partFileName, partName, stepFileName } from '../src';

describe('part name (as SolidWorks names a part)', () => {
  const demo = createDemoPart(); // has the part-name property 「行走骨架示範件」
  const empty = createEmptyPart();

  it('is the name of the file the part was saved to or opened from', () => {
    for (const file of ['定位板.3dbx', '定位板.3DBX', '定位板.3db.json', '定位板.json', '定位板.step', '定位板.STP']) {
      expect(partName(demo, file)).toBe('定位板');
    }
  });

  it('falls back to the part-name property, then to the untitled name', () => {
    expect(partName(demo, null)).toBe('行走骨架示範件');
    expect(partName(empty, null)).toBe('零件1');
    expect(partName(empty, null, '零件3')).toBe('零件3');
    expect(partName({ ...empty, properties: { 零件名稱: '  ' } }, null, '零件2')).toBe('零件2');
  });

  it('names files after it, safely', () => {
    expect(stepFileName('夾具/底板:A')).toBe('夾具_底板_A.step');
    expect(partFileName('定位板')).toBe('定位板.3dbx');
  });
});
