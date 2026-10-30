import { useEffect, useRef, useState } from 'react';
import { labelsOf, t } from '@3db/i18n';
import { findFeature, joinPath, mateEnds, type Id } from '@3db/model';
import { deletion } from '@3db/regen/dag';
import { store, useDocumentName, useStore } from '../state/store';
import { featureLabel } from '../strings';
import { componentInfo, mateProblem } from './AssemblyTree';
import { Icon } from './Icon';

/**
 * 「確認刪除」 (B2.8): what the deletion removes, with the SolidWorks choices to take the dependent
 * features and the sketches left unused ("absorbed") along. Both start unticked: the least destructive.
 */
export function DeleteDialog() {
  const id = useStore((s) => s.confirmDelete);
  const doc = useStore((s) => s.doc);
  const [children, setChildren] = useState(false);
  const [absorbed, setAbsorbed] = useState(false);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setChildren(false);
    setAbsorbed(false);
    ok.current?.focus();
  }, [id]);
  const feature = id ? findFeature(doc, id) : undefined;
  if (!id || !feature) return null;
  const plan = deletion(doc, id, { children, absorbed });
  const name = (x: Id) => doc.features.find((f) => f.id === x)?.name ?? x;
  const close = () => store.requestDelete(null);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal" role="dialog" aria-label={t('del.title')} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('del.title')}</h3>
        <p className="muted">{t('del.features')}</p>
        <ul className="delete-list">
          {plan.features.map((x) => {
            const f = findFeature(doc, x)!;
            return (
              <li key={x}>
                <Icon name={f.type} /> {featureLabel(f)}: {f.name}
              </li>
            );
          })}
        </ul>
        {plan.children.length > 0 && (
          <>
            <label className="pm-row checkbox">
              <input type="checkbox" checked={children} onChange={(e) => setChildren(e.target.checked)} />
              <span>{t('del.children', { names: plan.children.map(name).join(t('cmd.listSeparator')) })}</span>
            </label>
            {!children && <p className="hint">{t('del.childrenKept')}</p>}
          </>
        )}
        {plan.absorbed.length > 0 && (
          <label className="pm-row checkbox">
            <input type="checkbox" checked={absorbed} onChange={(e) => setAbsorbed(e.target.checked)} />
            <span>{t('del.absorbed', { names: plan.absorbed.map(name).join(t('cmd.listSeparator')) })}</span>
          </label>
        )}
        <div className="modal-actions">
          <button ref={ok} className="primary" onClick={() => store.deleteFeatures(plan.features)}>
            {t('pm.delete')}
          </button>
          <button onClick={close}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/** 「錯誤為何？」 (D7.1): every feature with an error or a warning, what went wrong, and the nearest candidates. */
export function WhatsWrongDialog() {
  const open = useStore((s) => s.whatsWrong);
  const doc = useStore((s) => s.doc);
  const result = useStore((s) => s.result);
  const asm = useStore((s) => s.asm);
  if (!open) return null;
  if (asm) return <AssemblyWhatsWrong />;
  const items = (result?.features ?? []).filter((r) => r.status === 'error' || (r.warnings?.length ?? 0) > 0);
  const close = () => store.showWhatsWrong(false);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide" role="dialog" aria-label={t('tree.whatsWrong')} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('tree.whatsWrong')}</h3>
        {items.length === 0 && <p className="muted">{t('wrong.none')}</p>}
        <ul className="whats-wrong">
          {items.map((r) => {
            const f = findFeature(doc, r.id);
            if (!f) return null;
            return (
              <li
                key={r.id}
                onClick={() => {
                  store.select(r.id);
                  close();
                }}
                title={t('wrong.clickToSelect')}
              >
                <Icon name={r.status === 'error' ? 'error' : 'warning'} className={r.status === 'error' ? 'status-error' : 'status-warning'} />
                <div>
                  <strong>
                    {featureLabel(f)}: {f.name}
                  </strong>
                  {r.message && <p>{r.message}</p>}
                  {r.unresolved?.map((u) => (
                    <div key={u.ref.name} className="unresolved" onClick={(e) => e.stopPropagation()}>
                      <p className="muted">
                        {u.reason === 'ambiguous' ? t('wrong.ambiguous') : t('wrong.notFound')}{' '}
                        <code>{u.ref.name}</code>
                      </p>
                      {u.candidates.slice(0, 3).map((c, i) => (
                        <button key={c.name} className="use-nearest" title={i === 0 ? t('wrong.closest') : t('wrong.other')} onClick={() => store.replaceRef(r.id, u.ref, c)}>
                          {i === 0 ? t('pm.nearest.use') : t('wrong.useThis')} <code>{c.name}</code>
                        </button>
                      ))}
                    </div>
                  ))}
                  {r.warnings?.map((w) => (
                    <p key={w} className="warning-text">
                      {w}
                    </p>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="modal-actions">
          <button onClick={close}>{t('relations.close')}</button>
        </div>
      </div>
    </div>
  );
}

/** 「要儲存變更嗎？」 before a new or opened part replaces a modified one (SolidWorks asks the same). */
const PENDING_VERB = labelsOf({ open: 'unsaved.open', 'new-assembly': 'unsaved.newAssembly', 'new-part': 'unsaved.newPart', 'new-demo': 'unsaved.newPart', 'open-part': 'unsaved.openPart', 'return-assembly': 'unsaved.returnAssembly', 'import-step-assembly': 'unsaved.importStepAssembly' });

export function UnsavedDialog() {
  const action = useStore((s) => s.unsaved);
  const name = useDocumentName();
  const save = useRef<HTMLButtonElement>(null);
  useEffect(() => save.current?.focus(), [action]);
  if (!action) return null;
  const answer = (a: 'save' | 'discard' | 'cancel') => () => void store.answerUnsaved(a);
  return (
    <div className="modal-backdrop" onPointerDown={answer('cancel')}>
      <div className="modal" role="dialog" aria-label={t('unsaved.title')} onPointerDown={(e) => e.stopPropagation()}>
        <h3>{t('unsaved.title')}</h3>
        <p>{t('unsaved.body', { name, action: PENDING_VERB[action] })}</p>
        {action === 'open-part' && <p className="hint">{t('unsaved.openPartHint')}</p>}
        <div className="modal-actions">
          <button ref={save} className="primary" onClick={answer('save')}>
            {t('note.save')}
          </button>
          <button onClick={answer('discard')}>{t('unsaved.discard')}</button>
          <button onClick={answer('cancel')}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The project folder (B9.4): an assembly and the parts it uses live in one folder the user grants
 * once. The folder picker needs a click of its own, so this dialog asks for it.
 */
export function FolderDialog() {
  const reason = useStore((s) => s.folderRequest);
  const write = useStore((s) => s.folderWrite);
  const remembered = useStore((s) => (s.folderWrite ? null : s.rememberedProject)); // a folder written into is picked afresh, with write access
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), [reason]);
  if (!reason) return null;
  return (
    <div className="modal-backdrop" onPointerDown={() => store.cancelFolder()}>
      <div className="modal" role="dialog" aria-label={t('folder.title')} onPointerDown={(e) => e.stopPropagation()}>
        <h3>{t('folder.title')}</h3>
        <p>{reason}</p>
        {remembered && <p className="hint">{t('folder.remembered', { name: remembered })}</p>}
        <p className="hint">{write ? t('stepasm.folderHint') : t('folder.hint')}</p>
        <div className="modal-actions">
          {remembered && (
            <button ref={first} className="primary" onClick={() => void store.useRememberedFolder()}>
              {t('folder.use', { name: remembered })}
            </button>
          )}
          <button ref={remembered ? undefined : first} className={remembered ? '' : 'primary'} onClick={() => void store.chooseFolder()}>
            {t('folder.choose')}
          </button>
          <button onClick={() => store.cancelFolder()}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/** 「確認刪除」 for components and mates (C15.12): what goes. A component takes its mates along; part files stay. */
export function DeleteComponentsDialog() {
  const asm = useStore((s) => s.asm);
  const ok = useRef<HTMLButtonElement>(null);
  const ids = asm?.confirmDelete ?? null;
  useEffect(() => ok.current?.focus(), [ids]);
  if (!asm || !ids) return null;
  const close = () => store.assembly?.requestDelete(null);
  const components = asm.doc.components.filter((c) => ids.includes(c.id));
  const gone = new Set(components.map((c) => c.id));
  // Mates chosen, and mates on the components being deleted.
  const mates = asm.doc.mates.filter((m) => ids.includes(m.id) || mateEnds(m).some((e) => gone.has(e.component ?? '')));
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal" role="dialog" aria-label={t('del.title')} onPointerDown={(e) => e.stopPropagation()}>
        <h3>{t('del.title')}</h3>
        <p className="muted">{components.length > 0 ? t('delAsm.components') : t('delAsm.mates')}</p>
        <ul className="delete-list">
          {components.map((c) => (
            <li key={c.id}>
              <Icon name="part" /> {componentInfo(asm, c).name}
            </li>
          ))}
          {mates.map((m) => (
            <li key={m.id}>
              <Icon name="mates" /> {m.name}
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button ref={ok} className="primary" onClick={() => store.assembly?.deleteItems(ids)}>
            {t('pm.delete')}
          </button>
          <button onClick={close}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 「找不到參考的檔案」 (B9.4): the part files the assembly uses that are not where its paths say (renamed,
 * moved, deleted), with the components that use them. Files of the project folder with the same name
 * are offered (a file moved elsewhere); 「瀏覽…」 picks any part or STEP file there. Every component of
 * the file follows; mates on it hold if the new file has the same faces (a copy, a renamed file, or the
 * part saved from its STEP file).
 */
export function MissingFilesDialog() {
  const asm = useStore((s) => s.asm);
  const name = useDocumentName();
  const relink = asm?.relink;
  const a = store.assembly;
  if (!asm || !relink || !a) return null;
  const close = () => a.closeRelink();
  const missing = a.missingFiles();
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide" role="dialog" aria-label={t('relink.title')} onPointerDown={(e) => e.stopPropagation()}>
        <h3>{t('relink.title')}</h3>
        <p>{t('relink.body', { name })}</p>
        {missing.length === 0 && <p className="muted">{t('relink.allFound')}</p>}
        <ul className="relink-list">
          {missing.map((f) => {
            const users = asm.doc.components.filter((c) => c.file === f.id).map((c) => componentInfo(asm, c).name);
            const found = relink.candidates?.get(f.id);
            return (
              <li key={f.id} data-file={f.id}>
                <div className="relink-file">
                  <Icon name="error" className="status-error" />
                  <strong>{joinPath(asm.folder, f.path)}</strong>
                  <span className="muted">({users.join(t('cmd.listSeparator'))})</span>
                </div>
                <div className="relink-actions">
                  {relink.candidates === null ? (
                    <span className="muted">{t('relink.searching')}</span>
                  ) : found && found.length > 0 ? (
                    found.map((p) => (
                      <button key={p} className="pm-button" onClick={() => a.relink(f.id, p)}>
                        {t('relink.use', { path: p })}
                      </button>
                    ))
                  ) : (
                    <span className="muted">{t('relink.noSame')}</span>
                  )}
                  <button className="pm-button" onClick={() => void a.browseRelink(f.id)}>
                    {t('relink.browse')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="modal-actions">
          <button onClick={close}>{missing.length === 0 ? t('relations.close') : t('relink.skip')}</button>
        </div>
      </div>
    </div>
  );
}

/** 「錯誤為何？」 of an assembly (D7.1, C15.12): every mate that fails and why; a click selects it. */
function AssemblyWhatsWrong() {
  const asm = useStore((s) => s.asm)!;
  const close = () => store.showWhatsWrong(false);
  const items = asm.doc.mates.flatMap((m) => {
    const problem = mateProblem(asm, m);
    return problem ? [{ m, problem }] : [];
  });
  const over = asm.doc.components.filter((c) => asm.solution?.components.get(c.id)?.status === 'over');
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide" role="dialog" aria-label={t('tree.whatsWrong')} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('tree.whatsWrong')}</h3>
        {items.length === 0 && <p className="muted">{t('wrong.noErrors')}</p>}
        <ul className="whats-wrong">
          {items.map(({ m, problem }) => (
            <li
              key={m.id}
              onClick={() => {
                store.assembly?.select(m.id);
                close();
              }}
              title={t('wrong.clickToSelect')}
            >
              <Icon name="error" className="status-error" />
              <div>
                <strong>{m.name}</strong>
                <p>{problem}</p>
              </div>
            </li>
          ))}
        </ul>
        {over.length > 0 && <p className="muted">{t('wrong.overDefined', { names: over.map((c) => componentInfo(asm, c).name).join(t('cmd.listSeparator')) })}</p>}
        <div className="modal-actions">
          <button onClick={close}>{t('relations.close')}</button>
        </div>
      </div>
    </div>
  );
}

/** The symbol of a unit of $INSUNITS. */
const DXF_UNITS: Record<number, string> = { 1: 'in', 2: 'ft', 3: 'mi', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km', 8: 'µin', 9: 'mil', 10: 'yd', 11: 'Å', 12: 'nm', 13: 'µm', 14: 'dm', 15: 'dam', 16: 'hm' };

/**
 * 「匯入 DXF」 (F2.6, ADR 0219): what the file holds before anything is added — its unit and size (to see that the unit is right), each layer with how many
 * entities it has, ticked to import, and the layers to bring in as construction geometry; what will be left out and how many entities cannot be read.
 */
export function DxfImportDialog() {
  const open = useStore((s) => s.dxfImport);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [construction, setConstruction] = useState<Set<string>>(new Set());
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setChosen(new Set(open?.survey.layers.map((l) => l.name) ?? []));
    setConstruction(new Set());
    ok.current?.focus();
  }, [open]);
  if (!open) return null;
  const { survey } = open;
  const close = () => store.cancelDxfImport();
  const toggle = (set: Set<string>, name: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(name);
    else next.delete(name);
    return next;
  };
  const size = survey.bounds ? `${(survey.bounds.max[0] - survey.bounds.min[0]).toFixed(3)} × ${(survey.bounds.max[1] - survey.bounds.min[1]).toFixed(3)}` : null;
  const left = Object.entries(survey.skipped).map(([type, k]) => `${type} ×${k}`);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal" role="dialog" aria-label={t('dxfImport.title')} data-dialog="dxf-import" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('dxfImport.title')}</h3>
        <p className="muted">{t('dxfImport.file', { name: open.name })}</p>
        <p>{survey.unit === null ? t('dxfImport.unitNone') : t('dxfImport.unit', { unit: DXF_UNITS[survey.unit] ?? String(survey.unit), scale: survey.scale })}</p>
        {size && <p>{t('dxfImport.size', { size })}</p>}
        {survey.layers.length === 0 ? (
          <p className="hint">{t('dxfImport.nothing')}</p>
        ) : (
          <table className="dxf-layers">
            <thead>
              <tr>
                <th>{t('dxfImport.layer')}</th>
                <th>{t('dxfImport.entities')}</th>
                <th>{t('dxfImport.asConstruction')}</th>
              </tr>
            </thead>
            <tbody>
              {survey.layers.map((l) => (
                <tr key={l.name} data-dxf-layer={l.name}>
                  <td>
                    <label className="checkbox">
                      <input type="checkbox" data-field="import" checked={chosen.has(l.name)} onChange={(e) => setChosen(toggle(chosen, l.name, e.target.checked))} /> {l.name}
                    </label>
                  </td>
                  <td>{l.count}</td>
                  <td>
                    <input type="checkbox" data-field="construction" aria-label={t('dxfImport.asConstruction')} disabled={!chosen.has(l.name)} checked={construction.has(l.name)} onChange={(e) => setConstruction(toggle(construction, l.name, e.target.checked))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {left.length > 0 && <p className="hint">{t('dxfImport.leftOut', { list: left.join(t('cmd.listSeparator')) })}</p>}
        {survey.problems.length > 0 && <p className="hint">{t('dxfImport.surveyProblems', { n: survey.problems.length })}</p>}
        <div className="modal-actions">
          <button ref={ok} className="primary" data-action="dxf-import" disabled={chosen.size === 0} onClick={() => store.applyDxfImport([...chosen], [...construction].filter((n) => chosen.has(n)))}>
            {t('dxfImport.import')}
          </button>
          <button onClick={close}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/** 找到沒有儲存的零件 (B9.3): the copy autosave left in the browser when the last session ended with changes that were not saved. */
export function RecoveryDialog() {
  const recovery = useStore((s) => s.recovery);
  const restore = useRef<HTMLButtonElement>(null);
  useEffect(() => restore.current?.focus(), [recovery]);
  if (!recovery) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label={t('recovery.title')}>
        <h3>{t('recovery.title')}</h3>
        <p>{t('recovery.body', { name: recovery.name, time: new Date(recovery.savedAt).toLocaleString() })}</p>
        <p className="hint">{t('recovery.hint')}</p>
        <div className="modal-actions">
          <button ref={restore} className="primary" onClick={() => void store.restoreRecovery()}>
            {t('recovery.restore')}
          </button>
          <button onClick={() => store.discardRecovery()}>{t('recovery.discard')}</button>
        </div>
      </div>
    </div>
  );
}
