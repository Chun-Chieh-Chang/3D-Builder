import { useEffect, useState } from 'react';
import {
  findFeature,
  isDimension,
  SKETCH_ORIGIN,
  type Command,
  type ExtrudeFeature,
  type FilletFeature,
  type Id,
  type SketchConstraint,
  type SketchFeature,
} from '@3db/model';
import { applicableRelations, constraintsOf, dimensionText, sameRelation } from '@3db/sketch/interact';
import { store, useSketcherView, useStore } from '../state/store';
import { DIMENSION_LABEL, FEATURE_LABEL, RELATION_LABEL, SKETCH_STATUS_LABEL, TOOL_LABEL } from '../strings';
import { Icon } from './Icon';

/** Numeric field that commits a document command on Enter/blur; invalid input stays red (D6.1). */
function ValueInput({ value, toCommand, suffix = 'mm' }: { value: string; toCommand: (v: string) => Command; suffix?: string }) {
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
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
        className={invalid ? 'invalid' : ''}
        value={text}
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

function ExtrudePanel({ f }: { f: ExtrudeFeature }) {
  const doc = useStore((s) => s.doc);
  const d = f.dir1;
  const depth = 'depth' in d ? d.depth : '10';
  const set = (value: ExtrudeFeature['dir1']) => store.execute({ type: 'setEndCondition', featureId: f.id, dir: 'dir1', value });
  return (
    <section className="pm-group">
      <h4>方向 1</h4>
      <label className="pm-row">
        <span>終止型態</span>
        <select value={d.type} onChange={(e) => set(e.target.value === 'midPlane' ? { type: 'midPlane', depth } : { type: 'blind', depth })}>
          <option value="blind">給定深度</option>
          <option value="midPlane">兩側對稱</option>
        </select>
      </label>
      <label className="pm-row">
        <span>深度</span>
        <ValueInput
          value={depth}
          toCommand={(value) => ({
            type: 'setEndCondition',
            featureId: f.id,
            dir: 'dir1',
            value: d.type === 'midPlane' ? { type: 'midPlane', depth: value } : { type: 'blind', depth: value, ...(d.type === 'blind' && d.reverse ? { reverse: true } : {}) },
          })}
        />
      </label>
      {d.type === 'blind' && (
        <label className="pm-row checkbox">
          <input type="checkbox" checked={d.reverse ?? false} onChange={(e) => set({ type: 'blind', depth, ...(e.target.checked ? { reverse: true } : {}) })} />
          <span>反轉方向</span>
        </label>
      )}
      <p className="hint">輪廓：{findFeature(doc, f.sketch)?.name ?? f.sketch}</p>
    </section>
  );
}

function FilletPanel({ f }: { f: FilletFeature }) {
  const r = useStore((s) => s.result);
  return (
    <>
      <section className="pm-group">
        <h4>圓角參數</h4>
        <label className="pm-row">
          <span>半徑</span>
          <ValueInput value={f.radius} toCommand={(value) => ({ type: 'setFilletRadius', featureId: f.id, value })} />
        </label>
      </section>
      <section className="pm-group">
        <h4>要產生圓角的邊線</h4>
        <ul className="selection-box">
          {f.edges.length === 0 && <li className="muted">（在圖面中點選邊線）</li>}
          {f.edges.map((e, i) => {
            const found = r?.edgeNames.includes(e.name);
            return (
              <li key={e.name} className={found ? '' : 'missing'} title={e.name}>
                邊線 {i + 1}
                {!found && '（遺失參考）'}
                <code>{e.name}</code>
              </li>
            );
          })}
        </ul>
        <p className="hint">編輯時顯示圓角之前的模型；點選邊線加入或移除。參考以持久名稱儲存，不使用索引。</p>
      </section>
    </>
  );
}

/** PropertyManager (D2): parameters of the feature being edited; ✔ commits one undo step, ✖ restores (B7.3). */
export function PropertyManager() {
  const editing = useStore((s) => s.editing);
  const doc = useStore((s) => s.doc);
  if (!editing) return null;
  const f = findFeature(doc, editing.featureId);
  if (!f) return null;
  const sketching = editing.kind === 'sketch';
  return (
    <div className="property-manager">
      <div className="pm-header">
        <Icon name={f.type} />
        <span className="pm-title">
          {sketching ? '編輯草圖' : FEATURE_LABEL[f.type]}：{f.name}
        </span>
        <button className="pm-ok" title={sketching ? '離開草圖' : '確定（Enter）'} onClick={() => store.commitEdit()}>
          <Icon name="ok" />
        </button>
        <button className="pm-cancel" title={sketching ? '放棄變更' : '取消（Esc）'} onClick={() => store.cancelEdit()}>
          <Icon name="cancel" />
        </button>
      </div>
      {f.type === 'sketch' && <SketchPanel f={f} />}
      {f.type === 'extrude' && <ExtrudePanel f={f} />}
      {f.type === 'fillet' && <FilletPanel f={f} />}
    </div>
  );
}
