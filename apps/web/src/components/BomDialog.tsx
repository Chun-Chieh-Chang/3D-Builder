import { useState } from 'react';
import { t } from '@3db/i18n';
import { bomCsv, bomFileName } from '@3db/io';
import { download } from '../files';
import { store, useDocumentName, useStore } from '../state/store';

/**
 * 「零件表」 (C15.16): the parts of the open assembly counted, flat or indented, with the vendor and part number of each part's file; saved as CSV.
 * What it shows is derived from the document and the files read each time it is drawn, so it is never out of date.
 */
export function BomDialog() {
  const open = useStore((s) => s.dialog === 'bom');
  const asm = useStore((s) => s.asm);
  const name = useDocumentName();
  const [indented, setIndented] = useState(false);
  if (!open || !asm || !store.assembly) return null;
  const close = () => store.openDialog(null);
  const bom = store.assembly.bom();
  const rows = indented ? bom.indented : bom.flat;
  const total = bom.flat.reduce((n, r) => n + r.qty, 0);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide parameters" role="dialog" aria-label={t('bom.title')} onPointerDown={(e) => e.stopPropagation()}>
        <h3>{t('bom.title')}</h3>
        <div className="pm-row">
          <span className="mate-align">
            <button className={indented ? '' : 'active'} onClick={() => setIndented(false)}>
              {t('bom.flat')}
            </button>
            <button className={indented ? 'active' : ''} onClick={() => setIndented(true)}>
              {t('bom.indented')}
            </button>
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="muted">{t('bom.empty')}</p>
        ) : (
          <div className="shortcut-list">
            <table className="eq-table" data-bom>
              <thead>
                <tr>
                  <th>{t('bom.item')}</th>
                  <th>{t('bom.name')}</th>
                  <th>{t('bom.qty')}</th>
                  <th>{t('bom.vendor')}</th>
                  <th>{t('bom.partNo')}</th>
                  <th>{t('bom.file')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.item}|${r.path}|${r.mirrored}`}>
                    <td>{r.item}</td>
                    <td style={{ paddingLeft: 8 + 16 * r.level }}>{r.name}</td>
                    <td>{r.qty}</td>
                    <td>{r.vendor}</td>
                    <td>{r.partNo}</td>
                    <td className="muted">{r.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">{t('bom.total', { rows: rows.length, qty: total })}</p>
        <p className="hint">{t('bom.hint')}</p>
        <div className="modal-actions">
          <button className="primary" disabled={rows.length === 0} onClick={() => download(bomFileName(name), bomCsv(rows) as Uint8Array<ArrayBuffer>, 'text/csv;charset=utf-8')}>
            {t('bom.exportCsv')}
          </button>
          <button onClick={close}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
