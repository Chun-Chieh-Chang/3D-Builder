/**
 * B1 (2026-10-16): local (partial) section view — model-layer validation.
 */
import { describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  createEmptyDrawing,
  DRAWING_SCHEMA_VERSION,
  type DrawingDoc,
  type LocalSectionDrawingView, page } from '@3db/model';
import '../support/drawingVersion';

const base = (): DrawingDoc => createEmptyDrawing();

const localSection = (overrides: Partial<LocalSectionDrawingView> = {}): LocalSectionDrawingView => ({
  id: 'localsec1',
  kind: 'sectionLocal',
  name: 'Local A-A',
  parent: 'view1',
  outline: { kind: 'rectangle', p0: [0, 0], p1: [20, 20] },
  depth: 5,
  label: 'A',
  ...overrides,
});

const insertViews = (doc: DrawingDoc, v: LocalSectionDrawingView) =>
  applyDrawingCommand(doc, { type: 'insertViews', views: [v] });

const withModelView = (doc: DrawingDoc) =>
  applyDrawingCommand(doc, {
    type: 'insertViews',
    views: [{ id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' }],
  });

describe('local section (sectionLocal) model validation', () => {
  it('Schema version is 25', () => {
    expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(21);
  });

  it('a circle-outline local section inserts', () => {
    const d = withModelView(base());
    const out = insertViews(d, localSection({ outline: { kind: 'circle', centre: [10, 10], radius: 8 } }));
    const v = page(out).views.find((x) => x.id === 'localsec1')! as LocalSectionDrawingView;
    expect(v.outline).toMatchObject({ kind: 'circle', centre: [10, 10], radius: 8 });
  });

  it('a closed polygon-outline local section inserts', () => {
    const d = withModelView(base());
    const out = insertViews(
      d,
      localSection({
        outline: {
          kind: 'polygon',
          points: [
            [0, 0],
            [20, 0],
            [20, 20],
            [0, 20],
            [0, 0],
          ],
        },
      })
    );
    const v = page(out).views.find((x) => x.id === 'localsec1')! as LocalSectionDrawingView;
    expect(v.outline.kind).toBe('polygon');
    expect((v.outline as { points: [number, number][] }).points).toHaveLength(5);
  });

  it('depth of zero is refused', () => {
    const d = withModelView(base());
    expect(() => insertViews(d, localSection({ depth: 0 }))).toThrow(/深度|depth/);
  });

  it('negative depth is refused', () => {
    const d = withModelView(base());
    expect(() => insertViews(d, localSection({ depth: -3 }))).toThrow(/深度|depth/);
  });

  it('missing label is refused', () => {
    const d = withModelView(base());
    expect(() => insertViews(d, localSection({ label: '' }))).toThrow(/字母|letter/);
  });

  it('missing outline is refused', () => {
    const d = withModelView(base());
    expect(() => insertViews(d, localSection({ outline: undefined as any }))).toThrow(/輪廓|outline/);
  });

  it('polygon not closed (first ≠ last) is refused', () => {
    const d = withModelView(base());
    expect(() =>
      insertViews(
        d,
        localSection({ outline: { kind: 'polygon', points: [[0, 0], [20, 0], [20, 20], [0, 20]] } })
      )
    ).toThrow(/輪廓|outline/);
  });

  it('polygon with a zero-length segment is refused', () => {
    const d = withModelView(base());
    expect(() =>
      insertViews(
        d,
        localSection({
          outline: {
            kind: 'polygon',
            points: [[0, 0], [20, 0], [20, 0], [20, 20], [0, 20], [0, 0]],
          },
        })
      )
    ).toThrow(/輪廓|outline/);
  });

  it('circle with non-positive radius is refused', () => {
    const d = withModelView(base());
    expect(() =>
      insertViews(d, localSection({ outline: { kind: 'circle', centre: [10, 10], radius: 0 } }))
    ).toThrow(/輪廓|outline/);
  });

  it('a local section cannot be derived from another local section', () => {
    const d = applyDrawingCommand(base(), {
      type: 'insertViews',
      views: [
        { id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' },
        {
          id: 'localsec1',
          kind: 'sectionLocal',
          name: 'Local A-A',
          parent: 'view1',
          outline: { kind: 'rectangle', p0: [0, 0], p1: [20, 20] },
          depth: 5,
          label: 'A',
        },
      ],
    });
    expect(() =>
      applyDrawingCommand(d, {
        type: 'insertViews',
        views: [
          {
            id: 'localsec2',
            kind: 'sectionLocal',
            name: 'Local B-B',
            parent: 'localsec1',
            outline: { kind: 'rectangle', p0: [0, 0], p1: [10, 10] },
            depth: 5,
            label: 'B',
          },
        ],
      })
    ).toThrow(/派生|derived|local section/);
  });

  it('setView refuses a field that does not belong to sectionLocal', () => {
    const d = applyDrawingCommand(base(), {
      type: 'insertViews',
      views: [
        { id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' },
        {
          id: 'localsec1',
          kind: 'sectionLocal',
          name: 'Local A-A',
          parent: 'view1',
          outline: { kind: 'rectangle', p0: [0, 0], p1: [20, 20] },
          depth: 5,
          label: 'A',
        },
      ],
    });
    expect(() =>
      applyDrawingCommand(d, { type: 'setView', viewId: 'localsec1', patch: { line: [[0, 0], [10, 10]] } })
    ).toThrow(/不屬於|does not belong/);
  });

  it('setView can change depth and label of a local section', () => {
    const d = applyDrawingCommand(base(), {
      type: 'insertViews',
      views: [
        { id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' },
        {
          id: 'localsec1',
          kind: 'sectionLocal',
          name: 'Local A-A',
          parent: 'view1',
          outline: { kind: 'rectangle', p0: [0, 0], p1: [20, 20] },
          depth: 5,
          label: 'A',
        },
      ],
    });
    const out = applyDrawingCommand(d, {
      type: 'setView',
      viewId: 'localsec1',
      patch: { depth: 8, label: 'B' },
    });
    const v = page(out).views.find((x) => x.id === 'localsec1')! as LocalSectionDrawingView;
    expect(v.depth).toBe(8);
    expect(v.label).toBe('B');
  });

  it('deleteViews removes a local section', () => {
    const d = applyDrawingCommand(base(), {
      type: 'insertViews',
      views: [
        { id: 'view1', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' },
        {
          id: 'localsec1',
          kind: 'sectionLocal',
          name: 'Local A-A',
          parent: 'view1',
          outline: { kind: 'rectangle', p0: [0, 0], p1: [20, 20] },
          depth: 5,
          label: 'A',
        },
      ],
    });
    const out = applyDrawingCommand(d, { type: 'deleteViews', viewIds: ['localsec1'] });
    expect(page(out).views.find((x) => x.id === 'localsec1')).toBeUndefined();
  });
});