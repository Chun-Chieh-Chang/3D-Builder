import { t } from '@3db/i18n';
import { formatNumber, holeRows } from '@3db/drawing';
import { useState } from 'react';
import { store, useStore } from '../state/store';

/** A text box for a tolerance class, committed on Enter or on leaving; empty takes the class away. */
function ClassBox({ value, onCommit, field }: { value: string; onCommit: (v: string) => void; field: string }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const commit = () => (text.trim() !== value ? onCommit(text.trim()) : undefined);
  return (
    <input
      data-field={field}
      value={text}
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

/**
 * The annotations of the selected view (C16.5, C16.6): its centre marks and centre lines, and its hole table with the tolerance class of each size of hole. Every
 * change is a command on the document.
 */
export function AnnotationPanel() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const view = drw.doc.views.find((v) => v.id === drw.selected);
  if (!view) return null;
  const features = drw.features.get(view.id) ?? [];
  const tables = drw.doc.tables.filter((x) => x.view === view.id);
  const centre = view.centreMarks ?? view.kind !== 'section';
  const sizes = [...new Set(holeRows(features).map((r) => formatNumber(2 * r.radius)))];
  return (
    <div className="pm-group" data-group="annotations">
      <h4>{t('drawingUi.annotations')}</h4>
      <label className="pm-row checkbox">
        <input type="checkbox" data-field="centreMarks" checked={centre} onChange={(e) => d.setView(view.id, { centreMarks: e.target.checked })} />
        <span>{t('drawingUi.centreMarks')}</span>
      </label>
      <div className="pm-row">
        <button className="pm-button" data-action="addHoleTable" disabled={sizes.length === 0} onClick={() => d.addHoleTable(view.id)}>
          {t('drawingUi.addHoleTable')}
        </button>
      </div>
      {sizes.length === 0 && <p className="muted">{t('drawingUi.tableEmpty')}</p>}
      {tables.map((table) => (
        <div key={table.id} data-table={table.id}>
          <div className="pm-row">
            <span className="name">{t('drawingUi.holeTable')}</span>
            <button className="pm-button" data-action="tableHome" disabled={!table.at} onClick={() => d.setTable(table.id, { at: null })}>
              {t('drawingUi.tableAutoPosition')}
            </button>
            <button title={t('drawingUi.deleteTable')} data-action="deleteTable" onClick={() => d.deleteTables([table.id])}>
              ✕
            </button>
          </div>
          {sizes.map((size) => (
            <label key={size} className="pm-row">
              <span>{t('drawingUi.tableFit', { d: size })}</span>
              <ClassBox
                field={`tableFit-${size}`}
                value={table.fits?.[size] ?? ''}
                onCommit={(fit) => {
                  const fits = { ...(table.fits ?? {}) };
                  if (fit) fits[size] = fit;
                  else delete fits[size];
                  d.setTable(table.id, { fits });
                }}
              />
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
