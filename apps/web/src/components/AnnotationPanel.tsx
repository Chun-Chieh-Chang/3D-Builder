import { t } from '@3db/i18n';
import { formatNumber, holeRows, raText } from '@3db/drawing';
import { SURFACE_FINISH_KINDS, type SurfaceFinish, type SurfaceFinishKind } from '@3db/model';
import { useState } from 'react';
import { store, useStore } from '../state/store';

/** A number box committed on Enter or on leaving (an empty text takes the value back). */
function NumberBox({ value, onCommit, field }: { value: number; onCommit: (v: number) => void; field: string }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <input
      data-field={field}
      inputMode="decimal"
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

/** A text box committed on Enter or on leaving (an empty text takes what was written away). */
function TextBox({ value, onCommit, field }: { value: string; onCommit: (v: string) => void; field: string }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const commit = () => (text !== value ? onCommit(text) : undefined);
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
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

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
  const tables = drw.doc.tables.flatMap((x) => (x.view === view.id && x.kind === 'holes' ? [x] : []));
  const centre = view.centreMarks ?? view.kind !== 'section';
  const assembly = drw.boms.has(view.id);
  const boms = drw.doc.tables.flatMap((x) => (x.view === view.id && x.kind === 'bom' ? [x] : []));
  const sizes = [...new Set(holeRows(features).map((r) => formatNumber(2 * r.radius)))];
  const finishes = d.surfaceFinishesOf(view.id);
  const currentFinish = drw.finish ? finishes.find((f) => f.id === drw.finish) : undefined;
  /** What a symbol is called in the list: its roughness, or how it is made when it has no value. */
  const finishLabel = (f: SurfaceFinish) => (f.ra !== undefined ? raText(f.ra) : t(`drawingUi.finishKind.${f.kind ?? 'machined'}`));
  return (
    <div className="pm-group" data-group="annotations">
      <h4>{t('drawingUi.annotations')}</h4>
      {assembly && (
        <>
          <div className="pm-row">
            <button className="pm-button" data-action="addBomTable" disabled={boms.length > 0} onClick={() => d.addBomTable(view.id)}>
              {t('drawingUi.addBomTable')}
            </button>
          </div>
          {boms.map((table) => (
            <div key={table.id} data-table={table.id}>
              <div className="pm-row">
                <span className="name">{t('bom.title')}</span>
                <button className="pm-button" data-action="tableHome" disabled={!table.at} onClick={() => d.setTable(table.id, { at: null })}>
                  {t('drawingUi.bomAutoPosition')}
                </button>
                <button title={t('drawingUi.deleteTable')} data-action="deleteTable" onClick={() => d.deleteTables([table.id])}>
                  ✕
                </button>
              </div>
              <label className="pm-row checkbox">
                <input type="checkbox" data-field="balloons" checked={!!table.balloons} onChange={(e) => d.setTable(table.id, { balloons: e.target.checked })} />
                <span>{t('drawingUi.balloons')}</span>
                <button className="pm-button" data-action="balloonsAuto" disabled={!table.balloonAt} onClick={(e) => { e.preventDefault(); d.setTable(table.id, { balloonAt: null }); }}>
                  {t('drawingUi.balloonsAuto')}
                </button>
              </label>
            </div>
          ))}
        </>
      )}
      {!assembly && (
      <>
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
      <h4>{t('drawingUi.surfaceFinishes')}</h4>
      <div className="pm-row">
        <button
          className={`pm-button${drw.tool?.kind === 'surface' ? ' active' : ''}`}
          data-action="toolSurfaceFinish"
          title={t('drawingUi.toolSurfaceFinish')}
          onClick={() => d.setTool(drw.tool?.kind === 'surface' ? null : { kind: 'surface' })}
        >
          {t('drawingUi.addSurfaceFinish')}
        </button>
      </div>
      {finishes.length === 0 && <p className="muted">{t('drawingUi.finishNone')}</p>}
      <ul className="selection-box" data-field="surfaceFinishes">
        {finishes.map((f) => (
          <li key={f.id} className={f.id === drw.finish ? 'selected' : ''} onClick={() => d.selectSurfaceFinish(f.id)} data-finish={f.id}>
            <span className="name">{finishLabel(f)}</span>
            <button title={t('drawingUi.finishDelete')} onClick={(e) => (e.stopPropagation(), d.deleteSurfaceFinishes([f.id]))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {currentFinish && (
        <>
          <label className="pm-row">
            <span>{t('drawingUi.finishKind')}</span>
            <select data-field="finishKind" value={currentFinish.kind ?? 'machined'} onChange={(e) => d.setSurfaceFinish(currentFinish.id, { kind: e.target.value as SurfaceFinishKind })}>
              {SURFACE_FINISH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`drawingUi.finishKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishRa')}</span>
            <NumberBox field="finishRa" value={currentFinish.ra ?? 0} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { ra: v > 0 ? v : null })} />
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishMethod')}</span>
            <TextBox field="finishMethod" value={currentFinish.method ?? ''} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { method: v })} />
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishNote')}</span>
            <TextBox field="finishNote" value={currentFinish.note ?? ''} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { note: v })} />
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishAngle')}</span>
            <NumberBox field="finishAngle" value={currentFinish.angle ?? 90} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { angle: v })} />
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishLeader')}</span>
            <NumberBox field="finishLeader" value={currentFinish.leader ?? 0} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { leader: v > 0 ? v : null })} />
          </label>
        </>
      )}
      </>
      )}
    </div>
  );
}
