import { t } from '@3db/i18n';
import { formatNumber, overlappingDimensions } from '@3db/drawing';
import { MM_PER_INCH } from '@3db/model';
import type { Dimension, DimensionOrientation, DimensionTolerance, ViewFeature } from '@3db/model';
import { useState } from 'react';
import { store, useStore } from '../state/store';

/** The label of a thing a dimension can point at, as the list shows it. */
type Pickable = Exclude<ViewFeature, { type: 'axis' }>;

/** The direction of a slanted face's line, degrees counter-clockwise from the view's x axis, in (-90, 90]. */
const slantAngle = (f: Extract<ViewFeature, { type: 'slant' }>): number => {
  let a = (Math.atan2(f.dir[1], f.dir[0]) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
};

const featureLabel = (f: Pickable): string =>
  f.type === 'slant'
    ? t('drawingUi.featureSlant', { angle: formatNumber(slantAngle(f), 1), x: formatNumber(f.at[0], 1), y: formatNumber(f.at[1], 1) })
    : f.type === 'plane'
    ? t(f.axis === 'x' ? 'drawingUi.featurePlaneX' : 'drawingUi.featurePlaneY', { value: formatNumber(f.coord, 2) })
    : f.type === 'torus'
    ? // a fillet is always an R of the tube, wherever on the arc it was pointed at
      t('drawingUi.featureFillet', { size: formatNumber(f.radius, 2), x: formatNumber(f.at[0], 2), y: formatNumber(f.at[1], 2) })
    : t(f.full ? (f.convex ? 'drawingUi.featureCylinder' : 'drawingUi.featureHole') : 'drawingUi.featureArc', {
        size: formatNumber(f.full ? 2 * f.radius : f.radius, 2),
        x: formatNumber(f.centre[0], 2),
        y: formatNumber(f.centre[1], 2),
      });

/** A number box that commits on Enter or when it loses focus. */
function NumberBox({ value, onCommit, field }: { value: number; onCommit: (v: number) => void; field: string }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <input
      data-field={field}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        e.stopPropagation();
      }}
    />
  );
}

const toleranceKind = (tol: DimensionTolerance | undefined) => tol?.type ?? 'none';

/**
 * The dimensions of the selected view (C16.4): all of them at once (overall size, holes, where the holes are), one between two elements or of one circle, and
 * what is written on each (reference, tolerance), where it is drawn, and deleting it. Every change is a command on the document.
 */
export function DimensionPanel() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const view = drw.doc.views.find((v) => v.id === drw.selected);
  const [opts, setOpts] = useState({ overall: true, holes: true, positions: false, callouts: true });
  const [a, setA] = useState(0);
  const [b, setB] = useState(1);
  const [orientation, setOrientation] = useState<DimensionOrientation>('horizontal');
  const [round, setRound] = useState(0);
  // the dimension chosen is the document's state: it is chosen on the sheet as well
  const selected = drw.dimension;
  const setSelected = (id: string | null) => d.selectDimension(id);
  const features = view ? (drw.features.get(view.id) ?? null) : null;
  const planes = (features ?? []).filter((f): f is Extract<Pickable, { type: 'plane' }> => f.type === 'plane');
  const slants = (features ?? []).filter((f): f is Extract<Pickable, { type: 'slant' }> => f.type === 'slant');
  const circles = (features ?? []).filter((f): f is Extract<Pickable, { type: 'circle' }> => f.type === 'circle');
  const linearPick = [...planes, ...circles];
  /** What an angle can be between: the planes seen edge-on, the ones square to x and y and the slanted ones. */
  const anglePick = [...planes, ...slants];
  const [ang1, setAng1] = useState(0);
  const [ang2, setAng2] = useState(1);
  const mine = view ? drw.doc.dimensions.filter((x) => x.view === view.id) : [];
  const outcomes = d.scene().dimensions;
  const overlapping = overlappingDimensions(d.scene().scene.items, new Set(mine.map((x) => x.id)));
  // the dimensions chosen (on any view): with more than one, the panel changes them all at once instead of showing one
  const chosenIds = drw.selection.filter((x) => x.kind === 'dimension').map((x) => x.id);
  const chosenDims = drw.doc.dimensions.filter((x) => chosenIds.includes(x.id));
  const batch = chosenDims.length > 1;
  const current = batch ? null : (mine.find((x) => x.id === selected) ?? null);
  // the numbers of a tolerance are typed and shown in the unit of the sheet; the document holds millimetres
  const perUnit = drw.doc.sheet.unit === 'in' ? MM_PER_INCH : 1;
  const shownTol = (mm: number) => Math.round((mm / perUnit) * 1e6) / 1e6;
  const textOf = (x: Dimension) => {
    const o = outcomes.get(x.id);
    return o ? ('error' in o ? '⚠ ' + o.error : o.text) : '…';
  };
  return (
    <>
      <div className="pm-row">
        <button
          className={`pm-button${drw.tool?.kind === 'dimension' ? ' active' : ''}`}
          data-action="toolDimension"
          title={t('drawingUi.hint.dimension0')}
          onClick={() => d.setTool(drw.tool?.kind === 'dimension' ? null : { kind: 'dimension', picks: [] })}
        >
          {t('drawingUi.toolDimension')}
        </button>
      </div>
      {!view && <p className="muted">{t('drawingUi.dimSelectView')}</p>}
      {view && (
        <>
          {features && features.length === 0 && <p className="muted">{t('drawingUi.dimNoFeatures')}</p>}
          {(['overall', 'holes', 'callouts', 'positions'] as const).map((k) => (
            <label key={k} className="pm-row checkbox">
              <input type="checkbox" data-field={`auto-${k}`} checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
              <span>{t(`drawingUi.dimAuto.${k}`)}</span>
            </label>
          ))}
          <div className="pm-row">
            <button
              className="pm-button"
              data-action="autoDimension"
              disabled={!features}
              onClick={() => {
                const n = d.autoDimension(view.id, opts);
                if (n > 0) d.notifyInfo(t('drawingUi.dimAdded', { n }));
                else if (features) d.notifyInfo(t('drawingUi.dimNothingNew'));
              }}
            >
              {t('drawingUi.dimAutoButton')}
            </button>
          </div>
          {overlapping > 0 && (
            <p className="warning-text" data-field="overlap">
              {t('drawingUi.dimOverlap', { n: overlapping })}
            </p>
          )}
          {linearPick.length >= 2 && (
            <div className="pm-row">
              <select data-field="dimA" value={Math.min(a, linearPick.length - 1)} onChange={(e) => setA(Number(e.target.value))}>
                {linearPick.map((f, i) => (
                  <option key={i} value={i}>
                    {featureLabel(f)}
                  </option>
                ))}
              </select>
              <select data-field="dimB" value={Math.min(b, linearPick.length - 1)} onChange={(e) => setB(Number(e.target.value))}>
                {linearPick.map((f, i) => (
                  <option key={i} value={i}>
                    {featureLabel(f)}
                  </option>
                ))}
              </select>
              <select data-field="dimOrientation" value={orientation} onChange={(e) => setOrientation(e.target.value as DimensionOrientation)}>
                <option value="horizontal">{t('drawingUi.dimHorizontal')}</option>
                <option value="vertical">{t('drawingUi.dimVertical')}</option>
                <option value="aligned">{t('drawingUi.dimAligned')}</option>
              </select>
              <button
                className="pm-button"
                data-action="addLinear"
                onClick={() => d.addLinear(view.id, linearPick[Math.min(a, linearPick.length - 1)]!.ref, linearPick[Math.min(b, linearPick.length - 1)]!.ref, orientation)}
              >
                {t('drawingUi.dimLinear')}
              </button>
            </div>
          )}
          {anglePick.length >= 2 && (
            <div className="pm-row">
              <select data-field="angA" value={Math.min(ang1, anglePick.length - 1)} onChange={(e) => setAng1(Number(e.target.value))}>
                {anglePick.map((f, i) => (
                  <option key={i} value={i}>
                    {featureLabel(f)}
                  </option>
                ))}
              </select>
              <select data-field="angB" value={Math.min(ang2, anglePick.length - 1)} onChange={(e) => setAng2(Number(e.target.value))}>
                {anglePick.map((f, i) => (
                  <option key={i} value={i}>
                    {featureLabel(f)}
                  </option>
                ))}
              </select>
              <button
                className="pm-button"
                data-action="addAngle"
                onClick={() => d.addAngle(view.id, anglePick[Math.min(ang1, anglePick.length - 1)]!.ref, anglePick[Math.min(ang2, anglePick.length - 1)]!.ref)}
              >
                {t('drawingUi.dimAngleButton')}
              </button>
            </div>
          )}
          {circles.length > 0 && (
            <div className="pm-row">
              <select data-field="dimRound" value={Math.min(round, circles.length - 1)} onChange={(e) => setRound(Number(e.target.value))}>
                {circles.map((f, i) => (
                  <option key={i} value={i}>
                    {featureLabel(f)}
                  </option>
                ))}
              </select>
              <button className="pm-button" data-action="addDiameter" onClick={() => d.addRound(view.id, 'diameter', circles[Math.min(round, circles.length - 1)]!.ref)}>
                {t('drawingUi.dimDiameter')}
              </button>
              <button className="pm-button" data-action="addRadius" onClick={() => d.addRound(view.id, 'radius', circles[Math.min(round, circles.length - 1)]!.ref)}>
                {t('drawingUi.dimRadius')}
              </button>
            </div>
          )}
          <ul className="selection-box drawing-views" data-field="dimensions">
            {mine.map((x) => (
              <li key={x.id} className={chosenIds.includes(x.id) ? 'selected' : ''} onClick={(e) => (e.ctrlKey || e.metaKey ? d.pick([{ kind: 'dimension', id: x.id }], 'toggle') : setSelected(x.id))} data-dimension={x.id}>
                <span className="name">{textOf(x)}</span>
                <button title={t('drawingUi.dimDelete')} onClick={(e) => (e.stopPropagation(), d.deleteDimensions([x.id]))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {batch && <BatchDimensions dims={chosenDims} perUnit={perUnit} />}
          {current && (
            <>
              <label className="pm-row checkbox">
                <input type="checkbox" data-field="dimReference" checked={!!current.reference} onChange={(e) => d.setDimension(current.id, { reference: e.target.checked })} />
                <span>{t('drawingUi.dimReference')}</span>
              </label>
              {current.kind === 'diameter' && (
                <label className="pm-row checkbox">
                  <input type="checkbox" data-field="dimCallout" checked={!!current.callout} onChange={(e) => d.setDimension(current.id, { callout: e.target.checked })} />
                  <span>{t('drawingUi.dimCallout')}</span>
                </label>
              )}
              {current.kind === 'linear' ? (
                <label className="pm-row">
                  <span>{t('drawingUi.dimOffset')}</span>
                  <NumberBox field="dimOffset" value={current.offset} onCommit={(v) => d.setDimension(current.id, { offset: v })} />
                </label>
              ) : current.kind === 'angle' ? (
                <>
                  <label className="pm-row">
                    <span>{t('drawingUi.dimArc')}</span>
                    <NumberBox field="dimArc" value={current.arc} onCommit={(v) => v > 0 && d.setDimension(current.id, { arc: v })} />
                  </label>
                  <label className="pm-row checkbox">
                    <input type="checkbox" data-field="dimSupplementary" checked={!!current.supplementary} onChange={(e) => d.setDimension(current.id, { supplementary: e.target.checked })} />
                    <span>{t('drawingUi.dimSupplementary')}</span>
                  </label>
                </>
              ) : (
                <>
                  <label className="pm-row">
                    <span>{t('drawingUi.dimAngle')}</span>
                    <NumberBox field="dimAngle" value={current.angle} onCommit={(v) => d.setDimension(current.id, { angle: v })} />
                  </label>
                  <label className="pm-row">
                    <span>{t('drawingUi.dimCount')}</span>
                    <NumberBox field="dimCount" value={current.count ?? 1} onCommit={(v) => d.setDimension(current.id, { count: v >= 2 ? Math.round(v) : null })} />
                  </label>
                </>
              )}
              <label className="pm-row">
                <span>{t('drawingUi.dimPrecision')}</span>
                <select data-field="dimPrecision" value={current.precision === undefined ? '' : String(current.precision)} onChange={(e) => d.setDimension(current.id, { precision: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">{t('drawingUi.dimPrecisionAuto')}</option>
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pm-row">
                <span>{t('drawingUi.dimPrefix')}</span>
                <TextField field="dimPrefix" value={current.prefix ?? ''} onCommit={(v) => d.setDimension(current.id, { prefix: v })} />
              </label>
              <label className="pm-row">
                <span>{t('drawingUi.dimSuffix')}</span>
                <TextField field="dimSuffix" value={current.suffix ?? ''} onCommit={(v) => d.setDimension(current.id, { suffix: v })} />
              </label>
              <label className="pm-row" title={t('drawingUi.dimTextTip')}>
                <span>{t('drawingUi.dimText')}</span>
                <TextField field="dimText" value={current.text ?? ''} onCommit={(v) => d.setDimension(current.id, { text: v })} />
              </label>
              {(current.kind === 'linear' || current.kind === 'angle') && (
                <label className="pm-row">
                  <span>{t('drawingUi.dimSlide')}</span>
                  <NumberBox field="dimSlide" value={current.slide ?? 0} onCommit={(v) => d.setDimension(current.id, { slide: v })} />
                </label>
              )}
              {(current.kind === 'diameter' || current.kind === 'radius') && (
                <label className="pm-row">
                  <span>{t('drawingUi.dimLeader')}</span>
                  <NumberBox field="dimLeader" value={current.leader ?? 8} onCommit={(v) => v > 0 && d.setDimension(current.id, { leader: v })} />
                </label>
              )}
              <label className="pm-row">
                <span>{t('drawingUi.dimTolerance')}</span>
                <select
                  data-field="dimToleranceType"
                  value={toleranceKind(current.tolerance)}
                  onChange={(e) => {
                    const kind = e.target.value;
                    d.setDimension(current.id, {
                      tolerance:
                        kind === 'bilateral'
                          ? { type: 'bilateral', upper: 0.05, lower: -0.05 }
                          : kind === 'fit'
                          ? { type: 'fit', fit: current.kind === 'linear' ? 'h7' : 'H7' }
                          : kind === 'max'
                          ? { type: 'max' }
                          : kind === 'min'
                          ? { type: 'min' }
                          : null,
                    });
                  }}
                >
                  <option value="none">{t('drawingUi.dimTolNone')}</option>
                  <option value="bilateral">{t('drawingUi.dimTolBilateral')}</option>
                  <option value="max">{t('drawingUi.dimTolMax')}</option>
                  <option value="min">{t('drawingUi.dimTolMin')}</option>
                  {/* an angle has no size for an ISO 286 fit to come from */}
                  {current.kind !== 'angle' && <option value="fit">{t('drawingUi.dimTolFit')}</option>}
                </select>
              </label>
              {current.tolerance?.type === 'bilateral' && (
                <>
                  <label className="pm-row">
                    <span>{t('drawingUi.dimUpper')}</span>
                    <NumberBox field="dimUpper" value={shownTol(current.tolerance.upper)} onCommit={(v) => d.setDimension(current.id, { tolerance: { type: 'bilateral', upper: v * perUnit, lower: (current.tolerance as { lower: number }).lower } })} />
                  </label>
                  <label className="pm-row">
                    <span>{t('drawingUi.dimLower')}</span>
                    <NumberBox field="dimLower" value={shownTol(current.tolerance.lower)} onCommit={(v) => d.setDimension(current.id, { tolerance: { type: 'bilateral', upper: (current.tolerance as { upper: number }).upper, lower: v * perUnit } })} />
                  </label>
                </>
              )}
              {current.tolerance?.type === 'fit' && (
                <label className="pm-row">
                  <span>{t('drawingUi.dimFit')}</span>
                  <FitBox value={current.tolerance.fit} onCommit={(fit) => d.setDimension(current.id, { tolerance: { type: 'fit', fit } })} />
                </label>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

/** What several values are when they are all the same, or undefined when they differ. */
function common<T>(values: readonly T[]): T | undefined {
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first) ? values[0] : undefined;
}

/** A number box for several values: empty when they differ (and left alone until something is typed), committed on Enter or on leaving. */
function MixedNumber({ value, onCommit, field }: { value: number | undefined; onCommit: (v: number) => void; field: string }) {
  const shownText = value === undefined ? '' : String(value);
  const [text, setText] = useState(shownText);
  const [shown, setShown] = useState(shownText);
  if (shownText !== shown) {
    setShown(shownText);
    setText(shownText);
  }
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && text !== shownText) onCommit(v);
    else setText(shownText);
  };
  return (
    <input
      data-field={field}
      inputMode="decimal"
      value={text}
      placeholder={value === undefined ? t('drawingUi.mixed') : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        e.stopPropagation();
      }}
    />
  );
}

/**
 * Several dimensions chosen (D-I1a, ADR 0130): what they have in common is shown, and a change is made to all of them as one step. What differs between them is
 * shown as differing and is left as it is until it is changed. A change one of them refuses (a fit class on an angle) is refused for all, and said.
 */
function BatchDimensions({ dims, perUnit }: { dims: readonly Dimension[]; perUnit: number }) {
  const d = store.drawingStore!;
  const ids = dims.map((x) => x.id);
  const set = (patch: Parameters<typeof d.setDimensions>[1]) => d.setDimensions(ids, patch);
  const reference = common(dims.map((x) => !!x.reference));
  const precision = common(dims.map((x) => x.precision));
  const tolerance = common(dims.map((x) => x.tolerance ?? null));
  const kind = tolerance === undefined ? 'mixed' : toleranceKind(tolerance ?? undefined);
  const hasAngle = dims.some((x) => x.kind === 'angle');
  const shown = (mm: number) => Math.round((mm / perUnit) * 1e6) / 1e6;
  const upper = common(dims.map((x) => (x.tolerance?.type === 'bilateral' ? x.tolerance.upper : NaN)));
  const lower = common(dims.map((x) => (x.tolerance?.type === 'bilateral' ? x.tolerance.lower : NaN)));
  const fit = common(dims.map((x) => (x.tolerance?.type === 'fit' ? x.tolerance.fit : '')));
  return (
    <div data-group="dimBatch">
      <p className="muted" data-field="dimBatch">
        {t('drawingUi.dimBatch', { n: dims.length })}
      </p>
      <label className="pm-row checkbox">
        <input
          type="checkbox"
          data-field="batchReference"
          checked={reference === true}
          ref={(el) => {
            if (el) el.indeterminate = reference === undefined;
          }}
          onChange={(e) => set({ reference: e.target.checked })}
        />
        <span>{t('drawingUi.dimReference')}</span>
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.dimPrecision')}</span>
        <select data-field="batchPrecision" value={precision === undefined && dims.some((x) => x.precision !== undefined) ? 'mixed' : precision === undefined ? '' : String(precision)} onChange={(e) => e.target.value !== 'mixed' && set({ precision: e.target.value === '' ? null : Number(e.target.value) })}>
          {common(dims.map((x) => x.precision)) === undefined && dims.some((x) => x.precision !== undefined) && <option value="mixed">{t('drawingUi.mixed')}</option>}
          <option value="">{t('drawingUi.dimPrecisionAuto')}</option>
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.dimTolerance')}</span>
        <select
          data-field="batchToleranceType"
          value={kind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === 'mixed') return;
            set({
              tolerance: k === 'bilateral' ? { type: 'bilateral', upper: 0.05, lower: -0.05 } : k === 'fit' ? { type: 'fit', fit: 'H7' } : k === 'max' ? { type: 'max' } : k === 'min' ? { type: 'min' } : null,
            });
          }}
        >
          {kind === 'mixed' && <option value="mixed">{t('drawingUi.mixed')}</option>}
          <option value="none">{t('drawingUi.dimTolNone')}</option>
          <option value="bilateral">{t('drawingUi.dimTolBilateral')}</option>
          <option value="max">{t('drawingUi.dimTolMax')}</option>
          <option value="min">{t('drawingUi.dimTolMin')}</option>
          {/* an angle has no size for an ISO 286 fit to come from: with one among them the class is not offered at all, rather than refused afterwards */}
          {!hasAngle && <option value="fit">{t('drawingUi.dimTolFit')}</option>}
        </select>
      </label>
      {hasAngle && <p className="muted">{t('drawingUi.dimBatchNoFit')}</p>}
      {kind === 'bilateral' && (
        <>
          <label className="pm-row">
            <span>{t('drawingUi.dimUpper')}</span>
            <MixedNumber field="batchUpper" value={upper === undefined || Number.isNaN(upper) ? undefined : shown(upper)} onCommit={(v) => d.setDimensionsEach(ids, (x) => (x.tolerance?.type === 'bilateral' ? { tolerance: { ...x.tolerance, upper: v * perUnit } } : null))} />
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.dimLower')}</span>
            <MixedNumber field="batchLower" value={lower === undefined || Number.isNaN(lower) ? undefined : shown(lower)} onCommit={(v) => d.setDimensionsEach(ids, (x) => (x.tolerance?.type === 'bilateral' ? { tolerance: { ...x.tolerance, lower: v * perUnit } } : null))} />
          </label>
        </>
      )}
      {kind === 'fit' && (
        <label className="pm-row">
          <span>{t('drawingUi.dimFit')}</span>
          <FitBox value={fit ?? ''} onCommit={(f) => f && set({ tolerance: { type: 'fit', fit: f } })} />
        </label>
      )}
      <div className="pm-row">
        <button className="pm-button" data-action="batchDelete" onClick={() => d.deleteSelection()}>
          {t('drawingUi.selDelete')}
        </button>
      </div>
    </div>
  );
}

/** A text box committed on Enter or on leaving (an empty text takes what was written away). */
function TextField({ value, onCommit, field }: { value: string; onCommit: (v: string) => void; field: string }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const commit = () => (text !== value ? onCommit(text) : undefined);
  return (
    <input
      data-field={field}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

/** A text box for a tolerance class, committed on Enter or on leaving. */
function FitBox({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const commit = () => (text.trim() !== value ? onCommit(text.trim()) : undefined);
  return (
    <input
      data-field="dimFit"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        e.stopPropagation();
      }}
    />
  );
}
