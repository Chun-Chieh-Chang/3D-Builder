import type { Id } from '@3db/model';
import type { Loop2, P2} from './types';

/**
 * Industrial CAD Sans-Serif Vector Font (ADR 0163).
 * Provides clean, watertight 2D closed polygon contours for standard ASCII characters.
 * All glyph coordinates are defined in normalized font space: height = 1000 units.
 */

export interface GlyphContour {
  isHole?: boolean;
  points: P2[];
}

export interface GlyphDefinition {
  width: number;
  contours: GlyphContour[];
}

/** Calculate signed polygon area; positive for CCW, negative for CW. */
export function signedArea(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Calculate signed area of a Loop2; positive for CCW, negative for CW. */
export function contourArea(loop: Loop2): number {
  const pts: P2[] = loop.map((s) => (s.kind === 'line' ? s.a : s.kind === 'arc' ? s.from : s.kind === 'spline' ? s.points[0]! : s.c));
  return signedArea(pts);
}

/** Ensure polygon winding: CCW for outer boundaries, CW for inner holes. */
export function orientContour(pts: P2[], ccw: boolean): P2[] {
  const a = signedArea(pts);
  if ((ccw && a < 0) || (!ccw && a > 0)) {
    return [...pts].reverse();
  }
  return pts;
}

// ---------------------------------------------------------------- Glyph Geometry Definitions
// Standard dimensions: Height = 1000, Stroke ≈ 160-200.

const GLYPHS: Record<string, GlyphDefinition> = {
  ' ': {
    width: 350,
    contours: [],
  },
  '-': {
    width: 500,
    contours: [
      { points: [[50, 420], [450, 420], [450, 580], [50, 580]] },
    ],
  },
  '_': {
    width: 550,
    contours: [
      { points: [[30, 0], [520, 0], [520, 160], [30, 160]] },
    ],
  },
  '.': {
    width: 320,
    contours: [
      { points: [[80, 0], [240, 0], [240, 160], [80, 160]] },
    ],
  },
  ':': {
    width: 320,
    contours: [
      { points: [[80, 100], [240, 100], [240, 260], [80, 260]] },
      { points: [[80, 600], [240, 600], [240, 760], [80, 760]] },
    ],
  },
  '+': {
    width: 600,
    contours: [
      {
        points: [
          [220, 150], [380, 150], [380, 420], [550, 420],
          [550, 580], [380, 580], [380, 850], [220, 850],
          [220, 580], [50, 580], [50, 420], [220, 420],
        ],
      },
    ],
  },
  '=': {
    width: 550,
    contours: [
      { points: [[50, 320], [500, 320], [500, 440], [50, 440]] },
      { points: [[50, 560], [500, 560], [500, 680], [50, 680]] },
    ],
  },
  '/': {
    width: 500,
    contours: [
      { points: [[50, 0], [210, 0], [450, 1000], [290, 1000]] },
    ],
  },
  '0': {
    width: 650,
    contours: [
      {
        points: [
          [160, 0], [490, 0], [600, 160], [600, 840],
          [490, 1000], [160, 1000], [50, 840], [50, 160],
        ],
      },
      {
        isHole: true,
        points: [
          [210, 180], [210, 820], [440, 820], [440, 180],
        ],
      },
    ],
  },
  '1': {
    width: 480,
    contours: [
      {
        points: [
          [80, 0], [400, 0], [400, 160], [320, 160],
          [320, 1000], [160, 1000], [60, 840], [120, 740],
          [160, 800], [160, 160], [80, 160],
        ],
      },
    ],
  },
  '2': {
    width: 620,
    contours: [
      {
        points: [
          [60, 0], [560, 0], [560, 160], [260, 160],
          [550, 580], [550, 840], [440, 1000], [160, 1000],
          [60, 840], [180, 760], [220, 840], [380, 840],
          [410, 760], [410, 640], [140, 260], [60, 140],
        ],
      },
    ],
  },
  '3': {
    width: 620,
    contours: [
      {
        points: [
          [150, 0], [480, 0], [580, 140], [580, 380],
          [470, 500], [560, 600], [560, 840], [440, 1000],
          [100, 1000], [100, 840], [420, 840], [420, 660],
          [240, 660], [240, 500], [430, 500], [430, 160],
          [150, 160],
        ],
      },
    ],
  },
  '4': {
    width: 640,
    contours: [
      {
        points: [
          [420, 0], [580, 0], [580, 260], [620, 260],
          [620, 420], [580, 420], [580, 1000], [420, 1000],
          [50, 420], [50, 260], [420, 260],
        ],
      },
      {
        isHole: true,
        points: [
          [240, 420], [420, 720], [420, 420],
        ],
      },
    ],
  },
  '5': {
    width: 620,
    contours: [
      {
        points: [
          [140, 0], [480, 0], [580, 140], [580, 440],
          [480, 560], [230, 560], [230, 840], [560, 840],
          [560, 1000], [70, 1000], [70, 420], [420, 420],
          [420, 160], [140, 160],
        ],
      },
    ],
  },
  '6': {
    width: 640,
    contours: [
      {
        points: [
          [160, 0], [480, 0], [590, 150], [590, 450],
          [480, 580], [220, 580], [220, 840], [530, 840],
          [530, 1000], [150, 1000], [50, 840], [50, 150],
        ],
      },
      {
        isHole: true,
        points: [
          [210, 160], [210, 440], [430, 440], [430, 160],
        ],
      },
    ],
  },
  '7': {
    width: 580,
    contours: [
      {
        points: [
          [180, 0], [350, 0], [540, 840], [540, 840],
          [60, 840], [60, 1000], [560, 1000], [560, 850],
        ],
      },
    ],
  },
  '8': {
    width: 640,
    contours: [
      {
        points: [
          [160, 0], [480, 0], [590, 140], [590, 400],
          [500, 490], [580, 580], [580, 860], [470, 1000],
          [170, 1000], [60, 860], [60, 580], [140, 490],
          [50, 400], [50, 140],
        ],
      },
      {
        isHole: true,
        points: [
          [210, 150], [210, 410], [430, 410], [430, 150],
        ],
      },
      {
        isHole: true,
        points: [
          [210, 570], [210, 850], [430, 850], [430, 570],
        ],
      },
    ],
  },
  '9': {
    width: 640,
    contours: [
      {
        points: [
          [480, 1000], [160, 1000], [50, 850], [50, 550],
          [160, 420], [420, 420], [420, 160], [110, 160],
          [110, 0], [490, 0], [590, 160], [590, 850],
        ],
      },
      {
        isHole: true,
        points: [
          [210, 560], [210, 840], [430, 840], [430, 560],
        ],
      },
    ],
  },
  'A': {
    width: 680,
    contours: [
      {
        points: [
          [40, 0], [210, 0], [260, 220], [420, 220],
          [470, 0], [640, 0], [440, 1000], [240, 1000],
        ],
      },
      {
        isHole: true,
        points: [
          [290, 360], [390, 360], [340, 750],
        ],
      },
    ],
  },
  'B': {
    width: 660,
    contours: [
      {
        points: [
          [80, 0], [470, 0], [600, 130], [600, 390],
          [510, 480], [580, 560], [580, 860], [470, 1000],
          [80, 1000],
        ],
      },
      {
        isHole: true,
        points: [
          [240, 160], [240, 420], [440, 420], [440, 160],
        ],
      },
      {
        isHole: true,
        points: [
          [240, 560], [240, 840], [420, 840], [420, 560],
        ],
      },
    ],
  },
  'C': {
    width: 640,
    contours: [
      {
        points: [
          [160, 0], [500, 0], [600, 150], [480, 260],
          [430, 160], [210, 160], [210, 840], [430, 840],
          [480, 740], [600, 850], [500, 1000], [160, 1000],
          [50, 840], [50, 160],
        ],
      },
    ],
  },
  'D': {
    width: 680,
    contours: [
      {
        points: [
          [80, 0], [450, 0], [620, 180], [620, 820],
          [450, 1000], [80, 1000],
        ],
      },
      {
        isHole: true,
        points: [
          [240, 180], [240, 820], [420, 820], [460, 740],
          [460, 260], [420, 180],
        ],
      },
    ],
  },
  'E': {
    width: 600,
    contours: [
      {
        points: [
          [80, 0], [540, 0], [540, 160], [240, 160],
          [240, 420], [480, 420], [480, 580], [240, 580],
          [240, 840], [540, 840], [540, 1000], [80, 1000],
        ],
      },
    ],
  },
  'F': {
    width: 580,
    contours: [
      {
        points: [
          [80, 0], [240, 0], [240, 440], [480, 440],
          [480, 600], [240, 600], [240, 840], [540, 840],
          [540, 1000], [80, 1000],
        ],
      },
    ],
  },
  'G': {
    width: 660,
    contours: [
      {
        points: [
          [160, 0], [520, 0], [620, 160], [620, 520],
          [380, 520], [380, 360], [460, 360], [460, 180],
          [220, 180], [220, 820], [440, 820], [480, 720],
          [600, 820], [500, 1000], [160, 1000], [50, 840],
          [50, 160],
        ],
      },
    ],
  },
  'H': {
    width: 660,
    contours: [
      {
        points: [
          [80, 0], [240, 0], [240, 420], [420, 420],
          [420, 0], [580, 0], [580, 1000], [420, 1000],
          [420, 580], [240, 580], [240, 1000], [80, 1000],
        ],
      },
    ],
  },
  'I': {
    width: 340,
    contours: [
      {
        points: [
          [80, 0], [260, 0], [260, 1000], [80, 1000],
        ],
      },
    ],
  },
  'J': {
    width: 520,
    contours: [
      {
        points: [
          [120, 0], [380, 0], [460, 120], [460, 1000],
          [300, 1000], [300, 180], [180, 180], [180, 300],
          [50, 300], [50, 120],
        ],
      },
    ],
  },
  'K': {
    width: 640,
    contours: [
      {
        points: [
          [80, 0], [240, 0], [240, 380], [430, 0],
          [600, 0], [360, 480], [590, 1000], [420, 1000],
          [240, 600], [240, 1000], [80, 1000],
        ],
      },
    ],
  },
  'L': {
    width: 560,
    contours: [
      {
        points: [
          [80, 0], [520, 0], [520, 160], [240, 160],
          [240, 1000], [80, 1000],
        ],
      },
    ],
  },
  'M': {
    width: 760,
    contours: [
      {
        points: [
          [60, 0], [200, 0], [200, 650], [340, 200],
          [420, 200], [560, 650], [560, 0], [700, 0],
          [700, 1000], [540, 1000], [380, 480], [220, 1000],
          [60, 1000],
        ],
      },
    ],
  },
  'N': {
    width: 660,
    contours: [
      {
        points: [
          [80, 0], [220, 0], [440, 600], [440, 0],
          [580, 0], [580, 1000], [440, 1000], [220, 400],
          [220, 1000], [80, 1000],
        ],
      },
    ],
  },
  'O': {
    width: 680,
    contours: [
      {
        points: [
          [160, 0], [520, 0], [630, 160], [630, 840],
          [520, 1000], [160, 1000], [50, 840], [50, 160],
        ],
      },
      {
        isHole: true,
        points: [
          [210, 180], [210, 820], [470, 820], [470, 180],
        ],
      },
    ],
  },
  'P': {
    width: 640,
    contours: [
      {
        points: [
          [80, 0], [240, 0], [240, 460], [460, 460],
          [580, 580], [580, 860], [460, 1000], [80, 1000],
        ],
      },
      {
        isHole: true,
        points: [
          [240, 620], [240, 840], [420, 840], [420, 620],
        ],
      },
    ],
  },
  'Q': {
    width: 680,
    contours: [
      {
        points: [
          [160, 0], [440, 0], [480, -100], [600, -100],
          [530, 60], [630, 160], [630, 840], [520, 1000],
          [160, 1000], [50, 840], [50, 160],
        ],
      },
      {
        isHole: true,
        points: [
          [210, 180], [210, 820], [470, 820], [470, 180],
        ],
      },
    ],
  },
  'R': {
    width: 660,
    contours: [
      {
        points: [
          [80, 0], [240, 0], [240, 460], [440, 460],
          [570, 0], [720, 0], [550, 500], [600, 600],
          [600, 860], [480, 1000], [80, 1000],
        ],
      },
      {
        isHole: true,
        points: [
          [240, 600], [240, 840], [430, 840], [430, 600],
        ],
      },
    ],
  },
  'S': {
    width: 620,
    contours: [
      {
        points: [
          [140, 0], [480, 0], [580, 140], [580, 360],
          [480, 480], [220, 540], [220, 820], [440, 820],
          [470, 740], [590, 820], [500, 1000], [150, 1000],
          [50, 850], [50, 640], [150, 520], [410, 460],
          [410, 180], [180, 180], [150, 260], [40, 180],
        ],
      },
    ],
  },
  'T': {
    width: 600,
    contours: [
      {
        points: [
          [220, 0], [380, 0], [380, 840], [560, 840],
          [560, 1000], [40, 1000], [40, 840], [220, 840],
        ],
      },
    ],
  },
  'U': {
    width: 660,
    contours: [
      {
        points: [
          [160, 0], [500, 0], [600, 160], [600, 1000],
          [440, 1000], [440, 220], [220, 220], [220, 1000],
          [60, 1000], [60, 160],
        ],
      },
    ],
  },
  'V': {
    width: 640,
    contours: [
      {
        points: [
          [240, 0], [400, 0], [600, 1000], [440, 1000],
          [320, 320], [200, 1000], [40, 1000],
        ],
      },
    ],
  },
  'W': {
    width: 820,
    contours: [
      {
        points: [
          [160, 0], [290, 0], [390, 500], [480, 0],
          [620, 0], [780, 1000], [630, 1000], [530, 360],
          [440, 820], [340, 820], [250, 360], [150, 1000],
          [20, 1000],
        ],
      },
    ],
  },
  'X': {
    width: 640,
    contours: [
      {
        points: [
          [50, 0], [200, 0], [320, 340], [440, 0],
          [590, 0], [420, 500], [580, 1000], [430, 1000],
          [320, 660], [210, 1000], [60, 1000], [220, 500],
        ],
      },
    ],
  },
  'Y': {
    width: 620,
    contours: [
      {
        points: [
          [230, 0], [390, 0], [390, 460], [580, 1000],
          [420, 1000], [310, 620], [200, 1000], [40, 1000],
          [230, 460],
        ],
      },
    ],
  },
  'Z': {
    width: 600,
    contours: [
      {
        points: [
          [60, 0], [540, 0], [540, 160], [240, 160],
          [510, 840], [540, 840], [540, 1000], [70, 1000],
          [70, 840], [360, 160], [60, 160],
        ],
      },
    ],
  },
};

/**
 * Returns a glyph definition for any char; falls back to uppercase or square block.
 */
export function getGlyph(char: string): GlyphDefinition {
  if (GLYPHS[char]) return GLYPHS[char];
  const upper = char.toUpperCase();
  if (GLYPHS[upper]) {
    // If lowercase, scale slightly to small-caps
    if (char >= 'a' && char <= 'z') {
      const g = GLYPHS[upper]!;
      const s = 0.75;
      return {
        width: g.width * s,
        contours: g.contours.map((c) => ({
          isHole: c.isHole,
          points: c.points.map(([x, y]) => [x * s, y * s]),
        })),
      };
    }
    return GLYPHS[upper]!;
  }
  // Fallback box for unknown characters
  return {
    width: 600,
    contours: [
      {
        points: [
          [100, 0], [500, 0], [500, 1000], [100, 1000],
        ],
      },
      {
        isHole: true,
        points: [
          [220, 160], [220, 840], [380, 840], [380, 160],
        ],
      },
    ],
  };
}

export interface TextOptions {
  size: number;
  at?: P2;
  angle?: number; // degrees
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  source?: Id;
}

/**
 * Transforms a text string into a set of closed polygon loops (Loop2) in sketch coordinates.
 */
export function textContours(text: string, options: TextOptions): Loop2[] {
  const size = options.size;
  if (!text || text.length === 0 || !(size > 0 && Number.isFinite(size))) return [];

  const scaleFactor = size / 1000;
  const tracking = 100; // units between glyphs
  const glyphs: { def: GlyphDefinition; xOffset: number }[] = [];
  let curX = 0;

  for (const ch of text) {
    const g = getGlyph(ch);
    glyphs.push({ def: g, xOffset: curX });
    curX += g.width + tracking;
  }
  const totalWidth = curX > 0 ? curX - tracking : 0;

  // Horizontal alignment shift
  let alignShift = 0;
  if (options.align === 'center') alignShift = -totalWidth / 2;
  else if (options.align === 'right') alignShift = -totalWidth;

  const at: P2 = options.at ?? [0, 0];
  const angleRad = ((options.angle ?? 0) * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const italicShear = options.italic ? 0.25 : 0;
  const source = options.source ?? '';

  const loops: Loop2[] = [];

  for (const { def, xOffset } of glyphs) {
    for (const c of def.contours) {
      if (c.points.length < 3) continue;

      // Transform raw points to sketch coordinates
      const oriented = orientContour(c.points, !c.isHole);
      const transformedPts: P2[] = oriented.map(([px, py]) => {
        // 1. Position in text layout
        let lx = px + xOffset + alignShift;
        let ly = py;

        // 2. Italic shear
        lx += ly * italicShear;

        // 3. Scale by font size
        const sx = lx * scaleFactor;
        const sy = ly * scaleFactor;

        // 4. Rotate by angle
        const rx = sx * cosA - sy * sinA;
        const ry = sx * sinA + sy * cosA;

        // 5. Translate to anchor
        return [at[0] + rx, at[1] + ry];
      });

      // Construct closed Loop2 made of Segment2 line segments
      const loop: Loop2 = [];
      const n = transformedPts.length;
      for (let i = 0; i < n; i++) {
        const p1 = transformedPts[i]!;
        const p2 = transformedPts[(i + 1) % n]!;
        loop.push({
          kind: 'line',
          a: p1,
          b: p2,
          source,
        });
      }
      loops.push(loop);
    }
  }

  return loops;
}
