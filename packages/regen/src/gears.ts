import { gearDimensions, type GearParameters } from '@3db/model';
import type { Region, Segment } from '@3db/kernel';
type P=[number,number];
const polar=(r:number,a:number):P=>[r*Math.cos(a),r*Math.sin(a)];
const choose=(n:number,k:number)=>{let value=1;for(let i=1;i<=k;i++)value=value*(n-i+1)/i;return value;};
/** Degree-17 Taylor involute in Bernstein form: no least-squares fit or interior knots. */
function involutePoles(base:number,start:number,end:number,center:number,sign:number,half:number):P[] {
  const degree=17,x=Array<number>(18).fill(0),y=Array<number>(18).fill(0);x[0]=base;
  let factorial=1;
  for(let k=1;k<=degree;k++) {factorial*=k;if(k%2===0)x[k]=base*(-1)**(k/2-1)*(k-1)/factorial;else if(k>=3)y[k]=base*(-1)**((k+1)/2)*(k-1)/factorial;}
  const bernstein=(coefficients:number[])=>{
    const local=Array.from({length:18},(_,j)=>coefficients.reduce((sum,c,k)=>k<j?sum:sum+c*choose(k,j)*start**(k-j)*(end-start)**j,0));
    return Array.from({length:18},(_,i)=>local.slice(0,i+1).reduce((sum,c,j)=>sum+c*choose(i,j)/choose(degree,j),0));
  };
  const bx=bernstein(x),by=bernstein(y),angle=center+sign*half,c=Math.cos(angle),s=Math.sin(angle);
  return bx.map((value,i)=>[value*c+sign*by[i]!*s,value*s-sign*by[i]!*c]);
}
/** Native arcs at tip/root and degree-17 analytic-series Bezier involute flanks; no tooth booleans. */
export function toothedProfile(p:GearParameters):Region {
  const d=gearDimensions(p),outer:Segment[]=[];
  const line=(a:P,b:P,source:string)=>outer.push({kind:'line',a,b,source});
  if(p.kind==='rack') {
    const length=d.pitch*p.teeth,left=-length/2,root=-1.25*p.module,bottom=root-p.baseHeight;
    line([left,bottom],[left+length,bottom],'back');line([left+length,bottom],[left+length,root],'end');
    let prev:P=[left+length,root];
    // Traverse the top from right to left, making one full pitch per tooth, centered in its cell.
    for(let i=p.teeth-1;i>=0;i--) {
      const center=left+(i+0.5)*d.pitch,rootHalf=d.thickness/2+1.25*p.module*Math.tan(p.pressureAngle),tipHalf=d.thickness/2-p.module*Math.tan(p.pressureAngle);
      const points:P[]=[[center+rootHalf,root],[center+tipHalf,p.module],[center-tipHalf,p.module],[center-rootHalf,root]];
      for(let j=0;j<points.length;j++){line(prev,points[j]!,`tooth:${i}:${j}`);prev=points[j]!;}
    }
    line(prev,[left,root],'rootEnd');line([left,root],[left,bottom],'start');
    return {outer,holes:[]};
  }
  const startRadius=Math.max(d.rootRadius,d.baseRadius),t0=Math.sqrt((startRadius/d.baseRadius)**2-1),t1=Math.sqrt((d.tipRadius/d.baseRadius)**2-1);
  const parameters=Array.from({length:33},(_,i)=>t0+(t1-t0)*i/32);
  const pitchT=Math.tan(p.pressureAngle);if(pitchT>t0&&pitchT<t1&&!parameters.some(t=>Math.abs(t-pitchT)<1e-6))parameters.push(pitchT);parameters.sort((a,b)=>a-b);
  const flank=(center:number,sign:number):P[]=>parameters.map(t=>polar(d.baseRadius*Math.sqrt(1+t*t),center+sign*(d.half-(t-Math.atan(t)))));
  for(let i=0;i<p.teeth;i++) {
    const center=i*2*Math.PI/p.teeth,left=flank(center,-1),right=flank(center,1),rootAngle=d.half-(t0-Math.atan(t0));
    const rootLeft=polar(d.rootRadius,center-rootAngle),rootRight=polar(d.rootRadius,center+rootAngle);
    if(startRadius-d.rootRadius>1e-7)line(rootLeft,left[0]!,`tooth:${i}:rootLeft`);
    const leftPoles=involutePoles(d.baseRadius,t0,t1,center,-1,d.half);leftPoles[0]=left[0]!;leftPoles[leftPoles.length-1]=left.at(-1)!;
    outer.push({kind:'spline',points:left,closed:false,bezierPoles:leftPoles,source:`tooth:${i}:left`});
    outer.push({kind:'arc',c:[0,0],r:d.tipRadius,from:left.at(-1)!,to:right.at(-1)!,ccw:true,source:`tooth:${i}:tip`});
    const rightPoles=involutePoles(d.baseRadius,t0,t1,center,1,d.half);rightPoles[0]=right[0]!;rightPoles[rightPoles.length-1]=right.at(-1)!;
    outer.push({kind:'spline',points:right.reverse(),closed:false,bezierPoles:rightPoles.reverse(),source:`tooth:${i}:right`});
    if(startRadius-d.rootRadius>1e-7)line(right.at(-1)!,rootRight,`tooth:${i}:rootRight`);
    outer.push({kind:'arc',c:[0,0],r:d.rootRadius,from:rootRight,to:polar(d.rootRadius,(i+1)*2*Math.PI/p.teeth-rootAngle),ccw:true,source:`tooth:${i}:root`});
  }
  return {outer,holes:p.bore>0?[[{kind:'circle',c:[0,0],r:p.bore/2,source:'bore'}]]:[]};
}
