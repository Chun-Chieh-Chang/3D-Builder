import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import { evalAngle, evalLength, type Vec3 } from '@3db/model';
import { store, useStore } from '../state/store';
import type { MoveOp } from '../state/assembly';
import { componentInfo } from './AssemblyTree';
import { Icon } from './Icon';

type MoveMode = 'free' | 'by' | 'to';
type TurnMode = 'free' | 'by';

const AXES = ['X', 'Y', 'Z'] as const;
const trim = (v: number) => String(Math.round(v * 1000) / 1000 + 0);

/** Three number boxes and 「套用」: ΔX ΔY ΔZ, or X Y Z. */
function XyzFields({ labels, suffix, initial, onApply }: { labels: string[]; suffix: string; initial: string[]; onApply: (values: string[]) => void }) {
  const [values, setValues] = useState(initial);
  useEffect(() => setValues(initial), [initial.join()]);
  return (
    <div className="xyz-fields">
      {labels.map((label, i) => (
        <div key={label} className="pm-row">
          <span>{label}</span>
          <span className="value-input">
            <input
              value={values[i]}
              onChange={(e) => setValues(values.map((v, k) => (k === i ? e.target.value : v)))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onApply(values);
                }
                e.stopPropagation();
              }}
            />
            <span className="suffix">{suffix}</span>
          </span>
        </div>
      ))}
      <div className="pm-row">
        <span />
        <button className="pm-button" onClick={() => onApply(values)}>
          {t('movepm.apply')}
        </button>
      </div>
    </div>
  );
}

/**
 * 「移動零組件」 / 「旋轉零組件」 PropertyManager (C15.3). Dragging a component in the graphics area moves
 * it (turns it, with 旋轉 chosen or with the right button), only along the freedoms its mates leave
 * (A3.5); or the selected component is moved by numbers: 依據 Delta XYZ, 至 XYZ 位置 (its origin), or
 * turned by degrees about the assembly's X, Y and Z. Each move is one undo step. ✓ closes it.
 */
export function MovePanel() {
  const asm = useStore((s) => s.asm)!;
  const a = store.assembly;
  const tool = asm.move!.tool;
  const [moveMode, setMoveMode] = useState<MoveMode>('free');
  const [turnMode, setTurnMode] = useState<TurnMode>('free');
  const c = asm.doc.components.find((x) => x.id === asm.selected);
  const result = c ? asm.solution?.components.get(c.id) : undefined;
  const origin = c ? (a?.poseOf(c.id)?.position ?? [0, 0, 0]) : [0, 0, 0];
  const apply = (op: MoveOp) => void a?.moveSelected(op);
  const read = (values: string[], parse: (v: string) => number): Vec3 | null => {
    try {
      const v = values.map((x) => parse(x.trim() || '0'));
      return v.every(Number.isFinite) ? (v as Vec3) : null;
    } catch (e) {
      store.notify(e instanceof Error ? e.message : String(e), 'error');
      return null;
    }
  };
  const state = !c ? null : c.fixed ? t('movepm.fixed') : result?.dof === 0 ? t('movepm.defined') : result ? t('movepm.dof', { n: result.dof }) : null;
  return (
    <div className="property-manager" data-help="move-component">
      <div className="pm-header">
        <Icon name="assembly" />
        <span className="pm-title">{t(tool === 'move' ? 'act.moveComponent' : 'act.rotateComponent')}</span>
        <button className="pm-ok" title={t('movepm.close')} onClick={() => a?.closeMove()}>
          <Icon name="ok" />
        </button>
      </div>
      <div className="pm-group">
        <h4>{t('movepm.component')}</h4>
        <ul className="selection-box">{c && <li>{componentInfo(asm, c).name}</li>}</ul>
        {state ? <p className={c?.fixed || result?.dof === 0 ? 'error-text' : 'hint'}>{state}</p> : <p className="hint">{t('movepm.pickComponent')}</p>}
      </div>
      <div className="pm-group">
        <h4>{t('movepm.whileDragging')}</h4>
        <span className="mate-align">
          <button className={tool === 'move' ? 'active' : ''} onClick={() => a?.setMoveTool('move')}>
            {t('movepm.move')}
          </button>
          <button className={tool === 'rotate' ? 'active' : ''} onClick={() => a?.setMoveTool('rotate')}>
            {t('movepm.rotate')}
          </button>
        </span>
        <p className="hint">{t('movepm.dragHint')}</p>
        <label className="pm-row checkbox">
          <input type="checkbox" data-field="collisionStop" checked={asm.collisionStop} onChange={(e) => a?.setCollisionStop(e.target.checked)} />
          <span>{t('move.collision')}</span>
        </label>
        {asm.collisionStop && <p className="hint">{t('move.collisionHint')}</p>}
        {asm.drag?.blocked && <p className="error-text" data-field="collisionHit">{t('move.collisionHit', { names: asm.drag.blocked.names.join(', ') })}</p>}
      </div>
      {tool === 'move' ? (
        <div className="pm-group">
          <h4>{t('movepm.move')}</h4>
          <div className="pm-row">
            <select value={moveMode} onChange={(e) => setMoveMode(e.target.value as MoveMode)} aria-label={t('movepm.moveMode')}>
              <option value="free">{t('movepm.free')}</option>
              <option value="by">{t('movepm.byDelta')}</option>
              <option value="to">{t('movepm.toXyz')}</option>
            </select>
          </div>
          {moveMode === 'by' && (
            <XyzFields
              labels={AXES.map((x) => `Δ${x}`)}
              suffix="mm"
              initial={['0', '0', '0']}
              onApply={(v) => {
                const delta = read(v, evalLength);
                if (delta) apply({ kind: 'by', delta });
              }}
            />
          )}
          {moveMode === 'to' && (
            <XyzFields
              labels={[...AXES]}
              suffix="mm"
              initial={origin.map(trim)}
              onApply={(v) => {
                const position = read(v, evalLength);
                if (position) apply({ kind: 'to', position });
              }}
            />
          )}
          {moveMode === 'to' && <p className="hint">{t('movepm.toHint')}</p>}
        </div>
      ) : (
        <div className="pm-group">
          <h4>{t('movepm.rotate')}</h4>
          <div className="pm-row">
            <select value={turnMode} onChange={(e) => setTurnMode(e.target.value as TurnMode)} aria-label={t('movepm.turnMode')}>
              <option value="free">{t('movepm.free')}</option>
              <option value="by">{t('movepm.byDelta')}</option>
            </select>
          </div>
          {turnMode === 'by' && (
            <XyzFields
              labels={AXES.map((x) => `Δ${x}`)}
              suffix="°"
              initial={['0', '0', '0']}
              onApply={(v) => {
                const angles = read(v, evalAngle);
                if (angles) apply({ kind: 'turn', angles });
              }}
            />
          )}
          {turnMode === 'by' && <p className="hint">{t('movepm.turnHint')}</p>}
        </div>
      )}
    </div>
  );
}
