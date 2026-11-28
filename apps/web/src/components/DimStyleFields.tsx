import { t } from '@3db/i18n';
import { ARROW_STYLES, type ArrowStyle, type DimStyle } from '@3db/model';
import { NumberBox } from './DimensionPanel';

const COLOR_SWATCHES = ['#000000', '#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED'] as const;

export function ColorRow({ field, value, onChange, onReset, canReset }: { field: string; value: string; onChange: (hex: string) => void; onReset?: () => void; canReset?: boolean }) {
  return (
    <div className="pm-row" style={{ flexWrap: 'wrap', gap: 4 }}>
      <span>{t('drawingUi.color')}</span>
      <input
        type="color"
        className="dim-style-color-input"
        data-field={field}
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
      <div className="dim-style-color-swatches">
        {COLOR_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            className="dim-style-color-swatch"
            title={hex}
            aria-pressed={value.toUpperCase() === hex}
            data-color-swatch={hex}
            onClick={() => onChange(hex)}
            style={{ background: hex }}
          />
        ))}
      </div>
      {onReset && (
        <button type="button" className="pm-button" data-action={`${field}Reset`} disabled={!canReset} onClick={onReset}>
          {t('drawingUi.colorReset')}
        </button>
      )}
    </div>
  );
}

/**
 * The fields of a dimension style (ADR 0146): text height, arrow length and kind, line width, color. `value` is what the style says itself; `base` what is drawn where it
 * says nothing (the drawing's style for a dimension, ISO's for the drawing). A size out of its limits is refused by the command, which says why — nothing here
 * puts it in range. 「恢復預設」 takes the style away (`null`).
 */
export function DimStyleFields({ scope, value, base, onChange }: { scope: 'sheet' | 'dimension'; value: DimStyle; base: Required<DimStyle>; onChange: (next: DimStyle | null) => void }) {
  const shown = { ...base, ...value };
  const set = (patch: DimStyle) => onChange({ ...value, ...patch });
  return (
    <div data-group={`dimStyle-${scope}`}>
      <ColorRow field={`dimStyleColor-${scope}`} value={shown.color} onChange={(color) => set({ color })} />
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
