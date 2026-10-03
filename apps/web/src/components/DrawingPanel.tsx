import { t } from '@3db/i18n';
import { SHEET_SIZES, TITLE_FIELDS, VIEW_NAMES, isDerived, type DrawingView, type Scale, type SheetSize, type TitleField, type ViewName, type ViewSide } from '@3db/model';
import { STANDARD_SCALES, scaleText, showsHidden } from '@3db/drawing';
import { useState } from 'react';
import { store, useStore } from '../state/store';

const SIDES: readonly ViewSide[] = ['right', 'left', 'up', 'down'];
const same = (a: Scale, b: Scale) => a[0] === b[0] && a[1] === b[1];
const parseScale = (s: string): Scale => {
  const [n, d] = s.split(':').map(Number);
  return [n!, d!];
};

/** A text box that commits on Enter or when it loses focus. */
function TextBox({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const commit = () => text !== value && onCommit(text);
  return (
    <input
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
 * The left panel of a drawing (B1.1, C16): the sheet, the title block and the views. Everything is a command on the document, so each change is one undo step.
 */
export function DrawingPanel() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const doc = drw.doc;
  const [direction, setDirection] = useState<ViewName>('isometric');
  const [side, setSide] = useState<ViewSide>('right');
  const [vertical, setVertical] = useState(true);
  const [at, setAt] = useState('');
  const [centre, setCentre] = useState<[string, string]>(['', '']);
  const [radius, setRadius] = useState('');
  const scale = scaleText(doc.sheet.scale);
  const standard = STANDARD_SCALES.some((s) => same(s, doc.sheet.scale));
  return (
    <div className="property-manager drawing-panel" data-drawing-panel>
      <div className="pm-group">
        <h4>{t('drawingUi.sheet')}</h4>
        <label className="pm-row">
          <span>{t('drawingUi.size')}</span>
          <select data-field="size" value={doc.sheet.size} onChange={(e) => d.setSheet({ size: e.target.value as SheetSize })}>
            {SHEET_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="pm-row">
          <span>{t('drawingUi.orientation')}</span>
          <select data-field="orientation" value={doc.sheet.orientation} onChange={(e) => d.setSheet({ orientation: e.target.value as 'landscape' | 'portrait' })}>
            <option value="landscape">{t('drawingUi.landscape')}</option>
            <option value="portrait">{t('drawingUi.portrait')}</option>
          </select>
        </label>
        <label className="pm-row">
          <span>{t('drawing.title.projection')}</span>
          <select data-field="projection" value={doc.sheet.projection} onChange={(e) => d.setSheet({ projection: e.target.value as 'first' | 'third' })}>
            <option value="first">{t('drawing.projection.first')}</option>
            <option value="third">{t('drawing.projection.third')}</option>
          </select>
        </label>
        <label className="pm-row">
          <span>{t('drawing.title.scale')}</span>
          <select data-field="scale" value={scale} onChange={(e) => d.setSheet({ scale: parseScale(e.target.value) })}>
            {!standard && <option value={scale}>{scale}</option>}
            {STANDARD_SCALES.map((s) => (
              <option key={scaleText(s)} value={scaleText(s)}>
                {scaleText(s)}
              </option>
            ))}
          </select>
        </label>
        <div className="pm-row">
          <button className="pm-button" data-action="autoScale" onClick={() => d.autoScale()}>
            {t('drawingUi.autoScale')}
          </button>
        </div>
      </div>
      <div className="pm-group">
        <h4>{t('drawingUi.titleBlock')}</h4>
        {TITLE_FIELDS.map((field: TitleField) => (
          <label key={field} className="pm-row">
            <span>{t(`drawing.title.${field}`)}</span>
            <TextBox value={doc.title[field] ?? ''} onCommit={(v) => d.setTitle(field, v)} />
          </label>
        ))}
      </div>
      <div className="pm-group">
        <h4>{t('drawingUi.views')}</h4>
        {doc.views.length === 0 && <p className="muted">{t('drawingUi.noViews')}</p>}
        <ul className="selection-box drawing-views" data-field="views">
          {doc.views.map((v: DrawingView) => (
            <li key={v.id} className={v.id === drw.selected ? 'selected' : ''} onClick={() => d.select(v.id)} data-view={v.id}>
              <span className="name">{v.name}</span>
              {!isDerived(v) && (
                <select
                  value={v.direction}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => d.setView(v.id, { direction: e.target.value as ViewName, name: t(`drawing.view.${e.target.value as ViewName}`) })}
                >
                  {VIEW_NAMES.map((n) => (
                    <option key={n} value={n}>
                      {t(`drawing.view.${n}`)}
                    </option>
                  ))}
                </select>
              )}
              {v.kind === 'projected' && (
                <select value={v.side} onClick={(e) => e.stopPropagation()} onChange={(e) => d.setView(v.id, { side: e.target.value as ViewSide })}>
                  {SIDES.map((s) => (
                    <option key={s} value={s}>
                      {t(`drawing.side.${s}`)}
                    </option>
                  ))}
                </select>
              )}
              {drw.problems.get(v.id) && <span className="error-text" title={drw.problems.get(v.id)}>⚠</span>}
              <button title={t('drawingUi.delete')} onClick={(e) => (e.stopPropagation(), d.deleteViews([v.id]))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        {[...drw.problems.values()].map((p, i) => (
          <p key={i} className="error-text" data-field="problem">
            {p}
          </p>
        ))}
        {(() => {
          const v = doc.views.find((x) => x.id === drw.selected);
          if (!v) return null;
          return (
            <>
              <label className="pm-row checkbox">
                <input type="checkbox" data-field="hidden" checked={showsHidden(v)} onChange={(e) => d.setView(v.id, { hidden: e.target.checked ? true : false })} />
                <span>{t('drawingUi.hiddenLines')}</span>
              </label>
              <label className="pm-row">
                <span>{t('drawingUi.viewScale')}</span>
                <select data-field="viewScale" value={v.scale ? scaleText(v.scale) : ''} onChange={(e) => d.setView(v.id, { scale: e.target.value ? parseScale(e.target.value) : null })}>
                  <option value="">{t('drawingUi.inheritScale')}</option>
                  {STANDARD_SCALES.map((s) => (
                    <option key={scaleText(s)} value={scaleText(s)}>
                      {scaleText(s)}
                    </option>
                  ))}
                </select>
              </label>
              {(v.kind === 'section' || v.kind === 'detail') && (
                <label className="pm-row">
                  <span>{t('drawingUi.label')}</span>
                  <TextBox value={v.label} onCommit={(x) => x.trim() && d.setView(v.id, { label: x.trim() })} />
                </label>
              )}
              {v.kind === 'section' && (
                <label className="pm-row checkbox">
                  <input type="checkbox" data-field="flip" checked={!!v.flip} onChange={(e) => d.setView(v.id, { flip: e.target.checked })} />
                  <span>{t('drawingUi.sectionFlip')}</span>
                </label>
              )}
              <div className="pm-row">
                <button className="pm-button" data-action="resetPosition" disabled={!v.at} onClick={() => d.setView(v.id, { at: null })}>
                  {t('drawingUi.autoLayout')}
                </button>
              </div>
            </>
          );
        })()}
        <div className="pm-row">
          <select data-field="newDirection" value={direction} onChange={(e) => setDirection(e.target.value as ViewName)}>
            {VIEW_NAMES.map((n) => (
              <option key={n} value={n}>
                {t(`drawing.view.${n}`)}
              </option>
            ))}
          </select>
          <button className="pm-button" data-action="addView" onClick={() => d.addViews([direction])}>
            {t('drawingUi.addView')}
          </button>
        </div>
      </div>
      {(() => {
        const parent = doc.views.find((x) => x.id === drw.selected);
        const box: { min: [number, number]; max: [number, number] } | null | undefined = parent ? (parent.kind === 'detail' ? { min: [parent.centre[0] - parent.radius, parent.centre[1] - parent.radius], max: [parent.centre[0] + parent.radius, parent.centre[1] + parent.radius] } : drw.lines.get(parent.id)?.box) : null;
        const num = (s: string, fallback: number) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : fallback);
        const mid: [number, number] = box ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2] : [0, 0];
        const span = box ? Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) : 20;
        return (
          <div className="pm-group" data-group="derived">
            <h4>{t('drawingUi.derived')}</h4>
            {!parent && <p className="muted">{t('drawingUi.selectParent')}</p>}
            <div className="pm-row">
              <select data-field="newSide" value={side} onChange={(e) => setSide(e.target.value as ViewSide)}>
                {SIDES.map((s) => (
                  <option key={s} value={s}>
                    {t(`drawing.side.${s}`)}
                  </option>
                ))}
              </select>
              <button className="pm-button" data-action="addProjected" disabled={!parent} onClick={() => parent && d.addProjected(parent.id, side)}>
                {t('drawingUi.projected')}
              </button>
            </div>
            <div className="pm-row">
              <select data-field="sectionAxis" value={vertical ? 'v' : 'h'} onChange={(e) => setVertical(e.target.value === 'v')}>
                <option value="v">{t('drawingUi.sectionVertical')}</option>
                <option value="h">{t('drawingUi.sectionHorizontal')}</option>
              </select>
              <input data-field="sectionAt" inputMode="decimal" placeholder={String(+mid[vertical ? 0 : 1].toFixed(2))} value={at} onChange={(e) => setAt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button
                className="pm-button"
                data-action="addSection"
                disabled={!parent || !box}
                onClick={() => {
                  if (!box) return;
                  const p = num(at, mid[vertical ? 0 : 1]);
                  const pad = 5;
                  parent && d.addSection(parent.id, vertical ? [[p, box.min[1] - pad], [p, box.max[1] + pad]] : [[box.min[0] - pad, p], [box.max[0] + pad, p]]);
                }}
              >
                {t('drawingUi.section')}
              </button>
            </div>
            <div className="pm-row">
              <span>{t('drawingUi.detailCentre')}</span>
              <input data-field="detailX" inputMode="decimal" placeholder={String(+mid[0].toFixed(2))} value={centre[0]} onChange={(e) => setCentre([e.target.value, centre[1]])} onKeyDown={(e) => e.stopPropagation()} />
              <input data-field="detailY" inputMode="decimal" placeholder={String(+mid[1].toFixed(2))} value={centre[1]} onChange={(e) => setCentre([centre[0], e.target.value])} onKeyDown={(e) => e.stopPropagation()} />
            </div>
            <div className="pm-row">
              <span>{t('drawingUi.detailRadius')}</span>
              <input data-field="detailRadius" inputMode="decimal" placeholder={String(+(span / 5).toFixed(2))} value={radius} onChange={(e) => setRadius(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button
                className="pm-button"
                data-action="addDetail"
                disabled={!parent || !box}
                onClick={() => parent && d.addDetail(parent.id, [num(centre[0], mid[0]), num(centre[1], mid[1])], num(radius, span / 5))}
              >
                {t('drawingUi.detail')}
              </button>
            </div>
          </div>
        );
      })()}
      <div className="pm-group">
        <div className="pm-row">
          <button className="pm-button" data-action="exportSvg" onClick={() => d.exportSvg()}>
            {t('drawingUi.exportSvg')}
          </button>
        </div>
        {drw.computing && <p className="muted">{t('drawingUi.computing')}</p>}
      </div>
    </div>
  );
}
