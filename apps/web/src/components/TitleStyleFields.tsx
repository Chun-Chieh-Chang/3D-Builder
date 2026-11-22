import { t } from '@3db/i18n';
import {
  TITLE_CELL_FIELDS,
  TITLE_ROW_HEIGHTS_DEFAULT,
  TITLE_STYLE_LIMITS,
  titleStyleProblem,
  type TitleCellField,
  type TitleFieldScales,
  type TitleRowHeights,
  type TitleStyle,
} from '@3db/model';
import { NumberBox } from './DimensionPanel';

const ROW_KEYS = ['drawingUi.titleRow0', 'drawingUi.titleRow1', 'drawingUi.titleRow2', 'drawingUi.titleRow3'] as const;

function cleanStyle(next: TitleStyle): TitleStyle | null {
  const out: TitleStyle = {};
  if (next.label !== undefined) out.label = next.label;
  if (next.value !== undefined) out.value = next.value;
  if (next.title !== undefined) out.title = next.title;
  if (next.fit !== undefined) out.fit = next.fit;
  if (next.rowHeights && next.rowHeights.some((h, i) => h !== TITLE_ROW_HEIGHTS_DEFAULT[i])) {
    out.rowHeights = [...next.rowHeights] as TitleRowHeights;
  }
  if (next.fieldScales) {
    const scales: TitleFieldScales = {};
    for (const f of TITLE_CELL_FIELDS) {
      const s = next.fieldScales[f];
      if (s !== undefined && s !== 100) scales[f] = s;
    }
    if (Object.keys(scales).length > 0) out.fieldScales = scales;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/**
 * The fields of the title block's text style (ADR 0150): the height of a cell's field name, of the text it holds, of the drawing's own title, whether a text
 * wider than its cell is drawn shrunk to fit, plus optional per-row heights (mm) and per-cell font scale percentages (%).
 * 「恢復預設」 takes the style away (`null`).
 */
export function TitleStyleFields({ value, base, onChange }: { value: TitleStyle; base: Required<TitleStyle>; onChange: (next: TitleStyle | null) => void }) {
  const shown = {
    ...base,
    ...value,
    rowHeights: (value.rowHeights ? [...value.rowHeights] : [...base.rowHeights]) as TitleRowHeights,
    fieldScales: value.fieldScales ? { ...value.fieldScales } : {},
  };
  const set = (patch: TitleStyle) => onChange(cleanStyle({ ...value, ...patch }));
  const check = (k: 'label' | 'value' | 'title') => (v: number) => titleStyleProblem({ ...value, [k]: v });
  const checkRow = (i: number) => (v: number) => {
    const nextRows = [...shown.rowHeights] as TitleRowHeights;
    nextRows[i] = v;
    return titleStyleProblem({ ...value, rowHeights: nextRows });
  };
  const setRow = (i: number, v: number) => {
    const nextRows = [...shown.rowHeights] as TitleRowHeights;
    nextRows[i] = v;
    set({ rowHeights: nextRows });
  };
  const checkScale = (field: TitleCellField) => (v: number) =>
    titleStyleProblem({ ...value, fieldScales: { ...shown.fieldScales, [field]: v } });
  const setScale = (field: TitleCellField, v: number) => {
    const nextScales: TitleFieldScales = { ...shown.fieldScales };
    if (v === 100) delete nextScales[field];
    else nextScales[field] = v;
    set({ fieldScales: nextScales });
  };
  const limits = (k: 'label' | 'value' | 'title') => `${TITLE_STYLE_LIMITS[k][0]}–${TITLE_STYLE_LIMITS[k][1]}`;
  return (
    <div data-group="titleStyle">
      <label className="pm-row">
        <span>{t('drawingUi.titleStyleLabel')}</span>
        <NumberBox field="titleStyleLabel" value={shown.label} onCommit={(v) => set({ label: v })} validate={check('label')} />
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.titleStyleValue')}</span>
        <NumberBox field="titleStyleValue" value={shown.value} onCommit={(v) => set({ value: v })} validate={check('value')} />
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.titleStyleTitle')}</span>
        <NumberBox field="titleStyleTitle" value={shown.title} onCommit={(v) => set({ title: v })} validate={check('title')} />
      </label>
      <label className="pm-row checkbox" title={t('drawingUi.titleStyleFitTip', { limits: `${limits('label')} / ${limits('value')} / ${limits('title')}` })}>
        <input type="checkbox" data-field="titleStyleFit" checked={shown.fit} onChange={(e) => set({ fit: e.target.checked })} />
        <span>{t('drawingUi.titleStyleFit')}</span>
      </label>
      <details data-group="titleRowHeights" style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: '4px 0' }}>{t('drawingUi.titleRowHeights')}</summary>
        {ROW_KEYS.map((rk, i) => (
          <label key={rk} className="pm-row">
            <span>{t(rk)}</span>
            <NumberBox field={`titleRowHeight${i}`} value={shown.rowHeights[i]!} onCommit={(v) => setRow(i, v)} validate={checkRow(i)} />
          </label>
        ))}
      </details>
      <details data-group="titleFieldScales" style={{ marginTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, padding: '4px 0' }}>{t('drawingUi.titleFieldScales')}</summary>
        {TITLE_CELL_FIELDS.map((field) => (
          <label key={field} className="pm-row">
            <span>{t(`drawing.title.${field}`)} (%)</span>
            <NumberBox field={`titleFieldScale_${field}`} value={shown.fieldScales[field] ?? 100} onCommit={(v) => setScale(field, v)} validate={checkScale(field)} />
          </label>
        ))}
      </details>
      <div className="pm-row end" style={{ marginTop: 8 }}>
        <button className="pm-button" data-action="titleStyleReset" disabled={Object.keys(value).length === 0} onClick={() => onChange(null)}>
          {t('drawingUi.titleStyleReset')}
        </button>
      </div>
    </div>
  );
}
