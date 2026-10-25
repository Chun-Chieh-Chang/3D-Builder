import { t } from '@3db/i18n';
import { KernelError } from '@3db/kernel';
import type { Kernel, Vec3 } from '@3db/kernel';
import { nameElements } from '@3db/naming';
import { flatPattern } from './flatPattern';
import type { SheetInfo, RebuildResult } from './engine';
import { sheetInverse, sheetPoint, sheetVector } from './sheetMapping';

/** Native flat material in drawing XY coordinates; caller releases shape. */
export function flatDrawingGeometry(k: Kernel, sheet: SheetInfo, source?: RebuildResult['body']) {
  const p = flatPattern(k, sheet);
  try {
    if (p.notIncluded.length) throw new KernelError(t('sheetState.bendCut'));
    const { frame: f } = p;
    const dot = (a: number[], b: number[]) => a.reduce((s,x,i)=>s+x*b[i]!,0);
    const shape = k.transformed(p.shape, [...f.xDir,-dot(f.xDir,f.origin)-p.min[0],...f.yDir,-dot(f.yDir,f.origin)-p.min[1],...f.normal,-dot(f.normal,f.origin)]);
    const topology = k.topology(shape);
    // A changed outline topology invalidates unnamed interior references, rather than reusing an unrelated index.
    const signature = `${topology.faces.map(f=>f.surface).sort().join('.')}:${topology.edges.length}:${topology.vertices.length}`;
    const world = (v: Vec3): Vec3 => f.origin.map((x,i)=>x+f.xDir[i]!*(v[0]+p.min[0])+f.yDir[i]!*(v[1]+p.min[1])+f.normal[i]!*v[2]) as Vec3;
    const faces = topology.faces.map((face,index) => {
      const g=face.geometry;
      if(g?.type==='plane') {
        for(const [axis,size] of [[0,p.width],[1,p.height]] as const) {
          if(Math.abs(g.normal[axis])<1-1e-8)continue;
          if(Math.abs(g.origin[axis])<1e-6)return `@flat:extent:${axis}:min`;
          if(Math.abs(g.origin[axis]-size)<1e-6)return `@flat:extent:${axis}:max`;
        }
      }
      if(g?.type==='cylinder' && source && sheet.mapping && !sheet.unfolding) {
        const center=world([g.origin[0],g.origin[1],p.thickness/2]);
        const axis:Vec3=f.normal;
        const matches=new Set<string>();
        for(const panel of sheet.mapping.panels) {
          const inverse=sheetInverse(panel.toFlat),c=sheetPoint(inverse,center),a=sheetVector(inverse,axis);
          source.topology.faces.forEach((candidate,i)=>{
            const cg=candidate.geometry;
            if(cg?.type!=='cylinder'||Math.abs(cg.radius-g.radius)>1e-6||Math.abs(dot(cg.axis,a))<1-1e-8)return;
            const delta=c.map((x,j)=>x-cg.origin[j]!) as Vec3;
            const along=dot(delta,cg.axis);
            if(Math.hypot(...delta.map((x,j)=>x-along*cg.axis[j]!))<1e-6)matches.add(source.names.faces[i]!);
          });
        }
        if(matches.size===1)return `@flat:source:${[...matches][0]}`;
      }
      return `@flat:topology:${signature}:face${index}`;
    });
    const names = nameElements(topology.faces.map((_,index)=>[{rel:'same' as const,kind:'face' as const,index}]), topology, {featureId:'@flat',input:{faces,edges:[],vertices:[]}});
    return {shape,topology,names};
  } finally { k.release(p.shape); }
}
