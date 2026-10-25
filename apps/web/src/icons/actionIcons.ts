import manifest from './solidcraft/manifest.json';

/** Original masters are MIT-licensed SolidCraft artwork. See solidcraft/README.md. */
const masters = import.meta.glob<string>('./solidcraft/*.svg', { query: '?raw', import: 'default', eager: true });
const cache = new Map<string, string>();
const actions: Readonly<Record<string, string>> = manifest.actions;
type Theme = 'light' | 'dark';
const surface = new Set(['ruled-surface', 'radiated-surface', 'replace-face', 'offset-surface', 'knit', 'fill-surface', 'flat-surface', 'trim-surface', 'mutual-trim', 'extend-surface', 'thicken', 'cut-with-surface']);
const cut = new Set(['extrude-cut', 'revolve-cut', 'sweep-cut', 'loft-cut']);

const diagram = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="currentColor" stroke-width="2.55" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
/** Actual dimension/symbol geometry distinguishes commands that have no direct upstream master. */
const diagrams: Readonly<Record<string, string>> = {
  'drw-dim-angle': '<path d="M9 12v43h45"/><path d="M9 27a28 28 0 0 1 28 28" stroke="#236ead" stroke-width="4.25"/><path d="M9 27l7-4m21 32 4-7" stroke="#236ead"/>',
  'drw-dim-radius': '<circle cx="32" cy="32" r="23"/><path d="M32 32l16-16m-9 1 9-1-1 9" stroke="#236ead" stroke-width="4.25"/><circle cx="32" cy="32" r="2" fill="#236ead"/>',
  'drw-dim-diameter': '<circle cx="32" cy="32" r="23"/><path d="M16 48l32-32m-10 1 10-1-1 10M17 38l-1 10 10-1" stroke="#236ead" stroke-width="4.25"/>',
  'drw-dim-chamfer': '<path d="M10 54V10h25l19 19v25Z" fill="#e2e8ef"/><path d="M35 10l19 19" stroke="#236ead" stroke-width="4.25"/><path d="M25 37h19m-12-6-7 6 7 6M44 37l-7-6m7 6-7 6" stroke="#236ead"/>',
  'drw-baseline': '<path d="M9 8v48M31 10v14M43 10v28M55 10v42"/><path d="M9 20h22M9 34h34M9 48h46" stroke="#236ead" stroke-width="4.25"/><path d="m14 16-5 4 5 4m12-8 5 4-5 4m-12 6-5 4 5 4m24-8 5 4-5 4m-24 6-5 4 5 4m36-8 5 4-5 4" stroke="#236ead"/>',
  'drw-ordinate': '<path d="M10 10v44h44"/><circle cx="10" cy="54" r="3" fill="#236ead"/><path d="M23 49v10m14-10v10m14-10v10M5 40h10M5 26h10M5 12h10" stroke="#236ead" stroke-width="4.25"/>',
  'drw-centre-mark': '<circle cx="32" cy="32" r="18"/><path d="M5 32h20m14 0h20M32 5v20m0 14v20" stroke="#236ead" stroke-width="3.5"/><circle cx="32" cy="32" r="2" fill="#236ead"/>',
  'drw-datum': '<path d="M19 8h26v22H19Z" fill="#e2e8ef"/><path d="M32 30v13m0 0-8 11h16Z" fill="#236ead"/><path d="M10 55h44"/>',
  'drw-fcf': '<path d="M5 20h54v24H5Zm18 0v24m18-24v24" fill="#e2e8ef"/><circle cx="14" cy="32" r="5" stroke="#236ead"/><path d="M14 24v16M6 32h16m9-7v14m-4-7h8m13-6h5m-5 6h5m-5 6h5" stroke="#236ead"/>',
  'drw-surface': '<path d="m9 32 12 19L43 12m-17 31h29" stroke="#236ead" stroke-width="4.25"/><path d="M9 55h46"/>',
  'new-drawing': '<path d="M12 5h29l11 11v43H12Z" fill="#e2e8ef"/><path d="M41 5v11h11M20 23h12v12H20Zm18 0h7v12h-7ZM20 41h12v9H20Z" stroke="#236ead"/>',
};

/** 3D-Builder-specific cues. Never substitute unrelated artwork for an unsupported command. */
function variant(id: string, svg: string): string {
  if (diagrams[id]) return diagram(diagrams[id]);
  if (cut.has(id)) return svg.replace('</svg>', '<circle cx="51" cy="51" r="11" fill="#fff" stroke="#b43737" stroke-width="2.55"/><path d="M45 51h12" stroke="#b43737" stroke-width="4.25" stroke-linecap="round"/></svg>');
  if (id === 'sheet-unfold-selected') return svg.replace('</svg>', '<circle cx="51" cy="51" r="10" fill="#fff" stroke="#236ead" stroke-width="2.55"/><path d="M51 41a10 10 0 0 1 0 20Z" fill="#236ead"/></svg>');
  if (id === 'cosmetic-thread') return diagram('<path d="M13 17v30c0 10 38 10 38 0V17" fill="#e2e8ef"/><ellipse cx="32" cy="17" rx="19" ry="8" fill="#b8c3cf"/><path d="M15 30c12 9 22-9 34 0m-34 9c12 9 22-9 34 0m-34 9c12 9 22-9 34 0" stroke="#236ead" stroke-width="3.5" stroke-dasharray="4 3"/>');
  if (id === 'knurl') return svg.replace('</svg>', '<path d="M18 30l20 21m-20-9 9 9m0-21 16 17m-24 3 22-18m-17 21 20-17" fill="none" stroke="#236ead" stroke-width="2.55" stroke-linecap="round"/></svg>');
  if (id === 'drw-dim-vertical' || id === 'drw-dim-aligned') return svg.replace(/(<title>.*?<\/title>)/s, `$1<g transform="rotate(${id === 'drw-dim-vertical' ? 90 : -30} 32 32)">`).replace('</svg>', '</g></svg>');
  return svg;
}

/** Returns an isolated SVG image: local masks cannot collide between repeated buttons. */
export function actionIconUrl(id: string, theme: Theme = 'light'): string | undefined {
  const name = actions[id];
  if (!name) return undefined;
  const key = `${theme}:${id}`;
  const saved = cache.get(key);
  if (saved) return saved;
  const master = masters[`./solidcraft/${name}.svg`];
  if (!master) throw new Error(`Missing command icon: ${id} / ${name}`);
  const accentName = surface.has(id) ? 'surface' : id.startsWith('tool-') || id === 'sketch' || id === 'exit-sketch' ? 'sketch' : undefined;
  const accent = accentName ? manifest.accents[accentName] : undefined;
  const palette = new Map<string, string>();
  for (const [role, values] of Object.entries(manifest.roles)) {
    if (role === 'line') continue;
    const active = accent && role in accent ? accent[role as keyof typeof accent] : undefined;
    palette.set(values.source.toLowerCase(), active?.[theme] ?? values[theme]);
  }
  let svg = variant(id, master);
  svg = svg.replace(/#[0-9a-f]{6}\b/gi, color => palette.get(color.toLowerCase()) ?? color).replace(/currentColor/g, manifest.roles.line[theme]);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, url);
  return url;
}
