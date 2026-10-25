import { t } from '@3db/i18n';
import type { DrawingView } from '@3db/model';
import type { SceneItem } from './scene';
import { toSheet, type PlacedView, type ViewLines } from './layout';

const number = (n: number) => String(+n.toFixed(3));
/** Manufacturing annotations share native bend data with the standalone flat-pattern export. */
export function bendTableItems(view: DrawingView, lines: ViewLines | null | undefined, placed: PlacedView): SceneItem[] {
  const style=view.flatBends, bends=lines?.bends;
  if (!style || !bends?.length) return [];
  const out:SceneItem[]=[];
  const direction=(d:'up'|'down')=>t(d==='up'?'drawingUi.bendUp':'drawingUi.bendDown');
  if(style.notes) bends.forEach((b,i)=>{
    const p=toSheet(placed,(b.a[0]+b.b[0])/2,(b.a[1]+b.b[1])/2);
    out.push({kind:'text',at:[p[0]+3,p[1]+3],text:`B${i+1} ${direction(b.direction)} ${number(b.angle*180/Math.PI)}° R${number(b.radius)} mm`,height:2.5,anchor:'left'});
  });
  if(style.table){
    const cols=[12,17,17,15,19], row=7, width=cols.reduce((a,b)=>a+b,0);
    const [x,y]=style.at??[placed.at[0]+placed.w/2+8,placed.at[1]+placed.h/2];
    const headers=['B','drawingUi.bendDirection','drawingUi.bendAngle','R (mm)','BA (mm)'].map(s=>s.includes('.')?t(s as 'drawingUi.bendDirection'):s);
    const rows=[headers,...bends.map((b,i)=>[`B${i+1}`,direction(b.direction),number(b.angle*180/Math.PI)+'°',number(b.radius),number(b.allowance)])];
    for(let r=0;r<=rows.length;r++)out.push({kind:'polyline',points:[x,y-r*row,x+width,y-r*row],style:'thin'});
    let at=x;
    for(const col of [0,...cols]){at+=col;out.push({kind:'polyline',points:[at,y,at,y-rows.length*row],style:'thin'});}
    rows.forEach((cells,r)=>{let dx=x;cells.forEach((text,c)=>{out.push({kind:'text',at:[dx+2,y-r*row-4.5],text,height:2.5,anchor:'left'});dx+=cols[c]!;});});
  }
  return out;
}
