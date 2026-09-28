import { useEffect, useRef, useState } from 'react';
import { findFeature, type Id } from '@3db/model';
import { deletion } from '@3db/regen/dag';
import { store, useStore } from '../state/store';
import { featureLabel } from '../strings';
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
  if (!open) return null;
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
  const fileName = useStore((s) => s.fileName);
  const partName = useStore((s) => s.doc.properties['零件名稱'] || '零件1');
  const save = useRef<HTMLButtonElement>(null);
  useEffect(() => save.current?.focus(), [action]);
  if (!action) return null;
  const answer = (a: 'save' | 'discard' | 'cancel') => () => void store.answerUnsaved(a);
  return (
    <div className="modal-backdrop" onPointerDown={answer('cancel')}>
      <div className="modal" role="dialog" aria-label="要儲存變更嗎" onPointerDown={(e) => e.stopPropagation()}>
        <h3>要儲存變更嗎？</h3>
        <p>
          「{fileName ?? partName}」有尚未儲存的變更。{action === 'open' ? '開啟其他檔案' : '建立新零件'}之前要先儲存嗎？
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
