import { afterAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import manifest from '../../apps/web/src/icons/solidcraft/manifest.json';
import { actionIconUrl } from '../../apps/web/src/icons/actionIcons';
const actions=Object.keys(manifest.actions);
const svg=(id:string,theme:'light'|'dark'='light')=>decodeURIComponent(actionIconUrl(id,theme)!.split(',').slice(1).join(','));
it('preserves every imported upstream master and distributes its complete MIT copyright notice',()=>{
 for(const [id,entry] of Object.entries(manifest.masters)){
  const bytes=readFileSync(new URL(`../../apps/web/src/icons/solidcraft/${id}.svg`,import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex'),id).toBe(entry.sha256);
 }
 const license=readFileSync(new URL('../../apps/web/public/licenses/solidcraft-icons-MIT.txt',import.meta.url),'utf8');expect(license).toContain('Copyright (c) 2026 SolidCraft contributors');expect(license).toContain('Permission is hereby granted');
});
it('covers the complete existing registry, including generated sketch tools and nested dimension commands',()=>{
 const source=readFileSync(new URL('../../apps/web/src/actions.ts',import.meta.url),'utf8').split('export const ACTIONS: UiAction[] = [')[1]!.split('\n];')[0]!;
 const literal=[...source.matchAll(/\bid:\s*'([^']+)'/g)].map(m=>m[1]!);
 const toolSource=readFileSync(new URL('../../apps/web/src/actions.ts',import.meta.url),'utf8').match(/const SKETCH_TOOLS: ToolId\[\] = \[(.*?)\]/)![1]!;
 const tools=[...toolSource.matchAll(/'([^']+)'/g)].map(m=>'tool-'+m[1]);
 expect(new Set(actions)).toEqual(new Set([...literal,...tools]));
 expect(actionIconUrl('future-unmapped-command')).toBeUndefined();
});
it('retains distinct visual cues for cuts, partial unfolding, cosmetic threads and each dimension type',()=>{
 for(const [a,b] of [['extrude','extrude-cut'],['revolve','revolve-cut'],['sweep','sweep-cut'],['loft','loft-cut'],['sheet-unfold','sheet-unfold-selected'],['thread','cosmetic-thread']])expect(svg(a!),a+' vs '+b).not.toBe(svg(b!));
 const dimensions=['horizontal','vertical','aligned','angle','radius','diameter','chamfer'].map(t=>svg('drw-dim-'+t));expect(new Set(dimensions).size).toBe(dimensions.length);
 expect(svg('tool-circle')).toContain('#057f45');expect(svg('offset-surface')).toContain('#a45000');expect(svg('drw-dim-radius','dark')).toContain('stroke="#dbe4ee"');
});
it('embeds scalable self-contained artwork with no scripts, external resources or unresolved color tokens',()=>{
 for(const id of actions)for(const theme of ['light','dark'] as const){const text=svg(id,theme);expect(text,id).toContain('viewBox="0 0 64 64"');expect(text,id).not.toMatch(/<(script|foreignObject|image)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=\s*["'](?:https?:|javascript:|data:)|currentColor/i);}
});
afterAll(()=>{
 // Optional standalone design evidence, using the same rendered images as production.
 if(process.env.ICON_PREVIEW_OUTPUT)writeFileSync(process.env.ICON_PREVIEW_OUTPUT,JSON.stringify(Object.fromEntries(actions.map(id=>[id,{light:actionIconUrl(id),dark:actionIconUrl(id,'dark')}]))));
});
