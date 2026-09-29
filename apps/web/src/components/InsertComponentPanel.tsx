import { dirName } from '@3db/model';
import { partNameOf } from '@3db/io';
import { store, useStore } from '../state/store';
import { Icon } from './Icon';

/**
 * 「插入零組件」 PropertyManager (C15.1): the part files of the project folder, or 「瀏覽」. The chosen
 * part follows the cursor in the graphics area and a click places it; ✓ places it at the origin.
 */
export function InsertComponentPanel() {
  const asm = useStore((s) => s.asm)!;
  const project = useStore((s) => s.projectName);
  const insert = asm.insert!;
  const a = store.assembly;
  const chosen = insert.chosen;
  const status = chosen ? asm.files.get(chosen) : undefined;
  const first = asm.doc.components.length === 0;
  return (
    <div className="property-manager">
      <div className="pm-header">
        <Icon name="assembly" />
        <span className="pm-title">插入零組件</span>
        <button className="pm-ok" title="放在原點（Enter）" disabled={status?.status !== 'ok'} onClick={() => a?.place(null)}>
          <Icon name="ok" />
        </button>
        <button className="pm-cancel" title="取消（Esc）" onClick={() => a?.cancelInsert()}>
          <Icon name="cancel" />
        </button>
      </div>
      <div className="pm-group">
        <h4>要插入的零件</h4>
        <p className="hint">專案資料夾：{project ?? '（未選擇）'}</p>
        {insert.files === null ? (
          <p className="muted">正在讀取資料夾…</p>
        ) : insert.files.length === 0 ? (
          <p className="muted">資料夾中沒有零件檔（.3dbx）。</p>
        ) : (
          <ul className="file-list" role="listbox" aria-label="零件檔">
            {insert.files.map((path) => (
              <li key={path} role="option" aria-selected={path === chosen} className={path === chosen ? 'selected' : ''} title={path} onClick={() => a?.choosePart(path)}>
                <Icon name="part" />
                <span className="name">{partNameOf(path)}</span>
                {dirName(path) && <span className="folder muted">{dirName(path)}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="pm-row">
          <button className="pm-button" onClick={() => void a?.browse()}>
            瀏覽…
          </button>
        </div>
      </div>
      {chosen && (
        <div className="pm-group">
          <h4>放置</h4>
          {status?.status === 'loading' && <p className="muted">正在載入「{partNameOf(chosen)}」…</p>}
          {(status?.status === 'missing' || status?.status === 'error') && <p className="error-text">{status.message}</p>}
          {status?.status === 'ok' && (
            <p className="hint">
              在圖面中按一下以放置「{partNameOf(chosen)}」，或按 ✓ 放在原點。
              {first ? '第一個零組件會固定（f），其餘的可以移動（-）。' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
