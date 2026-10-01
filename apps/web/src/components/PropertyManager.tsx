import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import {
  evalQuantity,
  findFeature,
  formatQuantity,
  isDimension,
  isNumber,
  isPlain,
  Parameters,
  SKETCH_ORIGIN,
  type ChamferFeature,
  type CombineFeature,
  type Command,
  type DeleteFaceFeature,
  type EndCondition,
  type ExtrudeFeature,
  type FilletFeature,
  type Id,
  type ImportedBodyFeature,
  type MoveFaceFeature,
  type PartDoc,
  type PlaneDefinition,
  type Ref,
  type RefPlaneFeature,
  type RevolveFeature,
  type SketchConstraint,
  type SketchFeature,
} from '@3db/model';
import type { RebuildPayload } from '../worker/protocol';
import { applicableRelations, constraintsOf, dimensionText, sameRelation } from '@3db/sketch/interact';
import { nearestElement } from '../state/candidates';
import { store, useSketcherView, useStore } from '../state/store';
import { DATUM_ITEMS, DIMENSION_LABEL, FEATURE_LABEL, featureLabel, PLANE_MODE_LABEL, RELATION_LABEL, SKETCH_STATUS_LABEL, TOOL_LABEL } from '../strings';
import { Icon } from './Icon';
import type { ControllerView, SketchController } from '../sketcher/controller';

/**
 * What an expression comes to in this document, for showing next to the box (D2.4): the value when it is
 * more than a plain number, or the reason it is not one. Null for a plain number.
 */
function preview(text: string, doc: PartDoc, angle: boolean): { value: string } | { error: string } | null {
  if (!text.trim() || isPlain(text)) return null;
  try {
    const q = evalQuantity(text, new Parameters(doc));
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
  const shown = preview(text, doc, suffix === '°');
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
      <span className="suffix">{suffix}</span>
      {shown && 'value' in shown && <span className="value-preview">= {shown.value}</span>}
    </span>
  );
}

const ENTITY_LABEL = { point: '點', line: '直線', circle: '圓', arc: '圓弧' } as const;

function describe(f: SketchFeature, id: Id): string {
  if (id === SKETCH_ORIGIN) return '原點';
  const e = f.entities.find((x) => x.id === id);
  if (e) return `${e.construction ? '幾何建構線 ' : ''}${ENTITY_LABEL[e.type]} ${id}`;
  const c = f.constraints.find((x) => x.id === id);
  if (c) return isDimension(c) ? `${DIMENSION_LABEL[c.type] ?? '尺寸'} ${dimensionText(c)}` : `${RELATION_LABEL[c.type]} ${id}`;
  return id;
}

function relationText(f: SketchFeature, c: SketchConstraint): string {
  if (isDimension(c)) return `${DIMENSION_LABEL[c.type] ?? '尺寸'} ${dimensionText(c)}`;
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

  return (
    <>
      <section className="pm-group">
        <h4>草圖狀態</h4>
        {solve ? (
          <p className={`sketch-status ${solve.status}`}>
            {SKETCH_STATUS_LABEL[solve.status]}
            {solve.status === 'under' && `（尚有 ${solve.dof} 個自由度）`}
          </p>
        ) : (
          <p className="muted">求解中…</p>
        )}
        {conflicting.length > 0 && <p className="error-text">衝突：{conflicting.join('、')}</p>}
        {solve && solve.problems.length > 0 && f.entities.length > 0 && <p className="hint">尚不能產生特徵：{solve.problems.join('；')}</p>}
      </section>

      {view && view.tool !== 'select' && (
        <section className="pm-group">
          <h4>{TOOL_LABEL[view.tool]}</h4>
          <p className="hint">{view.hint}</p>
          {sketcher && <ToolOptionsBox view={view} sketcher={sketcher} />}
          <p className="hint">Esc 結束工具。</p>
        </section>
      )}

      {sketcher && selection.length > 0 && (
        <section className="pm-group">
          <h4>選取的項目</h4>
          <ul className="selection-box">
            {selection.map((id) => (
              <li key={id}>{describe(f, id)}</li>
            ))}
          </ul>
          {existing.length > 0 && (
            <>
              <h4 className="sub">現有限制條件</h4>
              <ul className="relation-list">
                {existing.map((c) => (
                  <li key={c.id} className={solve?.conflicting.includes(c.id) ? 'over' : ''}>
                    <span>{relationText(f, c)}</span>
                    <button title="刪除" onClick={() => store.execute({ type: 'removeSketchItems', featureId: f.id, ids: [c.id] })}>
                      <Icon name="cancel" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {offered.length > 0 && (
            <>
              <h4 className="sub">加入限制條件</h4>
              <div className="relation-buttons">
                {offered.map((r) => (
                  <button key={r.type} onClick={() => void sketcher.addRelation(r)}>
                    {RELATION_LABEL[r.type]}
                  </button>
                ))}
              </div>
            </>
          )}
          {curves.length > 0 && (
            <label className="pm-row checkbox">
              <input type="checkbox" checked={curves.every((e) => e.construction)} onChange={(e) => sketcher.setConstruction(e.target.checked)} />
              <span>作為幾何建構線</span>
            </label>
          )}
          <p className="hint">Delete 刪除選取的項目。</p>
        </section>
      )}

      <section className="pm-group">
        <h4>尺寸</h4>
        {dims.length === 0 && <p className="muted">（用智慧型尺寸標註）</p>}
        {dims.map((c) => (
          <label key={c.id} className="pm-row">
            <span>{c.label ?? `${DIMENSION_LABEL[c.type] ?? '尺寸'} ${c.id}`}</span>
            <ValueInput
              value={c.value}
              suffix={c.type === 'angle' ? '°' : 'mm'}
              toCommand={(value) => ({ type: 'setDimension', featureId: f.id, constraintId: c.id, value })}
            />
          </label>
        ))}
      </section>
    </>
  );
}


const END_CONDITION: Record<EndCondition['type'], string> = {
  blind: '給定深度',
  midPlane: '兩側對稱',
  throughAll: '完全貫穿',
  upToFace: '成形至某一面',
};

/** 「合併結果」 (C7.1): whether a boss joins the bodies it touches or is a body of its own. */
function MergeBox({ f }: { f: ExtrudeFeature | RevolveFeature | ImportedBodyFeature }) {
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

/** Extrude (C4.1, C4.2): end condition, depth, direction and the end face for 「成形至某一面」. */
function ExtrudePanel({ f }: { f: ExtrudeFeature }) {
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const d = f.dir1;
  const depth = 'depth' in d ? d.depth : '10';
  const reverse = 'reverse' in d ? (d.reverse ?? false) : false;
  const rev = (on: boolean) => (on ? { reverse: true } : {});
  const set = (value: EndCondition) => store.execute({ type: 'setEndCondition', featureId: f.id, dir: 'dir1', value });
  const condition = (type: EndCondition['type'], flip = reverse): EndCondition => {
    switch (type) {
      case 'blind':
        return { type, depth, ...rev(flip) };
      case 'midPlane':
        return { type, depth };
      case 'throughAll':
        return { type, ...rev(flip) };
      case 'upToFace':
        // until a face is picked the reference is empty and the feature reports it as missing
        return { type, face: d.type === 'upToFace' ? d.face : { kind: 'face', name: '' }, ...rev(flip) };
    }
  };
  const faceFound = d.type === 'upToFace' && !!d.face.name && !!result?.faceNames.includes(d.face.name);
  return (
    <section className="pm-group">
      <h4>方向 1</h4>
      <label className="pm-row">
        <span>終止型態</span>
        <select value={d.type} onChange={(e) => set(condition(e.target.value as EndCondition['type']))}>
          {Object.entries(END_CONDITION).map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {'depth' in d && (
        <label className="pm-row">
          <span>深度</span>
          <ValueInput
            value={depth}
            toCommand={(value) => ({ type: 'setEndCondition', featureId: f.id, dir: 'dir1', value: d.type === 'midPlane' ? { type: 'midPlane', depth: value } : { type: 'blind', depth: value, ...rev(reverse) } })}
          />
        </label>
      )}
      {d.type === 'upToFace' && (
        <ul className="selection-box">
          {!d.face.name ? (
            <li className="muted">（在圖面中點選要終止的面）</li>
          ) : (
            <li className={faceFound ? '' : 'missing'} title={d.face.name}>
              終止面{!faceFound && '（遺失參考）'}
              <code>{d.face.name}</code>
              {!faceFound && <UseNearest featureId={f.id} refr={d.face} />}
            </li>
          )}
        </ul>
      )}
      {d.type !== 'midPlane' && (
        <label className="pm-row checkbox">
          <input type="checkbox" checked={reverse} onChange={(e) => set(condition(d.type, e.target.checked))} />
          <span>反轉方向</span>
        </label>
      )}
      <p className="hint">
        輪廓：{findFeature(doc, f.sketch)?.name ?? f.sketch}
        {f.op === 'cut' && '。除料預設往材料內部（與草圖法向相反）。'}
      </p>
      {f.op === 'boss' && <MergeBox f={f} />}
    </section>
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
        <h4>旋轉軸</h4>
        <select value={f.axis} onChange={(e) => store.execute({ type: 'setRevolveAxis', featureId: f.id, axis: e.target.value })}>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.construction ? '中心線' : '直線'} {l.id}
            </option>
          ))}
        </select>
      </section>
      <section className="pm-group">
        <h4>方向 1</h4>
        <label className="pm-row">
          <span>旋轉類型</span>
          <select value={d.type} onChange={(e) => set(e.target.value === 'midPlane' ? { type: 'midPlane', angle: d.angle } : { type: 'blind', angle: d.angle })}>
            <option value="blind">給定深度</option>
            <option value="midPlane">兩側對稱</option>
          </select>
        </label>
        <label className="pm-row">
          <span>角度</span>
          <ValueInput
            value={d.angle}
            suffix="°"
            toCommand={(angle) => ({ type: 'setRevolveCondition', featureId: f.id, value: d.type === 'midPlane' ? { type: 'midPlane', angle } : { type: 'blind', angle, ...(reverse ? { reverse: true } : {}) } })}
          />
        </label>
        {d.type === 'blind' && (
          <label className="pm-row checkbox">
            <input type="checkbox" checked={reverse} onChange={(e) => set({ type: 'blind', angle: d.angle, ...(e.target.checked ? { reverse: true } : {}) })} />
            <span>反轉方向</span>
          </label>
        )}
        <p className="hint">輪廓：{sketch?.name ?? f.sketch}</p>
        {f.op === 'boss' && <MergeBox f={f} />}
      </section>
    </>
  );
}

/** Edge selection box of a fillet or chamfer (D2.1): edges by persistent name, missing ones marked. */
function EdgeList({ f }: { f: FilletFeature | ChamferFeature }) {
  const r = useStore((s) => s.result);
  const label = FEATURE_LABEL[f.type];
  return (
    <section className="pm-group">
      <h4>要產生{label}的邊線</h4>
      <ul className="selection-box">
        {f.edges.length === 0 && <li className="muted">（在圖面中點選邊線）</li>}
        {f.edges.map((e, i) => {
          const found = r?.edgeNames.includes(e.name);
          return (
            <li key={e.name} className={found ? '' : 'missing'} title={e.name}>
              邊線 {i + 1}
              {!found && '（遺失參考）'}
              <code>{e.name}</code>
              {!found && <UseNearest featureId={f.id} refr={e} />}
            </li>
          );
        })}
      </ul>
      <p className="hint">編輯時顯示{label}之前的模型；點選邊線加入或移除。參考以持久名稱儲存，不使用索引。</p>
    </section>
  );
}

function FilletPanel({ f }: { f: FilletFeature }) {
  return (
    <>
      <section className="pm-group">
        <h4>圓角參數</h4>
        <label className="pm-row">
          <span>半徑</span>
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
        <h4>導角參數</h4>
        <label className="pm-row">
          <span>導角類型</span>
          <select
            value={f.mode}
            onChange={(e) => store.execute(e.target.value === 'angleDistance' ? set({ mode: 'angleDistance', second: '45' }) : set({ mode: 'distanceDistance', second: f.distance }))}
          >
            <option value="angleDistance">角度-距離</option>
            <option value="distanceDistance">距離-距離</option>
          </select>
        </label>
        <label className="pm-row">
          <span>{angled ? '距離' : '距離 1'}</span>
          <ValueInput value={f.distance} toCommand={(distance) => set({ distance })} />
        </label>
        <label className="pm-row">
          <span>{angled ? '角度' : '距離 2'}</span>
          <ValueInput value={f.second} suffix={angled ? '°' : 'mm'} toCommand={(second) => set({ second })} />
        </label>
        <label className="pm-row checkbox">
          <input type="checkbox" checked={f.flip ?? false} onChange={(e) => store.execute(set({ flip: e.target.checked }))} />
          <span>反轉方向</span>
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
    <button className="use-nearest" title={`幾何最接近的元素：${near.name}`} onClick={() => store.replaceRef(featureId, refr, near)}>
      改用最接近的：<code>{near.name}</code>
    </button>
  );
}

/**
 * One reference in a selection box: what it is, and whether the model on screen still has it. A
 * datum names a default plane or a reference plane feature; elements are shown by persistent name.
 */
function RefItem({ label, refr, doc, result, featureId }: { label: string; refr: Ref; doc: PartDoc; result: RebuildPayload | null; featureId: string }) {
  if (refr.kind === 'datum') {
    const plane = DATUM_ITEMS.find((d) => d.id === refr.name)?.label ?? findFeature(doc, refr.name)?.name;
    return <li className={plane ? '' : 'missing'}>{label}：{plane ?? `${refr.name}（遺失參考）`}</li>;
  }
  const names = refr.kind === 'face' ? result?.faceNames : refr.kind === 'edge' ? result?.edgeNames : result?.vertexNames;
  const found = !!names?.includes(refr.name);
  return (
    <li className={found ? '' : 'missing'} title={refr.name}>
      {label}
      {!found && '（遺失參考）'}
      <code>{refr.name}</code>
      {!found && <UseNearest featureId={featureId} refr={refr} />}
    </li>
  );
}

const FRONT: Ref = { kind: 'datum', name: 'plane:front' };

/**
 * Reference plane (C3.2): offset from a plane, at an angle to a plane through a straight edge, or
 * through three vertices. References come from the graphics area and, for planes, from the tree.
 */
function RefPlanePanel({ f }: { f: RefPlaneFeature }) {
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const d = f.def;
  const set = (def: PlaneDefinition): Command => ({ type: 'setRefPlane', featureId: f.id, def });
  const plane = d.mode === 'threePoint' ? FRONT : d.plane;
  const modeChange = (mode: PlaneDefinition['mode']) =>
    store.execute(
      set(
        mode === 'offset'
          ? { mode, plane, distance: '10' }
          : mode === 'angle'
            ? { mode, plane, axis: { kind: 'edge', name: '' }, angle: '45' }
            : { mode, points: [] },
      ),
    );
  const reverse = (on: boolean) => {
    const { reverse: _, ...rest } = d;
    store.execute(set((on ? { ...rest, reverse: true } : rest) as PlaneDefinition));
  };
  return (
    <>
      <section className="pm-group">
        <h4>基準面類型</h4>
        <select value={d.mode} onChange={(e) => modeChange(e.target.value as PlaneDefinition['mode'])}>
          {Object.entries(PLANE_MODE_LABEL).map(([mode, label]) => (
            <option key={mode} value={mode}>
              {label}
            </option>
          ))}
        </select>
      </section>
      <section className="pm-group">
        <h4>參考</h4>
        <ul className="selection-box">
          {d.mode !== 'threePoint' && <RefItem label="參考面" refr={d.plane} doc={doc} result={result} featureId={f.id} />}
          {d.mode === 'angle' &&
            (d.axis.name ? <RefItem label="旋轉軸" refr={d.axis} doc={doc} result={result} featureId={f.id} /> : <li className="muted">（在圖面中點選作為旋轉軸的直線邊線）</li>)}
          {d.mode === 'threePoint' && d.points.length === 0 && <li className="muted">（在圖面中點選三個頂點）</li>}
          {d.mode === 'threePoint' && d.points.map((p, i) => <RefItem key={p.name} label={`點 ${i + 1}`} refr={p} doc={doc} result={result} featureId={f.id} />)}
        </ul>
        {d.mode === 'offset' && (
          <label className="pm-row">
            <span>偏移距離</span>
            <ValueInput value={d.distance} toCommand={(distance) => set({ ...d, distance })} />
          </label>
        )}
        {d.mode === 'angle' && (
          <label className="pm-row">
            <span>角度</span>
            <ValueInput value={d.angle} suffix="°" toCommand={(angle) => set({ ...d, angle })} />
          </label>
        )}
        <label className="pm-row checkbox">
          <input type="checkbox" checked={d.reverse ?? false} onChange={(e) => reverse(e.target.checked)} />
          <span>反轉方向</span>
        </label>
        <p className="hint">
          {d.mode === 'threePoint'
            ? '再點一次已選的頂點可移除它。'
            : d.mode === 'angle'
              ? '角度 0° 時與參考面平行，90° 時垂直；參考面也可在設計樹中點選基準面。'
              : '參考面也可在設計樹中點選基準面。'}
        </p>
      </section>
    </>
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
        <h4>輸入的資料</h4>
        <p>{blob?.fileName ?? '（未記錄檔名）'}</p>
        {warnings.map((w) => (
          <p key={w} className="warning-text">
            {w}
          </p>
        ))}
        <p className="hint">
          資料存放在零件檔中（內容雜湊 <code>{blob?.sha256.slice(0, 12)}…</code>），不需要原始檔案。面依檔案中的順序命名。
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
    <div className="property-manager">
      <div className="pm-header">
        <Icon name={f.type} />
        <span className="pm-title">
          {sketching ? '編輯草圖' : featureLabel(f)}：{f.name}
        </span>
        <button className="pm-ok" title={sketching ? '離開草圖' : '確定（Enter）'} onClick={() => store.commitEdit()}>
          <Icon name="ok" />
        </button>
        <button className="pm-cancel" title={sketching ? '放棄變更' : '取消（Esc）'} onClick={() => store.cancelEdit()}>
          <Icon name="cancel" />
        </button>
      </div>
      {status?.status === 'error' && <p className="pm-message error-text">{status.message}</p>}
      {f.type === 'sketch' && <SketchPanel f={f} />}
      {f.type === 'extrude' && <ExtrudePanel f={f} />}
      {f.type === 'revolve' && <RevolvePanel f={f} />}
      {f.type === 'fillet' && <FilletPanel f={f} />}
      {f.type === 'chamfer' && <ChamferPanel f={f} />}
      {f.type === 'refPlane' && <RefPlanePanel f={f} />}
      {f.type === 'importedBody' && <ImportedBodyPanel f={f} />}
      {f.type === 'deleteFace' && <DeleteFacePanel f={f} />}
      {f.type === 'moveFace' && <MoveFacePanel f={f} />}
      {f.type === 'combine' && <CombinePanel f={f} />}
    </div>
  );
}
