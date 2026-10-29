import { FloatingFeatureEditor } from './FloatingFeatureEditor';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { labelsOf, t } from '@3db/i18n';
import { currentTopicId } from '../help/context';
import {
  canBeSeed,
  entityPoints,
  modelRefOf,
  gearParameters, gearDimensions, type SpurGearFeature, type RackFeature,
  evalLength,
  evalNumber,
  evalQuantity,
  findFeature,
  formatQuantity,
  isDimension,
  isNumber,
  isPlain,
  MAX_INSTANCES,
  Parameters,
  patternInstances,
  SKETCH_AXIS_H,
  SKETCH_AXIS_V,
  SKETCH_ORIGIN,
  type ChamferFeature,
  type CombineFeature,
  type SplitFeature,
  type MoveCopyBodyFeature,
  type DeleteKeepBodyFeature,
  type Command,
  type DeleteFaceFeature,
  type DraftFeature,
  type HoleFeature,
  type CosmeticThreadFeature,
  holeSize,
  RELIEF_SHAPES,
  HOLE_STANDARD_SOURCE,
  ISO_HOLE_SIZES,
  ALL_STANDARD_THREADS,
  lookupThread,
  threadToleranceClasses,
  validThreadTolerance,
  DOWEL_FITS,
  fitClearance,
  holeLimits,
  ISO_DOWEL_DIAMETERS,
  pinLimits,
  type EndCondition,
  type Draft,
  type ExtrudeFeature,
  type FilletFeature,
  type FilletVariablePoint,
  type FilletKind,
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
  type SheetUnfoldFeature,
  type MidBendFeature,
  type JogFeature,
  type MutualTrimFeature,
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
  type BreakCornerFeature,
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
  type ThreadFeature,
  type KnurlFeature,
  type HelixFeature,
  type ProjectedCurveFeature,
  type RuledSurfaceFeature,
  type RadiatedSurfaceFeature,
  type ReplaceFaceFeature,
  type HelixDefinedBy,
  type Thin,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
} from '@3db/model';
import type { RebuildPayload, SketchSolvePayload } from '../worker/protocol';
import { constraintsOf, conditionEnds, dimensionText, measuredText } from '@3db/sketch/interact';
import { relationsOffered } from '../sketcher/relationsOffered';
import { nearestElement } from '../state/candidates';
import { store, useSketcherView, useStore, type FilletGroup } from '../state/store';
import { accepts, attachFlip, axisDefinitionFor, fill, filled, planeDefinitionFor, pointDefinitionFor, slotsOf } from '../state/datumSlots';
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
 * expressions (D2.4): variables, other dimensions, units and functions, with the value shown beside it. Blank is red unless the field is
 * `optional` (its label says what blank means: none, the default): there blank is an entry like any other.
 */
function ValueInput({ value, toCommand, suffix = 'mm', optional = false }: { value: string; toCommand: (v: string) => Command; suffix?: string; optional?: boolean }) {
  const doc = useStore((s) => s.doc);
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const live = useStore(s => s.editing?.kind === 'feature');
  const command = useRef(toCommand); command.current = toCommand;
  const shown = preview(text, doc, suffix === '°', suffix === '');
  const missing = !optional && !text.trim();
  useEffect(() => {
    setText(value);
    setInvalid(false);
  }, [value]);
  useEffect(() => {
    if(!live||text===value||missing||(shown&&'error' in shown))return;
    const timer=setTimeout(()=>setInvalid(!store.execute(command.current(text.trim()))),280);
    return()=>clearTimeout(timer);
  },[text,value,live]);
  const commit = () => {
    if (text === value) { if (invalid) store.dismissNotice(); setInvalid(false); return; }
    setInvalid(!store.execute(toCommand(text.trim())));
  };
  return (
    <span className="value-input">
      <input
        className={invalid || missing || (shown && 'error' in shown) ? 'invalid' : ''}
        aria-invalid={invalid || missing || !!(shown && 'error' in shown)}
        value={text}
        title={shown ? ('error' in shown ? shown.error : t('value.expression', { value: shown.value })) : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            commit();
          }
        }}
      />
      {suffix !== '' && <span className="suffix">{suffix}</span>}
      {shown && 'value' in shown && <span className="value-preview">= {shown.value}</span>}
      {shown && 'error' in shown && <span className="value-error" role="status">{shown.error}</span>}
    </span>
  );
}

const ENTITY_LABEL = labelsOf({ point: 'entity.point', line: 'entity.line', circle: 'entity.circle', arc: 'entity.arc', ellipse: 'entity.ellipse', spline: 'entity.spline', text: 'entity.text' });

function describe(f: SketchFeature, id: Id): string {
  if (id === SKETCH_ORIGIN) return t('datum.origin');
  if (id === SKETCH_AXIS_H) return t('datum.sketchAxisH');
  if (id === SKETCH_AXIS_V) return t('datum.sketchAxisV');
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
    case 'stretchEntities':
    case 'moveEntities':
    case 'copyEntities':
    case 'rotateEntities':
    case 'scaleEntities':
    case 'linearPattern':
    case 'circularPattern':
      return <TransformOptions view={view} sketcher={sketcher} />;
    default:
      return null;
  }
}

/** A value of a transform tool exactly as typed: an empty or unreadable field is NaN, which the operation refuses and says why (ADR 0178, AGENTS.md §2.1). */
function TypedNumber({ label, value, name, onChange }: { label: string; value: number; name: string; onChange: (v: number) => void }) {
  return (
    <label className="pm-row">
      <span>{label}</span>
      <input type="number" step="any" name={name} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))} />
    </label>
  );
}

/** 移動／複製／旋轉／縮放圖元 and the sketch patterns (ADR 0178): 保持關係, 複製, the values and 套用. */
function TransformOptions({ view, sketcher }: { view: ControllerView; sketcher: SketchController }) {
  const o = view.options;
  const tool = view.tool;
  const set = (key: 'moveX' | 'moveY' | 'rotateAngle' | 'scaleFactor' | 'patternX' | 'patternY' | 'patternCount' | 'patternAngle' | 'pattern2X' | 'pattern2Y' | 'pattern2Count') => (v: number) => sketcher.setOption(key, v);
  const pattern = tool === 'linearPattern' || tool === 'circularPattern';
  return (
    <>
      <label className="pm-row checkbox" title={t('sketch.option.keepRelationsHint')}>
        <input type="checkbox" name="keepRelations" checked={o.keepRelations} disabled={pattern&&o.linkCopies} onChange={(e) => sketcher.setOption('keepRelations', e.target.checked)} />
        <span>{t('sketch.option.keepRelations')}</span>
      </label>
      {(tool === 'rotateEntities' || tool === 'scaleEntities') && (
        <label className="pm-row checkbox">
          <input type="checkbox" name="transformCopy" checked={o.transformCopy} onChange={(e) => sketcher.setOption('transformCopy', e.target.checked)} />
          <span>{t('sketch.option.copy')}</span>
        </label>
      )}
      {(tool==='stretchEntities' || tool === 'moveEntities' || tool === 'copyEntities') && (
        <>
          <TypedNumber label={t('sketch.option.moveX')} name="moveX" value={o.moveX} onChange={set('moveX')} />
          <TypedNumber label={t('sketch.option.moveY')} name="moveY" value={o.moveY} onChange={set('moveY')} />
        </>
      )}
      {tool === 'rotateEntities' && <TypedNumber label={t('sketch.option.angle')} name="rotateAngle" value={o.rotateAngle} onChange={set('rotateAngle')} />}
      {tool === 'scaleEntities' && <TypedNumber label={t('sketch.option.factor')} name="scaleFactor" value={o.scaleFactor} onChange={set('scaleFactor')} />}
      {tool === 'linearPattern' && (
        <>
          <TypedNumber label={t('sketch.option.patternX')} name="patternX" value={o.patternX} onChange={set('patternX')} />
          <TypedNumber label={t('sketch.option.patternY')} name="patternY" value={o.patternY} onChange={set('patternY')} />
        </>
      )}
      {pattern && <label className="pm-row checkbox"><input type="checkbox" name="linkCopies" checked={o.linkCopies} onChange={e=>sketcher.setOption('linkCopies',e.target.checked)}/>{t('sketch.option.linkCopies')}</label>}
      {tool==='linearPattern' && <><label className="pm-row checkbox"><input type="checkbox" name="secondDirection" checked={o.secondDirection} onChange={e=>sketcher.setOption('secondDirection',e.target.checked)}/>{t('sketch.option.secondDirection')}</label>{o.secondDirection&&<><TypedNumber label={t('sketch.option.pattern2X')} name="pattern2X" value={o.pattern2X} onChange={set('pattern2X')}/><TypedNumber label={t('sketch.option.pattern2Y')} name="pattern2Y" value={o.pattern2Y} onChange={set('pattern2Y')}/><TypedNumber label={t('sketch.option.pattern2Count')} name="pattern2Count" value={o.pattern2Count} onChange={set('pattern2Count')}/></>}</>}
      {pattern && <TypedNumber label={t('sketch.option.patternCount')} name="patternCount" value={o.patternCount} onChange={set('patternCount')} />}
      {tool === 'circularPattern' && <TypedNumber label={t('sketch.option.patternAngle')} name="patternAngle" value={o.patternAngle} onChange={set('patternAngle')} />}
      {tool !== 'circularPattern' && (
        <div className="relation-buttons">
          <button type="button" name="applyTransform" onClick={() => sketcher.applyToolValues()}>
            {t('sketch.option.apply')}
          </button>
        </div>
      )}
      <p className="hint">{t('sketch.option.keepRelationsHint')}</p>
    </>
  );
}

/** Over-defined sketch (A2.5, D7.2): the relations and dimensions that conflict, and what the solver confirms cures it, one click each. */
function DiagnosisBox({ f, solve, sketcher }: { f: SketchFeature; solve: SketchSolvePayload; sketcher: SketchController }) {
  const [fixes, setFixes] = useState<SketchFix[] | null>(null);
  const key = `${solve.status}|${solve.conflicting.join(',')}|${solve.redundant.join(',')}`;
  useEffect(() => {
    let live = true;
    setFixes(null);
    if (solve.status === 'over') void sketcher.diagnose().then((r) => live && setFixes(r)).catch((error:unknown)=>{if(live){setFixes([]);store.notify(error instanceof Error?error.message:String(error));}});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sketcher, f]);
  if (solve.status !== 'over') return null;
  return (
    <section className="pm-group">
      <h4>{t('sketch.diagnose.title')}</h4>
      {fixes === null && <p className="muted">{t('sketch.diagnose.busy')}</p>}
      {fixes !== null && fixes.length === 0 && <p className="hint">{t('sketch.diagnose.none')}</p>}
      {fixes !== null && fixes.length > 0 && <p className="hint">{t('sketch.diagnose.intro')}</p>}
      <ul className="relation-list">
        {(fixes ?? []).map((x) => (
          <li key={[x.id,...(x.related??[]).map(c=>c.id)].join(',')} onMouseEnter={() => sketcher.select([x.id,...(x.related??[]).map(c=>c.id)])}>
            <span>{[x,...(x.related??[])].map(c=>`${describe(f,c.id)} (${c.kind==='driven'?t('sketch.diagnose.driven'):t('sketch.diagnose.delete')})`).join(' + ')}</span>
            <button type="button" onClick={() => sketcher.applyFix(x)}>
              {t('sketch.diagnose.apply')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Finite native-solver probes, explicitly separate from the global DOF count. */
function ConstraintAnalysisBox({f,selection,sketcher,solve}:{f:SketchFeature;selection:Id[];sketcher:SketchController;solve:SketchSolvePayload|null}) {
  const [busy,setBusy]=useState(false),[motion,setMotion]=useState<Awaited<ReturnType<SketchController['motionProbes']>>|null>(null),[contributions,setContributions]=useState<Awaited<ReturnType<SketchController['constraintContributions']>>|null>(null);
  const version=useRef(0),key=selection.join(',');
  useEffect(()=>{version.current++;setMotion(null);setContributions(null);setBusy(false);return ()=>{version.current++;};},[f,key]);
  if(!solve||!['fully','under'].includes(solve.status))return null;
  const point=selection.length===1&&f.entities.some(e=>e.id===selection[0]&&e.type==='point')?selection[0]:undefined;
  const affected=new Set(selection);for(const e of f.entities){if(selection.includes(e.id))for(const p of entityPoints(e))affected.add(p);if(entityPoints(e).some(p=>selection.includes(p)))affected.add(e.id);}
  const relations=constraintsOf(f.constraints,affected);
  const run=async()=>{const current=version.current;setBusy(true);try{const m=point?await sketcher.motionProbes(point):null,c=await sketcher.constraintContributions(relations.map(c=>c.id));if(current===version.current){setMotion(m);setContributions(c);}}catch(error){if(current===version.current)store.notify(error instanceof Error?error.message:String(error));}finally{if(current===version.current)setBusy(false);}};
  if(!point&&relations.length===0)return null;
  return <div className="constraint-analysis"><button disabled={busy} onClick={()=>void run()}>{busy?t('sketch.diagnose.busy'):t('sketch.analysis.run')}</button>
    {motion!==null&&<><p className="hint">{t('sketch.analysis.motionHint')}</p>{motion.length===0?<p>{t('sketch.analysis.noMotion')}</p>:<ul>{motion.map(m=><li key={m.axis}>{t('sketch.analysis.motion',{axis:m.axis.toUpperCase(),dx:m.delta[0].toFixed(4),dy:m.delta[1].toFixed(4),dof:m.remainingDof})}</li>)}</ul>}</>}
    {contributions!==null&&contributions.length>0&&<><p className="hint">{t('sketch.analysis.contributionHint')}</p><ul>{contributions.map(c=><li key={c.id}>{describe(f,c.id)}: {t('sketch.analysis.released',{n:c.releasedDof})}</li>)}</ul></>}
  </div>;
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
/** A number typed in a box: kept as text while it is typed, and given when the box is left or Enter is pressed (a bad number puts the old one back). */
function PlainNumber({ label, value, onChange, field }: { label: string; value: number; onChange: (v: number) => void; field: string }) {
  const shown = String(Math.round(value * 1000) / 1000);
  const [text, setText] = useState<string | null>(null);
  const give = () => {
    const v = Number(text);
    setText(null);
    if (text !== null && text.trim() !== '' && Number.isFinite(v) && v !== value) onChange(v);
  };
  return (
    <label className="pm-row">
      <span>{label}</span>
      <input data-field={field} value={text ?? shown} onChange={(e) => setText(e.target.value)} onBlur={give} onKeyDown={(e) => e.key === 'Enter' && give()} style={{ width: '6em' }} />
    </label>
  );
}

/** The pictures of the sketch being edited (ADR 0116): add, place, scale from two points of the picture, fade, delete. */
function PicturesBox({ f }: { f: SketchFeature }) {
  const scale = useStore((s) => s.pictureScale);
  const doc = useStore((s) => s.doc);
  const [distance, setDistance] = useState('');
  const pictures = f.pictures ?? [];
  return (
    <section className="pm-group" data-field="pictures">
      <h4>{t('pm.picture.title')}</h4>
      <button type="button" data-field="addPicture" onClick={() => void store.addSketchPicture()}>
        {t('pm.picture.add')}
      </button>
      {pictures.length === 0 && <p className="muted">{t('pm.picture.none')}</p>}
      {pictures.map((p) => {
        const mine = scale?.pictureId === p.id ? scale : null;
        const name = doc.blobs.find((b) => b.id === p.blob)?.fileName ?? p.blob;
        return (
          <div key={p.id} data-picture={p.id} className="pm-picture">
            <strong>{t('pm.picture.name', { name })}</strong>
            <PlainNumber field="width" label={t('pm.picture.width')} value={p.width} onChange={(width) => store.setSketchPicture(p.id, { width, height: (width * p.height) / p.width })} />
            <PlainNumber field="height" label={t('pm.picture.height')} value={p.height} onChange={(height) => store.setSketchPicture(p.id, { height })} />
            <PlainNumber field="x" label={t('pm.picture.x')} value={p.x} onChange={(x) => store.setSketchPicture(p.id, { x })} />
            <PlainNumber field="y" label={t('pm.picture.y')} value={p.y} onChange={(y) => store.setSketchPicture(p.id, { y })} />
            <PlainNumber field="angle" label={t('pm.picture.angle')} value={p.angle} onChange={(angle) => store.setSketchPicture(p.id, { angle })} />
            <PlainNumber field="opacity" label={t('pm.picture.opacity')} value={p.opacity * 100} onChange={(v) => store.setSketchPicture(p.id, { opacity: Math.min(1, Math.max(0, v / 100)) })} />
            {mine ? (
              <>
                <p className="hint" data-field="scaleStatus">
                  {mine.points.length === 0 ? t('pm.picture.scaleFirst') : mine.points.length === 1 ? t('pm.picture.scaleSecond') : ''}
                </p>
                {mine.points.length === 2 && (
                  <label className="pm-row">
                    <span>{t('pm.picture.distance')}</span>
                    <input data-field="distance" value={distance} onChange={(e) => setDistance(e.target.value)} style={{ width: '6em' }} />
                    <button type="button" data-field="applyScale" onClick={() => store.finishPictureScale(Number(distance))}>
                      {t('pm.picture.apply')}
                    </button>
                  </label>
                )}
                <button type="button" onClick={() => store.cancelPictureScale()}>
                  {t('pm.picture.cancel')}
                </button>
              </>
            ) : (
              <button type="button" data-field="scalePicture" onClick={() => store.startPictureScale(p.id)}>
                {t('pm.picture.scale')}
              </button>
            )}
            <button type="button" data-field="removePicture" onClick={() => store.removeSketchPicture(p.id)}>
              {t('pm.picture.remove')}
            </button>
          </div>
        );
      })}
      <p className="hint">{t('pm.picture.hint')}</p>
    </section>
  );
}

function TextEntityBox({ f, entity, sketcher }: { f: SketchFeature; entity: Extract<SketchEntity, { type: 'text' }>; sketcher: SketchController | null }) {
  const [text, setText] = useState(entity.text);
  const [size, setSize] = useState(String(entity.size));
  const [angle, setAngle] = useState(String(entity.angle ?? 0));

  useEffect(() => {
    setText(entity.text);
    setSize(String(entity.size));
    setAngle(String(entity.angle ?? 0));
  }, [entity.id, entity.text, entity.size, entity.angle]);

  const update = (patch: { text?: string; size?: number; angle?: number; align?: 'left' | 'center' | 'right'; bold?: boolean; italic?: boolean }) => {
    store.execute({
      type: 'setSketchText',
      featureId: f.id,
      entityId: entity.id,
      ...patch,
    });
  };

  const handleTextBlur = () => {
    if (text.trim() && text !== entity.text) update({ text });
    else setText(entity.text);
  };

  const handleSizeBlur = () => {
    const s = Number(size);
    if (Number.isFinite(s) && s > 0 && s !== entity.size) update({ size: s });
    else setSize(String(entity.size));
  };

  const handleAngleBlur = () => {
    const a = Number(angle);
    if (Number.isFinite(a) && a !== (entity.angle ?? 0)) update({ angle: a });
    else setAngle(String(entity.angle ?? 0));
  };

  return (
    <div style={{ marginTop: '8px', borderTop: '1px solid var(--border-subtle, #e5e7eb)', paddingTop: '8px' }}>
      <label className="pm-row">
        <span>{t('pm.text.content')}</span>
        <input
          data-field="text-content"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={handleTextBlur}
          onKeyDown={(e) => e.key === 'Enter' && handleTextBlur()}
          style={{ width: '10em' }}
        />
      </label>
      <label className="pm-row">
        <span>{t('pm.text.size')}</span>
        <input
          data-field="text-size"
          type="number"
          min="0.1"
          step="0.5"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          onBlur={handleSizeBlur}
          onKeyDown={(e) => e.key === 'Enter' && handleSizeBlur()}
          style={{ width: '6em' }}
        />
      </label>
      <label className="pm-row">
        <span>{t('pm.text.angle')}</span>
        <input
          data-field="text-angle"
          type="number"
          step="1"
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
          onBlur={handleAngleBlur}
          onKeyDown={(e) => e.key === 'Enter' && handleAngleBlur()}
          style={{ width: '6em' }}
        />
      </label>
      <label className="pm-row">
        <span>{t('pm.text.align')}</span>
        <select
          data-field="text-align"
          value={entity.align ?? 'left'}
          onChange={(e) => update({ align: e.target.value as 'left' | 'center' | 'right' })}
        >
          <option value="left">{t('pm.text.alignLeft')}</option>
          <option value="center">{t('pm.text.alignCenter')}</option>
          <option value="right">{t('pm.text.alignRight')}</option>
        </select>
      </label>
      <div className="pm-row" style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
        <button
          type="button"
          className={entity.bold ? 'active' : ''}
          onClick={() => update({ bold: !entity.bold })}
          style={{ fontWeight: 'bold', minWidth: '40px' }}
        >
          {t('pm.text.bold')}
        </button>
        <button
          type="button"
          className={entity.italic ? 'active' : ''}
          onClick={() => update({ italic: !entity.italic })}
          style={{ fontStyle: 'italic', minWidth: '40px' }}
        >
          {t('pm.text.italic')}
        </button>
      </div>
      <div style={{ marginTop: '8px' }}>
        <button
          type="button"
          onClick={() => sketcher?.dissolveText(entity.id)}
          title={t('pm.text.dissolveHint')}
        >
          {t('pm.text.dissolve')}
        </button>
      </div>
    </div>
  );
}

function SketchPanel({ f }: { f: SketchFeature }) {
  const solve = useStore((s) => s.sketchSolve);
  const view = useSketcherView();
  const sketcher = store.sketcher;
  const selection = view?.selection ?? [];
  const { entityIds, existing, offered: allOffered } = relationsOffered(f, solve, selection);
  // every button at once, then the ones the solver would refuse go away once tried (ADR 0216)
  const [refused, setRefused] = useState<{ key: string; sketch: SketchFeature; types: Set<string> } | null>(null);
  const offeredKey = `${selection.join(',')}|${allOffered.map((r) => r.type).join(',')}|${solve?.status}`;
  useEffect(() => {
    let live = true;
    if (sketcher && allOffered.length > 0) void sketcher.refusedRelations(allOffered).then((r) => live && setRefused(r ? { key: offeredKey, sketch: f, types: r } : null)).catch(() => live && setRefused(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeredKey, sketcher, f]);
  const offered = refused && refused.key === offeredKey && refused.sketch === f ? allOffered.filter((r) => !refused.types.has(r.type)) : allOffered;
  const curves = f.entities.filter((e) => e.type !== 'point' && entityIds.includes(e.id));
  const dims = f.constraints.filter(isDimension);
  const conflicting = solve?.conflicting.map((id) => describe(f, id)) ?? [];
  const isPointId = (id: Id) => f.entities.some((e) => e.id === id && e.type === 'point');
  const canMerge = selection.length === 2 && selection.every(isPointId);
  const arcSelected = selection.length === 1 ? f.entities.find((e) => e.id === selection[0] && e.type === 'arc') : undefined;
  const textSelected = selection.length === 1 ? f.entities.find((e): e is Extract<SketchEntity, { type: 'text' }> => e.id === selection[0] && e.type === 'text') : undefined;

  return (
    <>
      {view?.message && (
        <p className="pm-note" role="status">
          {view.message}
        </p>
      )}
      {view && (
        <section className="pm-group" data-sketch-tool-status>
          <h4>{f.name} · {TOOL_LABEL[view.tool]}</h4>
          <p className="hint">{view.hint}</p>
          {view.picks.length > 0 && <ul className="selection-box">{view.picks.map(id => <li key={id}>{describe(f, id)}</li>)}</ul>}
          {sketcher && <ToolOptionsBox view={view} sketcher={sketcher} />}
          <p className="hint">{view.tool !== 'select' && t('pm.escTool')}</p>
        </section>
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

      {view?.tool === 'select' && sketcher && (view.candidates?.length ?? 0) > 1 && (
        <section className="pm-group" data-sketch-candidates>
          <h4>{t('sketch.pick.title')}</h4>
          <p className="hint">{t('sketch.pick.hint')}</p>
          <ul className="selection-box">
            {view.candidates!.map(hit => <li key={hit.id}><button type="button" data-sketch-candidate={hit.id} aria-pressed={selection.includes(hit.id)} data-preview={view.hover === hit.id} onMouseEnter={() => sketcher.previewCandidate(hit.id)} onFocus={() => sketcher.previewCandidate(hit.id)} onClick={e => sketcher.chooseCandidate(hit.id, e.ctrlKey || e.shiftKey)}>{describe(f, hit.id)}{(() => { const entity = f.entities.find(e => e.id === hit.id); const ref = entity && modelRefOf(entity); return ref ? ` · ${ref.name}` : ''; })()}</button></li>)}
          </ul>
        </section>
      )}

      <PicturesBox f={f} />
      {sketcher && solve && <DiagnosisBox f={f} solve={solve} sketcher={sketcher} />}
      {sketcher && solve && f.entities.length > 0 && <CheckBox f={f} view={view} sketcher={sketcher} />}

      {view && view.quickSnap && (
        <section className="pm-group">
          <p className="hint">
            {t('snap.quickOn', { name: t(`snap.name.${view.quickSnap}`) })}{' '}
            <button className="link" onClick={() => sketcher?.setQuickSnap(null)}>
              {t('snap.quickOff')}
            </button>
          </p>
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
          <ConstraintAnalysisBox f={f} selection={selection} sketcher={sketcher} solve={solve}/>
          {textSelected && <TextEntityBox f={f} entity={textSelected} sketcher={sketcher} />}
          {existing.length > 0 && (
            <>
              <h4 className="sub">{t('pm.existingRelations')}</h4>
              <ul className="relation-list">
                {existing.map((c) => (
                  <li key={c.id} className={solve?.conflicting.includes(c.id) ? 'over' : ''}>
                    <span>{relationText(f, c, solve?.geometry)}</span>
                    {c.type==='ellipseAxes'&&<span><label>{t('sketch.ellipseMajor')}<ValueInput value={c.majorRadius} toCommand={majorRadius=>({type:'setEllipseAxes',featureId:f.id,constraintId:c.id,majorRadius,minorRadius:c.minorRadius})}/></label><label>{t('sketch.ellipseMinor')}<ValueInput value={c.minorRadius} toCommand={minorRadius=>({type:'setEllipseAxes',featureId:f.id,constraintId:c.id,majorRadius:c.majorRadius,minorRadius})}/></label></span>}
                    {c.type==='lengthRatio'&&<ValueInput value={c.ratio} suffix="" toCommand={ratio=>({type:'setLengthRatio',featureId:f.id,constraintId:c.id,ratio})}/>}
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
          <Fragment key={c.id}>
          <label className="pm-row">
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
          {c.type === 'distance' && c.b !== undefined && solve && conditionEnds(solve.geometry, c.a, c.b, 'max') !== null && (
            <label className="pm-row">
              <span>{t('sketch.condition')}</span>
              <select value={c.condition ?? 'center'} onChange={(e) => sketcher?.setDistanceCondition(c.id, e.target.value === 'center' ? null : (e.target.value as 'min' | 'max'))}>
                <option value="center">{t('sketch.condition.center')}</option>
                <option value="min">{t('sketch.condition.min')}</option>
                <option value="max">{t('sketch.condition.max')}</option>
              </select>
            </label>
          )}
          </Fragment>
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
  const mode = f.dir2 ? 'two' : f.dir1.type==='midPlane' ? 'symmetric' : 'one';
  const direction = (next:'one'|'symmetric'|'two') => {
    const depth='depth' in f.dir1?f.dir1.depth:'10';
    const first=next==='symmetric'?{type:'midPlane' as const,depth}:f.dir1.type==='midPlane'?{type:'blind' as const,depth}:f.dir1;
    store.execute({type:'setExtrudeDirections',featureId:f.id,first,second:next==='two'?(f.dir2??{type:'blind',depth}):null});
  };
  return (
    <>
      <section className="pm-group"><h4>{t('pm.directionMode')}</h4><div className="parameter-segments" role="group" aria-label={t('pm.directionMode')}>{(['one','symmetric','two'] as const).map(m=><button type="button" key={m} data-direction-mode={m} aria-pressed={mode===m} onClick={()=>direction(m)}>{t(m==='one'?'pm.directionOne':m==='symmetric'?'pm.directionSymmetric':'pm.directionTwo')}</button>)}</div></section>
      <DirectionBox f={f} which="dir1" />
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
          {/* the sketch's own axes (ADR 0170): no centerline needs drawing to turn about one */}
          <option value={SKETCH_AXIS_H}>{t('datum.sketchAxisH')}</option>
          <option value={SKETCH_AXIS_V}>{t('datum.sketchAxisV')}</option>
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
  // another sketch, or a helix curve (ADR 0169), made before the sweep
  const paths = doc.features.filter((x, i) => (x.type === 'sketch' || x.type === 'helix') && x.id !== f.sketch && i < index);
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

/** The axes of the origin, as a thread's axis can name them. */
const ORIGIN_AXES = ['axis:x', 'axis:y', 'axis:z'];

/** Thread (ADR 0123): tooth profile sketch swept along a helix around an axis. */
function ThreadPanel({ f }: { f: ThreadFeature }) {
  const doc = useStore((s) => s.doc);
  const selectedFace = useStore((s) => s.selectedFace);
  const selected = useStore((s) => s.selected);
  const index = doc.features.findIndex((x) => x.id === f.id);
  const sketches = doc.features.filter((x, i): x is SketchFeature => x.type === 'sketch' && (index < 0 || i < index));
  const currentSketch = f.sketch ? findFeature(doc, f.sketch) : undefined;
  const lines = currentSketch?.type === 'sketch' ? currentSketch.entities.filter((e) => e.type === 'line') : [];
  const refAxes = doc.features.filter((x, i): x is RefAxisFeature => x.type === 'refAxis' && (index < 0 || i < index));

  const profileMode = f.profileMode ?? 'custom';
  const isStandard = profileMode === 'standard';

  const update = (patch: Partial<Omit<ThreadFeature, 'id' | 'type' | 'name' | 'suppressed'>>) => {
    store.execute({ type: 'setThread', featureId: f.id, params: patch });
  };

  // the axis as the value of the list: a line of the profile sketch, an axis of the origin or a reference axis, or the face or edge picked in the view
  const lineLabel = (id: string) => {
    const l = lines.find((e) => e.id === id);
    return `${l?.construction ? t('tool.centerline') : t('entity.line')} ${id}`;
  };
  const datumLabel = (name: string) => refAxes.find((a) => a.id === name)?.name ?? (ORIGIN_AXES.includes(name) ? t('pm.thread.originAxis', { a: name.slice(5).toUpperCase() }) : name);
  const encode = (axis: ThreadFeature['axis']): string => (typeof axis === 'string' ? `line:${axis}` : axis.kind === 'datum' ? `datum:${axis.name}` : `ref:${axis.kind}:${axis.name}`);
  const current = encode(f.axis);
  const axisLines = [...lines].sort((x, y) => Number(!!y.construction) - Number(!!x.construction));

  const canUseSelection = !!selectedFace || (!!selected && (selected.startsWith('axis:') || refAxes.some((a) => a.id === selected)));

  const applySelection = () => {
    if (selectedFace) {
      update({ axis: selectedFace });
    } else if (selected) {
      update({ axis: { kind: 'datum', name: selected } });
    }
  };

  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.thread.mode')}</h4>
        <div className="pm-row">
          <select
            value={profileMode}
            onChange={(e) => {
              const nextMode = e.target.value as 'standard' | 'custom';
              if (nextMode === 'standard') {
                const defaultStd = f.standardDesignation ?? 'M6';
                update({
                  profileMode: 'standard',
                  standardDesignation: defaultStd,
                  standardTarget: f.standardTarget ?? 'external',
                });
              } else {
                update({ profileMode: 'custom' });
              }
            }}
          >
            <option value="custom">{t('pm.thread.modeCustom')}</option>
            <option value="standard">{t('pm.thread.modeStandard')}</option>
          </select>
        </div>

        {isStandard ? (
          <>
            <h4>{t('pm.thread.standard')}</h4>
            <div className="pm-row">
              <select
                value={f.standardDesignation ?? 'M6'}
                onChange={(e) => update({ standardDesignation: e.target.value })}
              >
                {ALL_STANDARD_THREADS.map((std) => (
                  <option key={std.designation} value={std.designation}>
                    {std.designation} ({std.pitch.toFixed(2)} mm)
                  </option>
                ))}
              </select>
            </div>

            <h4>{t('pm.thread.target')}</h4>
            <div className="pm-row">
              <select
                value={f.standardTarget ?? 'external'}
                onChange={(e) => update({ standardTarget: e.target.value as 'external' | 'internal' })}
              >
                <option value="external">{t('pm.thread.targetExt')}</option>
                <option value="internal">{t('pm.thread.targetInt')}</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <h4>{t('pm.thread.sketch')}</h4>
            <select value={f.sketch ?? ''} onChange={(e) => update({ sketch: e.target.value })}>
              {f.sketch && !sketches.some((s) => s.id === f.sketch) && <option value={f.sketch}>{currentSketch?.name ?? f.sketch}</option>}
              {sketches.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </>
        )}

        <h4>{t('pm.thread.axis')}</h4>
        <div className="pm-row">
          <select
            value={current}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith('line:')) update({ axis: val.slice(5) });
              else if (val.startsWith('datum:')) update({ axis: { kind: 'datum', name: val.slice(6) } });
            }}
          >
            {current.startsWith('ref:') && typeof f.axis !== 'string' && <option value={current}>{f.axis.name}</option>}
            {current.startsWith('line:') && typeof f.axis === 'string' && !lines.some((l) => l.id === f.axis) && <option value={current}>{t('pm.thread.axisEmpty')}</option>}
            {axisLines.map((l) => (
              <option key={l.id} value={`line:${l.id}`}>
                {lineLabel(l.id)}
              </option>
            ))}
            {ORIGIN_AXES.map((name) => (
              <option key={name} value={`datum:${name}`}>
                {datumLabel(name)}
              </option>
            ))}
            {refAxes.map((a) => (
              <option key={a.id} value={`datum:${a.id}`}>
                {a.name}
              </option>
            ))}
            {current.startsWith('datum:') && typeof f.axis !== 'string' && !ORIGIN_AXES.includes(f.axis.name) && !refAxes.some((a) => a.id === (f.axis as { name: string }).name) && <option value={current}>{datumLabel(f.axis.name)}</option>}
          </select>
          <button type="button" disabled={!canUseSelection} title={t('pm.thread.useSelected')} onClick={applySelection}>
            {t('pm.thread.useSelected')}
          </button>
        </div>
      </section>

      <section className="pm-group">
        <h4>{t('pm.thread.op')}</h4>
        <select
          value={f.op ?? f.operation ?? 'cut'}
          onChange={(e) => update({ op: e.target.value as 'cut' | 'boss', operation: e.target.value as 'cut' | 'boss' })}
        >
          <option value="cut">{t('pm.thread.opCut')}</option>
          <option value="boss">{t('pm.thread.opBoss')}</option>
        </select>

        {!isStandard && (
          <label className="pm-row">
            <span>{t('pm.thread.pitch')}</span>
            <ValueInput value={f.pitch ?? '1'} toCommand={(pitch) => ({ type: 'setThread', featureId: f.id, params: { pitch } })} />
          </label>
        )}

        <label className="pm-row">
          <span>{t('pm.thread.starts')}</span>
          <ValueInput
            value={f.starts ?? '1'}
            suffix=""
            toCommand={(starts) => ({ type: 'setThread', featureId: f.id, params: { starts } })}
          />
        </label>

        <label className="pm-row">
          <span>{t('pm.thread.hand')}</span>
          <select value={f.hand ?? 'right'} onChange={(e) => update({ hand: e.target.value as 'right' | 'left' })}>
            <option value="right">{t('pm.thread.handRh')}</option>
            <option value="left">{t('pm.thread.handLh')}</option>
          </select>
        </label>

        <label className="pm-row">
          <span>{t('pm.thread.length')}</span>
          <ValueInput
            value={f.length ?? ''}
            toCommand={(length) => ({ type: 'setThread', featureId: f.id, params: { length } })}
          />
        </label>

        <label className="pm-row">
          <span>{t('pm.thread.taper')}</span>
          <ValueInput
            value={f.taper ?? '0'}
            suffix="°"
            toCommand={(taper) => ({ type: 'setThread', featureId: f.id, params: { taper } })}
          />
        </label>

        <label className="pm-row">
          <span>{t('pm.thread.phase')}</span>
          <ValueInput
            value={f.phase ?? '0'}
            suffix="°"
            toCommand={(phase) => ({ type: 'setThread', featureId: f.id, params: { phase } })}
          />
        </label>

        <label className="pm-row">
          <span>{t('pm.thread.fadeTurnsIn')}</span>
          <ValueInput
            value={f.fadeTurnsIn ?? '0'}
            suffix=""
            toCommand={(fadeTurnsIn) => ({ type: 'setThread', featureId: f.id, params: { fadeTurnsIn } })}
          />
        </label>

        <label className="pm-row">
          <span>{t('pm.thread.fadeTurnsOut')}</span>
          <ValueInput
            value={f.fadeTurnsOut ?? '0'}
            suffix=""
            toCommand={(fadeTurnsOut) => ({ type: 'setThread', featureId: f.id, params: { fadeTurnsOut } })}
          />
        </label>

        <label className="pm-row checkbox">
          <input type="checkbox" checked={f.reverse ?? false} onChange={(e) => update({ reverse: e.target.checked })} />
          <span>{t('pm.thread.reverse')}</span>
        </label>

        <p className="hint">{t('pm.thread.hint')}</p>
      </section>
    </>
  );
}

/**
 * Knurl (ADR 0124): the grooves of a straight, helical or diamond pattern cut into a cylinder about an axis. The axis is a face, an edge or a reference
 * axis of the model — never a line of a sketch, since no sketch is involved.
 */
function KnurlPanel({ f }: { f: KnurlFeature }) {
  const doc = useStore((s) => s.doc);
  const selectedFace = useStore((s) => s.selectedFace);
  const selected = useStore((s) => s.selected);
  const index = doc.features.findIndex((x) => x.id === f.id);
  const refAxes = doc.features.filter((x, i): x is RefAxisFeature => x.type === 'refAxis' && (index < 0 || i < index));

  const update = (patch: Partial<Omit<KnurlFeature, 'id' | 'type' | 'name' | 'suppressed'>>) => {
    store.execute({ type: 'setKnurl', featureId: f.id, knurl: patch });
  };

  const datumLabel = (name: string) => refAxes.find((a) => a.id === name)?.name ?? (ORIGIN_AXES.includes(name) ? t('pm.thread.originAxis', { a: name.slice(5).toUpperCase() }) : name);
  const current = f.axis.kind === 'datum' ? `datum:${f.axis.name}` : `ref:${f.axis.kind}:${f.axis.name}`;
  const canUseSelection = !!selectedFace || (!!selected && (selected.startsWith('axis:') || refAxes.some((a) => a.id === selected)));
  const applySelection = () => {
    if (selectedFace) update({ axis: selectedFace });
    else if (selected) update({ axis: { kind: 'datum', name: selected } });
  };

  // the circular pitch the count works out to: only when both are plain enough to read without the document's variables
  const pitch = (() => {
    try {
      const d = evalLength(f.diameter);
      const n = evalNumber(f.count);
      return d > 0 && n > 0 ? (Math.PI * d) / n : null;
    } catch {
      return null;
    }
  })();

  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.knurl.axis')}</h4>
        <div className="pm-row">
          <select
            value={current}
            onChange={(e) => {
              const val = e.target.value;
              if (val.startsWith('datum:')) update({ axis: { kind: 'datum', name: val.slice(6) } });
            }}
          >
            {current.startsWith('ref:') && <option value={current}>{f.axis.name}</option>}
            {ORIGIN_AXES.map((name) => (
              <option key={name} value={`datum:${name}`}>
                {datumLabel(name)}
              </option>
            ))}
            {refAxes.map((a) => (
              <option key={a.id} value={`datum:${a.id}`}>
                {a.name}
              </option>
            ))}
            {current.startsWith('datum:') && !ORIGIN_AXES.includes(f.axis.name) && !refAxes.some((a) => a.id === f.axis.name) && <option value={current}>{datumLabel(f.axis.name)}</option>}
          </select>
          <button type="button" disabled={!canUseSelection} title={t('pm.knurl.useSelected')} onClick={applySelection}>
            {t('pm.knurl.useSelected')}
          </button>
        </div>
      </section>

      <section className="pm-group">
        <h4>{t('pm.knurl.pattern')}</h4>
        <select value={f.pattern} onChange={(e) => update({ pattern: e.target.value as KnurlFeature['pattern'] })}>
          <option value="straight">{t('pm.knurl.straight')}</option>
          <option value="helical">{t('pm.knurl.helical')}</option>
          <option value="diamond">{t('pm.knurl.diamond')}</option>
        </select>

        <label className="pm-row">
          <span>{t('pm.knurl.diameter')}</span>
          <ValueInput value={f.diameter} toCommand={(diameter) => ({ type: 'setKnurl', featureId: f.id, knurl: { diameter } })} />
        </label>

        <label className="pm-row">
          <span>{t('pm.knurl.count')}</span>
          <ValueInput value={f.count} suffix="" toCommand={(count) => ({ type: 'setKnurl', featureId: f.id, knurl: { count } })} />
        </label>

        {pitch !== null && <p className="hint">{t('pm.knurl.pitch')}: {pitch.toFixed(3)} mm</p>}
        <p className="hint">{t('pm.knurl.pitchHint')}</p>

        <label className="pm-row">
          <span>{t('pm.knurl.length')}</span>
          <ValueInput value={f.length} toCommand={(length) => ({ type: 'setKnurl', featureId: f.id, knurl: { length } })} />
        </label>

        <label className="pm-row">
          <span>{t('pm.knurl.depth')}</span>
          <ValueInput value={f.depth} toCommand={(depth) => ({ type: 'setKnurl', featureId: f.id, knurl: { depth } })} />
        </label>

        <label className="pm-row">
          <span>{t('pm.knurl.included')}</span>
          <ValueInput value={f.included ?? '90'} suffix="°" toCommand={(included) => ({ type: 'setKnurl', featureId: f.id, knurl: { included } })} />
        </label>

        {f.pattern !== 'straight' && (
          <label className="pm-row">
            <span>{t('pm.knurl.angle')}</span>
            <ValueInput value={f.angle ?? '30'} suffix="°" toCommand={(angle) => ({ type: 'setKnurl', featureId: f.id, knurl: { angle } })} />
          </label>
        )}

        {f.pattern === 'helical' && (
          <label className="pm-row">
            <span>{t('pm.knurl.hand')}</span>
            <select value={f.hand ?? 'right'} onChange={(e) => update({ hand: e.target.value as 'right' | 'left' })}>
              <option value="right">{t('pm.knurl.handRh')}</option>
              <option value="left">{t('pm.knurl.handLh')}</option>
            </select>
          </label>
        )}

        <label className="pm-row">
          <span>{t('pm.knurl.phase')}</span>
          <ValueInput value={f.phase ?? '0'} suffix="°" toCommand={(phase) => ({ type: 'setKnurl', featureId: f.id, knurl: { phase } })} />
        </label>

        <label className="pm-row checkbox">
          <input type="checkbox" checked={f.reverse ?? false} onChange={(e) => update({ reverse: e.target.checked })} />
          <span>{t('pm.knurl.reverse')}</span>
        </label>

        <p className="hint">{t('pm.knurl.hint')}</p>
      </section>
    </>
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

/** The groups of faces of a fillet that is not the usual one, in the order the panel lists them, with what each is called. */
const FILLET_GROUPS: Record<'face' | 'full', { group: FilletGroup; label: () => string }[]> = {
  full: [
    { group: 'faces', label: () => t('pm.fillet.side1') },
    { group: 'center', label: () => t('pm.fillet.center') },
    { group: 'faces2', label: () => t('pm.fillet.side2') },
  ],
  face: [
    { group: 'faces', label: () => t('pm.fillet.group1') },
    { group: 'faces2', label: () => t('pm.fillet.group2') },
  ],
};

/** The groups of faces of a face fillet (面圓角): which one the next face picked goes into, and what each holds. */
function FilletGroups({ f }: { f: FilletFeature }) {
  const result = useStore((s) => s.result);
  const pick = useStore((s) => s.filletPick);
  const groups = FILLET_GROUPS[f.kind === 'full' ? 'full' : 'face'];
  return (
    <section className="pm-group">
      {groups.map(({ group, label }) => {
        const list = f[group] ?? [];
        return (
          <div key={group} data-group={group}>
            <label className="pm-row checkbox">
              <input type="radio" name="fillet-group" checked={pick === group} onChange={() => store.setFilletPick(group)} />
              <span>{label()}</span>
            </label>
            <ul className="selection-box">
              {list.length === 0 && <li className="muted">{t('pm.fillet.groupEmpty')}</li>}
              {list.map((x, i) => {
                const found = result?.faceNames.includes(x.name);
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
          </div>
        );
      })}
      <p className="hint">{t(f.kind === 'full' ? 'pm.fillet.fullHint' : 'pm.fillet.groupHint')}</p>
    </section>
  );
}

/** A position along an edge, 0 to 1: commits the control points on Enter/blur; a refused entry (the command says why) stays red. */
function PositionInput({ value, commit }: { value: number; commit: (t: number) => boolean }) {
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(String(value));
    setInvalid(false);
  }, [value]);
  const go = () => {
    if (text.trim() === String(value)) return;
    const n = Number(text);
    setInvalid(text.trim() === '' || !Number.isFinite(n) || !commit(n));
  };
  return (
    <span className="value-input">
      <input
        className={invalid ? 'invalid' : ''}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={go}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go();
          }
        }}
      />
    </span>
  );
}

/** The control points of a variable-radius fillet (C5.2): per picked edge, the radius at positions along it (0 = first end, 1 = last end). */
function FilletVariable({ f }: { f: FilletFeature }) {
  const points = f.variable ?? [];
  const on = points.length > 0;
  const send = (next: FilletVariablePoint[]) => store.execute({ type: 'setFilletVariable', featureId: f.id, points: next });
  const enable = (checked: boolean) => {
    if (!checked) return void send([]);
    send(f.edges.flatMap((e) => [{ edge: e.name, t: 0, radius: f.radius }, { edge: e.name, t: 1, radius: f.radius }]));
  };
  return (
    <section className="pm-group" data-fillet-variable>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={on} disabled={!on && f.edges.length === 0} onChange={(e) => enable(e.target.checked)} />
        <span>{t('pm.fillet.variable')}</span>
      </label>
      {!on && <p className="hint">{f.edges.length === 0 ? t('pm.fillet.variableNoEdges') : t('pm.fillet.variableHint')}</p>}
      {on &&
        f.edges.map((e, i) => {
          const mine = points.filter((p) => p.edge === e.name);
          const others = points.filter((p) => p.edge !== e.name);
          const put = (list: FilletVariablePoint[]) => send([...others, ...list].sort((a, b) => f.edges.findIndex((x) => x.name === a.edge) - f.edges.findIndex((x) => x.name === b.edge) || a.t - b.t));
          return (
            <div key={e.name} data-variable-edge={e.name}>
              <h4 title={e.name}>{t('pm.edges.item', { n: i + 1 })}</h4>
              {mine.length === 0 && <p className="hint">{t('pm.fillet.variableConstantEdge')}</p>}
              {mine.map((p, k) => (
                <div className="pm-row" key={k} data-variable-point>
                  <PositionInput value={p.t} commit={(n) => send(points.map((q) => (q === p ? { ...q, t: n } : q)))} />
                  <ValueInput value={p.radius} toCommand={(radius) => ({ type: 'setFilletVariable', featureId: f.id, points: points.map((q) => (q === p ? { ...q, radius } : q)) })} />
                  {p.t !== 0 && p.t !== 1 && (
                    <button className="link" title={t('pm.fillet.variableRemove')} onClick={() => put(mine.filter((q) => q !== p))}>
                      ×
                    </button>
                  )}
                </div>
              ))}
              {mine.length > 0 && (
                <button className="link" onClick={() => put([...mine, { edge: e.name, t: 0.5, radius: f.radius }])}>
                  {t('pm.fillet.variableAdd')}
                </button>
              )}
            </div>
          );
        })}
      {on && <p className="hint">{t('pm.fillet.variableHint')}</p>}
    </section>
  );
}

function FilletPanel({ f }: { f: FilletFeature }) {
  const kind = f.kind ?? 'constant';
  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.fillet.params')}</h4>
        <label className="pm-row">
          <span>{t('pm.fillet.kind')}</span>
          <select value={kind} onChange={(e) => store.setFilletKind(e.target.value as FilletKind)}>
            <option value="constant">{t('pm.fillet.kindConstant')}</option>
            <option value="face">{t('pm.fillet.kindFace')}</option>
            <option value="full">{t('pm.fillet.kindFull')}</option>
          </select>
        </label>
        {kind !== 'full' && (
          <label className="pm-row">
            <span>{t('dimension.radius')}</span>
            <ValueInput value={f.radius} toCommand={(value) => ({ type: 'setFilletRadius', featureId: f.id, value })} />
          </label>
        )}
      </section>
      {kind === 'constant' ? <EdgeList f={f} /> : <FilletGroups f={f} />}
      {kind === 'constant' && <FilletVariable f={f} />}
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
    ...doc.features.slice(0, Math.max(at, 0)).flatMap((x) => (x.type === 'refPlane' || x.type === 'refAxis' || x.type === 'refPoint' || x.type === 'coordSys' || x.type === 'sketch' ? [{ id: x.id, label: x.name, icon: x.type }] : [])),
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
        <h4>{d.mode === 'linear' ? t('pm.pattern.directions') : d.mode === 'circular' ? t('pm.pattern.axis') : t('pm.pattern.curve')}</h4>
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
        ) : d.mode === 'circular' ? (
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
        ) : (
          <>
            <label className="pm-row">
              <span>{t('pm.pattern.count')}</span>
              <ValueInput value={d.count} suffix="" toCommand={(count) => cmd({ def: { ...d, count } })} />
            </label>
            {!d.equal && (
              <label className="pm-row">
                <span>{t('pm.pattern.spacing')}</span>
                <ValueInput value={d.spacing ?? '10'} toCommand={(spacing) => cmd({ def: { ...d, spacing } })} />
              </label>
            )}
            <label className="pm-row checkbox">
              <input type="checkbox" checked={d.equal} onChange={(e) => store.execute(cmd({ def: { ...d, equal: e.target.checked } }))} />
              <span>{t('pm.pattern.equalDistance')}</span>
            </label>
            <label className="pm-row">
              <span>{t('pm.pattern.alignment')}</span>
              <select
                value={d.alignment ?? 'tangent'}
                onChange={(e) => store.execute(cmd({ def: { ...d, alignment: e.target.value as 'tangent' | 'parallel' } }))}
              >
                <option value="tangent">{t('pm.pattern.alignmentTangent')}</option>
                <option value="parallel">{t('pm.pattern.alignmentParallel')}</option>
              </select>
            </label>
            <label className="pm-row checkbox">
              <input type="checkbox" checked={d.reverse ?? false} onChange={(e) => store.execute(cmd({ def: { ...d, reverse: e.target.checked ? true : undefined } }))} />
              <span>{t('pm.pattern.reverse')}</span>
            </label>
          </>
        )}
        <p className="hint">{t(d.mode === 'linear' ? 'pm.pattern.hintLinear' : d.mode === 'circular' ? 'pm.pattern.hintCircular' : 'pm.pattern.hintCurve')}</p>
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
  const run = (patch: Partial<typeof settings>) => {
    const next = { ...settings, ...patch };
    if (!validThreadTolerance(next.toleranceClass, next.kind === 'tapped' ? next.size : undefined, 'internal')) delete next.toleranceClass;
    store.execute({ type: 'setHole', featureId: f.id, hole: next });
  };
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
        <ValueInput value={f.diameter} toCommand={(diameter) => ({ type: 'setHole', featureId: f.id, hole: { ...settings, diameter, size: undefined, toleranceClass: undefined } })} />
      </label>
      {f.kind === 'tapped' && f.size && (
        <label className="pm-row">
          <span>{t('pm.threadTolerance')}</span>
          <select data-field="holeToleranceClass" value={f.toleranceClass ?? ''} onChange={e => run({ toleranceClass: e.target.value || undefined })}>
            <option value="">{t('pm.threadToleranceNone')}</option>
            {threadToleranceClasses(f.size, 'internal').map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}
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
          <details className="hint" data-entrance-guidance>
            <summary>{t('entrance.guidanceTitle')}</summary>
            <p>{t('entrance.order')}</p>
            <p>{t('entrance.geometry')}</p>
          </details>
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

/** Mutual trim (P-3): the two surface bodies, the pieces taken away (a piece is taken away by a click on it, and taken back from the list), and what came of it. */
function MutualTrimPanel({ f }: { f: MutualTrimFeature }) {
  const pool = useStore((s) => s.bodyPool).filter((b) => b.surface);
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const choose = (which: 'a' | 'b', label: string) => (
    <label className="pm-row">
      <span>{label}</span>
      <select value={f[which].name} onChange={(e) => store.setMutualTrim({ [which]: { kind: 'body', name: e.target.value } })}>
        {!f[which].name && <option value="">{t('pm.cut.empty')}</option>}
        {f[which].name && !pool.some((b) => b.id === f[which].name) && (
          <option value={f[which].name}>
            {f[which].name}
            {t('pm.lost')}
          </option>
        )}
        {pool.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
  const away = f.discard ?? [];
  return (
    <section className="pm-group">
      <h4>{t('pm.mutualTrim.bodies')}</h4>
      {pool.length < 2 ? <p className="muted">{t('pm.mutualTrim.empty')}</p> : null}
      {choose('a', t('pm.mutualTrim.a'))}
      {choose('b', t('pm.mutualTrim.b'))}
      <h4>{t('pm.mutualTrim.away')}</h4>
      {away.length === 0 && <p className="muted">{t('pm.mutualTrim.awayNone')}</p>}
      <ul className="pm-list">
        {away.map((r) => (
          <li key={r.name}>
            <span>{r.name}</span>
            <button type="button" title={t('pm.mutualTrim.putBack')} onClick={() => store.setMutualTrim({ discard: away.filter((x) => x.name !== r.name) })}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.mutualTrim.hint')}</p>
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
        <ValueInput value={f.tolerance ?? ''} toCommand={(tolerance) => command({ tolerance: tolerance.trim() === '' ? undefined : tolerance })} optional />
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
        <ValueInput value={value('angle')} toCommand={(v) => run({ angle: v })} suffix="°" optional />
      </label>
      {f.type === 'snapHook' && (
        <>
          <label className="pm-row checkbox">
            <input
              type="checkbox"
              data-field="hookWindow"
              checked={f.windowDepth !== undefined}
              onChange={(e) => store.execute(run(e.target.checked ? { windowClearance: '0.3', windowDepth: '3' } : { windowClearance: undefined, windowDepth: undefined }))}
            />
            <span>{t('pm.hook.window')}</span>
          </label>
          {f.windowDepth !== undefined && (
            <>
              <label className="pm-row">
                <span>{t('pm.hook.windowClearance')}</span>
                <ValueInput value={value('windowClearance')} toCommand={(v) => run({ windowClearance: v })} />
              </label>
              <label className="pm-row">
                <span>{t('pm.hook.windowDepth')}</span>
                <ValueInput value={value('windowDepth')} toCommand={(v) => run({ windowDepth: v })} />
              </label>
              <p className="hint">{t('pm.hook.windowHint')}</p>
            </>
          )}
        </>
      )}
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
  const row = (label: string, value: string, key: string, optional = false) => (
    <label className="pm-row">
      <span>{label}</span>
      <ValueInput value={value} toCommand={(v) => run({ [key]: v })} optional={optional} />
    </label>
  );
  return (
    <section className="pm-group">
      {row(t('pm.flange.thickness'), f.thickness, 'thickness')}
      {row(t('pm.flange.radius'), f.radius, 'radius')}
      {row(t('pm.flange.kFactor'), f.kFactor, 'kFactor')}
      {row(t('pm.flange.depth'), f.depth ?? '', 'depth', true)}
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

/** Select construction bends to unfold; jogs remain a two-bend group. */
function SheetUnfoldPanel({f}:{f:SheetUnfoldFeature}) {
  const doc=useStore(s=>s.doc);
  const before=doc.features.slice(0,doc.features.findIndex(x=>x.id===f.id)).filter(x=>!x.suppressed&&['midBend','jog','edgeFlange','hem'].includes(x.type));
  return <div data-sheet-unfold-panel><p className="hint">{t('pm.sheetUnfold.hint')}</p>
    <label className="pm-row checkbox"><input type="checkbox" data-field="unfoldAll" disabled={!before.length} checked={!f.bends} onChange={e=>store.execute({type:'setSheetUnfold',featureId:f.id,bends:e.target.checked?null:[before[0]!.id]})} /><span>{t('pm.sheetUnfold.all')}</span></label>
    {before.map(b=><label className="pm-row checkbox" key={b.id}><input type="checkbox" data-bend={b.id} checked={!f.bends||f.bends.includes(b.id)} disabled={!f.bends} onChange={e=>store.execute({type:'setSheetUnfold',featureId:f.id,bends:e.target.checked?[...f.bends!,b.id]:f.bends!.filter(id=>id!==b.id)})}/><span>{b.name}{b.type==='jog'?t('pm.sheetUnfold.jogPair'):''}</span></label>)}
  </div>;
}

/** Mid bend (S-3): the angle, the radius, which side of the line stays and which way the other folds, and what came of it. */
function MidBendPanel({ f }: { f: MidBendFeature }) {
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const { id, type, name, suppressed, sketch, ...settings } = f;
  void [id, type, name, suppressed, sketch];
  const run = (patch: Record<string, unknown>): Command => {
    const next = { ...settings, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k];
    return { type: 'setMidBend', featureId: f.id, midBend: next as never };
  };
  return (
    <section className="pm-group">
      <label className="pm-row">
        <span>{t('pm.midBend.angle')}</span>
        <ValueInput value={f.angle} toCommand={(angle) => run({ angle })} suffix="°" />
      </label>
      <label className="pm-row">
        <span>{t('pm.midBend.radius')}</span>
        <ValueInput value={f.radius ?? ''} toCommand={(radius) => run({ radius })} optional />
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.flipSide} onChange={(e) => store.execute(run({ flipSide: e.target.checked }))} />
        <span>{t('pm.midBend.flipSide')}</span>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => store.execute(run({ reverse: e.target.checked }))} />
        <span>{t('pm.midBend.reverse')}</span>
      </label>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.midBend.hint')}</p>
    </section>
  );
}

/** Jog (C11.3, ADR 0159): offset height, angle, radius, flip side, reverse, and result info. */
function JogPanel({ f }: { f: JogFeature }) {
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const { id, type, name, suppressed, sketch, ...settings } = f;
  void [id, type, name, suppressed, sketch];
  const run = (patch: Record<string, unknown>): Command => {
    const next = { ...settings, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k];
    return { type: 'setJog', featureId: f.id, jog: next as never };
  };
  return (
    <section className="pm-group">
      <label className="pm-row">
        <span>{t('pm.jog.offset')}</span>
        <ValueInput value={f.offset} toCommand={(offset) => run({ offset })} />
      </label>
      <label className="pm-row">
        <span>{t('pm.jog.angle')}</span>
        <ValueInput value={f.angle ?? ''} toCommand={(angle) => run({ angle })} suffix="°" optional />
      </label>
      <label className="pm-row">
        <span>{t('pm.jog.radius')}</span>
        <ValueInput value={f.radius ?? ''} toCommand={(radius) => run({ radius })} optional />
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.flipSide} onChange={(e) => store.execute(run({ flipSide: e.target.checked }))} />
        <span>{t('pm.jog.flipSide')}</span>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => store.execute(run({ reverse: e.target.checked }))} />
        <span>{t('pm.jog.reverse')}</span>
      </label>
      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="hint">{t('pm.jog.hint')}</p>
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
            <span>{t('pm.flange.reliefShape')}</span>
            <select data-field="reliefShape" value={f.relief.shape ?? 'rect'} onChange={(e) => store.execute(run({ relief: { width: f.relief!.width, depth: f.relief!.depth, ...(e.target.value === 'rect' ? {} : { shape: e.target.value }) } }))}>
              {RELIEF_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {t(`pm.flange.reliefShape.${s}`)}
                </option>
              ))}
            </select>
          </label>
          {f.relief.shape !== 'tear' && (
            <label className="pm-row">
              <span>{t('pm.flange.reliefWidth')}</span>
              <ValueInput value={f.relief.width} toCommand={(width) => run({ relief: { ...f.relief!, width } })} />
            </label>
          )}
          <label className="pm-row">
            <span>{t('pm.flange.reliefDepth')}</span>
            <ValueInput value={f.relief.depth} toCommand={(depth) => run({ relief: { ...f.relief!, depth } })} />
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
        <ValueInput value={f.angle ?? ''} toCommand={(angle) => run({ angle })} suffix="°" optional />
      </label>
      <label className="pm-row">
        <span>{t('pm.eflange.radius')}</span>
        <ValueInput value={f.radius ?? ''} toCommand={(radius) => run({ radius })} optional />
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
        <ValueInput value={f.corner?.start ?? ''} toCommand={(start) => run({ corner: closed(start === '' ? undefined : start, f.corner?.end) })} optional />
      </label>
      <label className="pm-row">
        <span>{t('pm.eflange.cornerEnd')}</span>
        <ValueInput value={f.corner?.end ?? ''} toCommand={(end) => run({ corner: closed(f.corner?.start, end === '' ? undefined : end) })} optional />
      </label>
      <p className="hint">{t('pm.eflange.cornerHint')}</p>
      <label className="pm-row">
        <span>{t('pm.eflange.miterStart')}</span>
        <ValueInput value={f.miter?.start ?? ''} toCommand={(start) => run({ miter: closed(start === '' ? undefined : start, f.miter?.end) })} optional />
      </label>
      <label className="pm-row">
        <span>{t('pm.eflange.miterEnd')}</span>
        <ValueInput value={f.miter?.end ?? ''} toCommand={(end) => run({ miter: closed(f.miter?.start, end === '' ? undefined : end) })} optional />
      </label>
      <p className="hint">{t('pm.eflange.miterHint')}</p>
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

/** Break corner (C11.4): treatment and size for selected flange free-end corners. */
function BreakCornerPanel({ f }: { f: BreakCornerFeature }) {
  const result = useStore((s) => s.result);
  const run = (kind: BreakCornerFeature['kind'], size: string): Command => ({ type: 'setBreakCorner', featureId: f.id, corners: f.corners, kind, size });
  return (
    <section className="pm-group">
      <h4>{t('pm.breakCorner.edge')}</h4>
      <ul className="selection-box">
        {f.corners.length === 0 && <li className="muted">{t('pm.breakCorner.edgeEmpty')}</li>}
        {f.corners.map((corner) => {
          const found = result?.edgeNames.includes(corner.name) ?? false;
          return <li key={corner.name} className={found ? '' : 'missing'} title={corner.name}>{t('pm.breakCorner.edgeItem')}{!found && t('pm.lost')}<code>{corner.name}</code>{!found && <UseNearest featureId={f.id} refr={corner} />}</li>;
        })}
      </ul>
      <label className="pm-row">
        <span>{t('pm.breakCorner.kind')}</span>
        <select data-field="breakCornerKind" value={f.kind} onChange={(e) => store.execute(run(e.target.value as BreakCornerFeature['kind'], f.size))}>
          <option value="chamfer">{t('pm.breakCorner.chamfer')}</option>
          <option value="fillet">{t('pm.breakCorner.fillet')}</option>
        </select>
      </label>
      <label className="pm-row">
        <span>{t('pm.breakCorner.size')}</span>
        <ValueInput value={f.size} toCommand={(size) => run(f.kind, size)} />
      </label>
      <p className="hint">{t('pm.breakCorner.hint')}</p>
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
  const row = (label: string, value: string, toCommand: (v: string) => Command, suffix?: string, optional = false) => (
    <label className="pm-row">
      <span>{label}</span>
      <ValueInput value={value} toCommand={toCommand} {...(suffix ? { suffix } : {})} optional={optional} />
    </label>
  );
  return (
    <section className="pm-group">
      {row(t('pm.boss.diameter'), f.diameter, (diameter) => run({ diameter }))}
      {row(t('pm.boss.holeDiameter'), f.holeDiameter, (holeDiameter) => run({ holeDiameter }))}
      {row(t('pm.boss.height'), f.height, (height) => run({ height }))}
      {row(t('pm.boss.holeDepth'), f.holeDepth ?? '', (holeDepth) => run({ holeDepth }), undefined, true)}
      {row(t('pm.boss.draft'), f.draft ?? '', (draft) => run({ draft }), '°', true)}
      {row(t('pm.boss.holeDraft'), f.holeDraft ?? '', (holeDraft) => run({ holeDraft }), '°', true)}
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
          {row(t('pm.boss.ribAngle'), ribs.angle ?? '', (angle) => rib({ angle }), '°', true)}
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
        <select value={f.body.name} onChange={(e) => store.execute({ type: 'setThicken', featureId: f.id, body: { kind: 'body', name: e.target.value }, thickness: f.thickness, both: f.both, keepSurface: f.keepSurface })}>
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
        <ValueInput value={f.thickness} toCommand={(thickness) => ({ type: 'setThicken', featureId: f.id, body: f.body, thickness, both: f.both, keepSurface: f.keepSurface })} />
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" data-field="thickenBoth" checked={!!f.both} onChange={(e) => store.execute({ type: 'setThicken', featureId: f.id, body: f.body, thickness: f.thickness, both: e.target.checked, keepSurface: f.keepSurface })} />
        <span>{t('pm.thicken.both')}</span>
      </label>
      <label className="pm-row checkbox">
        <input type="checkbox" data-field="thickenKeep" checked={!!f.keepSurface} onChange={(e) => store.execute({ type: 'setThicken', featureId: f.id, body: f.body, thickness: f.thickness, both: f.both, keepSurface: e.target.checked })} />
        <span>{t('pm.thicken.keep')}</span>
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
  const vector = f.direction.kind === 'vector' ? f.direction.value : null;
  const axisLabels = [t('pm.cut.vectorX'), t('pm.cut.vectorY'), t('pm.cut.vectorZ')];
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
      <label className="pm-row"><span>{t('pm.cut.directionKind')}</span>
        <select data-field="cutDirectionKind" value={f.direction.kind === 'vector' ? 'vector' : 'reference'} onChange={(e) => store.setCut({ direction: e.target.value === 'vector' ? { kind: 'vector', value: [0, 0, 1] } : { kind: 'datum', name: 'plane:front' } })}>
          <option value="reference">{t('pm.cut.reference')}</option>
          <option value="vector">{t('pm.cut.vector')}</option>
        </select>
      </label>
      {vector ? (
        (['x', 'y', 'z'] as const).map((axis, i) => <label className="pm-row" key={axis}>
          <span>{axisLabels[i]}</span>
          <input className="cut-vector-component" data-field={`cutDirection${axis.toUpperCase()}`} aria-label={axisLabels[i]} type="number" step="any" value={vector[i]} onChange={(e) => {
            const value: [number, number, number] = [...vector];
            value[i] = Number(e.target.value);
            store.setCut({ direction: { kind: 'vector', value } });
          }} />
        </label>)
      ) : f.direction.kind !== 'vector' ? (
        <select data-field="cutDirectionRef" value={f.direction.name} onChange={(e) => store.setCut({ direction: { kind: 'datum', name: e.target.value } })}>
          {f.direction.kind === 'face' && <option value={f.direction.name}>{f.direction.name}</option>}
          {planes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      ) : null}
      <label className="pm-row checkbox">
        <input type="checkbox" checked={!!f.reverse} onChange={(e) => store.setCut({ reverse: e.target.checked })} />
        <span>{t('pm.cut.reverse')}</span>
      </label>
      <label className="pm-row"><span>{t('pm.cut.keep')}</span>
        <select data-field="cutKeep" value={f.keep ?? 'behind'} onChange={(e) => store.setCut({ keep: e.target.value as 'behind' | 'ahead' })}>
          <option value="behind">{t('pm.cut.keepBehind')}</option>
          <option value="ahead">{t('pm.cut.keepAhead')}</option>
        </select>
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

/** Split feature (C7.4, ADR 0158): cutting tool (datum plane or planar face) and optional target bodies. */
function SplitPanel({ f }: { f: SplitFeature }) {
  const result = useStore((s) => s.result);
  const bodies = (result?.bodies ?? []).filter((b) => !b.surface);
  const set = (patch: Partial<Pick<SplitFeature, 'tool' | 'targets'>>): Command => ({
    type: 'setSplit',
    featureId: f.id,
    tool: f.tool,
    targets: f.targets,
    ...patch,
  });

  const body = (name: string): Ref => ({ kind: 'body', name });
  const toggle = (id: string) => {
    const list = f.targets ?? [];
    const next = list.some((x) => x.name === id) ? list.filter((x) => x.name !== id) : [...list, body(id)];
    store.execute(set({ targets: next }));
  };

  const nameOf = (id: string) => bodies.find((b) => b.id === id)?.name ?? id;

  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.split.tool')}</h4>
        <div className="pm-row">
          <input type="text" readOnly value={f.tool.name || t('cmd.mustPickPlane')} />
        </div>
      </section>
      <section className="pm-group">
        <h4>{t('pm.split.targets')}</h4>
        <ul className="selection-box">
          {(!f.targets || f.targets.length === 0) && <li className="muted">{t('pm.split.allBodies')}</li>}
          {f.targets?.map((x) => {
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
        {bodies.map((b) => (
          <label key={b.id} className="pm-row checkbox">
            <input type="checkbox" checked={f.targets?.some((x) => x.name === b.id) ?? false} onChange={() => toggle(b.id)} />
            <span>{b.name}</span>
          </label>
        ))}
      </section>
    </>
  );
}

/** Move/Copy Body feature (C7.3, ADR 0164): translation offsets, rotation axis and angle, copy toggle. */
function MoveCopyBodyPanel({ f }: { f: MoveCopyBodyFeature }) {
  const result = useStore((s) => s.result);
  const bodies = (result?.bodies ?? []).filter((b) => !b.surface);
  const update = (patch: Partial<Omit<MoveCopyBodyFeature, 'id' | 'type' | 'name' | 'suppressed'>>) => {
    store.execute({
      type: 'setMoveCopyBody',
      featureId: f.id,
      targets: f.targets,
      dx: f.dx,
      dy: f.dy,
      dz: f.dz,
      rotationAxis: f.rotationAxis,
      rotationAngle: f.rotationAngle,
      copy: f.copy,
      ...patch,
    });
  };

  const body = (name: string): Ref => ({ kind: 'body', name });
  const toggle = (id: string) => {
    const list = f.targets ?? [];
    const next = list.some((x) => x.name === id) ? list.filter((x) => x.name !== id) : [...list, body(id)];
    update({ targets: next });
  };

  const nameOf = (id: string) => bodies.find((b) => b.id === id)?.name ?? id;

  const currentAxisMode = () => {
    if (!f.rotationAxis || f.rotationAxis === 'z') return 'z';
    if (f.rotationAxis === 'x') return 'x';
    if (f.rotationAxis === 'y') return 'y';
    return 'ref';
  };

  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.moveCopyBody.targets')}</h4>
        <ul className="selection-box">
          {(!f.targets || f.targets.length === 0) && <li className="muted">{t('feature.moveCopyNoTargets')}</li>}
          {f.targets?.map((x) => {
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
        {bodies.map((b) => (
          <label key={b.id} className="pm-row checkbox">
            <input type="checkbox" checked={f.targets?.some((x) => x.name === b.id) ?? false} onChange={() => toggle(b.id)} />
            <span>{b.name}</span>
          </label>
        ))}
      </section>

      <section className="pm-group">
        <h4>{t('pm.moveCopyBody.translate')}</h4>
        <label className="pm-row">
          <span>{t('pm.moveCopyBody.dx')}</span>
          <ValueInput value={f.dx ?? '0'} toCommand={(dx) => ({ type: 'setMoveCopyBody', featureId: f.id, targets: f.targets, dx, dy: f.dy, dz: f.dz, rotationAxis: f.rotationAxis, rotationAngle: f.rotationAngle, copy: f.copy })} />
        </label>
        <label className="pm-row">
          <span>{t('pm.moveCopyBody.dy')}</span>
          <ValueInput value={f.dy ?? '0'} toCommand={(dy) => ({ type: 'setMoveCopyBody', featureId: f.id, targets: f.targets, dx: f.dx, dy, dz: f.dz, rotationAxis: f.rotationAxis, rotationAngle: f.rotationAngle, copy: f.copy })} />
        </label>
        <label className="pm-row">
          <span>{t('pm.moveCopyBody.dz')}</span>
          <ValueInput value={f.dz ?? '0'} toCommand={(dz) => ({ type: 'setMoveCopyBody', featureId: f.id, targets: f.targets, dx: f.dx, dy: f.dy, dz, rotationAxis: f.rotationAxis, rotationAngle: f.rotationAngle, copy: f.copy })} />
        </label>
      </section>

      <section className="pm-group">
        <h4>{t('pm.moveCopyBody.rotate')}</h4>
        <label className="pm-row">
          <span>{t('pm.moveCopyBody.rotationAxis')}</span>
          <select
            value={currentAxisMode()}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'x' || val === 'y' || val === 'z') {
                update({ rotationAxis: val });
              }
            }}
          >
            <option value="z">{t('pm.moveCopyBody.axisZ')}</option>
            <option value="x">{t('pm.moveCopyBody.axisX')}</option>
            <option value="y">{t('pm.moveCopyBody.axisY')}</option>
            {typeof f.rotationAxis === 'object' && <option value="ref">{t('pm.moveCopyBody.axisRef')}</option>}
          </select>
        </label>
        {typeof f.rotationAxis === 'object' && (
          <div className="pm-row">
            <span>{t('pm.moveCopyBody.axisRef')}</span>
            <input type="text" readOnly value={f.rotationAxis.name || ''} />
          </div>
        )}
        <label className="pm-row">
          <span>{t('pm.moveCopyBody.rotationAngle')}</span>
          <ValueInput
            value={f.rotationAngle ?? '0'}
            toCommand={(rotationAngle) => ({ type: 'setMoveCopyBody', featureId: f.id, targets: f.targets, dx: f.dx, dy: f.dy, dz: f.dz, rotationAxis: f.rotationAxis, rotationAngle, copy: f.copy })}
            suffix="°"
          />
        </label>
      </section>

      <section className="pm-group">
        <label className="pm-row checkbox">
          <input type="checkbox" checked={!!f.copy} onChange={(e) => update({ copy: e.target.checked })} />
          <span>{t('pm.moveCopyBody.copy')}</span>
        </label>
        <p className="hint">{t('pm.moveCopyBody.hint')}</p>
      </section>
    </>
  );
}

/** Delete/Keep Body feature (C7.3, ADR 0165): blacklist or whitelist body filtering. */
function DeleteKeepBodyPanel({ f }: { f: DeleteKeepBodyFeature }) {
  const result = useStore((s) => s.result);
  const bodies = (result?.bodies ?? []).filter((b) => !b.surface);
  const update = (patch: Partial<Omit<DeleteKeepBodyFeature, 'id' | 'type' | 'name' | 'suppressed'>>) => {
    store.execute({
      type: 'setDeleteKeepBody',
      featureId: f.id,
      mode: f.mode ?? 'delete',
      targets: f.targets,
      ...patch,
    });
  };

  const body = (name: string): Ref => ({ kind: 'body', name });
  const toggle = (id: string) => {
    const list = f.targets ?? [];
    const next = list.some((x) => x.name === id) ? list.filter((x) => x.name !== id) : [...list, body(id)];
    update({ targets: next });
  };

  const nameOf = (id: string) => bodies.find((b) => b.id === id)?.name ?? id;

  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.deleteKeepBody.mode')}</h4>
        <div className="segmented-control">
          <button
            className={(f.mode ?? 'delete') === 'delete' ? 'active' : ''}
            onClick={() => update({ mode: 'delete' })}
          >
            {t('pm.deleteKeepBody.modeDelete')}
          </button>
          <button
            className={f.mode === 'keep' ? 'active' : ''}
            onClick={() => update({ mode: 'keep' })}
          >
            {t('pm.deleteKeepBody.modeKeep')}
          </button>
        </div>
      </section>

      <section className="pm-group">
        <h4>{t('pm.deleteKeepBody.targets')}</h4>
        <ul className="selection-box">
          {(!f.targets || f.targets.length === 0) && <li className="muted">{t('feature.deleteKeepNeedsTargets')}</li>}
          {f.targets?.map((x) => {
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
        {bodies.map((b) => (
          <label key={b.id} className="pm-row checkbox">
            <input type="checkbox" checked={f.targets?.some((x) => x.name === b.id) ?? false} onChange={() => toggle(b.id)} />
            <span>{b.name}</span>
          </label>
        ))}
        <p className="hint">{t('pm.deleteKeepBody.hint')}</p>
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

/** Panel for editing the plane of a sketch (SolidWorks 「編輯草圖基準面」). */
function SketchPlanePanel({ f }: { f: SketchFeature }) {
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const at = doc.features.findIndex((x) => x.id === f.id);
  const availablePlanes = [
    ...DATUM_ITEMS.filter((d) => d.icon === 'plane').map((d) => ({ id: d.id as string, label: d.label, ref: { kind: 'datum' as const, name: d.id as string } })),
    ...doc.features
      .slice(0, Math.max(at, 0))
      .flatMap((x) =>
        x.type === 'refPlane' || x.type === 'coordSys'
          ? [{ id: x.id, label: x.name, ref: { kind: 'datum' as const, name: x.id } }]
          : [],
      ),
  ];

  const currentLabel = () => {
    if (f.plane.kind === 'datum') {
      const standard = DATUM_ITEMS.find((d) => d.id === f.plane.name);
      if (standard) return standard.label;
      const custom = doc.features.find((x) => x.id === f.plane.name);
      if (custom) return custom.name;
      return f.plane.name;
    }
    return f.plane.name;
  };

  const setPlane = (ref: Ref) => {
    store.execute({ type: 'redefineSketchPlane', featureId: f.id, plane: ref });
  };

  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.currentPlane')}</h4>
        <div className="selection-box" style={{ padding: '8px 12px', background: 'var(--card)', borderRadius: '6px', border: '1px solid var(--line)', fontWeight: 500, display: 'flex', alignItems: 'center' }}>
          <Icon name="plane" />
          <span style={{ marginLeft: '8px' }}>{currentLabel()}</span>
        </div>
        <p className="hint" style={{ marginTop: '8px' }}>{t('pm.sketchPlaneHint')}</p>
      </section>

      <section className="pm-group">
        <h4>{t('pm.sketchAttach')}</h4>
        <ul className="selection-box">
          {slotsOf(f).flatMap((slot) => {
            const refs = filled(slot);
            if (refs.length === 0) return [<li key={slot.key} className="muted">{t(slot.key === 'origin' ? 'pm.sketchAttach.originEmpty' : 'pm.sketchAttach.xEmpty')}</li>];
            return refs.map((r) => <RefItem key={`${slot.key}:${r.name}`} label={slot.label} refr={r} doc={doc} result={result} featureId={f.id} onClear={() => store.execute(fill(f, slot.key, []))} />);
          })}
        </ul>
        <label className="pm-row checkbox">
          <input type="checkbox" checked={f.attach?.flipX ?? false} onChange={(e) => store.execute(attachFlip(f, e.target.checked))} />
          <span>{t('pm.sketchAttach.flip')}</span>
        </label>
        <DatumPicker f={f} />
        <p className="hint">{t('pm.sketchAttachHint')}</p>
      </section>

      <section className="pm-group">
        <h4>{t('pm.standardPlanes')}</h4>
        <div className="datum-picker" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {availablePlanes.map((p) => {
            const isSelected = f.plane.kind === 'datum' && f.plane.name === p.id;
            return (
              <button
                key={p.id}
                title={p.label}
                className={isSelected ? 'active' : ''}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 12px',
                  textAlign: 'left',
                  borderRadius: '4px',
                  border: isSelected ? '1px solid var(--accent)' : '1px solid var(--line)',
                  background: isSelected ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : undefined,
                  fontWeight: isSelected ? 600 : 400,
                  cursor: 'pointer',
                }}
                onClick={() => setPlane(p.ref)}
              >
                <Icon name="plane" />
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

/** CosmeticThread (ADR 0156): 2D/3D cosmetic thread annotation on cylindrical face. */
function CosmeticThreadPanel({ f }: { f: CosmeticThreadFeature }) {
  const selectedFace = useStore((s) => s.selectedFace);
  const selected = useStore((s) => s.selected);

  const update = (patch: Partial<Omit<CosmeticThreadFeature, 'id' | 'type' | 'name' | 'suppressed'>>) => {
    const next = { ...f, ...patch };
    if (!validThreadTolerance(next.toleranceClass, next.standardMode === 'standard' ? next.standardDesignation : undefined, next.threadType)) patch = { ...patch, toleranceClass: undefined };
    store.execute({ type: 'setCosmeticThread', featureId: f.id, params: patch });
  };

  const isCustom = f.standardMode === 'custom';
  const endCondition = f.endCondition ?? 'through';

  const applyFaceSelection = () => {
    if (selectedFace) {
      update({ targetFace: selectedFace });
    }
  };

  const applyEdgeSelection = () => {
    if (selected) {
      update({ startEdge: { kind: 'edge', name: selected } });
    }
  };

  const clearEdgeSelection = () => {
    update({ startEdge: undefined });
  };

  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.cosmeticThread.targetFace')}</h4>
        <div className="pm-row">
          <input
            type="text"
            readOnly
            value={f.targetFace ? f.targetFace.name : t('pm.cosmeticThread.noFace')}
            style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--card)' }}
          />
          <button type="button" disabled={!selectedFace} title={t('pm.cosmeticThread.useSelected')} onClick={applyFaceSelection}>
            {t('pm.cosmeticThread.useSelected')}
          </button>
        </div>

        <h4>{t('pm.cosmeticThread.startEdge')}</h4>
        <div className="pm-row">
          <input
            type="text"
            readOnly
            value={f.startEdge ? f.startEdge.name : t('pm.cosmeticThread.defaultEdge')}
            style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--line)', background: 'var(--card)' }}
          />
          <button type="button" disabled={!selected} title={t('pm.cosmeticThread.useSelected')} onClick={applyEdgeSelection}>
            {t('pm.cosmeticThread.useSelected')}
          </button>
          {f.startEdge && (
            <button type="button" title={t('slot.clear')} onClick={clearEdgeSelection}>
              ✕
            </button>
          )}
        </div>
      </section>

      <section className="pm-group">
        <h4>{t('pm.cosmeticThread.type')}</h4>
        {!isCustom && (
          <label className="pm-row">
            <span>{t('pm.threadTolerance')}</span>
            <select data-field="threadToleranceClass" value={f.toleranceClass ?? ''} onChange={e => update({ toleranceClass: e.target.value || undefined })}>
              <option value="">{t('pm.threadToleranceNone')}</option>
              {threadToleranceClasses(f.standardDesignation, f.threadType).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        <div className="pm-row">
          <select
            value={f.threadType ?? 'external'}
            onChange={(e) => {
              const nextType = e.target.value as 'external' | 'internal';
              if (f.standardMode === 'standard' && f.standardDesignation) {
                const std = lookupThread(f.standardDesignation);
                if (std) {
                  const minor = nextType === 'internal' ? std.intMinorDia : std.extMinorDia;
                  update({ threadType: nextType, minorDiameter: `${minor}` });
                  return;
                }
              }
              update({ threadType: nextType });
            }}
          >
            <option value="external">{t('pm.cosmeticThread.external')}</option>
            <option value="internal">{t('pm.cosmeticThread.internal')}</option>
          </select>
        </div>

        <h4>{t('pm.cosmeticThread.mode')}</h4>
        <div className="pm-row">
          <select
            value={isCustom ? 'custom' : 'standard'}
            onChange={(e) => {
              if (e.target.value === 'custom') {
                update({ standardMode: 'custom' });
              } else {
                const std = ALL_STANDARD_THREADS[0];
                if (std) {
                  const minor = f.threadType === 'internal' ? std.intMinorDia : std.extMinorDia;
                  update({
                    standardMode: 'standard',
                    standardDesignation: std.designation,
                    majorDiameter: `${std.nominalDia}`,
                    minorDiameter: `${minor}`,
                    pitch: `${std.pitch}`,
                  });
                }
              }
            }}
          >
            <option value="standard">{t('pm.cosmeticThread.standard')}</option>
            <option value="custom">{t('pm.cosmeticThread.custom')}</option>
          </select>
        </div>

        {!isCustom ? (
          <>
            <h4>{t('pm.cosmeticThread.standardSize')}</h4>
            <div className="pm-row">
              <select
                value={f.standardDesignation ?? ALL_STANDARD_THREADS[0]?.designation ?? 'M8'}
                onChange={(e) => {
                  const val = e.target.value;
                  const found = lookupThread(val);
                  if (found) {
                    const minor = f.threadType === 'internal' ? found.intMinorDia : found.extMinorDia;
                    update({
                      standardDesignation: val,
                      majorDiameter: `${found.nominalDia}`,
                      minorDiameter: `${minor}`,
                      pitch: `${found.pitch}`,
                    });
                  } else {
                    update({ standardDesignation: val });
                  }
                }}
              >
                {ALL_STANDARD_THREADS.map((std) => (
                  <option key={std.designation} value={std.designation}>
                    {std.designation} (P={std.pitch.toFixed(2)} mm)
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <label className="pm-row">
              <span>{t('pm.cosmeticThread.majorDia')}</span>
              <ValueInput
                value={f.majorDiameter ?? '10'}
                toCommand={(majorDiameter) => ({ type: 'setCosmeticThread', featureId: f.id, params: { majorDiameter } })}
              />
            </label>
            <label className="pm-row">
              <span>{t('pm.cosmeticThread.minorDia')}</span>
              <ValueInput
                value={f.minorDiameter ?? '8.5'}
                toCommand={(minorDiameter) => ({ type: 'setCosmeticThread', featureId: f.id, params: { minorDiameter } })}
              />
            </label>
            <label className="pm-row">
              <span>{t('pm.cosmeticThread.pitch')}</span>
              <ValueInput
                value={f.pitch ?? '1.5'}
                toCommand={(pitch) => ({ type: 'setCosmeticThread', featureId: f.id, params: { pitch } })}
              />
            </label>
          </>
        )}
      </section>

      <section className="pm-group">
        <h4>{t('pm.cosmeticThread.endCondition')}</h4>
        <div className="pm-row">
          <select
            value={endCondition}
            onChange={(e) => update({ endCondition: e.target.value as 'blind' | 'through' })}
          >
            <option value="through">{t('pm.cosmeticThread.through')}</option>
            <option value="blind">{t('pm.cosmeticThread.blind')}</option>
          </select>
        </div>

        {endCondition === 'blind' && (
          <label className="pm-row">
            <span>{t('pm.cosmeticThread.depth')}</span>
            <ValueInput
              value={f.depth ?? '10'}
              toCommand={(depth) => ({ type: 'setCosmeticThread', featureId: f.id, params: { depth } })}
            />
          </label>
        )}

        <label className="pm-row">
          <span>{t('pm.cosmeticThread.reverse')}</span>
          <input
            type="checkbox"
            checked={!!f.reverse}
            onChange={(e) => update({ reverse: e.target.checked })}
          />
        </label>
      </section>
    </>
  );
}

function GearPanel({f}:{f:SpurGearFeature|RackFeature}) {
  const doc=useStore(s=>s.doc),at=doc.features.findIndex(feature=>feature.id===f.id);
  const fields=['module','teeth','pressureAngle','width','backlash',f.type==='gear'?'bore':'baseHeight'] as const;
  let dimensions:ReturnType<typeof gearDimensions>|null=null;
  try {const result=new Parameters(doc).resolve(f);if(!result.problem)dimensions=gearDimensions(gearParameters(result.feature));}catch { /* The feature's existing error panel explains invalid expressions. */ }
  return <section className="pm-group" data-gear-panel={f.type}>
    <label className="pm-row"><span>{t('gear.plane')}</span><select data-gear-plane value={f.plane.kind==='datum'?f.plane.name:''} onChange={e=>store.execute({type:'setGear',featureId:f.id,params:{plane:{kind:'datum',name:e.target.value}}})}>
      <option value="" disabled>{t('gear.face')}</option>{(['front','top','right'] as const).map(name=><option key={name} value={'plane:'+name}>{t(`datum.${name}`)}</option>)}
      {doc.features.slice(0,at).filter(feature=>feature.type==='refPlane').map(plane=><option key={plane.id} value={plane.id}>{plane.name}</option>)}
    </select></label>
    {fields.map(field=><label key={field} className="pm-row"><span>{t(`gear.${field}`)}</span><ValueInput suffix={field==='teeth'?'':field==='pressureAngle'?'°':'mm'} value={field==='bore'?(f.type==='gear'?f.bore:'0'):field==='baseHeight'?(f.type==='rack'?f.baseHeight:'0'):f[field]} toCommand={value=>({type:'setGear',featureId:f.id,params:{[field]:value}})}/></label>)}
    {dimensions&&<output data-gear-pitch={dimensions.pitch}>{t('gear.pitch')}: {dimensions.pitch.toFixed(4)} mm<br/>{t(f.type==='gear'?'gear.pitchDiameter':'gear.length')}: {(f.type==='gear'?dimensions.pitchRadius*2:dimensions.length).toFixed(4)} mm</output>}
    <p className="hint">{t('gear.hint')}</p>
  </section>;
}

function SurfaceToolsPanel({f}:{f:RuledSurfaceFeature|RadiatedSurfaceFeature|ReplaceFaceFeature}) {
  const doc=useStore(s=>s.doc);
  const update=(params:Extract<Command,{type:'setSurfaceTools'}>['params'])=>store.execute({type:'setSurfaceTools',featureId:f.id,params});
  const field=(key:'first'|'second'|'edge'|'face'|'replacement',ref:Ref)=><div className="pm-row"><span>{t(`surfaceTools.${key}`)}</span><input readOnly value={ref.name} /><button onClick={()=>update({[key]:{kind:ref.kind,name:''}})} aria-label={t('surfaceTools.clear')}>×</button></div>;
  const plane=f.type==='radiatedSurface'?f.plane:f.type==='replaceFace'?f.replacement:null;
  const planes=plane&&<label className="pm-row"><span>{t('surfaceTools.plane')}</span><select value={plane.kind==='datum'?plane.name:''} onChange={e=>update(f.type==='radiatedSurface'?{plane:{kind:'datum',name:e.target.value}}:{replacement:{kind:'datum',name:e.target.value}})}><option value="" disabled>{t('projection.faces')}</option>{(['front','top','right'] as const).map(name=><option key={name} value={'plane:'+name}>{t(`datum.${name}`)}</option>)}{doc.features.slice(0,doc.features.findIndex(x=>x.id===f.id)).filter(x=>x.type==='refPlane').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>;
  return <section className="pm-group">
    {f.type==='ruledSurface'?<>{field('first',f.first)}{field('second',f.second)}<label className="pm-row"><input type="checkbox" checked={!!f.reverseSecond} onChange={e=>update({reverseSecond:e.target.checked})}/>{t('surfaceTools.reverse')}</label></>:f.type==='radiatedSurface'?<>{field('edge',f.edge)}{planes}<label className="pm-row"><span>{t('surfaceTools.distanceLabel')}</span><ValueInput value={f.distance} toCommand={distance=>({type:'setSurfaceTools',featureId:f.id,params:{distance}})}/></label><label className="pm-row"><input type="checkbox" checked={!!f.reverse} onChange={e=>update({reverse:e.target.checked})}/>{t('surfaceTools.reverse')}</label></>:<>{field('face',f.face)}{field('replacement',f.replacement)}{planes}</>}
    <p className="pm-hint">{t(f.type==='replaceFace'?'surfaceTools.replaceHint':f.type==='radiatedSurface'?'surfaceTools.radiateHint':'surfaceTools.ruledHint')}</p>
  </section>;
}

function ProjectedCurvePanel({ f }: { f: ProjectedCurveFeature }) {
  const doc = useStore(s=>s.doc);
  const update = (params: Partial<Omit<ProjectedCurveFeature, 'id' | 'type' | 'name' | 'suppressed'>>) => store.execute({ type: 'setProjectedCurve', featureId: f.id, params });
  const earlier = doc.features.slice(0,doc.features.findIndex(x=>x.id===f.id)).filter(x=>x.type==='sketch');
  return <section className="pm-group">
    <label className="pm-row"><span>{t('projection.modeLabel')}</span><select value={f.mode} onChange={e=>update({mode:e.target.value as ProjectedCurveFeature['mode'], ...(e.target.value==='sketchOnSketch' ? {secondSketch:earlier.find(s=>s.id!==f.sketch)?.id} : {})})}>
      <option value="sketchOnSketch">{t('projection.sketchOnSketch')}</option><option value="sketchOnFaces">{t('projection.sketchOnFaces')}</option>
    </select></label>
    <label className="pm-row"><span>{t('projection.first')}</span><select value={f.sketch} onChange={e=>update({sketch:e.target.value})}>{earlier.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    {f.mode==='sketchOnSketch' ? <label className="pm-row"><span>{t('projection.second')}</span><select value={f.secondSketch ?? ''} onChange={e=>update({secondSketch:e.target.value})}>{earlier.filter(s=>s.id!==f.sketch).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : <>
      <p>{(f.faces ?? []).map(r=>r.name).join(', ') || t('projection.faces')}</p>
      <button onClick={()=>update({faces:[]})}>{t('projection.clearFaces')}</button>
      <button onClick={()=>update({direction:undefined})}>{t('projection.normal')}</button>
      <select aria-label={t('projection.useDirection')} value={f.direction?.kind==='datum'?f.direction.name:''} onChange={e=>update({direction:e.target.value?{kind:'datum',name:e.target.value}:undefined})}><option value="">{t('projection.normal')}</option>{doc.features.slice(0,doc.features.findIndex(x=>x.id===f.id)).filter(x=>x.type==='refAxis'||x.type==='refPlane').map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <p>{f.direction?.name ?? t('projection.normal')}</p>
    </>}
    <p className="pm-hint">{t('projection.hint')}</p>
  </section>;
}

function HelixPanel({ f }: { f: HelixFeature }) {
  const status = useStore((s) => s.result?.features.find((r) => r.id === f.id));
  const definedBy = f.definedBy ?? 'pitchAndRev';
  const update = (params: Partial<Omit<HelixFeature, 'id' | 'type' | 'name' | 'suppressed'>>) =>
    store.execute({ type: 'setHelix', featureId: f.id, params });

  return (
    <>
      <section className="pm-group">
        <h4>{t('pm.helix.circle')}</h4>
        <SlotList f={f} />
        <DatumPicker f={f} />
      </section>

      <section className="pm-group">
        <h4>{t('pm.helix.definedBy')}</h4>
        <div className="pm-row">
          <select
            value={definedBy}
            onChange={(e) => update({ definedBy: e.target.value as HelixDefinedBy })}
          >
            <option value="pitchAndRev">{t('pm.helix.pitchAndRev')}</option>
            <option value="heightAndRev">{t('pm.helix.heightAndRev')}</option>
            <option value="heightAndPitch">{t('pm.helix.heightAndPitch')}</option>
            <option value="spiral">{t('pm.helix.spiral')}</option>
          </select>
        </div>
      </section>

      <section className="pm-group">
        <h4>{t('pm.helix.parameters')}</h4>
        {(definedBy === 'pitchAndRev' || definedBy === 'heightAndPitch' || definedBy === 'spiral') && (
          <label className="pm-row">
            <span>{t('pm.helix.pitch')}</span>
            <ValueInput
              value={f.pitch ?? '5'}
              toCommand={(pitch) => ({ type: 'setHelix', featureId: f.id, params: { pitch } })}
            />
          </label>
        )}

        {(definedBy === 'pitchAndRev' || definedBy === 'heightAndRev' || definedBy === 'spiral') && (
          <label className="pm-row">
            <span>{t('pm.helix.revolutions')}</span>
            <ValueInput
              value={f.revolutions ?? '3'}
              toCommand={(revolutions) => ({ type: 'setHelix', featureId: f.id, params: { revolutions } })}
            />
          </label>
        )}

        {(definedBy === 'heightAndRev' || definedBy === 'heightAndPitch') && (
          <label className="pm-row">
            <span>{t('pm.helix.height')}</span>
            <ValueInput
              value={f.height ?? '30'}
              toCommand={(height) => ({ type: 'setHelix', featureId: f.id, params: { height } })}
            />
          </label>
        )}

        <label className="pm-row">
          <span>{t('pm.helix.startAngle')}</span>
          <ValueInput
            value={f.startAngle ?? '0deg'}
            toCommand={(startAngle) => ({ type: 'setHelix', featureId: f.id, params: { startAngle } })}
          />
        </label>
      </section>

      <section className="pm-group">
        <h4>{t('pm.helix.direction')}</h4>
        <label className="pm-row">
          <span>{t('pm.helix.clockwise')}</span>
          <input
            type="checkbox"
            checked={f.clockwise ?? true}
            onChange={(e) => update({ clockwise: e.target.checked })}
          />
        </label>
        <label className="pm-row">
          <span>{t('pm.helix.reverse')}</span>
          <input
            type="checkbox"
            checked={!!f.reverse}
            onChange={(e) => update({ reverse: e.target.checked })}
          />
        </label>
      </section>

      {definedBy !== 'spiral' && (
        <section className="pm-group">
          <h4>{t('pm.helix.taper')}</h4>
          <label className="pm-row">
            <span>{t('pm.helix.taperAngle')}</span>
            <ValueInput
              value={f.taperAngle ?? '0deg'}
              toCommand={(taperAngle) => ({ type: 'setHelix', featureId: f.id, params: { taperAngle } })}
            />
          </label>
          <label className="pm-row">
            <span>{t('pm.helix.taperOutward')}</span>
            <input
              type="checkbox"
              checked={!!f.taperOutward}
              onChange={(e) => update({ taperOutward: e.target.checked })}
            />
          </label>
        </section>
      )}

      {status?.status === 'ok' && status.info && <p className="hint gap-info">{status.info}</p>}
      <p className="pm-hint">{t('pm.helix.hint')}</p>
    </>
  );
}

/**
 * The parameter groups of a feature — the same body a session's PropertyManager lays out, as plain components: each reads the feature from the
 * document and writes through commands, so the body depends on nothing but the feature. That is what lets the FeatureManager's properties page
 * show what a picked feature really is (plan §2.2) without opening a session for it. A sketch is the exception: its body belongs to the sketch
 * editor, so this answers nothing for one and the caller keeps its own entry to the session.
 */
export function FeatureParams({ f }: { f: Feature }) {
  if (f.type === 'sketch') return null;
  return (
    <>
      {f.type === 'extrude' && <ExtrudePanel f={f} />}
      {f.type === 'revolve' && <RevolvePanel f={f} />}
      {f.type === 'sweep' && <SweepPanel f={f} />}
      {(f.type==='gear'||f.type==='rack')&&<GearPanel f={f}/>}
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
      {f.type === 'mutualTrim' && <MutualTrimPanel f={f} />}
      {f.type === 'knit' && <KnitPanel f={f} />}
      {f.type === 'fillSurface' && <FillSurfacePanel f={f} />}
      {f.type === 'flatSurface' && <FlatSurfacePanel f={f} />}
      {f.type === 'extendSurface' && <ExtendSurfacePanel f={f} />}
      {f.type === 'thicken' && <ThickenPanel f={f} />}
      {f.type === 'lipGroove' && <LipGroovePanel f={f} />}
      {f.type === 'screwBoss' && <ScrewBossPanel f={f} />}
      {f.type === 'sheetUnfold' && <SheetUnfoldPanel f={f} />}
      {f.type === 'baseFlange' && <BaseFlangePanel f={f} />}
      {f.type === 'midBend' && <MidBendPanel f={f} />}
      {f.type === 'jog' && <JogPanel f={f} />}
      {f.type === 'edgeFlange' && <EdgeFlangePanel f={f} />}
      {f.type === 'hem' && <HemPanel f={f} />}
      {f.type === 'breakCorner' && <BreakCornerPanel f={f} />}
      {f.type === 'snapHook' && (
        <SketchPointsPanel f={f} hint={t('pm.hook.hint')} fields={[['width', t('pm.hook.width')], ['thickness', t('pm.hook.thickness')], ['length', t('pm.hook.length')], ['hookHeight', t('pm.hook.hookHeight')], ['hookDepth', t('pm.hook.hookDepth')]]} />
      )}
      {f.type === 'snapCatch' && <SketchPointsPanel f={f} hint={t('pm.catch.hint')} fields={[['length', t('pm.slots.length')], ['width', t('pm.slots.width')], ['depth', t('pm.slots.depth')]]} />}
      {f.type === 'vent' && (
        <SketchPointsPanel f={f} hint={t('pm.vent.hint')} fields={[['count', t('pm.slots.count')], ['pitch', t('pm.slots.pitch')], ['length', t('pm.slots.length')], ['width', t('pm.slots.width')], ['depth', t('pm.slots.depth')]]} />
      )}
      {f.type === 'cutWithSurface' && <CutWithSurfacePanel f={f} />}
      {f.type === 'combine' && <CombinePanel f={f} />}
      {f.type === 'split' && <SplitPanel f={f} />}
      {f.type === 'moveCopyBody' && <MoveCopyBodyPanel f={f} />}
      {f.type === 'deleteKeepBody' && <DeleteKeepBodyPanel f={f} />}
      {f.type === 'thread' && <ThreadPanel f={f} />}
      {f.type === 'knurl' && <KnurlPanel f={f} />}
      {f.type === 'cosmeticThread' && <CosmeticThreadPanel f={f} />}
      {(f.type==='ruledSurface'||f.type==='radiatedSurface'||f.type==='replaceFace') && <SurfaceToolsPanel f={f}/>}
      {f.type === 'projectedCurve' && <ProjectedCurvePanel f={f} />}
      {f.type === 'helix' && <HelixPanel f={f} />}
    </>
  );
}

export function PropertyManager() {
  const editing = useStore((s) => s.editing);
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const floating = useStore(s => s.options.floatingParameters);
  if (!editing) return null;
  const f = findFeature(doc, editing.featureId);
  if (!f) return null;
  const isSketchPlane = editing.kind === 'sketchPlane';
  const sketching = editing.kind === 'sketch';
  // Like the message box at the top of a SolidWorks PropertyManager: why the feature cannot be built yet.
  const status = sketching || isSketchPlane ? undefined : result?.features.find((r) => r.id === f.id);
  if (!sketching && !isSketchPlane && floating) {
    const action = f.type === 'importedBody' ? 'import-step' : f.type.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()) + ('op' in f && f.op==='cut'?'-cut':'');
    return <FloatingFeatureEditor key={f.id} title={`${featureLabel(f)}: ${f.name}`} action={action} error={status?.status==='error'?status.message:undefined}><FeatureParams f={f}/></FloatingFeatureEditor>;
  }
  return (
    <div className="property-manager" data-help={currentTopicId()}>
      <div className="pm-header">
        <Icon name={f.type} />
        <span className="pm-title">
          {isSketchPlane ? `${t('pm.editSketchPlane')}: ${f.name}` : sketching ? `${t('pm.editSketch')}: ${f.name}` : `${featureLabel(f)}: ${f.name}`}
        </span>
        {!sketching&&!isSketchPlane&&<button type="button" data-action="float-parameters" onClick={()=>store.setOptions({floatingParameters:true})}>{t('pm.float')}</button>}
        <button className="pm-ok" title={sketching ? t('pm.exitSketch') : t('pm.ok')} onClick={() => store.commitEdit()}>
          <Icon name="ok" />
        </button>
        <button className="pm-cancel" title={sketching ? t('pm.discardChanges') : t('pm.cancel')} onClick={() => store.cancelEdit()}>
          <Icon name="cancel" />
        </button>
      </div>
      {status?.status === 'error' && <p className="pm-message error-text">{status.message}</p>}
      {f.type === 'sketch' && (isSketchPlane ? <SketchPlanePanel f={f} /> : <SketchPanel f={f} />)}
      <FeatureParams f={f} />
    </div>
  );
}
