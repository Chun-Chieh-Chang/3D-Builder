/**
 * Helvetica, the standard PDF font every reader has (F3.2): the widths of the characters the drawings use (the standard AFM, in 1/1000 of the font size), and
 * which Unicode characters it can write in WinAnsiEncoding: ASCII and a few of Latin-1 (Ø × ± ° µ · ² ³), which is all a dimension needs.
 */

const ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0-9 : ; < = > ?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ A-O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P-Z [ \ ] ^ _
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` a-o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // p-z { | } ~
];

/** The Latin-1 characters supported besides ASCII: Unicode → [WinAnsi code, width]. */
const LATIN1: Record<number, [number, number]> = {
  0xb0: [0xb0, 400], // °
  0xb1: [0xb1, 584], // ±
  0xb2: [0xb2, 333], // ²
  0xb3: [0xb3, 333], // ³
  0xb5: [0xb5, 556], // µ
  0xb7: [0xb7, 278], // ·
  0xd7: [0xd7, 584], // ×
  0xd8: [0xd8, 778], // Ø
};

/** The WinAnsi code of a character in Helvetica, or null when the font cannot write it. */
export function helveticaCode(c: number): number | null {
  if (c >= 0x20 && c <= 0x7e) return c;
  return LATIN1[c]?.[0] ?? null;
}

/** The width of a character in Helvetica (1/1000 em); 0 for what it cannot write. */
export function helveticaWidth(c: number): number {
  if (c >= 0x20 && c <= 0x7e) return ASCII[c - 0x20]!;
  return LATIN1[c]?.[1] ?? 0;
}

/** The height of Helvetica's capitals (1/1000 em). */
export const HELVETICA_CAP_HEIGHT = 718;
