import { useEffect, useState } from 'react';
import {
  findFeature,
  isDimension,
  type Command,
  type ExtrudeFeature,
  type FilletFeature,
  type SketchFeature,
} from '@3db/model';
import { store, useStore } from '../state/store';
import { DIMENSION_LABEL, FEATURE_LABEL, SKETCH_STATUS_LABEL } from '../strings';
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

function SketchPanel({ f }: { f: SketchFeature }) {
  const r = useStore((s) => s.result?.features.find((x) => x.id === f.id));
  const dims = f.constraints.filter(isDimension);
  return (
    <>
      <section className="pm-group">
        <h4>草圖狀態</h4>
        {r?.sketch ? (
          <p className={`sketch-status ${r.sketch.status}`}>
            {SKETCH_STATUS_LABEL[r.sketch.status]}
            {r.sketch.status === 'under' && `（尚有 ${r.sketch.dof} 個自由度）`}
          </p>
        ) : (
          <p className="muted">計算中…</p>
        )}
        {r?.sketch && r.sketch.conflicting.length > 0 && <p className="error-text">衝突的限制條件：{r.sketch.conflicting.join('、')}</p>}
        {r?.sketch && r.sketch.problems.length > 0 && <p className="error-text">{r.sketch.problems.join('；')}</p>}
      </section>
      <section className="pm-group">
        <h4>尺寸</h4>
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
        <p className="hint">完整的草圖繪製工具（畫線、加入限制條件）排在 Phase 1。</p>
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
  return (
    <div className="property-manager">
      <div className="pm-header">
        <Icon name={f.type} />
        <span className="pm-title">
          {FEATURE_LABEL[f.type]}：{f.name}
        </span>
        <button className="pm-ok" title="確定（Enter）" onClick={() => store.commitEdit()}>
          <Icon name="ok" />
        </button>
        <button className="pm-cancel" title="取消（Esc）" onClick={() => store.cancelEdit()}>
          <Icon name="cancel" />
        </button>
      </div>
      {f.type === 'sketch' && <SketchPanel f={f} />}
      {f.type === 'extrude' && <ExtrudePanel f={f} />}
      {f.type === 'fillet' && <FilletPanel f={f} />}
    </div>
  );
}
