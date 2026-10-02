import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import { explodeStepProblem } from '@3db/model';
import { store, useStore } from '../state/store';
import { componentInfo } from './AssemblyTree';
import { Icon } from './Icon';

/**
 * The PropertyManager of the exploded view (C15.14): the steps in the order they were made, and the step being made or edited: which components, which
 * direction (one of the assembly's axes, or an element picked in the view), how far. The steps are only intent; 「爆炸」 and 「收合」 are what the view shows,
 * and no component's position is changed by either.
 */
export function ExplodePanel() {
  const asm = useStore((s) => s.asm)!;
  const draft = asm.explode!;
  const a = store.assembly!;
  const step = draft.step;
  const [distance, setDistance] = useState(step.distance);
  useEffect(() => setDistance(step.distance), [step.distance, draft.editing]);
  const problem = explodeStepProblem(step, asm.doc);
  const problems = a.explodeProblems();
  const choose = (id: string, on: boolean) => a.setExplodeDraft({ components: on ? [...step.components, id] : step.components.filter((x) => x !== id) });
  const axisValue = step.axis.kind === 'axis' ? step.axis.axis : 'ref';
  const nameOf = (id: string) => {
    const c = asm.doc.components.find((x) => x.id === id);
    return c ? componentInfo(asm, c).name : id;
  };
  const steps = asm.doc.explosion ?? [];
  return (
    <div className="property-manager">
      <div className="pm-header">
        <Icon name="assembly" />
        <span className="pm-title">{t('explode.title')}</span>
        <button className="pm-ok" title="Enter" onClick={() => a.closeExplode()}>
          <Icon name="ok" />
        </button>
      </div>
      <div className="pm-group">
        <div className="pm-row">
          <button className={`pm-button ${asm.exploded ? 'active' : ''}`} onClick={() => a.setExploded(true)}>
            {t('explode.explode')}
          </button>
          <button className={`pm-button ${asm.exploded ? '' : 'active'}`} onClick={() => a.setExploded(false)}>
            {t('explode.collapse')}
          </button>
        </div>
      </div>
      <div className="pm-group">
        <h4>{t('explode.steps')}</h4>
        {steps.length === 0 ? (
          <p className="muted">{t('explode.noSteps')}</p>
        ) : (
          <ul className="file-list" data-explode-steps>
            {steps.map((s, i) => (
              <li key={s.id} className={draft.editing === s.id ? 'selected' : ''} title={problems.get(s.id) ?? ''}>
                <span className="name">
                  {s.name}
                  {problems.get(s.id) ? ' ⚠' : ''}
                </span>
                <span className="folder muted">{t('explode.stepSummary', { components: s.components.map(nameOf).join(', '), distance: s.distance })}</span>
                <button title={t('explode.edit')} onClick={() => a.editExplodeStep(s.id)}>
                  ✎
                </button>
                <button title={t('explode.up')} disabled={i === 0} onClick={() => a.moveExplodeStep(s.id, i - 1)}>
                  ↑
                </button>
                <button title={t('explode.down')} disabled={i === steps.length - 1} onClick={() => a.moveExplodeStep(s.id, i + 1)}>
                  ↓
                </button>
                <button title={t('explode.deleteStep')} onClick={() => a.deleteExplodeSteps([s.id])}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pm-group">
        <h4>{draft.editing ? t('explode.updateStep') : t('explode.addStep')}</h4>
        <div className="pm-row">
          <input
            aria-label={t('explode.steps')}
            value={step.name}
            onChange={(e) => a.setExplodeDraft({ name: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <h4>{t('explode.components')}</h4>
        <ul className="selection-box" data-explode-components>
          {asm.doc.components
            .filter((c) => !c.suppressed)
            .map((c) => (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={step.components.includes(c.id)} onChange={(e) => choose(c.id, e.target.checked)} /> {componentInfo(asm, c).name}
                </label>
              </li>
            ))}
        </ul>
        <h4>{t('explode.direction')}</h4>
        <div className="pm-row">
          <select
            value={axisValue}
            aria-label={t('explode.direction')}
            onChange={(e) => (e.target.value === 'ref' ? a.pickExplodeAxis(true) : a.setExplodeDraft({ axis: { kind: 'axis', axis: e.target.value as 'x' | 'y' | 'z' } }))}
          >
            <option value="x">{t('pattern.axisX')}</option>
            <option value="y">{t('pattern.axisY')}</option>
            <option value="z">{t('pattern.axisZ')}</option>
            {step.axis.kind === 'ref' && <option value="ref">{t('pattern.axisElement', { name: `${step.axis.ref.ref.name}@${a.ownerLabel(step.axis.ref.component ?? '', step.axis.ref.path)}` })}</option>}
          </select>
          <button className={`pm-button ${draft.picking ? 'active' : ''}`} onClick={() => a.pickExplodeAxis(!draft.picking)}>
            {t('pattern.pickInView')}
          </button>
        </div>
        {draft.picking && <p className="hint">{t('pattern.picking')}</p>}
        <div className="pm-row">
          <span>{t('explode.distance')}</span>
          <input
            aria-label={t('explode.distance')}
            style={{ width: 90 }}
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            onBlur={() => distance.trim() !== step.distance && a.setExplodeDraft({ distance: distance.trim() })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') a.setExplodeDraft({ distance: distance.trim() });
              e.stopPropagation();
            }}
          />
          <span className="suffix">mm</span>
        </div>
        <label className="pm-row">
          <input type="checkbox" checked={!!step.flip} onChange={(e) => a.setExplodeDraft({ flip: e.target.checked })} />
          <span>{t('explode.flip')}</span>
        </label>
        {problem && <p className="error-text">{problem}</p>}
        <div className="pm-row">
          <button className="pm-button" disabled={!!problem || distance.trim() !== step.distance} onClick={() => a.applyExplodeStep()}>
            {draft.editing ? t('explode.updateStep') : t('explode.addStep')}
          </button>
        </div>
      </div>
      <p className="hint">{t('explode.hint')}</p>
    </div>
  );
}
