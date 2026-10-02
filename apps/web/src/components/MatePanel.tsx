import { useEffect, useState } from 'react';
import { DATUM_PLANES, type MateRef, type MateType } from '@3db/model';
import { MATE_LABEL } from '@3db/assembly';
import { store, useStore } from '../state/store';
import { PREVIEW_MATE, type AssemblyState, type MateDraft } from '../state/assembly';
import { DATUM_ITEMS } from '../strings';
import { componentInfo } from './AssemblyTree';
import { Icon } from './Icon';

const TYPES: MateType[] = ['coincident', 'parallel', 'perpendicular', 'tangent', 'concentric', 'lock', 'distance', 'angle'];
const KIND_WORD = { face: '面', edge: '邊線', vertex: '頂點', datum: '', body: '本體' } as const;
const PLANE_LABEL: Record<string, string> = Object.fromEntries(DATUM_ITEMS.map((d) => [d.id, d.label]));

/** An element as the selection box lists it: 「面 extrude1:cap:end@定位板<1>」, 「前基準面@組合件」. */
export function elementLabel(asm: AssemblyState, ref: MateRef): string {
  const owner = ref.component === null ? '組合件' : (store.assembly?.ownerLabel(ref.component, ref.path) ?? ref.component);
  if (ref.ref.kind === 'datum') {
    const plane = PLANE_LABEL[ref.ref.name] ?? store.assembly?.elementPart(ref)?.build.planes.find((p) => p.id === ref.ref.name)?.name ?? ref.ref.name;
    return `${plane}@${owner}`;
  }
  return `${KIND_WORD[ref.ref.kind]} ${ref.ref.name}@${owner}`;
}

/** What the mate being previewed does: holds, over-defines the assembly, or cannot be made. */
function previewStatus(asm: AssemblyState, d: MateDraft): { kind: 'ok' | 'error'; text: string } | null {
  const r = asm.solution?.mates.get(d.editing ?? PREVIEW_MATE);
  if (!r || !d.a || !d.b) return null;
  if (r.status === 'ok') return { kind: 'ok', text: '結合成立' };
  if (r.status === 'conflict') return { kind: 'error', text: '這個結合與之前的結合矛盾，組合件會過多定義' };
  if (r.status === 'suppressed') return { kind: 'ok', text: '結合已抑制' };
  return { kind: 'error', text: r.message };
}

/** A number box that commits on Enter or when it loses focus. */
function ValueBox({ value, suffix, onCommit }: { value: string; suffix: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onCommit(text.trim());
  return (
    <span className="value-input">
      <input
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
      <span className="suffix">{suffix}</span>
    </span>
  );
}

/**
 * The mate PropertyManager (C15.8): the two elements, the standard mates the pair allows (the one
 * SolidWorks would pick is chosen), alignment, and a distance or angle with 「反轉尺寸」. The mate is
 * previewed as it would be solved. ✓ adds it and waits for the next pair; ✓ with nothing chosen, or ✕,
 * closes the PropertyManager.
 */
export function MatePanel() {
  const asm = useStore((s) => s.asm)!;
  const d = asm.mate!;
  const a = store.assembly;
  const offered = a?.mateTypes() ?? [];
  const status = previewStatus(asm, d);
  const editing = d.editing ? asm.doc.mates.find((m) => m.id === d.editing) : undefined;
  const refs = [d.a, d.b];
  return (
    <div className="property-manager">
      <div className="pm-header">
        <Icon name="mates" />
        <span className="pm-title">{editing ? `編輯結合：${editing.name}` : '結合'}</span>
        <button className="pm-ok" title={d.a || d.b || d.editing ? '加入結合（Enter）' : '關閉'} onClick={() => a?.applyMate()}>
          <Icon name="ok" />
        </button>
        <button className="pm-cancel" title="取消（Esc）" onClick={() => a?.cancelMate()}>
          <Icon name="cancel" />
        </button>
      </div>
      <div className="pm-group">
        <h4>結合選擇</h4>
        <ul className="selection-box">
          {refs.map((r, i) =>
            r ? (
              <li key={i} className="removable">
                <span>{elementLabel(asm, r)}</span>
                <button title="移除" onClick={() => a?.pickElement(r)}>
                  <Icon name="cancel" />
                </button>
              </li>
            ) : null,
          )}
        </ul>
        {!d.a || !d.b ? <p className="hint">在圖面中點選兩個零組件上的面、邊線或頂點；基準面與原點在圖面左上的樹中。</p> : null}
      </div>
      {d.a && d.b && (
        <div className="pm-group">
          <h4>標準結合</h4>
          <div className="mate-types">
            {TYPES.map((t) => (
              <button key={t} className={t === d.type ? 'active' : ''} disabled={!offered.includes(t)} onClick={() => a?.setMateType(t)}>
                {MATE_LABEL[t]}
              </button>
            ))}
          </div>
          {(d.type === 'distance' || d.type === 'angle') && (
            <div className="pm-row">
              <span>{d.type === 'distance' ? '距離' : '角度'}</span>
              <ValueBox value={d.value ?? ''} suffix={d.type === 'distance' ? 'mm' : '°'} onCommit={(value) => a?.setMateOptions({ value })} />
            </div>
          )}
          {(d.type === 'distance' || d.type === 'angle') && (
            <label className="pm-row checkbox">
              <input type="checkbox" checked={!!d.flip} onChange={(e) => a?.setMateOptions({ flip: e.target.checked })} />
              <span>反轉尺寸</span>
            </label>
          )}
          {d.align && (
            <div className="pm-row">
              <span>結合對正</span>
              <span className="mate-align">
                <button className={d.align === 'aligned' ? 'active' : ''} onClick={() => a?.setMateOptions({ align: 'aligned' })}>
                  同向對齊
                </button>
                <button className={d.align === 'antiAligned' ? 'active' : ''} onClick={() => a?.setMateOptions({ align: 'antiAligned' })}>
                  反向對齊
                </button>
              </span>
            </div>
          )}
          {status && <p className={status.kind === 'ok' ? 'hint' : 'error-text'}>{status.text}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The flyout FeatureManager in the graphics area while a mate is defined: the assembly's planes and
 * origin, and each component's, to pick as mate elements (SolidWorks shows the same tree there).
 */
export function MateFlyout() {
  const asm = useStore((s) => s.asm)!;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const d = asm.mate;
  const pathKey = (path: readonly string[] | undefined) => (path ?? []).join('/');
  const chosen = (component: string | null, name: string, path?: readonly string[]) => [d?.a, d?.b].some((r) => r && r.component === component && pathKey(r.path) === pathKey(path) && r.ref.kind === 'datum' && r.ref.name === name);
  const pick = (component: string | null, name: string, path?: string[]) => store.assembly?.pickElement({ component, ...(path?.length ? { path } : {}), ref: { kind: 'datum', name } });
  const items = (component: string | null, extra: { id: string; name: string }[], path?: string[]) => (
    <ul>
      {[...DATUM_ITEMS.filter((x) => x.id in DATUM_PLANES), { id: 'origin', label: '原點' }].map((x) => (
        <li key={x.id} className={chosen(component, x.id, path) ? 'selected' : ''} onClick={() => pick(component, x.id, path)}>
          <Icon name={x.id === 'origin' ? 'origin' : 'plane'} />
          {x.label}
        </li>
      ))}
      {extra.map((p) => (
        <li key={p.id} className={chosen(component, p.id, path) ? 'selected' : ''} onClick={() => pick(component, p.id, path)}>
          <Icon name="plane" />
          {p.name}
        </li>
      ))}
    </ul>
  );
  const toggle = (id: string) => setOpen((s) => new Set(s.has(id) ? [...s].filter((x) => x !== id) : [...s, id]));
  return (
    <div className="flyout-tree" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flyout-title">{store.assembly?.name()}</div>
      {items(null, [])}
      {asm.doc.components.filter((c) => !c.suppressed).map((c) => (
        <div key={c.id}>
          <div className="flyout-component" onClick={() => toggle(c.id)}>
            <span className="twisty">{open.has(c.id) ? '▾' : '▸'}</span>
            <Icon name="part" />
            {componentInfo(asm, c).name}
          </div>
          {open.has(c.id) && items(c.id, store.assembly?.buildOf(c.id)?.planes ?? [])}
          {open.has(c.id) &&
            store.assembly?.leaves().filter((l) => l.top === c.id && l.path.length > 0).map((l) => (
              <div key={l.id} className="flyout-leaf">
                <div className="flyout-component" onClick={() => toggle(l.id)}>
                  <span className="twisty">{open.has(l.id) ? '▾' : '▸'}</span>
                  <Icon name="part" />
                  {store.assembly?.ownerLabel(c.id, l.path, 1)}
                </div>
                {open.has(l.id) && items(c.id, store.assembly?.buildOfLeaf(l)?.planes ?? [], l.path)}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
