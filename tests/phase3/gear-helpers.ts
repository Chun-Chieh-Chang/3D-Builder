import { gearDimensions, type GearParameters, type SpurGearFeature, type RackFeature } from '@3db/model';
export const gear=(extra:Partial<SpurGearFeature>={}):SpurGearFeature=>({id:'gear1',type:'gear',name:'gear1',suppressed:false,plane:{kind:'datum',name:'plane:front'},module:'2',teeth:'24',pressureAngle:'20deg',width:'10',backlash:'0',bore:'5',...extra});
export const rack=(extra:Partial<RackFeature>={}):RackFeature=>({id:'rack1',type:'rack',name:'rack1',suppressed:false,plane:{kind:'datum',name:'plane:front'},module:'2',teeth:'10',pressureAngle:'20deg',width:'10',backlash:'0',baseHeight:'5',...extra});
/** Analytic polar-area integral of the involute flanks and radial root transitions, independent of spline interpolation. */
export function gearArea(p:GearParameters) {
 const d=gearDimensions(p),r0=Math.max(d.rootRadius,d.baseRadius),a=Math.sqrt((r0/d.baseRadius)**2-1),b=Math.sqrt((d.tipRadius/d.baseRadius)**2-1);
 const integral=(t:number)=>2*t**3/3-(t*t+1)*Math.atan(t)+t;
 return Math.PI*d.rootRadius**2+p.teeth*((d.half-(a-Math.atan(a)))*(r0*r0-d.rootRadius**2)+d.baseRadius**2*(d.half*(b*b-a*a)-(integral(b)-integral(a))))-Math.PI*(p.bore/2)**2;
}
export function rackArea(p:GearParameters) {const d=gearDimensions(p);return p.teeth*(d.pitch*p.baseHeight+2.25*p.module*d.thickness+(1.25**2-1)*p.module**2*Math.tan(p.pressureAngle));}
