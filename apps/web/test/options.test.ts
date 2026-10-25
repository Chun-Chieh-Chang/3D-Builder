import { describe, expect, it } from 'vitest';
import { AUTOSAVE_SECONDS, DEFAULT_OPTIONS, loadOptions, parseOptions, saveOptions, VIEW_ARROW_STEP } from '../src/options';

describe('system options (D8.1)', () => {
  it('nothing stored, or something that is not an object, gives the defaults', () => {
    expect(parseOptions(undefined)).toEqual(DEFAULT_OPTIONS);
    expect(parseOptions('x')).toEqual(DEFAULT_OPTIONS);
    expect(parseOptions([1, 2])).toEqual(DEFAULT_OPTIONS);
    expect(loadOptions({ getItem: () => 'not json' })).toEqual(DEFAULT_OPTIONS);
    expect(loadOptions({ getItem: () => null })).toEqual(DEFAULT_OPTIONS);
  });

  it('each value that is not what it should be is the default, the others are kept', () => {
    const o = parseOptions({ autosave: 'yes', autosaveSeconds: 30, defaultTemplate: 'no-such-template', pickFilter: { faces: false, edges: 'x', planes: false }, datumOffset: 't' });
    expect(o.autosave).toBe(true);
    expect(o.autosaveSeconds).toBe(30);
    expect(o.defaultTemplate).toBe('blank');
    expect(o.pickFilter).toEqual({ faces: false, edges: true, vertices: true, planes: false }); // the remembered choice stays off; a missing one is on (ADR 0127)
    expect(o.datumOffset).toBe(DEFAULT_OPTIONS.datumOffset); // an expression that is not a plain number is not carried to the next part
    expect(parseOptions({ datumOffset: ' 25 ' }).datumOffset).toBe('25');
  });

  it('what an older build stored still gives the new choices their default', () => {
    const older = JSON.stringify({ autosave: true, autosaveSeconds: 5, defaultTemplate: 'blank', pickFilter: { faces: true, edges: true, vertices: true }, snap: DEFAULT_OPTIONS.snap });
    const o = loadOptions({ getItem: () => older });
    expect(o.pickFilter.planes).toBe(true); // planes could not be picked when this was stored
    expect(o.datumOffset).toBe('10');
  });

  it('the autosave wait is a whole number of seconds within the limits', () => {
    expect(parseOptions({ autosaveSeconds: 0 }).autosaveSeconds).toBe(AUTOSAVE_SECONDS.min);
    expect(parseOptions({ autosaveSeconds: 99999 }).autosaveSeconds).toBe(AUTOSAVE_SECONDS.max);
    expect(parseOptions({ autosaveSeconds: 7.6 }).autosaveSeconds).toBe(8);
    expect(parseOptions({ autosaveSeconds: NaN }).autosaveSeconds).toBe(DEFAULT_OPTIONS.autosaveSeconds);
  });

  it('the arrow keys\' angle is 15° at first (SolidWorks), kept within 1° to 90°; one that is not a number is the default; an older store has none', () => {
    expect(DEFAULT_OPTIONS.viewArrowStep).toBe(15);
    expect(parseOptions({ viewArrowStep: 0 }).viewArrowStep).toBe(VIEW_ARROW_STEP.min);
    expect(parseOptions({ viewArrowStep: 400 }).viewArrowStep).toBe(VIEW_ARROW_STEP.max);
    expect(parseOptions({ viewArrowStep: 7.5 }).viewArrowStep).toBe(7.5);
    expect(parseOptions({ viewArrowStep: NaN }).viewArrowStep).toBe(15);
    expect(parseOptions({ viewArrowStep: '30' }).viewArrowStep).toBe(15);
    expect(loadOptions({ getItem: () => JSON.stringify({ autosave: true }) }).viewArrowStep).toBe(15);
  });

  it('the selection filter bar is hidden at first, as the SW toolbar (ADR 0145); only a real boolean is kept', () => {
    expect(DEFAULT_OPTIONS.pickFilterBar).toBe(false);
    expect(parseOptions({ pickFilterBar: true }).pickFilterBar).toBe(true);
    expect(parseOptions({ pickFilterBar: 'yes' }).pickFilterBar).toBe(false);
    expect(loadOptions({ getItem: () => JSON.stringify({ autosave: true }) }).pickFilterBar).toBe(false);
  });

  it('the view cube\'s arrows turn 45° at first (FreeCAD), within the same 1° to 90°, apart from the arrow keys', () => {
    expect(DEFAULT_OPTIONS.viewCubeStep).toBe(45);
    expect(parseOptions({ viewCubeStep: 0 }).viewCubeStep).toBe(VIEW_ARROW_STEP.min);
    expect(parseOptions({ viewCubeStep: 180 }).viewCubeStep).toBe(VIEW_ARROW_STEP.max);
    expect(parseOptions({ viewCubeStep: Infinity }).viewCubeStep).toBe(45);
    const o = parseOptions({ viewArrowStep: 10, viewCubeStep: 60 });
    expect([o.viewArrowStep, o.viewCubeStep]).toEqual([10, 60]);
  });

  it('what is saved is what is loaded', () => {
    let kept = '';
    const options = { ...DEFAULT_OPTIONS, showGrid: false, automaticRelations: true, autosave: false, autosaveSeconds: 60, defaultTemplate: 'aluminium' as const, pickFilter: { faces: true, edges: false, vertices: false, planes: false }, pickFilterBar: true, datumOffset: '25', snap: { ...DEFAULT_OPTIONS.snap, enabled: false, grid: true, gridSpacing: 2.5 }, viewArrowStep: 7.5, viewCubeStep: 30 };
    saveOptions(options, { setItem: (_k, v) => void (kept = v) });
    expect(loadOptions({ getItem: () => kept })).toEqual(options);
  });

  it('a browser that refuses to store does not stop the program', () => {
    expect(() =>
      saveOptions(DEFAULT_OPTIONS, {
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
    expect(
      loadOptions({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_OPTIONS);
  });
});

it('model and sketch grid defaults on independently of snapping, and an explicit off preference persists',()=>{
 expect(DEFAULT_OPTIONS.showGrid).toBe(true);expect(DEFAULT_OPTIONS.snap.grid).toBe(false);
 expect(parseOptions({snap:{enabled:false,grid:false}}).showGrid).toBe(true);
 expect(parseOptions({showGrid:false}).showGrid).toBe(false);expect(parseOptions({showGrid:'false'}).showGrid).toBe(true);
 let kept='';saveOptions({...DEFAULT_OPTIONS,showGrid:false},{setItem:(_key,value)=>{kept=value;}});expect(loadOptions({getItem:()=>kept}).showGrid).toBe(false);
});
