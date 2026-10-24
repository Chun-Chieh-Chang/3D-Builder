import { t } from '@3db/i18n';
import { evalAngle, evalLength, evalQuantity } from './expr';
import type { RackFeature, SpurGearFeature } from './schema';
export interface GearParameters {
  kind:'gear'|'rack'; module:number; teeth:number; pressureAngle:number; width:number; backlash:number; bore:number; baseHeight:number;
}
/** Unshifted full-depth teeth: addendum m, dedendum 1.25m, pitch thickness πm/2 minus backlash. */
export function gearDimensions(p:GearParameters) {
  const fail=(key:'gear.range'|'gear.count'|'gear.undercut'|'gear.boreError'|'gear.overlap'):never=>{throw new Error(t(key));};
  if(!Object.values(p).every(value=>typeof value!=='number'||Number.isFinite(value))) fail('gear.range');
  if(p.kind!=='gear'&&p.kind!=='rack')fail('gear.range');
  if(!(p.module>=0.1&&p.module<=100&&p.width>=0.1&&p.width<=1000&&p.pressureAngle>=Math.PI/12-1e-12&&p.pressureAngle<=Math.PI/6+1e-12&&p.backlash>=0))fail('gear.range');
  if(!Number.isInteger(p.teeth)||p.teeth<1||p.teeth>200)fail('gear.count');
  const pitch=Math.PI*p.module,thickness=pitch/2-p.backlash;
  if(thickness<=2*p.module*Math.tan(p.pressureAngle)+1e-6)fail('gear.overlap');
  const pitchRadius=p.module*p.teeth/2,baseRadius=pitchRadius*Math.cos(p.pressureAngle),tipRadius=pitchRadius+p.module,rootRadius=pitchRadius-1.25*p.module;
  const inv=(r:number)=>{const q=Math.sqrt((r/baseRadius)**2-1);return q-Math.atan(q);};
  const half=thickness/(2*pitchRadius)+Math.tan(p.pressureAngle)-p.pressureAngle;
  if(p.kind==='gear') {
    if(p.teeth<Math.ceil(2/Math.sin(p.pressureAngle)**2-1e-10))fail('gear.undercut');
    if(!(p.bore>=0&&p.bore<2*rootRadius-0.1*p.module))fail('gear.boreError');
    if(!(half-inv(tipRadius)>1e-6&&half-inv(Math.max(rootRadius,baseRadius))<Math.PI/p.teeth))fail('gear.overlap');
    if(2*tipRadius>10000)fail('gear.range');
  } else if(!(p.baseHeight>=0.1&&p.baseHeight<=1000&&p.teeth*pitch<=10000))fail('gear.range');
  return {pitch,length:pitch*p.teeth,thickness,pitchRadius,baseRadius,tipRadius,rootRadius,half};
}
/** Called after expression resolution; no guessed defaults or changed user values. */
export function gearParameters(f:SpurGearFeature|RackFeature):GearParameters {
  const q=evalQuantity(f.teeth);
  if(q.L!==0||q.A!==0)throw new Error(t('gear.count'));
  const p:GearParameters={kind:f.type,module:evalLength(f.module),teeth:q.v,pressureAngle:evalAngle(f.pressureAngle),width:evalLength(f.width),backlash:evalLength(f.backlash),bore:f.type==='gear'?evalLength(f.bore):0,baseHeight:f.type==='rack'?evalLength(f.baseHeight):0};
  gearDimensions(p);return p;
}
