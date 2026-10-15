import { t } from '@3db/i18n';
import { ARROW_STYLES, type ArrowStyle, type DimStyle } from '@3db/model';
import { NumberBox } from './DimensionPanel';

/**
 * The fields of a dimension style (ADR 0146): text height, arrow length and kind, line width. `value` is what the style says itself; `base` what is drawn where it
 * says nothing (the drawing's style for a dimension, ISO's for the drawing). A size out of its limits is refused by the command, which says why — nothing here
 * puts it in range. 「恢復預設」 takes the style away (`null`).
 */
export function DimStyleFields({ scope, value, base, onChange }: { scope: 'sheet' | 'dimension'; value: DimStyle; base: Required<DimStyle>; onChange: (next: DimStyle | null) => void }) {
  const shown = { ...base, ...value };
  const set = (patch: DimStyle) => onChange({ ...value, ...patch });
  return (
    <div data-group={`dimStyle-${scope}`}>
      <label className="pm-row">
        <span>{t('drawingUi.dimStyleText')}</span>
        <NumberBox field="dimStyleText" value={shown.text} onCommit={(v) => set({ text: v })} />
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.dimStyleArrowStyle')}</span>
        <select data-field="dimStyleArrowStyle" value={shown.arrowStyle} onChange={(e) => set({ arrowStyle: e.target.value as ArrowStyle })}>
          {ARROW_STYLES.map((s) => (
            <option key={s} value={s}>
              {t(`drawingUi.arrowStyle.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.dimStyleArrow')}</span>
        <NumberBox field="dimStyleArrow" value={shown.arrow} onCommit={(v) => set({ arrow: v })} />
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.dimStyleLine')}</span>
        <NumberBox field="dimStyleLine" value={shown.line} onCommit={(v) => set({ line: v })} />
      </label>
      <div className="pm-row end">
        <button className="pm-button" data-action={`dimStyleReset-${scope}`} disabled={Object.keys(value).length === 0} onClick={() => onChange(null)}>
          {t('drawingUi.dimStyleReset')}
        </button>
      </div>
    </div>
  );
}
