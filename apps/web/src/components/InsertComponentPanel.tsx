import { useState } from 'react';
import { t } from '@3db/i18n';
import { dirName } from '@3db/model';
import { standardLengths, standardSizes, STANDARD_KINDS, STANDARD_NUMBER, type StandardKind } from '@3db/library';
import { partNameOf } from '@3db/io';
import { store, useStore } from '../state/store';
import { Icon } from './Icon';
import { Busy, loadingText, useLoadingParts } from './LoadProgress';

/** The standard parts library (F6.1): a kind, a size and a length make a part file in the project folder and choose it. */
function StandardParts() {
  const [kind, setKind] = useState<StandardKind>('socketScrew');
  const [size, setSize] = useState('M6');
  const [length, setLength] = useState(20);
  const sizes = standardSizes(kind);
  const lengths = standardLengths(kind);
  const pickKind = (k: StandardKind) => {
    setKind(k);
    setSize(standardSizes(k).includes(size) ? size : standardSizes(k)[Math.min(3, standardSizes(k).length - 1)]!);
    if (standardLengths(k).length > 0 && !standardLengths(k).includes(length)) setLength(standardLengths(k)[5]!);
  };
  return (
    <div className="pm-group">
      <h4>{t('library.title')}</h4>
      <label className="pm-row">
        <span>{t('library.kind')}</span>
        <select value={kind} onChange={(e) => pickKind(e.target.value as StandardKind)}>
          {STANDARD_KINDS.map((k) => (
            <option key={k} value={k}>
              {`${STANDARD_NUMBER[k]} ${t(`library.kind.${k}`)}`}
            </option>
          ))}
        </select>
      </label>
      <label className="pm-row">
        <span>{t('library.size')}</span>
        <select value={size} onChange={(e) => setSize(e.target.value)}>
          {sizes.map((s) => (
            <option key={s} value={s}>
              {kind === 'dowelPin' ? `Ø${s}` : s}
            </option>
          ))}
        </select>
      </label>
      {lengths.length > 0 && (
        <label className="pm-row">
          <span>{t('library.length')}</span>
          <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {lengths.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="pm-row">
        <button className="pm-button" onClick={() => void store.assembly?.addStandardPart({ kind, size, ...(lengths.length > 0 ? { length } : {}) })}>
          {t('library.add')}
        </button>
      </div>
      <p className="hint">{t('library.hint')}</p>
    </div>
  );
}

/**
 * 「插入零組件」 PropertyManager (C15.1): the part files of the project folder, or 「瀏覽」. The chosen
 * part follows the cursor in the graphics area and a click places it; ✓ places it at the origin. In an
 * empty assembly it is SolidWorks' 「開始組合件」, which a new assembly opens with.
 */
export function InsertComponentPanel() {
  const asm = useStore((s) => s.asm)!;
  const project = useStore((s) => s.projectName);
  const insert = asm.insert!;
  const a = store.assembly;
  const chosen = insert.chosen;
  const status = chosen ? asm.files.get(chosen) : undefined;
  const first = asm.doc.components.length === 0;
  const loading = useLoadingParts();
  // a sub-assembly can be placed once the files it uses are read too
  const ready = status?.status === 'ok' && !(status.assembly && [...asm.files.values()].some((s) => s.status === 'loading'));
  return (
    <div className="property-manager">
      <div className="pm-header">
        <Icon name="assembly" />
        <span className="pm-title">{first ? '開始組合件' : '插入零組件'}</span>
        <button className="pm-ok" title="放在原點（Enter）" disabled={!ready} onClick={() => a?.place(null)}>
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
          <p className="muted">資料夾中沒有零件檔（.3dbx）或 STEP 檔。</p>
        ) : (
          <ul className="file-list" role="listbox" aria-label="零件檔">
            {insert.files.map((path) => (
              <li key={path} role="option" aria-selected={path === chosen} className={path === chosen ? 'selected' : ''} title={path} onClick={() => a?.choosePart(path)}>
                <Icon name={/\.3dba$/i.test(path) ? 'assembly' : 'part'} />
                <span className="name">{partNameOf(path)}</span>
                {dirName(path) && <span className="folder muted">{dirName(path)}</span>}
                {/\.(step|stp)$/i.test(path) && <span className="file-kind">STEP</span>}
                {/\.3dba$/i.test(path) && <span className="file-kind">3DBA</span>}
              </li>
            ))}
          </ul>
        )}
        {insert.truncated && <p className="hint">資料夾裡的檔案很多，只列出了一部分。建議為這個專案建立一個資料夾，只放它的零件與組合件。</p>}
        <div className="pm-row">
          <button className="pm-button" onClick={() => void a?.browse()}>
            瀏覽…
          </button>
        </div>
      </div>
      <StandardParts />
      {chosen && (
        <div className="pm-group">
          <h4>放置</h4>
          {status?.status === 'loading' && (
            <div role="status">
              <p className="muted">
                正在載入「{partNameOf(chosen)}」：{loadingText(loading.find((p) => p.path === chosen) ?? { path: chosen, name: '', stage: status.stage, seconds: 0 })}
              </p>
              <Busy />
            </div>
          )}
          {(status?.status === 'missing' || status?.status === 'error') && <p className="error-text">{status.message}</p>}
          {status?.status === 'ok' && !ready && (
            <div role="status">
              <Busy />
            </div>
          )}
          {ready && (
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
