import { t } from '@3db/i18n';
import { store, useStore } from '../state/store';
import { componentInfo } from './AssemblyTree';
import { Icon } from './Icon';

/**
 * The PropertyManager that forms a sub-assembly (E-3): the components of the assembly to put in it, and the name of the file it is written to, next to the assembly.
 * ✓ forms it (the file is written, the assembly changes in one undo step); ✕ closes the panel.
 */
export function FormSubPanel() {
  const asm = useStore((s) => s.asm)!;
  const a = store.assembly!;
  const draft = asm.formSub!;
  const problem = a.formSubProblem();
  const choose = (id: string, on: boolean) => a.setFormSub({ ids: on ? [...draft.ids, id] : draft.ids.filter((x) => x !== id) });
  return (
    <div className="property-manager" data-help="form-sub-assembly">
      <div className="pm-header">
        <Icon name="assembly" />
        <span className="pm-title">{t('subassembly.form.title')}</span>
        <button className="pm-ok" title={t('subassembly.form.apply')} data-action="applyFormSub" disabled={problem !== ''} onClick={() => void a.applyFormSub()}>
          <Icon name="ok" />
        </button>
        <button className="pm-cancel" title="Esc" data-action="cancelFormSub" onClick={() => a.cancelFormSub()}>
          <Icon name="cancel" />
        </button>
      </div>
      <div className="pm-group">
        <h4>{t('subassembly.form.components')}</h4>
        <ul className="selection-box" data-form-components>
          {asm.doc.components.map((c) => (
            <li key={c.id}>
              <label>
                <input type="checkbox" checked={draft.ids.includes(c.id)} onChange={(e) => choose(c.id, e.target.checked)} /> {componentInfo(asm, c).name}
              </label>
            </li>
          ))}
        </ul>
        <h4>{t('subassembly.form.name')}</h4>
        <div className="pm-row">
          <input data-field="subAssemblyName" aria-label={t('subassembly.form.name')} value={draft.name} onChange={(e) => a.setFormSub({ name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        {problem && <p className="error-text" data-field="formSubProblem">{problem}</p>}
        <p className="hint">{t('subassembly.form.hint')}</p>
      </div>
    </div>
  );
}
