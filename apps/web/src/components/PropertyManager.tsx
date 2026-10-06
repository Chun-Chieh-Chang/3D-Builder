import { useEffect, useState, type ReactNode } from 'react';
import { labelsOf, t } from '@3db/i18n';
import { currentTopicId } from '../help/context';
import {
  canBeSeed,
  evalQuantity,
  findFeature,
  formatQuantity,
  isDimension,
  isNumber,
  isPlain,
  MAX_INSTANCES,
  Parameters,
  patternInstances,
  SKETCH_ORIGIN,
  type ChamferFeature,
  type CombineFeature,
  type Command,
  type DeleteFaceFeature,
  type DraftFeature,
  type HoleFeature,
  holeSize,
  HOLE_STANDARD_SOURCE,
  ISO_HOLE_SIZES,
  DOWEL_FITS,
  fitClearance,
  holeLimits,
  ISO_DOWEL_DIAMETERS,
  pinLimits,
  type EndCondition,
  type Draft,
  type ExtrudeFeature,
  type FilletFeature,
  type Id,
  type AxisDefinition,
  type CoordSysFeature,
  type Feature,
  type ImportedBodyFeature,
  type LoftFeature,
  type MoveFaceFeature,
  type OffsetSurfaceFeature,
  type SplitLineFeature,
  type KnitFeature,
  type FillSurfaceFeature,
  type FlatSurfaceFeature,
  type TrimSurfaceFeature,
  type ExtendSurfaceFeature,
  type ThickenFeature,
  type LipGrooveFeature,
  type ScrewBossFeature,
  type BaseFlangeFeature,
  type SheetGauge,
  type EdgeFlangeFeature,
  type HemFeature,
  type SnapHookFeature,
  type SnapCatchFeature,
  type VentFeature,
  type CutWithSurfaceFeature,
  type MirrorFeature,
  type PartDoc,
  type PatternDefinition,
  type PatternDirection,
  type PatternFeature,
  type PlaneDefinition,
  type PointDefinition,
  type Ref,
  type RefAxisFeature,
  type RefPlaneFeature,
  type RefPointFeature,
  type RevolveFeature,
  type RibFeature,
  type ShellFeature,
  type SweepFeature,
  type Thin,
  type SketchConstraint,
  type SketchFeature,
} from '@3db/model';
import type { RebuildPayload, SketchSolvePayload } from '../worker/protocol';
import { applicableRelations, constraintsOf, dimensionText, measuredText, sameRelation } from '@3db/sketch/interact';
import { nearestElement } from '../state/candidates';
import { store, useSketcherView, useStore } from '../state/store';
import { accepts, axisDefinitionFor, fill, filled, planeDefinitionFor, pointDefinitionFor, slotsOf } from '../state/datumSlots';
import { AXIS_MODE_LABEL, DATUM_ITEMS, DIMENSION_LABEL, FEATURE_LABEL, featureLabel, PLANE_MODE_LABEL, POINT_MODE_LABEL, RELATION_LABEL, SKETCH_STATUS_LABEL, TOOL_LABEL } from '../strings';
import { Icon } from './Icon';
import type { ControllerView, SketchController, SketchFix } from '../sketcher/controller';
import type { SketchIssue } from '@3db/sketch/check';
import type { ContourChoice } from '@3db/sketch/profiles';

/**
 * What an expression comes to in this document, for showing next to the box (D2.4): the value when it is
 * more than a plain number, or the reason it is not one. Null for a plain number.
 */
function preview(text: string, doc: PartDoc, angle: boolean, count = false): { value: string } | { error: string } | null {
  if (!text.trim() || isPlain(text)) return null;
  try {
    const q = evalQuantity(text, new Parameters(doc));
    if (count) return isNumber(q) ? { value: String(Math.round(q.v * 1e6) / 1e6) } : { error: t('expr.countHasUnit') };
    return { value: formatQuantity(angle && isNumber(q) ? { v: (q.v * Math.PI) / 180, L: 0, A: 1 } : !angle && isNumber(q) ? { v: q.v, L: 1, A: 0 } : q) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Field that commits a document command on Enter/blur; invalid input stays red (D6.1). It takes
 * expressions (D2.4): variables, other dimensions, units and functions, with the value shown beside it.
 */
function ValueInput({ value, toCommand, suffix = 'mm' }: { value: string; toCommand: (v: string) => Command; suffix?: string }) {
  const doc = useStore((s) => s.doc);
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const shown = preview(text, doc, suffix === '°', suffix === '');
  useEffect(() => {
    setText(value);
    setInvalid(false);
  }, [value]);
  const commit = () => {
    if (text === value) return;
    setInvalid(!store.execute(toCommand(text.trim())));
  };
  return (
    <span className="value-input">
      <input
        className={invalid || (shown && 'error' in shown) ? 'invalid' : ''}
        value={text}
        title={shown ? ('error' in shown ? shown.error : t('value.expression', { value: shown.value })) : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
      {suffix !== '' && <span className="suffix">{suffix}</span>}
      {shown && 'value' in shown && <span className="value-preview">= {shown.value}</span>}
    </span>
  );
}

const ENTITY_LABEL = labelsOf({ point: 'entity.point', line: 'entity.line', circle: 'entity.circle', arc: 'entity.arc' });

function describe(f: SketchFeature, id: Id): string {
  if (id === SKETCH_ORIGIN) return t('datum.origin');
  const e = f.entities.find((x) => x.id === id);
  if (e) return `${e.construction ? `${t('entity.construction')} ` : ''}${ENTITY_LABEL[e.type]} ${id}`;
  const c = f.constraints.find((x) => x.id === id);
  if (c) return isDimension(c) ? `${DIMENSION_LABEL[c.type] ?? t('dimension.generic')} ${dimensionText(c)}` : `${RELATION_LABEL[c.type]} ${id}`;
  return id;
}

function relationText(f: SketchFeature, c: SketchConstraint, geometry?: SketchSolvePayload['geometry']): string {
  if (isDimension(c)) return `${DIMENSION_LABEL[c.type] ?? t('dimension.generic')} ${dimensionText(c, geometry && measuredText(c, geometry))}`;
  return RELATION_LABEL[c.type];
}

/** A number the sketch tool is about to use; an invalid entry is simply not taken. */
function OptionNumber({ label, value, integer = false, onChange }: { label: string; value: number; integer?: boolean; onChange: (v: number) => void }) {
  return (
    <label className="pm-row">
      <span>{label}</span>
      <input
        type="number"
        min={integer ? 3 : 0}
        step={integer ? 1 : 'any'}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v > 0 && (!integer || Number.isInteger(v))) onChange(v);
        }}
      />
    </label>
  );
}

/** What a sketch tool needs set before it is used: the number of sides, a radius, a distance. */
function ToolOptionsBox({ view, sketcher }: { view: ControllerView; sketcher: SketchController }) {
  const o = view.options;
  switch (view.tool) {
    case 'polygon':
      return (
        <>
          <OptionNumber label={t('sketch.option.sides')} value={o.polygonSides} integer onChange={(v) => sketcher.setOption('polygonSides', v)} />
          <label className="pm-row checkbox">
            <input type="checkbox" checked={o.circumscribed} onChange={(e) => sketcher.setOption('circumscribed', e.target.checked)} />
            <span>{t('sketch.option.circumscribed')}</span>
          </label>
        </>
      );
    case 'sketchFillet':
      return <OptionNumber label={t('sketch.option.radius')} value={o.filletRadius} onChange={(v) => sketcher.setOption('filletRadius', v)} />;
    case 'sketchChamfer':
      return (
        <>
          <OptionNumber label={t('sketch.option.distance1')} value={o.chamferDistance1} onChange={(v) => sketcher.setOption('chamferDistance1', v)} />
          <OptionNumber label={t('sketch.option.distance2')} value={o.chamferDistance2} onChange={(v) => sketcher.setOption('chamferDistance2', v)} />
        </>
      );
    case 'offset':
      return <OptionNumber label={t('sketch.option.offset')} value={o.offsetDistance} onChange={(v) => sketcher.setOption('offsetDistance', v)} />;
    default:
      return null;
  }
}

/** Over-defined sketch (A2.5, D7.2): the relations and dimensions that conflict, and what the solver confirms cures it, one click each. */
function DiagnosisBox({ f, solve, sketcher }: { f: SketchFeature; solve: SketchSolvePayload; sketcher: SketchController }) {
  const [fixes, setFixes] = useState<SketchFix[] | null>(null);
  const key = `${solve.status}|${solve.conflicting.join(',')}|${solve.redundant.join(',')}|${f.constraints.length}`;
  useEffect(() => {
    let live = true;
    setFixes(null);
    if (solve.status === 'over') void sketcher.diagnose().then((r) => live && setFixes(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sketcher]);
  if (solve.status !== 'over') return null;
  return (
    <section className="pm-group">
      <h4>{t('sketch.diagnose.title')}</h4>
      {fixes === null && <p className="muted">{t('sketch.diagnose.busy')}</p>}
      {fixes !== null && fixes.length === 0 && <p className="hint">{t('sketch.diagnose.none')}</p>}
      {fixes !== null && fixes.length > 0 && <p className="hint">{t('sketch.diagnose.intro')}</p>}
      <ul className="relation-list">
        {(fixes ?? []).map((x) => (
          <li key={x.id} onMouseEnter={() => sketcher.select([x.id])}>
            <span>{describe(f, x.id)}</span>
            <button type="button" onClick={() => sketcher.applyFix(x)}>
              {x.kind === 'driven' ? t('sketch.diagnose.driven') : t('sketch.diagnose.delete')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 「檢查草圖用於特徵」 (C1.35): what keeps the sketch from making a profile; click one to see where, and 「修復草圖」 for what needs no decision. */
function CheckBox({ f, view, sketcher }: { f: SketchFeature; view: ControllerView | null; sketcher: SketchController }) {
  const issues = sketcher.issues();
  const text = (i: SketchIssue): string => {
    const ids = i.ids.join(t('cmd.listSeparator'));
    switch (i.kind) {
      case 'openEnd':
        return t('sketch.check.openEnd', { ids });
      case 'gap':
        return t('sketch.check.gap', { ids, size: String(Math.round(i.size * 1e4) / 1e4) });
      case 'branch':
        return t('sketch.check.branch', { ids });
      case 'duplicate':
        return t('sketch.check.duplicate', { ids });
      case 'zeroLength':
        return t('sketch.check.zeroLength', { ids });
      case 'crossing':
        return t('sketch.check.crossing', { ids });
    }
  };
  const fixable = issues.some((i) => i.kind === 'gap' || i.kind === 'duplicate' || i.kind === 'zeroLength');
  return (
    <section className="pm-group">
      <h4>{t('sketch.check.title')}</h4>
      {issues.length === 0 ? (
        <p className="hint">{t('sketch.check.ok')}</p>
      ) : (
        <ul className="relation-list">
          {issues.map((i, k) => (
            <li key={`${i.kind}${k}`} onClick={() => sketcher.select(i.ids)}>
              <span>{text(i)}</span>
            </li>
          ))}
        </ul>
      )}
      <OptionNumber label={t('sketch.check.tolerance')} value={view?.options.gapTolerance ?? 0.1} onChange={(v) => sketcher.setOption('gapTolerance', v)} />
      {fixable && (
        <div className="relation-buttons">
          <button type="button" onClick={() => sketcher.repair()}>
            {t('sketch.check.repair')}
          </button>
        </div>
      )}
    </section>
  );
}

/** Sketch PropertyManager (C1.26, C1.27, C1.31): status, tool, selection, relations and dimensions. */
function SketchPanel({ f }: { f: SketchFeature }) {
  const solve = useStore((s) => s.sketchSolve);
  const view = useSketcherView();
  const sketcher = store.sketcher;
  const selection = view?.selection ?? [];
  const entityIds = selection.filter((id) => id === SKETCH_ORIGIN || f.entities.some((e) => e.id === id));
  const curves = f.entities.filter((e) => e.type !== 'point' && entityIds.includes(e.id));
  const existing = constraintsOf(f.constraints, entityIds);
  const offered = solve ? applicableRelations(solve.geometry, entityIds).filter((r) => !existing.some((c) => sameRelation(c, r))) : [];
  const dims = f.constraints.filter(isDimension);
  const conflicting = solve?.conflicting.map((id) => describe(f, id)) ?? [];
  const isPointId = (id: Id) => f.entities.some((e) => e.id === id && e.type === 'point');
  const canMerge = selection.length === 2 && selection.every(isPointId);
  const arcSelected = selection.length === 1 ? f.entities.find((e) => e.id === selection[0] && e.type === 'arc') : undefined;

  return (
    <>
      {view?.message && (
        <p className="pm-note" role="status">
          {view.message}
        </p>
      )}
      <section className="pm-group">
        <h4>{t('pm.sketchStatus')}</h4>
        {solve ? (
          <p className={`sketch-status ${solve.status}`}>
            {SKETCH_STATUS_LABEL[solve.status]}
            {solve.status === 'under' && t('pm.dof', { n: solve.dof })}
          </p>
        ) : (
          <p className="muted">{t('pm.solving')}</p>
        )}
        {conflicting.length > 0 && <p className="error-text">{t('pm.conflict', { ids: conflicting.join(t('cmd.listSeparator')) })}</p>}
      </section>

      {sketcher && solve && <DiagnosisBox f={f} solve={solve} sketcher={sketcher} />}
      {sketcher && solve && f.entities.length > 0 && <CheckBox f={f} view={view} sketcher={sketcher} />}

      {view && view.tool !== 'select' && (
        <section className="pm-group">
          <h4>{TOOL_LABEL[view.tool]}</h4>
          <p className="hint">{view.hint}</p>
          {sketcher && <ToolOptionsBox view={view} sketcher={sketcher} />}
          <p className="hint">{t('pm.escTool')}</p>
        </section>
      )}

      {sketcher && selection.length > 0 && (
        <section className="pm-group">
          <h4>{t('pm.selectedItems')}</h4>
          <ul className="selection-box">
            {selection.map((id) => (
              <li key={id}>{describe(f, id)}</li>
            ))}
          </ul>
          {existing.length > 0 && (
            <>
              <h4 className="sub">{t('pm.existingRelations')}</h4>
              <ul className="relation-list">
                {existing.map((c) => (
                  <li key={c.id} className={solve?.conflicting.includes(c.id) ? 'over' : ''}>
                    <span>{relationText(f, c, solve?.geometry)}</span>
                    <button title={t('pm.delete')} onClick={() => store.execute({ type: 'removeSketchItems', featureId: f.id, ids: [c.id] })}>
                      <Icon name="cancel" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {offered.length > 0 && (
            <>
              <h4 className="sub">{t('pm.addRelations')}</h4>
              <div className="relation-buttons">
                {offered.map((r) => (
                  <button key={r.type} onClick={() => void sketcher.addRelation(r)}>
                    {RELATION_LABEL[r.type]}
                  </button>
                ))}
                {canMerge && <button onClick={() => sketcher.mergeSelection()}>{t('relation.merge')}</button>}
              </div>
            </>
          )}
          {canMerge && offered.length === 0 && (
            <div className="relation-buttons">
              <button onClick={() => sketcher.mergeSelection()}>{t('relation.merge')}</button>
            </div>
          )}
          {arcSelected && (
            <div className="relation-buttons">
              <button onClick={() => sketcher.dimensionArcLength(arcSelected.id)}>{t('sketch.arcLengthButton')}</button>
            </div>
          )}
          {curves.length > 0 && (
            <label className="pm-row checkbox">
              <input type="checkbox" checked={curves.every((e) => e.construction)} onChange={(e) => sketcher.setConstruction(e.target.checked)} />
              <span>{t('pm.asConstruction')}</span>
            </label>
          )}
          <p className="hint">{t('pm.deleteHint')}</p>
        </section>
      )}

      <section className="pm-group">
        <h4>{t('pm.dimensions')}</h4>
        {dims.length === 0 && <p className="muted">{t('pm.dimensionsHint')}</p>}
        {dims.map((c) => (
          <label key={c.id} className="pm-row">
            <span>{c.label ?? `${DIMENSION_LABEL[c.type] ?? t('dimension.generic')} ${c.id}`}</span>
            {c.driving === false ? (
              <span className="muted" title={t('sketch.driven')}>
                {dimensionText(c, solve ? measuredText(c, solve.geometry) : undefined)}
              </span>
            ) : (
              <ValueInput
                value={c.value}
                suffix={c.type === 'angle' ? '°' : 'mm'}
                toCommand={(value) => ({ type: 'setDimension', featureId: f.id, constraintId: c.id, value })}
              />
            )}
            <button type="button" className="link" onClick={() => sketcher?.setDriven(c.id, c.driving !== false)}>
              {c.driving === false ? t('sketch.makeDriving') : t('sketch.makeDriven')}
            </button>
          </label>
        ))}
      </section>
    </>
  );
}


const END_CONDITION: Record<EndCondition['type'], () => string> = {
  blind: () => t('pm.end.blind'),
  midPlane: () => t('pm.end.midPlane'),
  throughAll: () => t('feature.throughAll'),
  upToFace: () => t('feature.upToFace'),
  upToNext: () => t('feature.upToNext'),
  upToVertex: () => t('feature.upToVertex'),
  upToBody: () => t('feature.upToBody'),
  offsetFromFace: () => t('feature.offsetFromFace'),
};

/** A new end condition of the given type, keeping the depth and the direction the old one had; references start empty (picked in the graphics area). */
function endCondition(type: EndCondition['type'], old: EndCondition): EndCondition {
  const depth = 'depth' in old ? old.depth : '10';
  const flip = 'reverse' in old && old.reverse ? { reverse: true } : {};
  switch (type) {
    case 'blind':
      return { type, depth, ...flip };
    case 'midPlane':
      return { type, depth };
    case 'throughAll':
    case 'upToNext':
      return { type, ...flip };
    case 'upToFace':
      return { type, face: { kind: 'face', name: '' }, ...flip };
    case 'upToVertex':
      return { type, vertex: { kind: 'vertex', name: '' }, ...flip };
    case 'upToBody':
      return { type, body: { kind: 'body', name: '' }, ...flip };
    case 'offsetFromFace':
      return { type, face: { kind: 'face', name: '' }, offset: 'offset' in old ? old.offset : '1', ...flip };
  }
}

/** The element an end condition ends on, with a mark when the model no longer has it. */
function EndRef({ f, d }: { f: ExtrudeFeature; d: EndCondition }) {
  const result = useStore((s) => s.result);
  // the body an extrusion goes up to is looked up in the model before the feature: once the extrusion has joined it, the final bodies no longer list it,
  // so it is the feature's own report that says it is lost
  const bodyLost = !!result?.features.find((x) => x.id === f.id)?.unresolved?.some((u) => d.type === 'upToBody' && u.ref.name === d.body.name);
  const [ref, found, prompt] =
    d.type === 'upToFace' || d.type === 'offsetFromFace'
      ? ([d.face, !!result?.faceNames.includes(d.face.name), t('pm.pickFace')] as const)
      : d.type === 'upToVertex'
        ? ([d.vertex, !!result?.vertexNames.includes(d.vertex.name), t('pm.pickVertex')] as const)
        : d.type === 'upToBody'
          ? ([d.body, !bodyLost, t('pm.pickBody')] as const)
          : [null, true, ''];
  if (!ref) return null;
  return (
    <ul className="selection-box">
      {!ref.name ? (
        <li className="muted">{prompt}</li>
      ) : (
        <li className={found ? '' : 'missing'} title={ref.name}>
          {t(d.type === 'upToVertex' ? 'feature.endVertex' : d.type === 'upToBody' ? 'feature.upToBody' : 'feature.endFace')}
          {!found && t('pm.lostRef')}
          <code>{ref.name}</code>
          {!found && ref.kind !== 'body' && <UseNearest featureId={f.id} refr={ref} />}
        </li>
      )}
    </ul>
  );
}

/** One direction of an extrusion (C4.1): its end condition, depth or offset, direction and draft. */
function DirectionBox({ f, which }: { f: ExtrudeFeature; which: 'dir1' | 'dir2' }) {
  const d = which === 'dir1' ? f.dir1 : f.dir2!;
  const draft = which === 'dir1' ? f.draft1 : f.draft2;
  const set = (value: EndCondition) => store.execute({ type: 'setEndCondition', featureId: f.id, dir: which, value });
  const rev = (on: boolean) => (on ? { reverse: true } : {});
  const reverse = 'reverse' in d && !!d.reverse;
  const setDraft = (next: Draft | null) => store.execute({ type: 'setDraft', featureId: f.id, dir: which, draft: next });
  return (
    <section className="pm-group">
      <h4>{t(which === 'dir1' ? 'feature.dir1' : 'feature.dir2')}</h4>
      <label className="pm-row">
        <span>{t('pm.endCondition')}</span>
        <select value={d.type} onChange={(e) => set(endCondition(e.target.value as EndCondition['type'], d))}>
          {Object.entries(END_CONDITION).map(([type, label]) => (
            <option key={type} value={type}>
              {label()}
            </option>
          ))}
        </select>
      </label>
      {'depth' in d && (
        <label className="pm-row">
          <span>{t('pm.depth')}</span>
          <ValueInput value={d.depth} toCommand={(value) => ({ type: 'setEndCondition', featureId: f.id, dir: which, value: d.type === 'midPlane' ? { type: 'midPlane', depth: value } : { type: 'blind', depth: value, ...rev(reverse) } })} />
        </label>
      )}
      {d.type === 'offsetFromFace' && (
        <>
          <label className="pm-row">
            <span>{t('pm.offset')}</span>
            <ValueInput value={d.offset} toCommand={(value) => ({ type: 'setEndCondition', featureId: f.id, dir: which, value: { ...d, offset: value } })} />
          </label>
          <label className="pm-row checkbox">
            <input type="checkbox" checked={!!d.beyond} onChange={(e) => set({ ...d, ...(e.target.checked ? { beyond: true } : { beyond: undefined }) })} />
            <span>{t('pm.offset.beyond')}</span>
          </label>
        </>
      )}
      <EndRef f={f} d={d} />
      {d.type !== 'midPlane' && (
        <label className="pm-row checkbox">
          <input type="checkbox" checked={reverse} onChange={(e) => set({ ...d, reverse: e.target.checked ? true : undefined } as EndCondition)} />
          <span>{t('pm.reverseDirection')}</span>
        </label>
      )}
      {d.type !== 'midPlane' && (
        <>
          <label className="pm-row checkbox">
            <input type="checkbox" checked={!!draft} onChange={(e) => setDraft(e.target.checked ? { angle: '3deg' } : null)} />
            <span>{t('pm.draft')}</span>
          </label>
          {draft && (
            <>
              <label className="pm-row">
                <span>{t('pm.draft.angle')}</span>
                <ValueInput value={draft.angle} suffix="°" toCommand={(angle) => ({ type: 'setDraft', featureId: f.id, dir: which, draft: { ...draft, angle } })} />
              </label>
              <label className="pm-row checkbox">
                <input type="checkbox" checked={!!draft.inward} onChange={(e) => setDraft({ angle: draft.angle, ...(e.target.checked ? { inward: true } : {}) })} />
                <span>{t('pm.draft.inward')}</span>
              </label>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** 「薄件」 (C4.1, C4.3): the outline thickened instead of the inside filled; one way, half each way, or two thicknesses. */
function ThinBox({ f }: { f: ExtrudeFeature | RevolveFeature }) {
  const thin = f.thin;
  const set = (next: Thin | null) => store.execute({ type: 'setThin', featureId: f.id, thin: next });
  return (
    <section className="pm-group">
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!thin} onChange={(e) => set(e.target.checked ? { mode: 'one', thickness: '2' } : null)} />
        <span>{t('pm.thin')}</span>
      </label>
      {thin && (
        <>
          <label className="pm-row">
            <span>{t('pm.thin.mode')}</span>
            <select value={thin.mode} onChange={(e) => set({ ...thin, mode: e.target.value as Thin['mode'], ...(e.target.value === 'two' ? { thickness2: thin.thickness2 ?? thin.thickness } : {}) })}>
              <option value="one">{t('pm.thin.one')}</option>
              <option value="mid">{t('pm.thin.mid')}</option>
              <option value="two">{t('pm.thin.two')}</option>
            </select>
          </label>
          <label className="pm-row">
            <span>{t('pm.thin.thickness')}</span>
            <ValueInput value={thin.thickness} toCommand={(thickness) => ({ type: 'setThin', featureId: f.id, thin: { ...thin, thickness } })} />
          </label>
          {thin.mode === 'two' && (
            <label className="pm-row">
              <span>{t('pm.thin.thickness2')}</span>
              <ValueInput value={thin.thickness2 ?? thin.thickness} toCommand={(thickness2) => ({ type: 'setThin', featureId: f.id, thin: { ...thin, thickness2 } })} />
            </label>
          )}
          {thin.mode === 'one' && (
            <label className="pm-row checkbox">
              <input type="checkbox" checked={!!thin.reverse} onChange={(e) => set({ mode: 'one', thickness: thin.thickness, ...(e.target.checked ? { reverse: true } : {}) })} />
              <span>{t('pm.thin.reverse')}</span>
            </label>
          )}
          <p className="hint">{t('pm.thin.hint')}</p>
        </>
      )}
    </section>
  );
}

/** 「所選輪廓」 (C1.34): which of the sketch's closed regions a boss or cut uses. Nothing chosen means all of them. */
function ContourBox({ f }: { f: ExtrudeFeature | RevolveFeature | SweepFeature }) {
  const doc = useStore((s) => s.doc);
  const [choices, setChoices] = useState<ContourChoice[] | null>(null);
  useEffect(() => {
    let live = true;
    // the list stays while it is read again (a click changes the document), so it does not flicker
    void store.sketchContours(f.sketch).then((c) => live && setChoices(c));
    return () => {
      live = false;
    };
  }, [f.sketch, doc]);
  if (choices !== null && choices.length < 2) return null; // one contour (or none) is not a choice
  const same = (a: readonly string[], b: readonly string[]) => a.length > 0 && a.filter((id) => b.includes(id)).length / new Set([...a, ...b]).size >= 0.5;
  const chosen = (c: ContourChoice) => !f.contours || f.contours.some((w) => same(w, c.ids));
  const toggle = (c: ContourChoice) => {
    if (!choices) return;
    const next = choices.filter((x) => (x === c ? !chosen(x) : chosen(x)));
    if (next.length === 0) return; // at least one
    store.execute({ type: 'setContours', featureId: f.id, contours: next.length === choices.length ? null : next.map((x) => x.ids) });
  };
  return (
    <>
      <h4 className="sub">{t('contour.title')}</h4>
      {choices === null && <p className="muted">{t('contour.loading')}</p>}
      {choices?.map((c, i) => (
        <label key={c.ids.join('+')} className="pm-row checkbox">
          <input type="checkbox" checked={chosen(c)} onChange={() => toggle(c)} />
          <span>
            {t('contour.item', {
              n: String(i + 1),
              area: String(Math.round(c.area * 100) / 100),
              x: String(Math.round(c.center[0] * 100) / 100),
              y: String(Math.round(c.center[1] * 100) / 100),
              holes: c.holes > 0 ? t('contour.holes', { n: String(c.holes) }) : '',
            })}
          </span>
        </label>
      ))}
      <p className="hint">{t('contour.hint')}</p>
    </>
  );
}

/** 「合併結果」 (C7.1): whether a boss joins the bodies it touches or is a body of its own. */
function MergeBox({ f }: { f: ExtrudeFeature | RevolveFeature | SweepFeature | LoftFeature | ImportedBodyFeature }) {
  return (
    <>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={f.merge !== false} onChange={(e) => store.execute({ type: 'setMerge', featureId: f.id, merge: e.target.checked })} />
        <span>{t('pm.merge')}</span>
      </label>
      <p className="hint">{t('pm.merge.hint')}</p>
    </>
  );
}

/** Extrude (C4.1, C4.2): one or two directions with their end conditions and drafts, thin walls, contours and merging. */
function ExtrudePanel({ f }: { f: ExtrudeFeature }) {
  const doc = useStore((s) => s.doc);
  return (
    <>
      <DirectionBox f={f} which="dir1" />
      <section className="pm-group">
        <label className="pm-row checkbox">
          <input
            type="checkbox"
            checked={!!f.dir2}
            onChange={(e) => store.execute({ type: 'setEndCondition', featureId: f.id, dir: 'dir2', value: e.target.checked ? { type: 'blind', depth: 'depth' in f.dir1 ? f.dir1.depth : '10' } : null })}
          />
          <span>{t('feature.dir2')}</span>
        </label>
      </section>
      {f.dir2 && <DirectionBox f={f} which="dir2" />}
      <ThinBox f={f} />
      <section className="pm-group">
        <p className="hint">
          {t('pm.profile', { name: findFeature(doc, f.sketch)?.name ?? f.sketch })}
          {f.op === 'cut' && ` ${t('pm.cutHint')}`}
        </p>
        <ContourBox f={f} />
        {f.op === 'boss' && <MergeBox f={f} />}
      </section>
    </>
  );
}
/** Revolve (C4.3): axis line of the sketch, one direction or both, and the angle. */
function RevolvePanel({ f }: { f: RevolveFeature }) {
  const doc = useStore((s) => s.doc);
  const sketch = findFeature(doc, f.sketch);
  const lines = sketch?.type === 'sketch' ? sketch.entities.filter((e) => e.type === 'line') : [];
  const d = f.dir1;
  const reverse = d.type === 'blind' && (d.reverse ?? false);
  const set = (value: RevolveFeature['dir1']) => store.execute({ type: 'setRevolveCondition', featureId: f.id, value });
  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.revolve.axis')}</h4>
        <select value={f.axis} onChange={(e) => store.execute({ type: 'setRevolveAxis', featureId: f.id, axis: e.target.value })}>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.construction ? t('tool.centerline') : t('entity.line')} {l.id}
            </option>
          ))}
        </select>
      </section>
      <section className="pm-group">
        <h4>{t('pattern.direction1')}</h4>
        <label className="pm-row">
          <span>{t('pm.revolve.type')}</span>
          <select value={d.type} onChange={(e) => set(e.target.value === 'midPlane' ? { type: 'midPlane', angle: d.angle } : { type: 'blind', angle: d.angle })}>
            <option value="blind">{t('pm.end.blind')}</option>
            <option value="midPlane">{t('pm.end.midPlane')}</option>
          </select>
        </label>
        <label className="pm-row">
          <span>{t('dimension.angle')}</span>
          <ValueInput
            value={d.angle}
            suffix="°"
            toCommand={(angle) => ({ type: 'setRevolveCondition', featureId: f.id, value: d.type === 'midPlane' ? { type: 'midPlane', angle } : { type: 'blind', angle, ...(reverse ? { reverse: true } : {}) } })}
          />
        </label>
        {d.type === 'blind' && (
          <label className="pm-row checkbox">
            <input type="checkbox" checked={reverse} onChange={(e) => set({ type: 'blind', angle: d.angle, ...(e.target.checked ? { reverse: true } : {}) })} />
            <span>{t('pm.reverseDirection')}</span>
          </label>
        )}
        <p className="hint">{t('pm.profile', { name: sketch?.name ?? f.sketch })}</p>
        <ThinBox f={f} />
        <ContourBox f={f} />
        {f.op === 'boss' && <MergeBox f={f} />}
      </section>
    </>
  );
}

/** Sweep (C4.4): the profile is the sketch it was made from, the path another sketch before it; contours and merging as for an extrusion. */
function SweepPanel({ f }: { f: SweepFeature }) {
  const doc = useStore((s) => s.doc);
  const index = doc.features.findIndex((x) => x.id === f.id);
  const paths = doc.features.filter((x, i): x is SketchFeature => x.type === 'sketch' && x.id !== f.sketch && i < index);
  return (
    <section className="pm-group">
      <h4>{t('pm.sweep.profile')}</h4>
      <p className="hint">{findFeature(doc, f.sketch)?.name ?? f.sketch}</p>
      <ContourBox f={f} />
      <h4>{t('pm.sweep.path')}</h4>
      <select value={f.path} onChange={(e) => store.execute({ type: 'setSweepPath', featureId: f.id, path: e.target.value })}>
        {!paths.some((p) => p.id === f.path) && <option value={f.path}>{findFeature(doc, f.path)?.name ?? f.path}</option>}
        {paths.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {f.op === 'boss' && <MergeBox f={f} />}
      <p className="hint">{t('pm.sweep.hint')}</p>
    </section>
  );
}

/** Loft (C4.5): the sketches of the sections as an ordered list (move up, move down, remove), and a list to add one from. */
function LoftPanel({ f }: { f: LoftFeature }) {
  const doc = useStore((s) => s.doc);
  const index = doc.features.findIndex((x) => x.id === f.id);
  const name = (id: Id) => findFeature(doc, id)?.name ?? id;
  const set = (sections: Id[]) => store.execute({ type: 'setLoftSections', featureId: f.id, sections });
  const move = (i: number, by: number) => {
    const next = [...f.sections];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    set(next);
  };
  const more = doc.features.filter((x, i): x is SketchFeature => x.type === 'sketch' && i < index && !f.sections.includes(x.id));
  return (
    <section className="pm-group">
      <h4>{t('pm.loft.sections')}</h4>
      {f.sections.map((id, i) => (
        <div key={id} className="pm-row">
          <span>
            {i + 1}. {name(id)}
          </span>
          <button disabled={i === 0} title={t('pm.loft.up')} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button disabled={i === f.sections.length - 1} title={t('pm.loft.down')} onClick={() => move(i, 1)}>
            ↓
          </button>
          <button title={t('pm.loft.remove')} onClick={() => set(f.sections.filter((x) => x !== id))}>
            ✕
          </button>
        </div>
      ))}
      <select value="" onChange={(e) => e.target.value && set([...f.sections, e.target.value])}>
        <option value="">{t('pm.loft.add')}</option>
        {more.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {f.op === 'boss' && <MergeBox f={f} />}
      <p className="hint">{t('pm.loft.hint')}</p>
    </section>
  );
}

/** Rib (C4.7): the thickness of the wall made of the sketch's line, where the thickness goes, and which way the wall grows. */
function RibPanel({ f }: { f: RibFeature }) {
  const { sketch: _sketch, id: _id, type: _type, name: _name, suppressed: _suppressed, ...settings } = f;
  void [_sketch, _id, _type, _name, _suppressed];
  const run = (patch: Partial<typeof settings>) => store.execute({ type: 'setRib', featureId: f.id, rib: { ...settings, ...patch } });
  return (
    <section className="pm-group">
      <label className="pm-row">
        <span>{t('pm.rib.thickness')}</span>
        <ValueInput value={f.thickness} toCommand={(thickness) => ({ type: 'setRib', featureId: f.id, rib: { ...settings, thickness } })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.rib.side')}</span>
        <select value={f.side} onChange={(e) => run({ side: e.target.value as RibFeature['side'] })}>
          <option value="mid">{t('pm.rib.mid')}</option>
          <option value="positive">{t('pm.rib.positive')}</option>
          <option value="negative">{t('pm.rib.negative')}</option>
        </select>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={f.flip === true} onChange={(e) => run({ flip: e.target.checked ? true : undefined })} />
        <span>{t('pm.rib.flip')}</span>
      </label>
      <p className="hint">{t('pm.rib.hint')}</p>
    </section>
  );
}

/** Edge selection box of a fillet or chamfer (D2.1): edges by persistent name, missing ones marked. */
function EdgeList({ f }: { f: FilletFeature | ChamferFeature | FillSurfaceFeature | FlatSurfaceFeature | ExtendSurfaceFeature }) {
  const r = useStore((s) => s.result);
  const label = FEATURE_LABEL[f.type];
  return (
    <section className="pm-group">
      <h4>{t('pm.edges.heading', { label })}</h4>
      <ul className="selection-box">
        {f.edges.length === 0 && <li className="muted">{t('pm.edges.empty')}</li>}
        {f.edges.map((e, i) => {
          const found = r?.edgeNames.includes(e.name);
          return (
            <li key={e.name} className={found ? '' : 'missing'} title={e.name}>
              {t('pm.edges.item', { n: i + 1 })}
              {!found && t('pm.lost')}
              <code>{e.name}</code>
              {!found && <UseNearest featureId={f.id} refr={e} />}
            </li>
          );
        })}
      </ul>
      {(f.type === 'fillet' || f.type === 'chamfer') && <p className="hint">{t('pm.edges.hintFaces', { label })}</p>}
      {(f.type === 'fillet' || f.type === 'chamfer') && <FaceList f={f} label={label} />}
    </section>
  );
}

/** The faces of a fillet or a chamfer (fillet and chamfer by face): every edge of each is done, worked out at each rebuild. */
function FaceList({ f, label }: { f: FilletFeature | ChamferFeature; label: string }) {
  const r = useStore((s) => s.result);
  const faces = f.faces ?? [];
  return (
    <>
      <h4>{t('pm.faces.heading', { label })}</h4>
      <ul className="selection-box">
        {faces.length === 0 && <li className="muted">{t('pm.faces.empty')}</li>}
        {faces.map((x, i) => {
          const found = r?.faceNames.includes(x.name);
          return (
            <li key={x.name} className={found ? '' : 'missing'} title={x.name}>
              {t('pm.faces.item', { n: i + 1 })}
              {!found && t('pm.lost')}
              <code>{x.name}</code>
              {!found && <UseNearest featureId={f.id} refr={x} />}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function FilletPanel({ f }: { f: FilletFeature }) {
  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.fillet.params')}</h4>
        <label className="pm-row">
          <span>{t('dimension.radius')}</span>
          <ValueInput value={f.radius} toCommand={(value) => ({ type: 'setFilletRadius', featureId: f.id, value })} />
        </label>
      </section>
      <EdgeList f={f} />
    </>
  );
}

/** Chamfer (C5.3): 「角度-距離」 or 「距離-距離」, and which face the first distance is measured on. */
function ChamferPanel({ f }: { f: ChamferFeature }) {
  const params = { mode: f.mode, distance: f.distance, second: f.second, ...(f.flip ? { flip: true } : {}) };
  const set = (patch: Partial<ChamferFeature>): Command => ({ type: 'setChamfer', featureId: f.id, value: { ...params, ...patch } });
  const angled = f.mode === 'angleDistance';
  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.chamfer.params')}</h4>
        <label className="pm-row">
          <span>{t('pm.chamfer.type')}</span>
          <select
            value={f.mode}
            onChange={(e) => store.execute(e.target.value === 'angleDistance' ? set({ mode: 'angleDistance', second: '45' }) : set({ mode: 'distanceDistance', second: f.distance }))}
          >
            <option value="angleDistance">{t('pm.chamfer.angleDistance')}</option>
            <option value="distanceDistance">{t('pm.chamfer.distanceDistance')}</option>
          </select>
        </label>
        <label className="pm-row">
          <span>{angled ? t('dimension.distance') : t('sketch.option.distance1')}</span>
          <ValueInput value={f.distance} toCommand={(distance) => set({ distance })} />
        </label>
        <label className="pm-row">
          <span>{angled ? t('dimension.angle') : t('sketch.option.distance2')}</span>
          <ValueInput value={f.second} suffix={angled ? '°' : 'mm'} toCommand={(second) => set({ second })} />
        </label>
        <label className="pm-row checkbox">
          <input type="checkbox" checked={f.flip ?? false} onChange={(e) => store.execute(set({ flip: e.target.checked }))} />
          <span>{t('pm.reverseDirection')}</span>
        </label>
      </section>
      <EdgeList f={f} />
    </>
  );
}

/** 「改用最接近的」 (B4.3): offered under a reference the model no longer has; one click points the feature at it. */
function UseNearest({ featureId, refr }: { featureId: string; refr: Ref }) {
  const result = useStore((s) => s.result);
  const near = nearestElement(refr, result);
  if (!near) return null;
  return (
    <button className="use-nearest" title={t('pm.nearest.title', { name: near.name })} onClick={() => store.replaceRef(featureId, refr, near)}>
      {t('pm.nearest.use')} <code>{near.name}</code>
    </button>
  );
}

/**
 * One reference in a selection box: what it is, and whether the model on screen still has it. A
 * datum names a default plane or a reference plane feature; elements are shown by persistent name.
 */
function RefItem({ label, refr, doc, result, featureId, onClear }: { label: string; refr: Ref; doc: PartDoc; result: RebuildPayload | null; featureId: string; onClear?: () => void }) {
  const clear = onClear && (
    <button className="link" title={t('slot.clear')} onClick={onClear}>
      ×
    </button>
  );
  if (refr.kind === 'datum') {
    const plane = DATUM_ITEMS.find((d) => d.id === refr.name)?.label ?? findFeature(doc, refr.name)?.name;
    return (
      <li className={plane ? '' : 'missing'}>
        {label}: {plane ?? `${refr.name} ${t('pm.lost')}`}
        {clear}
      </li>
    );
  }
  const names = refr.kind === 'face' ? result?.faceNames : refr.kind === 'edge' ? result?.edgeNames : result?.vertexNames;
  const found = !!names?.includes(refr.name);
  return (
    <li className={found ? '' : 'missing'} title={refr.name}>
      {label}
      {!found && t('pm.lost')}
      <code>{refr.name}</code>
      {!found && <UseNearest featureId={featureId} refr={refr} />}
      {clear}
    </li>
  );
}

/** The selection boxes of reference geometry (C3.2–C3.5): what is in each, with a way to empty it, and a line saying what to click for the ones that are empty. */
function SlotList({ f }: { f: Feature }) {
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  return (
    <ul className="selection-box">
      {slotsOf(f).flatMap((slot) => {
        const refs = filled(slot);
        const items = refs.map((r, i) => (
          <RefItem key={`${slot.key}:${r.name}`} label={slot.list ? `${slot.label} ${i + 1}` : slot.label} refr={r} doc={doc} result={result} featureId={f.id} onClear={() => store.execute(fill(f, slot.key, refs.filter((_, k) => k !== i)))} />
        ));
        const open = slot.list ? refs.length < slot.list : refs.length === 0;
        if (open) items.push(<li key={`${slot.key}:empty`} className="muted">{slot.optional ? t('slot.optionalEmpty', { what: slot.label }) : t('slot.empty', { what: slot.label })}</li>);
        return items;
      })}
    </ul>
  );
}

/**
 * The default planes and the reference planes, axes and points made before this feature, that one of its boxes takes: the FeatureManager is
 * hidden while a PropertyManager is open, so this is the flyout tree of SolidWorks. A click puts the datum in the first box that takes it.
 */
function DatumPicker({ f }: { f: Feature }) {
  const doc = useStore((s) => s.doc);
  const at = doc.features.findIndex((x) => x.id === f.id);
  const slots = slotsOf(f);
  const choices = [
    ...DATUM_ITEMS.filter((d) => d.icon === 'plane').map((d) => ({ id: d.id as string, label: d.label, icon: 'plane' as const })),
    ...doc.features.slice(0, Math.max(at, 0)).flatMap((x) => (x.type === 'refPlane' || x.type === 'refAxis' || x.type === 'refPoint' ? [{ id: x.id, label: x.name, icon: x.type }] : [])),
  ].filter((c) => slots.some((s) => accepts(s.type, { kind: 'datum', name: c.id }, doc)));
  if (choices.length === 0) return null;
  return (
    <div className="datum-picker">
      {choices.map((c) => (
        <button key={c.id} title={c.label} onClick={() => store.putDatumRef({ kind: 'datum', name: c.id })}>
          <Icon name={c.icon} />
          {c.label}
        </button>
      ))}
    </div>
  );
}

/** The type of a reference geometry feature, as a drop-down list. */
function ModeSelect({ heading, value, labels, onChange }: { heading: string; value: string; labels: Record<string, string>; onChange: (mode: string) => void }) {
  return (
    <section className="pm-group">
      <h4>{heading}</h4>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(labels).map(([mode, label]) => (
          <option key={mode} value={mode}>
            {label}
          </option>
        ))}
      </select>
    </section>
  );
}

/**
 * Reference plane (C3.2): offset from a plane, at an angle to a plane through a straight edge or axis, through three points, through a point parallel
 * to a plane or square to an axis, halfway between two planes, or tangent to a cylinder. References come from the graphics area and, for planes, axes
 * and points, from the tree.
 */
function RefPlanePanel({ f }: { f: RefPlaneFeature }) {
  const d = f.def;
  const set = (def: PlaneDefinition): Command => ({ type: 'setRefPlane', featureId: f.id, def });
  const reverse = (on: boolean) => {
    const { reverse: _, ...rest } = d;
    store.execute(set((on ? { ...rest, reverse: true } : rest) as PlaneDefinition));
  };
  return (
    <>
      <ModeSelect heading={t('pm.plane.type')} value={d.mode} labels={PLANE_MODE_LABEL} onChange={(mode) => store.execute(set(planeDefinitionFor(mode as PlaneDefinition['mode'], d)))} />
      <section className="pm-group">
        <h4>{t('pm.refs')}</h4>
        <SlotList f={f} />
      <DatumPicker f={f} />
        <DatumPicker f={f} />
        {d.mode === 'offset' && (
          <label className="pm-row">
            <span>{t('pm.plane.offset')}</span>
            <ValueInput value={d.distance} toCommand={(distance) => set({ ...d, distance })} />
          </label>
        )}
        {d.mode === 'angle' && (
          <label className="pm-row">
            <span>{t('pm.plane.angle')}</span>
            <ValueInput value={d.angle} suffix="°" toCommand={(angle) => set({ ...d, angle })} />
          </label>
        )}
        <label className="pm-row checkbox">
          <input type="checkbox" checked={d.reverse ?? false} onChange={(e) => reverse(e.target.checked)} />
          <span>{t('pm.plane.reverse')}</span>
        </label>
        <p className="hint">{t(`pm.plane.hint.${d.mode}`)}</p>
      </section>
    </>
  );
}

/** Reference axis (C3.3). */
function RefAxisPanel({ f }: { f: RefAxisFeature }) {
  const d = f.def;
  return (
    <>
      <ModeSelect heading={t('pm.axis.type')} value={d.mode} labels={AXIS_MODE_LABEL} onChange={(mode) => store.execute({ type: 'setRefAxis', featureId: f.id, def: axisDefinitionFor(mode as AxisDefinition['mode']) })} />
      <section className="pm-group">
        <h4>{t('pm.refs')}</h4>
        <SlotList f={f} />
      <DatumPicker f={f} />
        <DatumPicker f={f} />
        <p className="hint">{t(`pm.axis.hint.${d.mode}`)}</p>
      </section>
    </>
  );
}

/** Reference point (C3.5). */
function RefPointPanel({ f }: { f: RefPointFeature }) {
  const d = f.def;
  const set = (def: PointDefinition): Command => ({ type: 'setRefPoint', featureId: f.id, def });
  return (
    <>
      <ModeSelect heading={t('pm.point.type')} value={d.mode} labels={POINT_MODE_LABEL} onChange={(mode) => store.execute(set(pointDefinitionFor(mode as PointDefinition['mode'])))} />
      <section className="pm-group">
        <h4>{t('pm.refs')}</h4>
        <SlotList f={f} />
      <DatumPicker f={f} />
        <DatumPicker f={f} />
        {d.mode === 'coords' &&
          (['x', 'y', 'z'] as const).map((axis) => (
            <label key={axis} className="pm-row">
              <span>{t(`pm.point.${axis}`)}</span>
              <ValueInput value={d[axis]} toCommand={(value) => set({ ...d, [axis]: value })} />
            </label>
          ))}
        <p className="hint">{t(`pm.point.hint.${d.mode}`)}</p>
      </section>
    </>
  );
}

/** Pattern (C6.1, C6.2): the seeds, the direction(s) or the axis, how many and how far apart, and the instances to leave out. */
function PatternPanel({ f }: { f: PatternFeature }) {
  const doc = useStore((s) => s.doc);
  const d = f.def;
  const at = doc.features.findIndex((x) => x.id === f.id);
  const candidates = doc.features.slice(0, Math.max(at, 0)).filter(canBeSeed);
  const cmd = (patch: { seeds?: Id[]; def?: PatternDefinition; skip?: string[] }): Command => {
    const skip = patch.skip ?? f.skip;
    return { type: 'setPattern', featureId: f.id, seeds: patch.seeds ?? f.seeds, def: patch.def ?? f.def, ...(skip && skip.length > 0 ? { skip } : {}) };
  };
  const toggleSeed = (id: Id, on: boolean) => store.execute(cmd({ seeds: on ? [...f.seeds, id] : f.seeds.filter((x) => x !== id) }));
  // the instances there are, by label, for the list of those to skip
  const counts = (() => {
    try {
      const p = new Parameters(doc);
      return d.mode === 'linear' ? [p.evaluate(d.dir1.count, 'count'), d.dir2 ? p.evaluate(d.dir2.count, 'count') : null] : [p.evaluate(d.count, 'count'), null];
    } catch {
      return null;
    }
  })();
  const labels = counts && counts[0]! >= 2 && counts[0]! <= MAX_INSTANCES && (counts[1] === null || (counts[1]! >= 2 && counts[1]! <= MAX_INSTANCES)) ? patternInstances(Math.round(counts[0]!), counts[1] === null ? null : Math.round(counts[1]!)) : [];
  const skipped = new Set(f.skip ?? []);
  const direction = (title: string, key: 'dir1' | 'dir2', x: PatternDirection) => {
    const set = (patch: Partial<PatternDirection>): Command => cmd({ def: { ...(d as Extract<PatternDefinition, { mode: 'linear' }>), [key]: { ...x, ...patch } } });
    return (
      <div key={key}>
        <h4>{title}</h4>
        <label className="pm-row">
          <span>{t('pm.pattern.spacing')}</span>
          <ValueInput value={x.spacing} toCommand={(spacing) => set({ spacing })} />
        </label>
        <label className="pm-row">
          <span>{t('pm.pattern.count')}</span>
          <ValueInput value={x.count} suffix="" toCommand={(count) => set({ count })} />
        </label>
        <label className="pm-row checkbox">
          <input type="checkbox" checked={x.reverse ?? false} onChange={(e) => store.execute(set({ reverse: e.target.checked ? true : undefined }))} />
          <span>{t('pm.pattern.reverse')}</span>
        </label>
      </div>
    );
  };
  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.pattern.seeds')}</h4>
        <ul className="selection-box">
          {candidates.length === 0 && <li className="muted">{t('pm.pattern.noSeeds')}</li>}
          {candidates.map((c) => (
            <li key={c.id}>
              <label className="pm-row checkbox">
                <input type="checkbox" checked={f.seeds.includes(c.id)} onChange={(e) => toggleSeed(c.id, e.target.checked)} />
                <span>{c.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="hint">{t('pm.pattern.seedsHint')}</p>
      </section>
      <section className="pm-group">
        <h4>{d.mode === 'linear' ? t('pm.pattern.directions') : t('pm.pattern.axis')}</h4>
        <SlotList f={f} />
        <DatumPicker f={f} />
        {d.mode === 'linear' ? (
          <>
            {direction(t('pm.pattern.dir1'), 'dir1', d.dir1)}
            {d.dir2 ? (
              <>
                {direction(t('pm.pattern.dir2'), 'dir2', d.dir2)}
                <button onClick={() => store.execute(cmd({ def: { mode: 'linear', dir1: d.dir1 }, skip: [] }))}>{t('pm.pattern.removeDir2')}</button>
              </>
            ) : (
              <button onClick={() => store.execute(cmd({ def: { ...d, dir2: { ref: { kind: 'datum', name: 'plane:top' }, spacing: '10', count: '2' } }, skip: [] }))}>{t('pm.pattern.addDir2')}</button>
            )}
          </>
        ) : (
          <>
            <label className="pm-row">
              <span>{t('pm.pattern.count')}</span>
              <ValueInput value={d.count} suffix="" toCommand={(count) => cmd({ def: { ...d, count } })} />
            </label>
            <label className="pm-row">
              <span>{t('pm.pattern.angle')}</span>
              <ValueInput value={d.angle} suffix="°" toCommand={(angle) => cmd({ def: { ...d, angle } })} />
            </label>
            <label className="pm-row checkbox">
              <input type="checkbox" checked={d.equal} onChange={(e) => store.execute(cmd({ def: { ...d, equal: e.target.checked } }))} />
              <span>{t('pm.pattern.equal')}</span>
            </label>
            <label className="pm-row checkbox">
              <input type="checkbox" checked={d.reverse ?? false} onChange={(e) => store.execute(cmd({ def: { ...d, reverse: e.target.checked ? true : undefined } }))} />
              <span>{t('pm.pattern.reverse')}</span>
            </label>
          </>
        )}
        <p className="hint">{t(d.mode === 'linear' ? 'pm.pattern.hintLinear' : 'pm.pattern.hintCircular')}</p>
      </section>
      {labels.length > 0 && (
        <section className="pm-group">
          <h4>{t('pm.pattern.skip')}</h4>
          <div className="datum-picker">
            {labels.map((x) => (
              <button key={x.label} className={skipped.has(x.label) ? 'skipped' : ''} onClick={() => store.execute(cmd({ skip: skipped.has(x.label) ? [...skipped].filter((l) => l !== x.label) : [...skipped, x.label] }))}>
                {x.label}
              </button>
            ))}
          </div>
          <p className="hint">{t('pm.pattern.skipHint')}</p>
        </section>
      )}
    </>
  );
}

/** Mirror (C6.3): features or bodies, and the plane they are reflected across. */
function MirrorPanel({ f }: { f: MirrorFeature }) {
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const at = doc.features.findIndex((x) => x.id === f.id);
  const candidates = doc.features.slice(0, Math.max(at, 0)).filter(canBeSeed);
  const value = (patch: Partial<Pick<MirrorFeature, 'target' | 'seeds' | 'bodies' | 'merge'>>): Command => ({
    type: 'setMirror',
    featureId: f.id,
    value: { target: f.target, plane: f.plane, seeds: f.seeds, bodies: f.bodies, ...(f.merge === false ? { merge: false } : {}), ...patch },
  });
  const known = (result?.bodies ?? []).map((b) => ({ id: b.id, name: b.name }));
  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.mirror.target')}</h4>
        <select value={f.target} onChange={(e) => store.execute(value({ target: e.target.value as MirrorFeature['target'] }))}>
          <option value="features">{t('pm.mirror.features')}</option>
          <option value="bodies">{t('pm.mirror.bodies')}</option>
        </select>
      </section>
      {f.target === 'features' ? (
        <section className="pm-group">
          <h4>{t('pm.pattern.seeds')}</h4>
          <ul className="selection-box">
            {candidates.length === 0 && <li className="muted">{t('pm.pattern.noSeeds')}</li>}
            {candidates.map((c) => (
              <li key={c.id}>
                <label className="pm-row checkbox">
                  <input type="checkbox" checked={f.seeds.includes(c.id)} onChange={(e) => store.execute(value({ seeds: e.target.checked ? [...f.seeds, c.id] : f.seeds.filter((x) => x !== c.id) }))} />
                  <span>{c.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="hint">{t('pm.mirror.hintFeatures')}</p>
        </section>
      ) : (
        <section className="pm-group">
          <h4>{t('pm.mirror.bodiesHeading')}</h4>
          <ul className="selection-box">
            {known.length === 0 && <li className="muted">{t('pm.mirror.noBodies')}</li>}
            {known.map((b) => (
              <li key={b.id}>
                <label className="pm-row checkbox">
                  <input
                    type="checkbox"
                    checked={f.bodies.some((x) => x.name === b.id)}
                    onChange={(e) => store.execute(value({ bodies: e.target.checked ? [...f.bodies, { kind: 'body', name: b.id }] : f.bodies.filter((x) => x.name !== b.id) }))}
                  />
                  <span>{b.name}</span>
                </label>
              </li>
            ))}
          </ul>
          <label className="pm-row checkbox">
            <input type="checkbox" checked={f.merge !== false} onChange={(e) => store.execute(value({ merge: e.target.checked }))} />
            <span>{t('pm.mirror.merge')}</span>
          </label>
          <p className="hint">{t('pm.mirror.hintBodies')}</p>
        </section>
      )}
      <section className="pm-group">
        <h4>{t('pm.mirror.plane')}</h4>
        <SlotList f={f} />
        <DatumPicker f={f} />
      </section>
    </>
  );
}

/** Coordinate system (C3.4). */
function CoordSysPanel({ f }: { f: CoordSysFeature }) {
  const flip = (key: 'flipX' | 'flipY', on: boolean) => {
    const { origin, x, y, flipX, flipY } = f;
    store.execute({ type: 'setCoordSys', featureId: f.id, value: { ...(origin ? { origin } : {}), x, y, ...(flipX ? { flipX } : {}), ...(flipY ? { flipY } : {}), [key]: on ? true : undefined } });
  };
  return (
    <section className="pm-group">
      <h4>{t('pm.refs')}</h4>
      <SlotList f={f} />
      <DatumPicker f={f} />
      <label className="pm-row checkbox">
        <input type="checkbox" checked={f.flipX ?? false} onChange={(e) => flip('flipX', e.target.checked)} />
        <span>{t('pm.coordSys.flipX')}</span>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={f.flipY ?? false} onChange={(e) => flip('flipY', e.target.checked)} />
        <span>{t('pm.coordSys.flipY')}</span>
      </label>
      <p className="hint">{t('pm.coordSys.hint')}</p>
    </section>
  );
}

/** Delete Face (C10.2): the faces to take out, by persistent name with the missing ones marked, and 「刪除鑽孔」. */
function DeleteFacePanel({ f }: { f: DeleteFaceFeature }) {
  const result = useStore((s) => s.result);
  return (
    <section className="pm-group">
      <h4>{t('pm.deleteFace.heading')}</h4>
      <ul className="selection-box">
        {f.faces.length === 0 && <li className="muted">{t('pm.deleteFace.empty')}</li>}
        {f.faces.map((r, i) => {
          const found = result?.faceNames.includes(r.name);
          return (
            <li key={r.name} className={found ? '' : 'missing'} title={r.name}>
              {t('pm.face', { n: i + 1 })}
              {!found && t('pm.lost')}
              <code>{r.name}</code>
              {!found && <UseNearest featureId={f.id} refr={r} />}
            </li>
          );
        })}
      </ul>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={f.hole ?? false} onChange={(e) => store.execute({ type: 'setFaces', featureId: f.id, faces: f.faces, ...(e.target.checked ? { hole: true } : {}) })} />
        <span>{t('pm.deleteFace.hole')}</span>
      </label>
      <p className="hint">{t('pm.deleteFace.hint', { label: FEATURE_LABEL.deleteFace })}</p>
    </section>
  );
}

/** Hole wizard (C4.8): the kind, a standard size (which fills in the diameters) or typed values, the depth and the direction. */
function HolePanel({ f }: { f: HoleFeature }) {
  const { sketch: _sketch, id: _id, type: _type, name: _name, suppressed: _suppressed, ...settings } = f;
  void [_sketch, _id, _type, _name, _suppressed];
  const run = (patch: Partial<typeof settings>) => store.execute({ type: 'setHole', featureId: f.id, hole: { ...settings, ...patch } });
  const size = holeSize(f.size ?? '');
  /** The diameters of a standard size, for the kind of hole this is (a threaded hole is drilled to its tap size, the others to the clearance). */
  const fill = (kind: HoleFeature['kind'], name: string): Partial<typeof settings> => {
    const s = holeSize(name);
    if (!s) return { kind, size: undefined };
    const base = { kind, size: name, diameter: String(kind === 'tapped' ? s.tapDrill : s.normal) };
    if (kind === 'counterbore') return { ...base, cbDiameter: String(s.cbDiameter), cbDepth: String(s.cbDepth) };
    if (kind === 'countersink') return { ...base, csDiameter: String(s.csDiameter), csAngle: '90deg' };
    return base;
  };
  const dowelNominal = Number(f.diameter);
  const limits = f.kind === 'dowel' && Number.isFinite(dowelNominal) ? holeLimits(dowelNominal, f.fit ?? 'H7') : undefined;
  const pin = f.kind === 'dowel' && limits ? pinLimits(dowelNominal, 'm6') : undefined;
  const clearance = f.kind === 'dowel' && limits ? fitClearance(dowelNominal, f.fit ?? 'H7', 'm6') : undefined;
  const kindChange = (kind: HoleFeature['kind']) =>
    kind === 'dowel'
      ? run({ kind, size: undefined, fit: f.fit ?? 'H7', chamfer: f.chamfer ?? '0.5', diameter: ISO_DOWEL_DIAMETERS.includes(dowelNominal) ? f.diameter : '6', cbDiameter: undefined, cbDepth: undefined, csDiameter: undefined, csAngle: undefined })
      : run({ ...fill(kind, f.size ?? ''), kind, fit: undefined, chamfer: undefined, ...(kind === 'counterbore' && !f.cbDiameter ? { cbDiameter: String(Number(f.diameter) * 1.8 || 11), cbDepth: '3' } : {}), ...(kind === 'countersink' && !f.csDiameter ? { csDiameter: String(Number(f.diameter) * 2 || 12), csAngle: '90deg' } : {}) });
  return (
    <section className="pm-group">
      <h4>{t('pm.hole.kind')}</h4>
      <select value={f.kind} onChange={(e) => kindChange(e.target.value as HoleFeature['kind'])}>
        <option value="straight">{t('pm.hole.straight')}</option>
        <option value="counterbore">{t('pm.hole.counterbore')}</option>
        <option value="countersink">{t('pm.hole.countersink')}</option>
        <option value="tapped">{t('pm.hole.tapped')}</option>
        <option value="dowel">{t('pm.hole.dowel')}</option>
      </select>
      {f.kind === 'dowel' ? (
        <label className="pm-row">
          <span>{t('pm.hole.size')}</span>
          <select value={ISO_DOWEL_DIAMETERS.includes(dowelNominal) ? f.diameter : ''} onChange={(e) => e.target.value && run({ diameter: e.target.value })}>
            <option value="">{t('pm.hole.custom')}</option>
            {ISO_DOWEL_DIAMETERS.map((d) => (
              <option key={d} value={String(d)}>
                {`Ø${d}`}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="pm-row">
          <span>{t('pm.hole.size')}</span>
          <select value={f.size ?? ''} onChange={(e) => run(fill(f.kind, e.target.value))}>
            <option value="">{t('pm.hole.custom')}</option>
            {ISO_HOLE_SIZES.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="pm-row">
        <span>{t('pm.hole.diameter')}</span>
        <ValueInput value={f.diameter} toCommand={(diameter) => ({ type: 'setHole', featureId: f.id, hole: { ...settings, diameter, size: undefined } })} />
      </label>
      {f.kind === 'dowel' && (
        <>
          <label className="pm-row">
            <span>{t('pm.hole.fit')}</span>
            <select value={f.fit ?? 'H7'} onChange={(e) => run({ fit: e.target.value as 'H6' | 'H7' | 'H8' })}>
              {DOWEL_FITS.map((fit) => (
                <option key={fit} value={fit}>
                  {fit}
                </option>
              ))}
            </select>
          </label>
          <label className="pm-row">
            <span>{t('pm.hole.chamfer')}</span>
            <ValueInput value={f.chamfer ?? '0'} toCommand={(chamfer) => ({ type: 'setHole', featureId: f.id, hole: { ...settings, chamfer } })} />
          </label>
          {limits && pin && clearance && (
            <p className="hint">
              {t('pm.hole.fitLimits', { fit: f.fit ?? 'H7', min: limits.min.toFixed(3), max: limits.max.toFixed(3), pin: 'm6', pinMin: pin.min.toFixed(3), pinMax: pin.max.toFixed(3), loosest: clearance.loosest.toFixed(3), tightest: clearance.tightest.toFixed(3) })}
            </p>
          )}
        </>
      )}
      {f.kind === 'counterbore' && (
        <>
          <label className="pm-row">
            <span>{t('pm.hole.cbDiameter')}</span>
            <ValueInput value={f.cbDiameter ?? '0'} toCommand={(cbDiameter) => ({ type: 'setHole', featureId: f.id, hole: { ...settings, cbDiameter } })} />
          </label>
          <label className="pm-row">
            <span>{t('pm.hole.cbDepth')}</span>
            <ValueInput value={f.cbDepth ?? '0'} toCommand={(cbDepth) => ({ type: 'setHole', featureId: f.id, hole: { ...settings, cbDepth } })} />
          </label>
        </>
      )}
      {f.kind === 'countersink' && (
        <>
          <label className="pm-row">
            <span>{t('pm.hole.csDiameter')}</span>
            <ValueInput value={f.csDiameter ?? '0'} toCommand={(csDiameter) => ({ type: 'setHole', featureId: f.id, hole: { ...settings, csDiameter } })} />
          </label>
          <label className="pm-row">
            <span>{t('pm.hole.csAngle')}</span>
            <ValueInput value={f.csAngle ?? '90deg'} suffix="°" toCommand={(csAngle) => ({ type: 'setHole', featureId: f.id, hole: { ...settings, csAngle } })} />
          </label>
        </>
      )}
      <label className="pm-row">
        <span>{t('pm.endCondition')}</span>
        <select value={f.end.type} onChange={(e) => run({ end: e.target.value === 'blind' ? { type: 'blind', depth: '10' } : { type: 'throughAll' } })}>
          <option value="blind">{t('pm.end.blind')}</option>
          <option value="throughAll">{t('feature.throughAll')}</option>
        </select>
      </label>
      {f.end.type === 'blind' && (
        <label className="pm-row">
          <span>{t('pm.depth')}</span>
          <ValueInput value={f.end.depth} toCommand={(depth) => ({ type: 'setHole', featureId: f.id, hole: { ...settings, end: { type: 'blind', depth } } })} />
        </label>
      )}
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => run({ reverse: e.target.checked ? true : undefined })} />
        <span>{t('pm.reverseDirection')}</span>
      </label>
      <p className="hint">{f.kind === 'dowel' ? t('pm.hole.dowelHint') : size ? t('pm.hole.sourceHint', { source: HOLE_STANDARD_SOURCE }) : t('pm.hole.hint')}</p>
    </section>
  );
}

/** Draft (C5.5): the neutral face, the walls that lean, the angle, and which way they lean. */
function DraftPanel({ f }: { f: DraftFeature }) {
  const result = useStore((s) => s.result);
  const run = (patch: Partial<Pick<DraftFeature, 'neutral' | 'faces' | 'angle' | 'reverse'>>) => {
    const next = { neutral: f.neutral, faces: f.faces, angle: f.angle, reverse: f.reverse, ...patch };
    store.execute({ type: 'setDraftFeature', featureId: f.id, neutral: next.neutral, faces: next.faces, angle: next.angle, ...(next.reverse ? { reverse: true } : {}) });
  };
  const row = (r: Ref, label: string) => {
    const found = result?.faceNames.includes(r.name);
    return (
      <li key={r.name + label} className={found ? '' : 'missing'} title={r.name}>
        {label}
        {!found && t('pm.lost')}
        <code>{r.name}</code>
        {!found && <UseNearest featureId={f.id} refr={r} />}
      </li>
    );
  };
  return (
    <section className="pm-group">
      <h4>{t('pm.draft.neutral')}</h4>
      <ul className="selection-box">
        {!f.neutral.name ? <li className="muted">{t('pm.draft.neutralEmpty')}</li> : row(f.neutral, t('feature.neutralPlane'))}
      </ul>
      {f.neutral.name && (
        <button type="button" className="link" onClick={() => run({ neutral: { kind: 'face', name: '' } })}>
          {t('pm.draft.reselect')}
        </button>
      )}
      <h4 className="sub">{t('pm.draft.faces')}</h4>
      <ul className="selection-box">
        {f.faces.length === 0 && <li className="muted">{t('pm.draft.facesEmpty')}</li>}
        {f.faces.map((r, i) => row(r, t('pm.face', { n: i + 1 })))}
      </ul>
      <label className="pm-row">
        <span>{t('pm.draft.angle')}</span>
        <ValueInput value={f.angle} suffix="°" toCommand={(angle) => ({ type: 'setDraftFeature', featureId: f.id, neutral: f.neutral, faces: f.faces, angle, ...(f.reverse ? { reverse: true } : {}) })} />
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => run({ reverse: e.target.checked })} />
        <span>{t('pm.draft.reverse')}</span>
      </label>
      <p className="hint">{t('pm.draft.hint')}</p>
    </section>
  );
}

/** Shell (C5.4): the faces to take away to open the body, the wall thickness, which way the wall grows, and the faces whose wall is another thickness. */
function ShellPanel({ f }: { f: ShellFeature }) {
  const result = useStore((s) => s.result);
  const mode = useStore((s) => s.shellPick);
  const walls = f.faceThickness ?? [];
  const missing = (name: string) => !result?.faceNames.includes(name);
  const withWalls = (faceThickness: { face: Ref; thickness: string }[]) => store.setShellWalls(faceThickness);
  return (
    <section className="pm-group">
      <h4>{t('pm.shell.heading')}</h4>
      <ul className="selection-box">
        {f.faces.length === 0 && <li className="muted">{t('pm.shell.empty')}</li>}
        {f.faces.map((r, i) => {
          const found = result?.faceNames.includes(r.name);
          return (
            <li key={r.name} className={found ? '' : 'missing'} title={r.name}>
              {t('pm.face', { n: i + 1 })}
              {!found && t('pm.lost')}
              <code>{r.name}</code>
              {!found && <UseNearest featureId={f.id} refr={r} />}
            </li>
          );
        })}
      </ul>
      <label className="pm-row">
        <span>{t('pm.shell.thickness')}</span>
        <ValueInput value={f.thickness} toCommand={(thickness) => ({ type: 'setShell', featureId: f.id, faces: f.faces, thickness, ...(f.outward ? { outward: true } : {}) })} />
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.outward} onChange={(e) => store.execute({ type: 'setShell', featureId: f.id, faces: f.faces, thickness: f.thickness, ...(e.target.checked ? { outward: true } : {}) })} />
        <span>{t('pm.shell.outward')}</span>
      </label>
      <h4 className="sub">{t('pm.shell.mode')}</h4>
      <label className="pm-row checkbox">
        <input type="radio" name="shell-pick" checked={mode === 'open'} onChange={() => store.setShellPick('open')} />
        <span>{t('pm.shell.modeOpen')}</span>
      </label>
      <label className="pm-row checkbox">
        <input type="radio" name="shell-pick" data-field="pick-walls" checked={mode === 'thickness'} onChange={() => store.setShellPick('thickness')} />
        <span>{t('pm.shell.modeThickness')}</span>
      </label>
      <h4 className="sub">{t('pm.shell.thicknessHeading')}</h4>
      <ul className="selection-box" data-field="walls">
        {walls.length === 0 && <li className="muted">{t('pm.shell.thicknessEmpty')}</li>}
        {walls.map((w, i) => (
          <li key={w.face.name} className={missing(w.face.name) ? 'missing' : ''} title={w.face.name}>
            <code>{w.face.name}</code>
            {missing(w.face.name) && t('pm.lost')}
            <ValueInput value={w.thickness} toCommand={(thickness) => ({ type: 'setShell', featureId: f.id, faces: f.faces, thickness: f.thickness, ...(f.outward ? { outward: true } : {}), faceThickness: walls.map((x, k) => (k === i ? { ...x, thickness } : x)) })} />
            <button className="use-nearest" title={t('slot.clear')} onClick={() => withWalls(walls.filter((_, k) => k !== i))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">{t('pm.shell.thicknessHint')}</p>
      <p className="hint">{t('pm.shell.hint')}</p>
    </section>
  );
}

/** Move Face (C10.1): the plane to push and how far along its outward normal. */
function MoveFacePanel({ f }: { f: MoveFaceFeature }) {
  const result = useStore((s) => s.result);
  const found = !!f.face.name && !!result?.faceNames.includes(f.face.name);
  return (
    <section className="pm-group">
      <h4>{t('pm.moveFace.heading')}</h4>
      <ul className="selection-box">
        {!f.face.name && <li className="muted">{t('pm.moveFace.empty')}</li>}
        {f.face.name && (
          <li className={found ? '' : 'missing'} title={f.face.name}>
            {t('pm.face', { n: 1 })}
            {!found && t('pm.lost')}
            <code>{f.face.name}</code>
            {!found && <UseNearest featureId={f.id} refr={f.face} />}
          </li>
        )}
      </ul>
      <label className="pm-row">
        <span>{t('pm.moveFace.distance')}</span>
        <ValueInput value={f.distance} toCommand={(distance) => ({ type: 'setMoveFace', featureId: f.id, face: f.face, distance })} />
      </label>
      <p className="hint">{t('pm.moveFace.hint')}</p>
    </section>
  );
}

/** One row of a selection box of faces: the name, and the nearest face to use when the reference is lost. */
function FaceRow({ featureId, r, label }: { featureId: string; r: Ref; label: string }) {
  const result = useStore((s) => s.result);
  const found = !!r.name && !!result?.faceNames.includes(r.name);
  return (
    <li className={found ? '' : 'missing'} title={r.name}>
      {label}
      {!found && t('pm.lost')}
      <code>{r.name}</code>
      {!found && <UseNearest featureId={featureId} refr={r} />}
    </li>
  );
}

/** Offset surface (C9.2): the faces, how far (positive: outward), how it goes round a corner; and the gap the result was measured to have. */
function OffsetSurfacePanel({ f }: { f: OffsetSurfaceFeature }) {
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const run = (patch: Partial<Pick<OffsetSurfaceFeature, 'faces' | 'distance' | 'join'>>): Command => {
    const next = { faces: f.faces, distance: f.distance, join: f.join, ...patch };
    return { type: 'setOffsetSurface', featureId: f.id, faces: next.faces, distance: next.distance, ...(next.join ? { join: next.join } : {}) };
  };
  return (
    <section className="pm-group">
      <h4>{t('pm.offsetSurface.heading')}</h4>
      <ul className="selection-box">
        {f.faces.length === 0 && <li className="muted">{t('pm.offsetSurface.empty')}</li>}
        {f.faces.map((r, i) => (
          <FaceRow key={r.name} featureId={f.id} r={r} label={t('pm.face', { n: i + 1 })} />
        ))}
      </ul>
      <label className="pm-row">
        <span>{t('pm.offsetSurface.distance')}</span>
        <ValueInput value={f.distance} toCommand={(distance) => run({ distance })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.offsetSurface.join')}</span>
        <select value={f.join ?? 'arc'} onChange={(e) => store.execute(run({ join: e.target.value === 'intersection' ? 'intersection' : undefined }))}>
          <option value="arc">{t('pm.offsetSurface.joinArc', { distance: f.distance })}</option>
          <option value="intersection">{t('pm.offsetSurface.joinSharp')}</option>
        </select>
      </label>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.offsetSurface.hint')}</p>
    </section>
  );
}

/** The sketch, the face, the way round and through-all of a feature that projects a sketch onto a face (a split line, a trim surface). */
function ProjectionFields({ f, command, children }: { f: SplitLineFeature | TrimSurfaceFeature; command: (patch: Partial<Pick<SplitLineFeature, 'sketch' | 'face' | 'reverse' | 'throughAll'>>) => Command; children?: ReactNode }) {
  const doc = useStore((s) => s.doc);
  const sketches = doc.features.slice(0, Math.max(0, doc.features.findIndex((x) => x.id === f.id))).filter((x) => x.type === 'sketch');
  return (
    <>
      <h4>{t('pm.splitLine.sketch')}</h4>
      {sketches.length === 0 ? (
        <p className="muted">{t('pm.splitLine.noSketch')}</p>
      ) : (
        <select value={f.sketch} onChange={(e) => store.execute(command({ sketch: e.target.value }))}>
          {sketches.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <h4 className="sub">{t('pm.splitLine.face')}</h4>
      <ul className="selection-box">
        {!f.face.name && <li className="muted">{t('pm.splitLine.faceEmpty')}</li>}
        {f.face.name && <FaceRow featureId={f.id} r={f.face} label={t('pm.face', { n: 1 })} />}
      </ul>
      {children}
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => store.execute(command({ reverse: e.target.checked }))} />
        <span>{t('pm.splitLine.reverse')}</span>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.throughAll} onChange={(e) => store.execute(command({ throughAll: e.target.checked }))} />
        <span>{t('pm.splitLine.throughAll')}</span>
      </label>
    </>
  );
}

/** Split line (C8.1): the sketch to project, the face it is projected onto, which way, and whether through every layer. */
function SplitLinePanel({ f }: { f: SplitLineFeature }) {
  const command = (patch: Partial<Pick<SplitLineFeature, 'sketch' | 'face' | 'reverse' | 'throughAll'>>): Command => {
    const next = { sketch: f.sketch, face: f.face, reverse: f.reverse, throughAll: f.throughAll, ...patch };
    return { type: 'setSplitLine', featureId: f.id, sketch: next.sketch, face: next.face, ...(next.reverse ? { reverse: true } : {}), ...(next.throughAll ? { throughAll: true } : {}) };
  };
  return (
    <section className="pm-group">
      <ProjectionFields f={f} command={command} />
      <p className="hint">{t('pm.splitLine.hint')}</p>
    </section>
  );
}

/** Trim surface (C9.3): as a split line, and which side of the outline is kept. */
function TrimSurfacePanel({ f }: { f: TrimSurfaceFeature }) {
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const command = (patch: Partial<Pick<TrimSurfaceFeature, 'sketch' | 'face' | 'keep' | 'reverse' | 'throughAll'>>): Command => {
    const next = { sketch: f.sketch, face: f.face, keep: f.keep, reverse: f.reverse, throughAll: f.throughAll, ...patch };
    return { type: 'setTrimSurface', featureId: f.id, sketch: next.sketch, face: next.face, ...(next.keep ? { keep: next.keep } : {}), ...(next.reverse ? { reverse: true } : {}), ...(next.throughAll ? { throughAll: true } : {}) };
  };
  return (
    <section className="pm-group">
      <ProjectionFields f={f} command={command}>
        <label className="pm-row">
          <span>{t('pm.trim.keep')}</span>
          <select value={f.keep ?? 'inside'} onChange={(e) => store.execute(command({ keep: e.target.value === 'outside' ? 'outside' : undefined }))}>
            <option value="inside">{t('pm.trim.inside')}</option>
            <option value="outside">{t('pm.trim.outside')}</option>
          </select>
        </label>
      </ProjectionFields>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.trim.hint')}</p>
    </section>
  );
}

/** Fill surface (C9.2): the edges of the boundary, how the patch meets the faces beside them, and what was measured of it. */
function FillSurfacePanel({ f }: { f: FillSurfaceFeature }) {
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  return (
    <>
      <EdgeList f={f} />
      <section className="pm-group">
      <label className="pm-row">
        <span>{t('pm.fill.continuity')}</span>
        <select value={f.continuity ?? 'tangent'} onChange={(e) => store.execute({ type: 'setFillSurface', featureId: f.id, edges: f.edges, ...(e.target.value === 'contact' ? { continuity: 'contact' as const } : {}) })}>
          <option value="tangent">{t('pm.fill.tangent')}</option>
          <option value="contact">{t('pm.fill.contact')}</option>
        </select>
      </label>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.fill.hint')}</p>
      </section>
    </>
  );
}

/** Flat surface (C9.2): the loop of edges. */
function FlatSurfacePanel({ f }: { f: FlatSurfaceFeature }) {
  return (
    <>
      <EdgeList f={f} />
      <section className="pm-group">
        <p className="hint">{t('pm.flat.hint')}</p>
      </section>
    </>
  );
}

/** Extend surface (C9.3): the edges to extend past and how far. */
function ExtendSurfacePanel({ f }: { f: ExtendSurfaceFeature }) {
  return (
    <>
      <EdgeList f={f} />
      <section className="pm-group">
        <label className="pm-row">
          <span>{t('pm.extend.distance')}</span>
          <ValueInput value={f.distance} toCommand={(distance) => ({ type: 'setExtendSurface', featureId: f.id, edges: f.edges, distance })} />
        </label>
        <p className="hint">{t('pm.extend.hint')}</p>
      </section>
    </>
  );
}

/** Knit (C9.3): the surface bodies to sew (ticked from the ones there were), the tolerance, whether a closed result becomes a solid, and what came of it. */
function KnitPanel({ f }: { f: KnitFeature }) {
  const pool = useStore((s) => s.bodyPool).filter((b) => b.surface);
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const picked = (id: string) => f.bodies.some((x) => x.name === id);
  const command = (patch: Partial<Pick<KnitFeature, 'bodies' | 'tolerance' | 'solid'>>): Command => {
    const next = { bodies: f.bodies, tolerance: f.tolerance, solid: f.solid, ...patch };
    return { type: 'setKnit', featureId: f.id, bodies: next.bodies, ...(next.tolerance === undefined ? {} : { tolerance: next.tolerance }), ...(next.solid === false ? { solid: false } : {}) };
  };
  return (
    <section className="pm-group">
      <h4>{t('pm.knit.bodies')}</h4>
      {pool.length === 0 && <p className="muted">{t('pm.knit.empty')}</p>}
      {pool.map((b) => (
        <label key={b.id} className="pm-row checkbox">
          <input type="checkbox" checked={picked(b.id)} onChange={() => store.setKnitBodies(picked(b.id) ? f.bodies.filter((x) => x.name !== b.id) : [...f.bodies, { kind: 'body', name: b.id }])} />
          <span>{b.name}</span>
        </label>
      ))}
      <label className="pm-row">
        <span>{t('pm.knit.tolerance')}</span>
        <ValueInput value={f.tolerance ?? ''} toCommand={(tolerance) => command({ tolerance: tolerance.trim() === '' ? undefined : tolerance })} />
      </label>
      <p className="hint">{t('pm.knit.toleranceHint')}</p>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={f.solid !== false} onChange={(e) => store.execute(command({ solid: e.target.checked }))} />
        <span>{t('pm.knit.solid')}</span>
      </label>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.knit.hint')}</p>
    </section>
  );
}

/**
 * The hook, its window and the vent (C4.11): features at the points of a sketch with a handful of sizes, an angle and (for the vent) round ends. The sizes are `fields`
 * (the key in the feature, its label), the angle is optional (empty = none); `flags` are the checkboxes.
 */
function SketchPointsPanel({ f, fields, hint }: { f: SnapHookFeature | SnapCatchFeature | VentFeature; fields: [string, string][]; hint: string }) {
  const { id, type, name, suppressed, sketch, ...settings } = f;
  void [id, type, name, suppressed, sketch];
  const run = (patch: Record<string, unknown>): Command => {
    const next = { ...settings, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k];
    return f.type === 'snapHook' ? { type: 'setSnapHook', featureId: f.id, hook: next as never } : f.type === 'snapCatch' ? { type: 'setSnapCatch', featureId: f.id, window: next as never } : { type: 'setVent', featureId: f.id, vent: next as never };
  };
  const value = (key: string): string => String((f as unknown as Record<string, unknown>)[key] ?? '');
  return (
    <section className="pm-group">
      {fields.map(([key, label]) => (
        <label className="pm-row" key={key}>
          <span>{label}</span>
          <ValueInput value={value(key)} toCommand={(v) => run({ [key]: v })} />
        </label>
      ))}
      <label className="pm-row">
        <span>{t('pm.slots.angle')}</span>
        <ValueInput value={value('angle')} toCommand={(v) => run({ angle: v })} suffix="°" />
      </label>
      {f.type === 'vent' && (
        <label className="pm-row checkbox">
          <input type="checkbox" checked={!!f.rounded} onChange={(e) => store.execute(run({ rounded: e.target.checked }))} />
          <span>{t('pm.slots.rounded')}</span>
        </label>
      )}
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => store.execute(run({ reverse: e.target.checked }))} />
        <span>{t('pm.reverseDirection')}</span>
      </label>
      <p className="hint">{hint}</p>
    </section>
  );
}

/** The gauge table of the part (C11.1): its rows, a row applied to the base flange, and the current parameters added as a row. */
function GaugeTable({ gauges, flange, apply }: { gauges: SheetGauge[]; flange: BaseFlangeFeature; apply: (g: SheetGauge) => void }) {
  const edit = (next: SheetGauge[]) => store.execute({ type: 'setSheetGauges', gauges: next });
  const number = (v: string) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : null);
  const change = (i: number, patch: Partial<SheetGauge>) => edit(gauges.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const current = () => ({ name: `${flange.thickness} mm`, thickness: number(flange.thickness) ?? 1, radius: number(flange.radius) ?? 1, kFactor: number(flange.kFactor) ?? 0.5 });
  return (
    <div className="pm-group" data-gauges>
      <h4>{t('pm.gauge.heading')}</h4>
      {gauges.length > 0 && (
        <label className="pm-row">
          <span>{t('pm.gauge.apply')}</span>
          <select value="" onChange={(e) => gauges[Number(e.target.value)] && apply(gauges[Number(e.target.value)]!)}>
            <option value="" />
            {gauges.map((g, i) => (
              <option key={g.name} value={i}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {gauges.map((g, i) => (
        <div className="pm-row" key={i} data-gauge={g.name}>
          <input value={g.name} aria-label={t('pm.gauge.name')} onChange={(e) => change(i, { name: e.target.value })} style={{ width: '5em' }} />
          <ValueInput value={String(g.thickness)} toCommand={(v) => ({ type: 'setSheetGauges', gauges: gauges.map((x, k) => (k === i ? { ...x, thickness: number(v) ?? x.thickness } : x)) })} />
          <ValueInput value={String(g.radius)} toCommand={(v) => ({ type: 'setSheetGauges', gauges: gauges.map((x, k) => (k === i ? { ...x, radius: number(v) ?? x.radius } : x)) })} />
          <ValueInput value={String(g.kFactor)} toCommand={(v) => ({ type: 'setSheetGauges', gauges: gauges.map((x, k) => (k === i ? { ...x, kFactor: number(v) ?? x.kFactor } : x)) })} />
          <button type="button" className="link" data-field="remove-gauge" onClick={() => edit(gauges.filter((_, k) => k !== i))}>
            {t('pm.gauge.remove')}
          </button>
        </div>
      ))}
      <button type="button" className="link" data-field="add-gauge" onClick={() => edit([...gauges, current()])}>
        {t('pm.gauge.add')}
      </button>
      <p className="hint">{t('pm.gauge.hint')}</p>
    </div>
  );
}

/** Base flange (C11.1): the sheet's thickness, bend radius and K-factor, and for an open profile its width; which side the thickness grows to and which way the sheet goes. */
function BaseFlangePanel({ f }: { f: BaseFlangeFeature }) {
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const gauges = useStore((s) => s.doc.sheetGauges);
  const { id, type, name, suppressed, sketch, ...settings } = f;
  void [id, type, name, suppressed, sketch];
  const run = (patch: Record<string, unknown>): Command => {
    const next = { ...settings, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k];
    return { type: 'setBaseFlange', featureId: f.id, flange: next as never };
  };
  const row = (label: string, value: string, key: string) => (
    <label className="pm-row">
      <span>{label}</span>
      <ValueInput value={value} toCommand={(v) => run({ [key]: v })} />
    </label>
  );
  return (
    <section className="pm-group">
      {row(t('pm.flange.thickness'), f.thickness, 'thickness')}
      {row(t('pm.flange.radius'), f.radius, 'radius')}
      {row(t('pm.flange.kFactor'), f.kFactor, 'kFactor')}
      {row(t('pm.flange.depth'), f.depth ?? '', 'depth')}
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.flipSide} onChange={(e) => store.execute(run({ flipSide: e.target.checked }))} />
        <span>{t('pm.flange.flipSide')}</span>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => store.execute(run({ reverse: e.target.checked }))} />
        <span>{t('pm.reverseDirection')}</span>
      </label>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <GaugeTable gauges={gauges ?? []} flange={f} apply={(g) => store.execute(run({ thickness: String(g.thickness), radius: String(g.radius), kFactor: String(g.kFactor) }))} />
      <p className="hint">{t('pm.flange.hint')}</p>
    </section>
  );
}

/** What an edge flange and a hem share beyond the edge (C11.4): how far they stop short of the two ends of it, and the relief notches beside them where they do. */
function FlangeExtras({ f, run }: { f: EdgeFlangeFeature | HemFeature; run: (patch: Record<string, unknown>) => Command }) {
  const inset = f.inset ?? { start: '0', end: '0' };
  return (
    <>
      <label className="pm-row">
        <span>{t('pm.flange.insetStart')}</span>
        <ValueInput value={inset.start} toCommand={(start) => run({ inset: { start, end: inset.end } })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.flange.insetEnd')}</span>
        <ValueInput value={inset.end} toCommand={(end) => run({ inset: { start: inset.start, end } })} />
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.relief} onChange={(e) => store.execute(run({ relief: e.target.checked ? { width: '1.5', depth: '1.5' } : undefined }))} />
        <span>{t('pm.flange.relief')}</span>
      </label>
      {f.relief && (
        <>
          <label className="pm-row">
            <span>{t('pm.flange.reliefWidth')}</span>
            <ValueInput value={f.relief.width} toCommand={(width) => run({ relief: { width, depth: f.relief!.depth } })} />
          </label>
          <label className="pm-row">
            <span>{t('pm.flange.reliefDepth')}</span>
            <ValueInput value={f.relief.depth} toCommand={(depth) => run({ relief: { width: f.relief!.width, depth } })} />
          </label>
        </>
      )}
      <p className="hint">{t('pm.flange.insetHint')}</p>
    </>
  );
}

/** Edge flange (C11.2): the edge, the length and where it is measured from, the angle, the radius, where the flange sits and which way it bends. */
/** The closed corners of an edge flange as the feature keeps them: only the ends that have a gap, none at all when neither does. */
const closed = (start?: string, end?: string) => (start === undefined && end === undefined ? undefined : { ...(start === undefined ? {} : { start }), ...(end === undefined ? {} : { end }) });

function EdgeFlangePanel({ f }: { f: EdgeFlangeFeature }) {
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const found = useStore((s) => !!f.edge.name && !!s.result?.edgeNames.includes(f.edge.name));
  const { id, type, name, suppressed, ...settings } = f;
  void [id, type, name, suppressed];
  const run = (patch: Record<string, unknown>): Command => {
    const next = { ...settings, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k];
    return { type: 'setEdgeFlange', featureId: f.id, flange: next as never };
  };
  return (
    <section className="pm-group">
      <h4>{t('pm.eflange.edge')}</h4>
      <ul className="selection-box">
        {!f.edge.name && <li className="muted">{t('pm.eflange.edgeEmpty')}</li>}
        {f.edge.name && (
          <li className={found ? '' : 'missing'} title={f.edge.name}>
            {t('pm.eflange.edgeItem')}
            {!found && t('pm.lost')}
            <code>{f.edge.name}</code>
            {!found && <UseNearest featureId={f.id} refr={f.edge} />}
          </li>
        )}
      </ul>
      <label className="pm-row">
        <span>{t('pm.eflange.length')}</span>
        <ValueInput value={f.length} toCommand={(length) => run({ length })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.eflange.lengthFrom')}</span>
        <select value={f.lengthFrom ?? 'outer'} onChange={(e) => store.execute(run({ lengthFrom: e.target.value === 'outer' ? undefined : e.target.value }))}>
          <option value="outer">{t('flange.fromOuter')}</option>
          <option value="inner">{t('flange.fromInner')}</option>
          <option value="tangent">{t('flange.fromTangent')}</option>
        </select>
      </label>
      <label className="pm-row">
        <span>{t('pm.eflange.angle')}</span>
        <ValueInput value={f.angle ?? ''} toCommand={(angle) => run({ angle })} suffix="°" />
      </label>
      <label className="pm-row">
        <span>{t('pm.eflange.radius')}</span>
        <ValueInput value={f.radius ?? ''} toCommand={(radius) => run({ radius })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.eflange.position')}</span>
        <select value={f.position ?? 'materialInside'} onChange={(e) => store.execute(run({ position: e.target.value === 'materialInside' ? undefined : e.target.value }))}>
          <option value="materialInside">{t('pm.eflange.posInside')}</option>
          <option value="bendOutside">{t('pm.eflange.posOutside')}</option>
        </select>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.flip} onChange={(e) => store.execute(run({ flip: e.target.checked }))} />
        <span>{t('pm.eflange.flip')}</span>
      </label>
      <FlangeExtras f={f} run={run} />
      <label className="pm-row">
        <span>{t('pm.eflange.cornerStart')}</span>
        <ValueInput value={f.corner?.start ?? ''} toCommand={(start) => run({ corner: closed(start === '' ? undefined : start, f.corner?.end) })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.eflange.cornerEnd')}</span>
        <ValueInput value={f.corner?.end ?? ''} toCommand={(end) => run({ corner: closed(f.corner?.start, end === '' ? undefined : end) })} />
      </label>
      <p className="hint">{t('pm.eflange.cornerHint')}</p>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.eflange.hint')}</p>
    </section>
  );
}

/** Hem (C11.2): the edge, how long the piece folded back is, the gap between the layers, where the hem sits and which way it bends. */
function HemPanel({ f }: { f: HemFeature }) {
  const found = useStore((s) => !!f.edge.name && !!s.result?.edgeNames.includes(f.edge.name));
  const { id, type, name, suppressed, ...settings } = f;
  void [id, type, name, suppressed];
  const run = (patch: Record<string, unknown>): Command => {
    const next = { ...settings, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k];
    return { type: 'setHem', featureId: f.id, hem: next as never };
  };
  return (
    <section className="pm-group">
      <h4>{t('pm.hem.edge')}</h4>
      <ul className="selection-box">
        {!f.edge.name && <li className="muted">{t('pm.eflange.edgeEmpty')}</li>}
        {f.edge.name && (
          <li className={found ? '' : 'missing'} title={f.edge.name}>
            {t('pm.eflange.edgeItem')}
            {!found && t('pm.lost')}
            <code>{f.edge.name}</code>
            {!found && <UseNearest featureId={f.id} refr={f.edge} />}
          </li>
        )}
      </ul>
      <label className="pm-row">
        <span>{t('pm.hem.length')}</span>
        <ValueInput value={f.length} toCommand={(length) => run({ length })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.hem.gap')}</span>
        <ValueInput value={f.gap} toCommand={(gap) => run({ gap })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.eflange.position')}</span>
        <select value={f.position ?? 'materialInside'} onChange={(e) => store.execute(run({ position: e.target.value === 'materialInside' ? undefined : e.target.value }))}>
          <option value="materialInside">{t('pm.eflange.posInside')}</option>
          <option value="bendOutside">{t('pm.eflange.posOutside')}</option>
        </select>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.flip} onChange={(e) => store.execute(run({ flip: e.target.checked }))} />
        <span>{t('pm.eflange.flip')}</span>
      </label>
      <FlangeExtras f={f} run={run} />
      <p className="hint">{t('pm.hem.hint')}</p>
    </section>
  );
}

/** Screw boss (C4.11): the outside and the pilot hole, the height and how deep the hole goes, the draft of the wall, and the gussets round the foot. */
function ScrewBossPanel({ f }: { f: ScrewBossFeature }) {
  const { id, type, name, suppressed, sketch, ...settings } = f;
  void [id, type, name, suppressed, sketch];
  const run = (patch: Partial<typeof settings>): Command => {
    const next = { ...settings, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
    return { type: 'setScrewBoss', featureId: f.id, boss: next as typeof settings };
  };
  const ribs = f.ribs;
  const rib = (patch: Partial<NonNullable<typeof ribs>>): Command => {
    const next = { ...ribs!, ...patch } as Record<string, unknown>;
    if (next.angle === '') delete next.angle;
    return run({ ribs: next as NonNullable<typeof ribs> });
  };
  const row = (label: string, value: string, toCommand: (v: string) => Command, suffix?: string) => (
    <label className="pm-row">
      <span>{label}</span>
      <ValueInput value={value} toCommand={toCommand} {...(suffix ? { suffix } : {})} />
    </label>
  );
  return (
    <section className="pm-group">
      {row(t('pm.boss.diameter'), f.diameter, (diameter) => run({ diameter }))}
      {row(t('pm.boss.holeDiameter'), f.holeDiameter, (holeDiameter) => run({ holeDiameter }))}
      {row(t('pm.boss.height'), f.height, (height) => run({ height }))}
      {row(t('pm.boss.holeDepth'), f.holeDepth ?? '', (holeDepth) => run({ holeDepth }))}
      {row(t('pm.boss.draft'), f.draft ?? '', (draft) => run({ draft }), '°')}
      {row(t('pm.boss.holeDraft'), f.holeDraft ?? '', (holeDraft) => run({ holeDraft }), '°')}
      {f.draft && f.holeDraft !== f.draft && (
        <button type="button" className="link" data-field="hole-draft-same" onClick={() => store.execute(run({ holeDraft: f.draft }))}>
          {t('pm.boss.holeDraftSame')}
        </button>
      )}
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => store.execute(run({ reverse: e.target.checked ? true : undefined }))} />
        <span>{t('pm.reverseDirection')}</span>
      </label>
      <h4 className="sub">{t('pm.boss.ribs')}</h4>
      {!ribs && (
        <button type="button" className="link" data-field="add-ribs" onClick={() => store.execute(run({ ribs: { count: '3', thickness: '1', length: '3', height: f.height } }))}>
          {t('pm.boss.addRibs')}
        </button>
      )}
      {ribs && (
        <>
          {row(t('pm.boss.ribCount'), ribs.count, (count) => rib({ count }))}
          {row(t('pm.boss.ribThickness'), ribs.thickness, (thickness) => rib({ thickness }))}
          {row(t('pm.boss.ribLength'), ribs.length, (length) => rib({ length }))}
          {row(t('pm.boss.ribHeight'), ribs.height, (height) => rib({ height }))}
          {row(t('pm.boss.ribAngle'), ribs.angle ?? '', (angle) => rib({ angle }), '°')}
          <button type="button" className="link" onClick={() => store.execute(run({ ribs: undefined }))}>
            {t('pm.boss.removeRibs')}
          </button>
        </>
      )}
      <p className="hint">{t('pm.boss.hint')}</p>
    </section>
  );
}

/** Lip and groove (C4.11): the planar face, which of the two, how far in from the edge, how wide and how high (deep), and what the ring came to. */
function LipGroovePanel({ f }: { f: LipGrooveFeature }) {
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const run = (patch: Partial<Pick<LipGrooveFeature, 'face' | 'kind' | 'offset' | 'width' | 'height'>>): Command => {
    const next = { face: f.face, kind: f.kind, offset: f.offset, width: f.width, height: f.height, ...patch };
    return { type: 'setLipGroove', featureId: f.id, ...next };
  };
  return (
    <section className="pm-group">
      <h4>{t('pm.lip.face')}</h4>
      <ul className="selection-box">
        {!f.face.name && <li className="muted">{t('pm.lip.faceEmpty')}</li>}
        {f.face.name && <FaceRow featureId={f.id} r={f.face} label={t('pm.face', { n: 1 })} />}
      </ul>
      <label className="pm-row">
        <span>{t('pm.lip.kind')}</span>
        <select value={f.kind} onChange={(e) => store.execute(run({ kind: e.target.value === 'groove' ? 'groove' : 'lip' }))}>
          <option value="lip">{t('lip.kindLip')}</option>
          <option value="groove">{t('lip.kindGroove')}</option>
        </select>
      </label>
      <label className="pm-row">
        <span>{t('pm.lip.offset')}</span>
        <ValueInput value={f.offset} toCommand={(offset) => run({ offset })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.lip.width')}</span>
        <ValueInput value={f.width} toCommand={(width) => run({ width })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.lip.height')}</span>
        <ValueInput value={f.height} toCommand={(height) => run({ height })} />
      </label>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.lip.hint')}</p>
    </section>
  );
}

/** Thicken (C9.4): the surface body, the thickness (negative: the other way), and what was measured of the solid. */
function ThickenPanel({ f }: { f: ThickenFeature }) {
  const pool = useStore((s) => s.bodyPool).filter((b) => b.surface);
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  return (
    <section className="pm-group">
      <h4>{t('pm.thicken.body')}</h4>
      {pool.length === 0 ? (
        <p className="muted">{t('pm.cut.empty')}</p>
      ) : (
        <select value={f.body.name} onChange={(e) => store.execute({ type: 'setThicken', featureId: f.id, body: { kind: 'body', name: e.target.value }, thickness: f.thickness })}>
          {!f.body.name && <option value="">{t('pm.cut.empty')}</option>}
          {f.body.name && !pool.some((b) => b.id === f.body.name) && <option value={f.body.name}>{f.body.name}{t('pm.lost')}</option>}
          {pool.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      <label className="pm-row">
        <span>{t('pm.thicken.thickness')}</span>
        <ValueInput value={f.thickness} toCommand={(thickness) => ({ type: 'setThicken', featureId: f.id, body: f.body, thickness })} />
      </label>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.thicken.hint')}</p>
    </section>
  );
}

/** Cut with surface (C9.4): the solid, the surface body, the plane whose normal is the way of the sweep, and which way. */
function CutWithSurfacePanel({ f }: { f: CutWithSurfaceFeature }) {
  const pool = useStore((s) => s.bodyPool);
  const doc = useStore((s) => s.doc);
  const planes = [
    ...DATUM_ITEMS.filter((d) => d.icon === 'plane').map((d) => ({ id: d.id as string, label: d.label })),
    ...doc.features.slice(0, Math.max(0, doc.features.findIndex((x) => x.id === f.id))).filter((x) => x.type === 'refPlane').map((x) => ({ id: x.id, label: x.name })),
  ];
  const pick = (label: string, value: Ref, surface: boolean, set: (ref: Ref) => void) => {
    const list = pool.filter((b) => b.surface === surface);
    return (
      <>
        <h4 className="sub">{label}</h4>
        <select value={value.name} onChange={(e) => set({ kind: 'body', name: e.target.value })}>
          {!value.name && <option value="">{t('pm.cut.empty')}</option>}
          {value.name && !list.some((b) => b.id === value.name) && <option value={value.name}>{value.name}{t('pm.lost')}</option>}
          {list.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </>
    );
  };
  return (
    <section className="pm-group">
      {pick(t('pm.cut.target'), f.target, false, (target) => store.setCut({ target }))}
      {pick(t('pm.cut.surface'), f.surface, true, (surface) => store.setCut({ surface }))}
      <h4 className="sub">{t('pm.cut.direction')}</h4>
      <select value={f.direction.name} onChange={(e) => store.setCut({ direction: { kind: 'datum', name: e.target.value } })}>
        {f.direction.kind === 'face' && <option value={f.direction.name}>{f.direction.name}</option>}
        {planes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => store.setCut({ reverse: e.target.checked })} />
        <span>{t('pm.cut.reverse')}</span>
      </label>
      <p className="hint">{t('pm.cut.hint')}</p>
    </section>
  );
}

/** Combine (C7.2): what is done, to which body, with which bodies. */
function CombinePanel({ f }: { f: CombineFeature }) {
  const result = useStore((s) => s.result);
  const bodies = result?.bodies ?? [];
  const set = (patch: Partial<Pick<CombineFeature, 'op' | 'main' | 'tools'>>): Command => ({ type: 'setCombine', featureId: f.id, op: f.op, main: f.main, tools: f.tools, ...patch });
  const body = (id: string): Ref => ({ kind: 'body', name: id });
  const toggle = (id: string) => store.execute(set({ tools: f.tools.some((x) => x.name === id) ? f.tools.filter((x) => x.name !== id) : [...f.tools, body(id)] }));
  const nameOf = (id: string) => bodies.find((b) => b.id === id)?.name ?? id;
  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.combine.op')}</h4>
        <select value={f.op} onChange={(e) => store.execute(set({ op: e.target.value as CombineFeature['op'] }))}>
          <option value="add">{t('pm.combine.add')}</option>
          <option value="subtract">{t('pm.combine.subtract')}</option>
          <option value="common">{t('pm.combine.common')}</option>
        </select>
      </section>
      <section className="pm-group">
        <h4>{t('pm.combine.main')}</h4>
        <select value={f.main.name} onChange={(e) => store.execute(set({ main: body(e.target.value), tools: f.tools.filter((x) => x.name !== e.target.value) }))}>
          {!f.main.name && <option value="">{t('pm.combine.emptyMain')}</option>}
          {f.main.name && !bodies.some((b) => b.id === f.main.name) && <option value={f.main.name}>{f.main.name}{t('pm.lost')}</option>}
          {bodies.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </section>
      <section className="pm-group">
        <h4>{t('pm.combine.tools')}</h4>
        <ul className="selection-box">
          {f.tools.length === 0 && <li className="muted">{t('pm.combine.emptyTools')}</li>}
          {f.tools.map((x) => {
            const found = bodies.some((b) => b.id === x.name);
            return (
              <li key={x.name} className={found ? '' : 'missing'} title={x.name}>
                {nameOf(x.name)}
                {!found && t('pm.lost')}
                <button className="use-nearest" onClick={() => toggle(x.name)}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
        {bodies
          .filter((b) => b.id !== f.main.name)
          .map((b) => (
            <label key={b.id} className="pm-row checkbox">
              <input type="checkbox" checked={f.tools.some((x) => x.name === b.id)} onChange={() => toggle(b.id)} />
              <span>{b.name}</span>
            </label>
          ))}
        <p className="hint">{t('pm.combine.hint')}</p>
      </section>
    </>
  );
}

/** Imported body (F2.1): where the data came from, and what happened to it on the way in. */
function ImportedBodyPanel({ f }: { f: ImportedBodyFeature }) {
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const blob = doc.blobs.find((b) => b.id === f.blob);
  const status = result?.features.find((r) => r.id === f.id);
  const warnings = status?.warnings ?? [];
  const d = status?.diagnostics;
  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.import.heading')}</h4>
        <p>{blob?.fileName ?? t('pm.import.noName')}</p>
        {warnings.map((w) => (
          <p key={w} className="warning-text">
            {w}
          </p>
        ))}
        <p className="hint">
          {t('pm.import.stored', { hash: `${blob?.sha256.slice(0, 12)}…` })}
        </p>
        <MergeBox f={f} />
      </section>
      <section className="pm-group">
        <h4>{t('pm.import.report')}</h4>
        {d ? (
          <ul className="report">
            <li>{d.solids > 0 ? t('pm.import.contents', { solids: d.solids, faces: d.faces }) : t('pm.import.contentsSurfaces', { faces: d.faces })}</li>
            <li className={d.validAfter ? '' : 'error-text'}>{!d.validBefore ? t(d.validAfter ? 'pm.import.checkHealed' : 'pm.import.checkStill') : t('pm.import.checkPassed')}</li>
            {d.sewn && <li>{t('pm.import.sewn', { tolerance: d.sewTolerance ?? 0, n: d.freeEdges ?? 0 })}</li>}
            {d.looseFaces > 0 && <li>{t('pm.import.loose', { n: d.looseFaces })}</li>}
          </ul>
        ) : (
          <p className="muted">{status?.status === 'error' ? status.message : '…'}</p>
        )}
        <label className="pm-row">
          <span>{t('pm.import.tolerance')}</span>
          <ValueInput
            value={f.sewTolerance ?? '0.01'}
            toCommand={(v) => ({ type: 'setImportOptions', featureId: f.id, ...(v ? { sewTolerance: v } : {}) })}
          />
        </label>
        <p className="hint">{t('pm.import.toleranceHint')}</p>
      </section>
    </>
  );
}

/** PropertyManager (D2): parameters of the feature being edited; ✔ commits one undo step, ✖ restores (B7.3). */
export function PropertyManager() {
  const editing = useStore((s) => s.editing);
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  if (!editing) return null;
  const f = findFeature(doc, editing.featureId);
  if (!f) return null;
  const sketching = editing.kind === 'sketch';
  // Like the message box at the top of a SolidWorks PropertyManager: why the feature cannot be built yet.
  const status = sketching ? undefined : result?.features.find((r) => r.id === f.id);
  return (
    <div className="property-manager" data-help={currentTopicId()}>
      <div className="pm-header">
        <Icon name={f.type} />
        <span className="pm-title">
          {sketching ? t('pm.editSketch') : featureLabel(f)}: {f.name}
        </span>
        <button className="pm-ok" title={sketching ? t('pm.exitSketch') : t('pm.ok')} onClick={() => store.commitEdit()}>
          <Icon name="ok" />
        </button>
        <button className="pm-cancel" title={sketching ? t('pm.discardChanges') : t('pm.cancel')} onClick={() => store.cancelEdit()}>
          <Icon name="cancel" />
        </button>
      </div>
      {status?.status === 'error' && <p className="pm-message error-text">{status.message}</p>}
      {f.type === 'sketch' && <SketchPanel f={f} />}
      {f.type === 'extrude' && <ExtrudePanel f={f} />}
      {f.type === 'revolve' && <RevolvePanel f={f} />}
      {f.type === 'sweep' && <SweepPanel f={f} />}
      {f.type === 'loft' && <LoftPanel f={f} />}
      {f.type === 'rib' && <RibPanel f={f} />}
      {f.type === 'fillet' && <FilletPanel f={f} />}
      {f.type === 'chamfer' && <ChamferPanel f={f} />}
      {f.type === 'refPlane' && <RefPlanePanel f={f} />}
      {f.type === 'refAxis' && <RefAxisPanel f={f} />}
      {f.type === 'refPoint' && <RefPointPanel f={f} />}
      {f.type === 'coordSys' && <CoordSysPanel f={f} />}
      {f.type === 'pattern' && <PatternPanel f={f} />}
      {f.type === 'mirror' && <MirrorPanel f={f} />}
      {f.type === 'importedBody' && <ImportedBodyPanel f={f} />}
      {f.type === 'deleteFace' && <DeleteFacePanel f={f} />}
      {f.type === 'shell' && <ShellPanel f={f} />}
      {f.type === 'draft' && <DraftPanel f={f} />}
      {f.type === 'hole' && <HolePanel f={f} />}
      {f.type === 'moveFace' && <MoveFacePanel f={f} />}
      {f.type === 'offsetSurface' && <OffsetSurfacePanel f={f} />}
      {f.type === 'splitLine' && <SplitLinePanel f={f} />}
      {f.type === 'trimSurface' && <TrimSurfacePanel f={f} />}
      {f.type === 'knit' && <KnitPanel f={f} />}
      {f.type === 'fillSurface' && <FillSurfacePanel f={f} />}
      {f.type === 'flatSurface' && <FlatSurfacePanel f={f} />}
      {f.type === 'extendSurface' && <ExtendSurfacePanel f={f} />}
      {f.type === 'thicken' && <ThickenPanel f={f} />}
      {f.type === 'lipGroove' && <LipGroovePanel f={f} />}
      {f.type === 'screwBoss' && <ScrewBossPanel f={f} />}
      {f.type === 'baseFlange' && <BaseFlangePanel f={f} />}
      {f.type === 'edgeFlange' && <EdgeFlangePanel f={f} />}
      {f.type === 'hem' && <HemPanel f={f} />}
      {f.type === 'snapHook' && (
        <SketchPointsPanel f={f} hint={t('pm.hook.hint')} fields={[['width', t('pm.hook.width')], ['thickness', t('pm.hook.thickness')], ['length', t('pm.hook.length')], ['hookHeight', t('pm.hook.hookHeight')], ['hookDepth', t('pm.hook.hookDepth')]]} />
      )}
      {f.type === 'snapCatch' && <SketchPointsPanel f={f} hint={t('pm.catch.hint')} fields={[['length', t('pm.slots.length')], ['width', t('pm.slots.width')], ['depth', t('pm.slots.depth')]]} />}
      {f.type === 'vent' && (
        <SketchPointsPanel f={f} hint={t('pm.vent.hint')} fields={[['count', t('pm.slots.count')], ['pitch', t('pm.slots.pitch')], ['length', t('pm.slots.length')], ['width', t('pm.slots.width')], ['depth', t('pm.slots.depth')]]} />
      )}
      {f.type === 'cutWithSurface' && <CutWithSurfacePanel f={f} />}
      {f.type === 'combine' && <CombinePanel f={f} />}
    </div>
  );
}
