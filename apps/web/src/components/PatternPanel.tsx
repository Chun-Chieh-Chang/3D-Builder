import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import { componentPatternLabels, componentPatternProblem, type ComponentPattern, type MirrorPlane, type PatternAxis } from '@3db/model';
import { store, useStore } from '../state/store';
import { PREVIEW_PATTERN } from '../state/assembly';
import { componentInfo } from './AssemblyTree';
import { Icon } from './Icon';

const PLANES: { id: MirrorPlane; label: () => string }[] = [
  { id: 'plane:front', label: () => t('pattern.planeFront') },
  { id: 'plane:top', label: () => t('pattern.planeTop') },
  { id: 'plane:right', label: () => t('pattern.planeRight') },
];

/** What separates the numbers of the instances to skip: commas of either width, the enumeration comma, spaces. */
const SKIP_SEPARATORS = new RegExp(`[,${String.fromCharCode(0x3001, 0xff0c)}\\s]+`);

/** A text box that commits on Enter or when it loses focus. */
function TextBox({ value, onCommit, label, width }: { value: string; onCommit: (v: string) => void; label: string; width?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onCommit(text.trim());
  return (
    <input
      aria-label={label}
      value={text}
      style={width ? { width } : undefined}
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

/** The direction or axis of one slot: one of the assembly's axes, or an element picked in the view. */
function AxisField({ slot, axis, title }: { slot: 'axis1' | 'axis2'; axis: PatternAxis | undefined; title: string }) {
  const draft = useStore((s) => s.asm?.pattern)!;
  const a = store.assembly!;
  const value = axis?.kind === 'axis' ? axis.axis : 'ref';
  const set = (v: string) => (v === 'ref' ? a.pickPatternAxis(slot) : a.setPatternDraft({ [slot]: { kind: 'axis', axis: v as 'x' | 'y' | 'z' } }));
  const picking = draft.picking === slot;
  return (
    <div className="pm-group">
      <h4>{title}</h4>
      <div className="pm-row">
        <select value={value} onChange={(e) => set(e.target.value)} aria-label={title}>
          <option value="x">{t('pattern.axisX')}</option>
          <option value="y">{t('pattern.axisY')}</option>
          <option value="z">{t('pattern.axisZ')}</option>
          {axis?.kind === 'ref' && <option value="ref">{t('pattern.axisElement', { name: `${axis.ref.ref.name}@${a.ownerLabel(axis.ref.component ?? '', axis.ref.path)}` })}</option>}
        </select>
        <button className={`pm-button ${picking ? 'active' : ''}`} onClick={() => a.pickPatternAxis(picking ? null : slot)}>
          {t('pattern.pickInView')}
        </button>
      </div>
      {picking && <p className="hint">{t('pattern.picking')}</p>}
    </div>
  );
}

/**
 * The PropertyManager of a pattern or mirror of a component (C15.13): the seed, the direction or axis, the number and spacing,
 * the instances to skip; or the plane a component is mirrored about. The instances show as the definition is made (derived
 * from the seed, never stored); ✓ adds the pattern, ✗ drops the draft.
 */
export function PatternPanel() {
  const asm = useStore((s) => s.asm)!;
  const draft = asm.pattern!;
  const a = store.assembly!;
  const p = draft.pattern;
  const [skipText, setSkipText] = useState((p.skip ?? []).join(', '));
  useEffect(() => setSkipText((p.skip ?? []).join(', ')), [draft.editing]);
  const problem = componentPatternProblem(p) ?? a.patternProblems().get(draft.editing ?? PREVIEW_PATTERN) ?? null;
  const title = p.kind === 'linear' ? t('pattern.titleLinear') : p.kind === 'circular' ? t('pattern.titleCircular') : t('pattern.titleMirror');
  const set = (patch: Partial<ComponentPattern>) => a.setPatternDraft(patch);
  const labels = componentPatternLabels(p);
  const grid = p.kind === 'linear' && !!p.axis2;
  const count = (key: 'count1' | 'count2') => (
    <TextBox
      label={t('pattern.compCount')}
      width={64}
      value={String(p[key] ?? '')}
      onCommit={(v) => set({ [key]: Number(v) })}
    />
  );
  return (
    <div className="property-manager">
      <div className="pm-header">
        <Icon name="assembly" />
        <span className="pm-title">{title}</span>
        <button className="pm-ok" title="Enter" disabled={!!problem} onClick={() => a.applyPattern()}>
          <Icon name="ok" />
        </button>
        <button className="pm-cancel" title="Esc" onClick={() => a.cancelPattern()}>
          <Icon name="cancel" />
        </button>
      </div>
      <div className="pm-group">
        <h4>{t('pattern.seed')}</h4>
        <div className="pm-row">
          <select value={p.seed} onChange={(e) => set({ seed: e.target.value })} aria-label={t('pattern.seed')}>
            {asm.doc.components
              .filter((c) => !c.suppressed)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {componentInfo(asm, c).name}
                </option>
              ))}
          </select>
        </div>
      </div>
      {p.kind === 'mirror' ? (
        <div className="pm-group">
          <h4>{t('pattern.mirrorPlane')}</h4>
          <div className="pm-row">
            <select value={p.plane ?? ''} onChange={(e) => set({ plane: e.target.value as MirrorPlane })} aria-label={t('pattern.mirrorPlane')}>
              {PLANES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label()}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <>
          <AxisField slot="axis1" axis={p.axis1} title={p.kind === 'linear' ? t('pattern.compDirection1') : t('pattern.axis')} />
          <div className="pm-group">
            <div className="pm-row">
              <span>{t('pattern.compCount')}</span>
              {count('count1')}
            </div>
            <div className="pm-row">
              <span>{p.kind === 'linear' ? t('pattern.spacing') : t('pattern.angle')}</span>
              <TextBox label={t('pattern.spacing')} width={90} value={p.spacing1 ?? ''} onCommit={(v) => set({ spacing1: v })} />
              <span className="suffix">{p.kind === 'linear' ? 'mm' : '°'}</span>
            </div>
            <label className="pm-row">
              <input type="checkbox" checked={!!p.flip1} onChange={(e) => set({ flip1: e.target.checked })} />
              <span>{t('pattern.flip')}</span>
            </label>
            {p.kind === 'circular' && (
              <label className="pm-row">
                <input type="checkbox" checked={!!p.equal} onChange={(e) => set({ equal: e.target.checked })} />
                <span>{t('pattern.equal')}</span>
              </label>
            )}
          </div>
          {p.kind === 'linear' &&
            (grid ? (
              <>
                <AxisField slot="axis2" axis={p.axis2} title={t('pattern.compDirection2')} />
                <div className="pm-group">
                  <div className="pm-row">
                    <span>{t('pattern.compCount')}</span>
                    {count('count2')}
                  </div>
                  <div className="pm-row">
                    <span>{t('pattern.spacing')}</span>
                    <TextBox label={t('pattern.spacing')} width={90} value={p.spacing2 ?? ''} onCommit={(v) => set({ spacing2: v })} />
                    <span className="suffix">mm</span>
                  </div>
                  <label className="pm-row">
                    <input type="checkbox" checked={!!p.flip2} onChange={(e) => set({ flip2: e.target.checked })} />
                    <span>{t('pattern.flip')}</span>
                  </label>
                  <button className="pm-button" onClick={() => set({ axis2: undefined, count2: undefined, spacing2: undefined, flip2: undefined, skip: [] })}>
                    {t('pattern.removeDirection2')}
                  </button>
                </div>
              </>
            ) : (
              <div className="pm-group">
                <button className="pm-button" onClick={() => set({ axis2: { kind: 'axis', axis: 'z' }, count2: 2, spacing2: '50' })}>
                  {t('pattern.addDirection2')}
                </button>
              </div>
            ))}
          <div className="pm-group">
            <h4>{t('pattern.skip')}</h4>
            <div className="pm-row">
              <input
                aria-label={t('pattern.skip')}
                value={skipText}
                onChange={(e) => setSkipText(e.target.value)}
                onBlur={() => set({ skip: skipText.split(SKIP_SEPARATORS).filter(Boolean) })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') set({ skip: skipText.split(SKIP_SEPARATORS).filter(Boolean) });
                  e.stopPropagation();
                }}
              />
            </div>
            <p className="hint">{t('pattern.skipHint', { labels: labels.length > 12 ? `${labels.slice(0, 12).join(', ')} …` : labels.join(', ') })}</p>
          </div>
        </>
      )}
      {problem && <p className="error-text">{problem}</p>}
      <p className="hint">{t('pattern.derivedHint')}</p>
    </div>
  );
}
