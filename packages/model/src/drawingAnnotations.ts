import { t } from '@3db/i18n';
import { CommandError } from './commands';
import type { Id } from './ids';

/**
 * The general annotations of a drawing (D-I3, ADR 0132, C16.5): notes with or without a leader, datum feature symbols (ISO 5459), geometric tolerances in
 * feature control frames (ISO 1101) and the centre lines and centre marks the user puts by hand. Like a surface finish, each is placed in the coordinates of
 * the view it is on (full size), so it moves with the view; its size on the sheet is fixed, as the text of a dimension is.
 */

/** The 14 characteristics of ISO 1101 a feature control frame states. */
export const GEOMETRIC_CHARACTERISTICS = [
  'straightness',
  'flatness',
  'circularity',
  'cylindricity',
  'lineProfile',
  'surfaceProfile',
  'parallelism',
  'perpendicularity',
  'angularity',
  'position',
  'concentricity',
  'symmetry',
  'circularRunout',
  'totalRunout',
] as const;
export type GeometricCharacteristic = (typeof GEOMETRIC_CHARACTERISTICS)[number];

/**
 * What each characteristic allows (ISO 1101, ISO 2692): whether it takes datums (`none`: a form tolerance never does; `required`: an orientation, a runout,
 * coaxiality and symmetry always do; `optional`: a profile and a position may or may not), whether its tolerance zone may be a cylinder (Ø: an axis), and
 * whether the maximum or least material requirement (Ⓜ, Ⓛ) may apply (a feature of size only).
 */
export const CHARACTERISTIC_RULES: Record<GeometricCharacteristic, { datums: 'none' | 'optional' | 'required'; diameter: boolean; material: boolean }> = {
  straightness: { datums: 'none', diameter: true, material: true },
  flatness: { datums: 'none', diameter: false, material: false },
  circularity: { datums: 'none', diameter: false, material: false },
  cylindricity: { datums: 'none', diameter: false, material: false },
  lineProfile: { datums: 'optional', diameter: false, material: false },
  surfaceProfile: { datums: 'optional', diameter: false, material: false },
  parallelism: { datums: 'required', diameter: true, material: true },
  perpendicularity: { datums: 'required', diameter: true, material: true },
  angularity: { datums: 'required', diameter: true, material: true },
  position: { datums: 'optional', diameter: true, material: true },
  concentricity: { datums: 'required', diameter: true, material: true },
  symmetry: { datums: 'required', diameter: false, material: true },
  circularRunout: { datums: 'required', diameter: false, material: false },
  totalRunout: { datums: 'required', diameter: false, material: false },
};

/** Ⓜ (maximum material requirement) or Ⓛ (least material requirement), ISO 2692. */
export type MaterialCondition = 'M' | 'L';

type P = [number, number];

interface AnnotationCommon {
  id: Id;
  /** The view it is drawn on. */
  view: Id;
}

/**
 * A note (C16.5): text, line after line, its first line's baseline starting at `at`. With a leader, a line with an arrow from the text to the point `leader`
 * (the feature the note is about). `$PRP:key` in the text is replaced by the title field or the property of that key.
 */
export interface NoteAnnotation extends AnnotationCommon {
  kind: 'note';
  at: P;
  text: string;
  /** The height of the capitals (mm on the sheet). Absent: 3.5. */
  height?: number;
  leader?: P;
}

/**
 * A datum feature symbol (ISO 5459): a filled triangle on the feature at `at`, a line from it to a square with the datum's letter, `length` mm long on the sheet
 * in the direction `angle` (degrees counter-clockwise from the view's x).
 */
export interface DatumAnnotation extends AnnotationCommon {
  kind: 'datum';
  at: P;
  label: string;
  /** Absent: 90 (the square above the feature). */
  angle?: number;
  /** Absent: 6. */
  length?: number;
}

/** A datum a frame refers to: its letter and, where the characteristic allows it, Ⓜ or Ⓛ. */
export interface DatumReference {
  label: string;
  material?: MaterialCondition;
}

/**
 * A feature control frame (ISO 1101): the characteristic, the tolerance (mm; Ø when the zone is a cylinder; Ⓜ or Ⓛ), and up to three datums in their order of
 * precedence. `at` is the middle of the frame's left side; with a leader, a line with an arrow from there to the point `leader` (the toleranced feature).
 */
export interface ToleranceFrameAnnotation extends AnnotationCommon {
  kind: 'fcf';
  at: P;
  characteristic: GeometricCharacteristic;
  tolerance: number;
  diameter?: boolean;
  material?: MaterialCondition;
  datums: DatumReference[];
  leader?: P;
}

/** A centre line put by hand: a chain line from `from` to `to`, a little past both. */
export interface CentreLineAnnotation extends AnnotationCommon {
  kind: 'centreLine';
  from: P;
  to: P;
}

/** A centre mark put by hand: the cross of chain lines about `at`, reaching a little past `radius` (full size) each way. */
export interface CentreMarkAnnotation extends AnnotationCommon {
  kind: 'centreMark';
  at: P;
  radius: number;
}

export type Annotation = NoteAnnotation | DatumAnnotation | ToleranceFrameAnnotation | CentreLineAnnotation | CentreMarkAnnotation;
export type AnnotationKind = Annotation['kind'];
export const ANNOTATION_KINDS: readonly AnnotationKind[] = ['note', 'datum', 'fcf', 'centreLine', 'centreMark'];

/** A letter of a datum: one or two capitals, not I, O or Q (ISO 5459 leaves them out: they are taken for 1, 0 and each other). */
export const DATUM_LABEL = /^[A-HJ-NPR-Z]{1,2}$/;
export const NOTE_MAX = 500;
export const NOTE_HEIGHT = { min: 1.8, max: 20 };

const finite = (p: unknown): p is P => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

/**
 * Checks an annotation on its own and against the others of the drawing: what its kind needs, what ISO 1101 allows a characteristic, and that every datum a
 * frame refers to is a datum symbol of the drawing. `others` are the annotations it is checked against (the drawing's, without it).
 */
export function checkAnnotation(a: Annotation, viewExists: (id: Id) => boolean, others: readonly Annotation[]): void {
  if (!a.id) throw new CommandError(t('drawing.idMissing'));
  if (!ANNOTATION_KINDS.includes(a.kind)) throw new CommandError(t('drawing.annBadKind', { kind: String((a as { kind?: unknown }).kind) }));
  if (!viewExists(a.view)) throw new CommandError(t('drawing.dimNoView', { id: String(a.view) }));
  switch (a.kind) {
    case 'note': {
      if (!finite(a.at) || (a.leader !== undefined && !finite(a.leader))) throw new CommandError(t('drawing.badPosition'));
      if (typeof a.text !== 'string' || a.text.trim() === '') throw new CommandError(t('drawing.noteEmpty'));
      if (a.text.length > NOTE_MAX) throw new CommandError(t('drawing.noteTooLong', { max: String(NOTE_MAX) }));
      if (a.height !== undefined && !(Number.isFinite(a.height) && a.height >= NOTE_HEIGHT.min && a.height <= NOTE_HEIGHT.max)) throw new CommandError(t('drawing.noteBadHeight', { min: String(NOTE_HEIGHT.min), max: String(NOTE_HEIGHT.max) }));
      return;
    }
    case 'datum': {
      if (!finite(a.at)) throw new CommandError(t('drawing.badPosition'));
      if (typeof a.label !== 'string' || !DATUM_LABEL.test(a.label)) throw new CommandError(t('drawing.datumBadLabel', { label: String(a.label) }));
      if (others.some((o) => o.kind === 'datum' && o.label === a.label)) throw new CommandError(t('drawing.datumTaken', { label: a.label }));
      if (a.angle !== undefined && !Number.isFinite(a.angle)) throw new CommandError(t('drawing.badFinishAngle'));
      if (a.length !== undefined && !(Number.isFinite(a.length) && a.length >= 0)) throw new CommandError(t('drawing.badFinishLeader'));
      return;
    }
    case 'fcf': {
      if (!finite(a.at) || (a.leader !== undefined && !finite(a.leader))) throw new CommandError(t('drawing.badPosition'));
      const rules = CHARACTERISTIC_RULES[a.characteristic];
      if (!rules) throw new CommandError(t('drawing.fcfBadCharacteristic', { name: String(a.characteristic) }));
      const name = t(`drawing.gdt.${a.characteristic}`);
      if (!(Number.isFinite(a.tolerance) && a.tolerance > 0)) throw new CommandError(t('drawing.fcfBadTolerance'));
      if (a.diameter && !rules.diameter) throw new CommandError(t('drawing.fcfNoDiameter', { name }));
      if (a.material !== undefined && a.material !== 'M' && a.material !== 'L') throw new CommandError(t('drawing.fcfBadMaterial'));
      if (a.material && !rules.material) throw new CommandError(t('drawing.fcfNoMaterial', { name }));
      if (!Array.isArray(a.datums) || a.datums.length > 3) throw new CommandError(t('drawing.fcfTooManyDatums'));
      if (rules.datums === 'none' && a.datums.length > 0) throw new CommandError(t('drawing.fcfNoDatums', { name }));
      if (rules.datums === 'required' && a.datums.length === 0) throw new CommandError(t('drawing.fcfNeedsDatum', { name }));
      const seen = new Set<string>();
      for (const d of a.datums) {
        if (typeof d?.label !== 'string' || !DATUM_LABEL.test(d.label)) throw new CommandError(t('drawing.datumBadLabel', { label: String(d?.label) }));
        if (seen.has(d.label)) throw new CommandError(t('drawing.fcfDatumTwice', { label: d.label }));
        seen.add(d.label);
        if (d.material !== undefined && d.material !== 'M' && d.material !== 'L') throw new CommandError(t('drawing.fcfBadMaterial'));
        if (d.material && !rules.material) throw new CommandError(t('drawing.fcfNoMaterial', { name }));
        // a frame that names a datum the drawing does not show cannot be read: the reader has nothing to measure from
        if (!others.some((o) => o.kind === 'datum' && o.label === d.label)) throw new CommandError(t('drawing.fcfNoSuchDatum', { label: d.label }));
      }
      return;
    }
    case 'centreLine': {
      if (!finite(a.from) || !finite(a.to)) throw new CommandError(t('drawing.badPosition'));
      if (Math.hypot(a.to[0] - a.from[0], a.to[1] - a.from[1]) < 1e-6) throw new CommandError(t('drawing.centreLineZero'));
      return;
    }
    case 'centreMark': {
      if (!finite(a.at)) throw new CommandError(t('drawing.badPosition'));
      if (!(Number.isFinite(a.radius) && a.radius > 0)) throw new CommandError(t('drawing.centreMarkBadRadius'));
      return;
    }
  }
}

/** The frames that refer to a datum, by its letter. */
export const framesUsing = (annotations: readonly Annotation[], label: string): ToleranceFrameAnnotation[] =>
  annotations.filter((a): a is ToleranceFrameAnnotation => a.kind === 'fcf' && a.datums.some((d) => d.label === label));

/** What `setAnnotation` may change: a field of the annotation's kind; `null` takes an optional field away. `kind`, `id` and `view` cannot be changed. */
export type AnnotationPatch = { [K in string]?: unknown };

/** The fields each kind may have changed, and which of them may be taken away. */
export const ANNOTATION_FIELDS: Record<AnnotationKind, { set: string[]; optional: string[] }> = {
  note: { set: ['at', 'text', 'height', 'leader'], optional: ['height', 'leader'] },
  datum: { set: ['at', 'label', 'angle', 'length'], optional: ['angle', 'length'] },
  fcf: { set: ['at', 'characteristic', 'tolerance', 'diameter', 'material', 'datums', 'leader'], optional: ['diameter', 'material', 'leader'] },
  centreLine: { set: ['from', 'to'], optional: [] },
  centreMark: { set: ['at', 'radius'], optional: [] },
};

/** The text of a note with `$PRP:key` replaced by what `lookup` says of the key; a key it does not know is left as written, so that it is seen to be wrong. */
export function noteText(text: string, lookup: (key: string) => string | undefined): string {
  return text.replace(/\$PRP:([\p{L}\p{N}_]+)/gu, (whole, key: string) => lookup(key) ?? whole);
}
