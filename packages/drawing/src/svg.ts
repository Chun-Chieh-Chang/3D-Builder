import { LINE_STYLES, type Scene } from './scene';
import { shadeHref } from './shade';

const num = (v: number) => String(Math.round(v * 1000) / 1000 + 0);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The scene as SVG (F3.1 on the screen): a page of the sheet's size in millimetres, white, with the lines in their widths and dashes. The sheet's y runs up and
 * SVG's down, so each y is `height − y`.
 */
export function toSvg(scene: Scene, options: { font?: string } = {}): string {
  const { width, height } = scene;
  const y = (v: number) => num(height - v);
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}mm" height="${num(height)}mm" viewBox="0 0 ${num(width)} ${num(height)}">`, `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="#ffffff"/>`];
  // the shaded views' images first, under every line (ADR 0146); a detail's cut to its circle
  (scene.images ?? []).forEach((img, i) => {
    const clip = img.clip ? `shade-clip-${i}` : null;
    if (img.clip && clip) out.push(`<clipPath id="${clip}"><circle cx="${num(img.clip.centre[0])}" cy="${y(img.clip.centre[1])}" r="${num(img.clip.radius)}"/></clipPath>`);
    out.push(`<image x="${num(img.at[0])}" y="${y(img.at[1] + img.h)}" width="${num(img.w)}" height="${num(img.h)}" preserveAspectRatio="none" href="${shadeHref(img.image)}"${clip ? ` clip-path="url(#${clip})"` : ''}/>`);
  });
  for (const item of scene.items) {
    if (item.kind === 'polyline') {
      const s = LINE_STYLES[item.style];
      const pts: string[] = [];
      for (let i = 0; i < item.points.length; i += 2) pts.push(`${num(item.points[i]!)},${y(item.points[i + 1]!)}`);
      const attrs = `fill="${item.filled ? '#000000' : 'none'}" stroke="#000000" stroke-width="${num(item.width ?? s.width)}" stroke-linecap="round" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash.join(' ')}"` : ''}`;
      out.push(item.closed ? `<polygon points="${pts.join(' ')}" ${attrs}/>` : `<polyline points="${pts.join(' ')}" ${attrs}/>`);
    } else {
      // the text of a dimension has a white edge: what is drawn under it does not strike through it
      const anchor = item.anchor === 'center' ? 'middle' : item.anchor === 'right' ? 'end' : 'start';
      const rotate = item.angle ? ` transform="rotate(${num(-item.angle)} ${num(item.at[0])} ${y(item.at[1])})"` : '';
      out.push(`<text x="${num(item.at[0])}" y="${y(item.at[1])}" font-size="${num(item.height * 1.4)}" font-family="${esc(options.font ?? 'sans-serif')}" text-anchor="${anchor}" fill="#000000"${item.group ? ` stroke="#ffffff" stroke-width="${num(item.height * 0.3)}" stroke-linejoin="round" paint-order="stroke"` : ''}${rotate}>${esc(item.text)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}
