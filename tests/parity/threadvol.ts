/**
 * 標準螺紋 cut 的每 mm 移除體積（手算推導，非量測回填）：
 * 牙型多邊形依 @3db/model threadStandards 的 ISO 68-1 构造（external cut：major 處 7P/8 開口、
 * 30° 牙山到 minor；internal cut：minor(钻孔) 處 P/4 開口、到 major 處 7P/8），以被切表面半徑裁剪
 * （external 裁掉伸出材料外的 extension margin；internal 裁掉悬在孔内 void 的部分），
 * 再依 Pappus：每節距移除體積 = 軸向截面積 × 2π × 形心半徑。
 */
import { generateStandardThreadProfile, lookupThread } from '@3db/model';

type Pt = [number, number]; // [r, z]

const clipHalfPlane = (pts: Pt[], keep: (r: number) => boolean, surfaceR: number): Pt[] => {
  const at = (a: Pt, b: Pt): Pt => {
    const t = (surfaceR - a[0]) / (b[0] - a[0]);
    return [surfaceR, a[1] + t * (b[1] - a[1])];
  };
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const ka = keep(a[0]);
    const kb = keep(b[0]);
    if (ka) out.push(a);
    if (ka !== kb && isFinite(a[0]) && isFinite(b[0]) && a[0] !== b[0]) out.push(at(a, b));
  }
  return out;
};

export function stdThreadCutPerMm(designation: string, target: 'external' | 'internal', surfaceR: number): number {
  const entry = lookupThread(designation);
  if (!entry) throw new Error(`unknown thread designation: ${designation}`);
  const raw = generateStandardThreadProfile(entry, { op: 'cut', target });
  const clipR = target === 'external' ? Math.min(surfaceR, entry.nominalDia / 2) : surfaceR;
  const poly = clipHalfPlane(raw, target === 'external' ? (r) => r <= clipR + 1e-9 : (r) => r >= clipR - 1e-9, clipR);
  if (poly.length < 3) return 0;
  let twiceA = 0;
  let moment = 0;
  for (let i = 0; i < poly.length; i++) {
    const [r1, z1] = poly[i]!;
    const [r2, z2] = poly[(i + 1) % poly.length]!;
    const cross = r1 * z2 - r2 * z1;
    twiceA += cross;
    moment += (r1 + r2) * cross;
  }
  const rBar = moment / (3 * twiceA); // 形心半徑（帶號公式，與繞向無關）
  return (Math.abs(twiceA) / 2) * 2 * Math.PI * Math.abs(rBar) / entry.pitch;
}
