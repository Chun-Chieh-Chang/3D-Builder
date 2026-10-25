import { Icon, isIconName, type IconName } from './Icon';
import type { UiAction } from '../actions';

/** Small CAD glyphs; feature commands reuse the same symbols as the feature tree. */
const PATHS: Record<string, string> = {
  'view-front':'M2 4h10v10H2zM2 4l3-2h9v9l-2 3M12 4l2-2',
  'view-back':'M4 2h10v10H4zM4 2L2 4v10h10l2-2M4 12h10',
  'view-top':'M2 6l4-4h8l-4 4zM2 6v8h8l4-4V2M10 6v8',
  'view-bottom':'M2 2h8l4 4v8H6l-4-4zM2 10h8l4 4M10 2v8l4 4',
  'view-left':'M2 4l4-2v10l-4 2zM6 2h8v10H6M2 14h8l4-2',
  'view-right':'M2 2h8l4 2v10l-4-2zM2 2v10h8M10 2v10l4 2',
  'view-normal':'M2 7l9-3 3 7-9 3zM8 9V1M6 3l2-2 2 2',
  line:'M2 14L14 2M2 12v2h2M12 2h2v2', centerline:'M2 14l3-3m2-2 2-2m2-2 3-3',
  rect:'M2 4h12v9H2z', centerRect:'M2 4h12v9H2zM6 8.5h4M8 6.5v4',
  circle:'M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0M7 8h2M8 7v2',
  perimeterCircle:'M13 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0M2 8h2M7 2h2M12 8h2',
  ellipse:'M14 8a6 3.5 0 1 1-12 0 6 3.5 0 0 1 12 0M7 8h2',
  bezier:'M2 13C5-2 11 18 14 3M2 13l3-10m6 10 3-10M4 2h2v2H4zM10 12h2v2h-2z',
  arc:'M3 13A9 9 0 0 1 13 3M2 12v2h2M12 2h2v2',
  tangentArc:'M1 13h6a6 6 0 0 0 6-6V2M5 11v4',
  threePointArc:'M2 12Q8-4 14 12M1 11h2v2H1zM7 3h2v2H7zM13 11h2v2h-2z',
  point:'M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4M8 1v3M8 12v3M1 8h3M12 8h3',
  slot:'M5 4h6a4 4 0 0 1 0 8H5a4 4 0 0 1 0-8', polygon:'M8 1l6 4v6l-6 4-6-4V5z',
  trim:'M2 3l12 10M2 13L14 3M8 2v4m0 4v4', extend:'M2 12l5-5m2-2 5-5M2 3h12M10 1l4 2-2 4',
  offset:'M2 10l5-6 6 4M2 14l5-6 6 4M12 2v4m-2-2 2 2 2-2',
  text:'M2 3h12M8 3v11M5 14h6M2 3v2M14 3v2',
  move:'M8 1v14M1 8h14M5 4l3-3 3 3M5 12l3 3 3-3M4 5 1 8l3 3M12 5l3 3-3 3',
  copy:'M1 1h9v9H1zM6 6h9v9H6z', rotate:'M13 5A6 6 0 1 0 14 10M13 1v4H9',
  scale:'M2 9h5v5H2zM2 6V2h12v12h-4M8 8l6-6M10 2h4v4',
  linearPattern:'M2 2h4v4H2zM10 2h4v4h-4zM2 10h4v4H2zM10 10h4v4h-4z',
  circularPattern:'M6 1h4v3H6zM1 7h3v3H1zM12 7h3v3h-3zM6 12h4v3H6zM8 5v6M5 8h6',
  undo:'M6 3L2 7l4 4M2 7h7a4 4 0 0 1 4 5', redo:'M10 3l4 4-4 4M14 7H7a4 4 0 0 0-4 5',
  open:'M1 5h5l2 2h7l-2 7H1zM1 5V2h5l2 2h5v3',
  save:'M2 2h10l2 2v10H2zM5 2v4h6V2M5 14V9h6v5',
  new:'M3 1h7l3 3v11H3zM10 1v4h3M5 9h6M8 6v6',
  measure:'M1 11L11 1l4 4L5 15zM4 8l2 2M7 5l2 2M10 2l2 2',
  fit:'M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5M4 4h8v8H4z',
  rebuild:'M13 6A5 5 0 0 0 4 3L2 5M2 1v4h4M3 10a5 5 0 0 0 9 3l2-2M14 15v-4h-4',
  help:'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1M6 5a2 2 0 1 1 3 2c-1 0-1 1-1 2M8 12v.1',
  helpPick:'M2 1v12l3-3 2 5 2-1-2-5h4zM11 2a2 2 0 1 1 2 3v2M13 9v.1',
  power:'M8 1v7M4 3a6 6 0 1 0 8 0',
  options:'M2 4h12M2 8h12M2 12h12M5 2v4M11 6v4M6 10v4',
  equations:'M3 3h10M3 7h10M3 11h4M11 9v5M8.5 11.5h5',
  filter:'M1 2h14l-5 6v5l-4 2V8z',
  horizontal:'M2 5v9M14 5v9M2 10h12M5 8l-3 2 3 2M11 8l3 2-3 2',
  vertical:'M2 2h10M2 14h10M7 2v12M5 5l2-3 2 3M5 11l2 3 2-3',
  angle:'M2 2v12h12M2 14L13 3M2 8a6 6 0 0 1 4 2',
  radius:'M14 8a6 6 0 1 0-6 6M8 8l5-5M10 3h3v3',
  diameter:'M13 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0M2 14L14 2',
  baseline:'M2 2v12M2 5h7M2 10h12M9 3v4M14 8v4',
};
const ALIASES: Record<string,string> = {
  'new-part':'new','new-part-template':'new','new-demo':'new','save-as':'save','undo':'undo','redo':'redo',
  'tool-moveEntities':'move','tool-stretchEntities':'move','tool-copyEntities':'copy','tool-rotateEntities':'rotate','tool-scaleEntities':'scale',
  'move-component':'move','move-with-triad':'move','rotate-component':'rotate','tool-linearPattern':'linearPattern','tool-circularPattern':'circularPattern',
  'linear-pattern':'linearPattern','pattern-linear':'linearPattern','circular-pattern':'circularPattern','pattern-circular':'circularPattern',
  'drw-dim-horizontal':'horizontal','drw-dim-vertical':'vertical','drw-dim-angle':'angle','drw-dim-radius':'radius','drw-dim-diameter':'diameter','drw-baseline':'baseline','drw-ordinate':'baseline',
  'help-pick':'helpPick','shutdown':'power','measure-part':'measure','measure-assembly':'measure','clearance':'measure',
  'physical-part':'measure','physical-assembly':'measure','filter-bar':'filter','clear-filters':'filter',
};
const EXISTING:Record<string,IconName>={
 'view-section':'sectionView','instant3D':'extrude',
 'new-assembly':'assembly','generate-assembly':'assembly','import-step-assembly':'assembly','return-assembly':'assembly',
 'new-drawing':'drawingDoc','drw-standard':'view','drw-projected':'projectedView','drw-section':'sectionView','drw-detail':'detailView',
 'drw-dimension':'dimension','drw-dim-aligned':'dimension','drw-dim-chamfer':'chamfer','drw-note':'note','drw-datum':'datum','drw-fcf':'gdt','drw-centre-mark':'centreMark','drw-centre-line':'refAxis','drw-surface':'surfaceFinish','drw-hole-table':'table','drw-bom':'table',
 'tool-dimension':'dimension','tool-sketchFillet':'fillet','tool-sketchChamfer':'chamfer','tool-mirror':'mirror','tool-convert':'sketch','tool-pierce':'refPoint','tool-intersect':'splitLine','tool-silhouette':'projectedCurve',
 'insert-component':'part','mate':'mates','explode':'assembly','interference':'combine','bom':'table','mirror-component':'mirror','fix-component':'pin','float-component':'moveCopyBody',
 'edit-feature':'properties','edit-feature-sketch':'sketch','suppress-feature':'eyeOff','toggle-visibility':'eye','delete-feature':'cancel',
 'offset-sketch':'sketch','angle-sketch':'sketch','sketch-picture':'palette','construction':'refAxis','select-underdefined':'search','automatic-relations':'mates','exit-sketch':'ok',
 'sketch-delete':'cancel','sketch-select-chain':'mates','sketch-end-tool':'ok','appearance':'palette','properties':'properties','shortcuts':'properties',
 'draft-analysis':'draft','undercut-analysis':'sectionView','thickness-analysis':'shell','check-part':'ok','check-assembly':'ok','flat-pattern':'sheet',
};
const GROUP:Record<UiAction['group'],IconName>={file:'exportFile',edit:'properties',feature:'part',sheet:'sheet',sketch:'sketch','sketch-tool':'sketch',assembly:'assembly',view:'view',tools:'properties',drawing:'view',annotation:'dimension'};
export function ActionIcon({id,group}:{id:string;group:UiAction['group']}) {
 const key=ALIASES[id]??(id.startsWith('tool-')?id.slice(5):id),path=PATHS[key];
 if(path)return <svg className="icon action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>;
 const base=id.replace(/-cut$/,'').replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase());
 const name=EXISTING[id]??(isIconName(base)?base:GROUP[group]);
 return <span className="action-icon-stack"><Icon name={name}/>{id.endsWith('-cut')&&<svg className="action-icon-badge" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="3.5"/><path d="M2 4h4"/></svg>}</span>;
}
