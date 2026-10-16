import { t } from '@3db/i18n';
import { TITLE_STYLE_LIMITS, type TitleStyle } from '@3db/model';
import { NumberBox } from './DimensionPanel';

/**
 * The fields of the title block's text style (ADR 0150): the height of a cell's field name, of the text it holds, of the drawing's own title, and whether a text
 * wider than its cell is drawn shrunk to fit. `value` is what the drawing says itself; `base` what is drawn where it says nothing (ISO 7200's). A height out of
 * its limits, or a name and the text under it too tall for the same cell, is refused by the command, which says why — nothing here puts it in range.
 * 「恢復預設」 takes the style away (`null`).
 */
export function TitleStyleFields({ value, base, onChange }: { value: TitleStyle; base: Required<TitleStyle>; onChange: (next: TitleStyle | null) => void }) {
  const shown = { ...base, ...value };
  const set = (patch: TitleStyle) => onChange({ ...value, ...patch });
  const limits = (k: 'label' | 'value' | 'title') => `${TITLE_STYLE_LIMITS[k][0]}–${TITLE_STYLE_LIMITS[k][1]}`;
  return (
    <div data-group="titleStyle">
      <label className="pm-row">
        <span>{t('drawingUi.titleStyleLabel')}</span>
        <NumberBox field="titleStyleLabel" value={shown.label} onCommit={(v) => set({ label: v })} />
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.titleStyleValue')}</span>
        <NumberBox field="titleStyleValue" value={shown.value} onCommit={(v) => set({ value: v })} />
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.titleStyleTitle')}</span>
        <NumberBox field="titleStyleTitle" value={shown.title} onCommit={(v) => set({ title: v })} />
      </label>
      <label className="pm-row checkbox" title={t('drawingUi.titleStyleFitTip', { limits: `${limits('label')} / ${limits('value')} / ${limits('title')}` })}>
        <input type="checkbox" data-field="titleStyleFit" checked={shown.fit} onChange={(e) => set({ fit: e.target.checked })} />
        <span>{t('drawingUi.titleStyleFit')}</span>
      </label>
      <div className="pm-row end">
        <button className="pm-button" data-action="titleStyleReset" disabled={Object.keys(value).length === 0} onClick={() => onChange(null)}>
          {t('drawingUi.titleStyleReset')}
        </button>
      </div>
    </div>
  );
}
