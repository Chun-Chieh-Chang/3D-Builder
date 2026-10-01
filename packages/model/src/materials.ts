import type { AppearanceTarget, DocSettings, MaterialRef, PartDoc } from './schema';

/** The materials of the built-in table (C14.1): ids, and the density in g/cm³ (round values for the usual alloys and plastics; a part of another grade types its own). */
export const MATERIALS = [
  { id: 'steel', density: 7.85 },
  { id: 'castIron', density: 7.2 },
  { id: 'stainless304', density: 8.0 },
  { id: 'aluminium6061', density: 2.7 },
  { id: 'aluminium7075', density: 2.81 },
  { id: 'copper', density: 8.96 },
  { id: 'brass', density: 8.5 },
  { id: 'titanium', density: 4.43 },
  { id: 'abs', density: 1.04 },
  { id: 'pc', density: 1.2 },
  { id: 'pa6', density: 1.14 },
  { id: 'pom', density: 1.41 },
  { id: 'pp', density: 0.9 },
  { id: 'pmma', density: 1.18 },
] as const;

export type MaterialId = (typeof MATERIALS)[number]['id'];

export const materialById = (id: string) => MATERIALS.find((m) => m.id === id);

/** Mass in grams of `volume` (mm³) of a material of `density` (g/cm³). */
export const massGrams = (volume: number, density: number): number => (volume * density) / 1000;

/** How a mass is written: grams below a kilogram, kilograms above. */
export const formatMass = (grams: number): string => (grams >= 1000 ? `${(grams / 1000).toFixed(3)} kg` : `${grams.toFixed(2)} g`);

export const DEFAULT_SETTINGS: DocSettings = { draftStandard: 'ISO', dimensionPrecision: 4, meshQuality: 'normal' };

/** The settings of a part with what was not chosen filled in. */
export const settingsOf = (doc: Pick<PartDoc, 'settings'>): DocSettings => ({ ...DEFAULT_SETTINGS, ...doc.settings });

/** How finely the screen, STL and images mesh a shape: `normal` is the kernel's default (a chord error of 5e-4 of the size of the shape, 0.25 rad). */
export const MESH_QUALITY: Record<DocSettings['meshQuality'], { relative?: number; angular?: number }> = {
  coarse: { relative: 2e-3, angular: 0.5 },
  normal: {},
  fine: { relative: 1e-4, angular: 0.1 },
};

export const materialOk = (m: MaterialRef): boolean => m.name.trim() !== '' && Number.isFinite(m.density) && m.density > 0 && m.density < 30;

/** Is this a color the way appearances and STEP files take it, "#rrggbb"? */
export const colorOk = (c: string): boolean => /^#[0-9a-fA-F]{6}$/.test(c);

/** Whether two targets are the same one (a color replaces the color of the same target). */
export function sameTarget(a: AppearanceTarget, b: AppearanceTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'part') return true;
  if (a.kind === 'face') return a.ref.name === (b as typeof a).ref.name;
  return a.id === (b as typeof a).id;
}
