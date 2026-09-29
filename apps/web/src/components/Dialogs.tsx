import { useEffect, useRef, useState } from 'react';
import { findFeature, type Id } from '@3db/model';
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
      <div className="modal" role="dialog" aria-label="確認刪除" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>確認刪除</h3>
        <p className="muted">將刪除以下特徵：</p>
        <ul className="delete-list">
          {plan.features.map((x) => {
            const f = findFeature(doc, x)!;
            return (
              <li key={x}>
                <Icon name={f.type} /> {featureLabel(f)}：{f.name}
              </li>
            );
          })}
        </ul>
        {plan.children.length > 0 && (
          <>
            <label className="pm-row checkbox">
              <input type="checkbox" checked={children} onChange={(e) => setChildren(e.target.checked)} />
              <span>同時刪除子特徵（{plan.children.map(name).join('、')}）</span>
            </label>
            {!children && <p className="hint">子特徵會保留，但會因為遺失參考而顯示錯誤，之後可以重新選擇參考或刪除它們。</p>}
          </>
        )}
        {plan.absorbed.length > 0 && (
          <label className="pm-row checkbox">
            <input type="checkbox" checked={absorbed} onChange={(e) => setAbsorbed(e.target.checked)} />
            <span>同時刪除被吸收的特徵（{plan.absorbed.map(name).join('、')}）</span>
          </label>
        )}
        <div className="modal-actions">
          <button ref={ok} className="primary" onClick={() => store.deleteFeatures(plan.features)}>
            刪除
          </button>
          <button onClick={close}>取消</button>
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
      <div className="modal wide" role="dialog" aria-label="錯誤為何" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>錯誤為何？</h3>
        {items.length === 0 && <p className="muted">沒有錯誤或警告。</p>}
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
                title="按一下在設計樹中選取"
              >
                <Icon name={r.status === 'error' ? 'error' : 'warning'} className={r.status === 'error' ? 'status-error' : 'status-warning'} />
                <div>
                  <strong>
                    {featureLabel(f)}：{f.name}
                  </strong>
                  {r.message && <p>{r.message}</p>}
                  {r.unresolved?.map((u) => (
                    <p key={u.ref.name} className="muted">
                      找不到 <code>{u.ref.name}</code>
                      {u.candidates.length > 0 && (
                        <>
                          ；最接近的是 <code>{u.candidates[0]!.name}</code>
                        </>
                      )}
                    </p>
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
          <button onClick={close}>關閉</button>
        </div>
      </div>
    </div>
  );
}

/** 「要儲存變更嗎？」 before a new or opened part replaces a modified one (SolidWorks asks the same). */
export function UnsavedDialog() {
  const action = useStore((s) => s.unsaved);
  const name = useDocumentName();
  const save = useRef<HTMLButtonElement>(null);
  useEffect(() => save.current?.focus(), [action]);
  if (!action) return null;
  const answer = (a: 'save' | 'discard' | 'cancel') => () => void store.answerUnsaved(a);
  return (
    <div className="modal-backdrop" onPointerDown={answer('cancel')}>
      <div className="modal" role="dialog" aria-label="要儲存變更嗎" onPointerDown={(e) => e.stopPropagation()}>
        <h3>要儲存變更嗎？</h3>
        <p>
          「{name}」有尚未儲存的變更。{action === 'open' ? '開啟其他檔案' : action === 'new-assembly' ? '建立新組合件' : '建立新零件'}之前要先儲存嗎？
        </p>
        <div className="modal-actions">
          <button ref={save} className="primary" onClick={answer('save')}>
            儲存
          </button>
          <button onClick={answer('discard')}>不儲存</button>
          <button onClick={answer('cancel')}>取消</button>
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
  const choose = useRef<HTMLButtonElement>(null);
  useEffect(() => choose.current?.focus(), [reason]);
  if (!reason) return null;
  return (
    <div className="modal-backdrop" onPointerDown={() => store.cancelFolder()}>
      <div className="modal" role="dialog" aria-label="選擇專案資料夾" onPointerDown={(e) => e.stopPropagation()}>
        <h3>選擇專案資料夾</h3>
        <p>{reason}</p>
        <p className="hint">
          下一個視窗只會顯示資料夾，看不到檔案是正常的：選放零件（.3dbx 或 STEP）的資料夾，再按「選擇資料夾」。建議為每個專案建立一個資料夾，只放它的零件與組合件。瀏覽器會詢問是否允許讀取這個資料夾；本工作階段內只問一次。
        </p>
        <div className="modal-actions">
          <button ref={choose} className="primary" onClick={() => void store.chooseFolder()}>
            選擇資料夾…
          </button>
          <button onClick={() => store.cancelFolder()}>取消</button>
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
  const mates = asm.doc.mates.filter((m) => ids.includes(m.id) || gone.has(m.a.component ?? '') || gone.has(m.b.component ?? ''));
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal" role="dialog" aria-label="確認刪除" onPointerDown={(e) => e.stopPropagation()}>
        <h3>確認刪除</h3>
        <p className="muted">{components.length > 0 ? '將從組合件刪除以下項目（零件檔本身不會刪除）：' : '將刪除以下結合：'}</p>
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
            刪除
          </button>
          <button onClick={close}>取消</button>
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
      <div className="modal wide" role="dialog" aria-label="錯誤為何" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>錯誤為何？</h3>
        {items.length === 0 && <p className="muted">沒有錯誤。</p>}
        <ul className="whats-wrong">
          {items.map(({ m, problem }) => (
            <li
              key={m.id}
              onClick={() => {
                store.assembly?.select(m.id);
                close();
              }}
              title="按一下在設計樹中選取"
            >
              <Icon name="error" className="status-error" />
              <div>
                <strong>{m.name}</strong>
                <p>{problem}</p>
              </div>
            </li>
          ))}
        </ul>
        {over.length > 0 && <p className="muted">過多定義的零組件：{over.map((c) => componentInfo(asm, c).name).join('、')}。刪除或抑制矛盾的結合即可恢復。</p>}
        <div className="modal-actions">
          <button onClick={close}>關閉</button>
        </div>
      </div>
    </div>
  );
}
