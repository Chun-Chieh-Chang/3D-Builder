import type { Feature, SheetUnfoldFeature } from './schema';
/** The latest unpaired manufacturing state, derived from feature order, never stored twice. */
export function activeSheetUnfold(features: readonly Feature[]): SheetUnfoldFeature | null {
  let active: SheetUnfoldFeature | null = null;
  for (const f of features) {
    if (f.suppressed) continue;
    if (f.type === 'sheetUnfold') active = f;
    if (f.type === 'sheetRefold' && f.unfold === active?.id) active = null;
  }
  return active;
}
