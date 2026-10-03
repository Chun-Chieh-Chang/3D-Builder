import { LINE_STYLES, type Scene } from './scene';

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
  for (const item of scene.items) {
    if (item.kind === 'polyline') {
      const s = LINE_STYLES[item.style];
      const pts: string[] = [];
      for (let i = 0; i < item.points.length; i += 2) pts.push(`${num(item.points[i]!)},${y(item.points[i + 1]!)}`);
      const attrs = `fill="none" stroke="#000000" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash.join(' ')}"` : ''}`;
      out.push(item.closed ? `<polygon points="${pts.join(' ')}" ${attrs}/>` : `<polyline points="${pts.join(' ')}" ${attrs}/>`);
    } else {
      const anchor = item.anchor === 'center' ? 'middle' : item.anchor === 'right' ? 'end' : 'start';
      const rotate = item.angle ? ` transform="rotate(${num(-item.angle)} ${num(item.at[0])} ${y(item.at[1])})"` : '';
      out.push(`<text x="${num(item.at[0])}" y="${y(item.at[1])}" font-size="${num(item.height * 1.4)}" font-family="${esc(options.font ?? 'sans-serif')}" text-anchor="${anchor}" fill="#000000"${rotate}>${esc(item.text)}</text>`);
    }
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}
