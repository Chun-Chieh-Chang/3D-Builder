/** Pointer motion projected onto the screen image of one model millimetre. */
export function draggedDepth(initial:number, from:readonly number[], to:readonly number[], axis:readonly number[]):number {
  if(![initial,...from,...to,...axis].every(Number.isFinite)) throw new Error('Depth and pointer coordinates must be finite');
  const n=axis[0]!*axis[0]!+axis[1]!*axis[1]!;
  if(n<1e-12) throw new Error('The depth axis has no screen projection');
  const value=initial+((to[0]!-from[0]!)*axis[0]!+(to[1]!-from[1]!)*axis[1]!)/n;
  if(!(value>0) || !Number.isFinite(value)) throw new Error('Depth must be positive');
  return value;
}

/** Which way a positive value grows the feature: a boss with the sketch normal, a cut into the material against it (C4.1, engine `dirOf`).
 *  The value axis stays put whether `reverse` is on or not — `reverse` carries its own sign in the signed value. */
export function extrusionGrowSign(op:'boss'|'cut'):1|-1 {
  return op==='cut'?-1:1;
}

/** The arrow (and the drag handle on it) points the way the feature is growing right now: along the value axis, flipped when the value ran past the sketch plane. */
export function previewArrowUnit(axis:readonly number[],value:number):number[] {
  const n=Math.hypot(axis[0]!,axis[1]!);
  const flip=value<0?-1:1;
  return [axis[0]!/n*flip,axis[1]!/n*flip];
}

/** Signed axial motion while constructing an extrusion. Crossing the plane intentionally reverses it. */
export function draggedExtrusion(initial:number,from:readonly number[],to:readonly number[],axis:readonly number[]):number {
  if([from,to,axis].some(v=>v.length!==2)||![initial,...from,...to,...axis].every(Number.isFinite))throw new Error('Invalid extrusion pointer coordinates');
  const n=axis[0]!*axis[0]!+axis[1]!*axis[1]!;
  if(n<1e-12)throw new Error('The extrusion axis has no screen projection');
  const value=initial+((to[0]!-from[0]!)*axis[0]!+(to[1]!-from[1]!)*axis[1]!)/n;
  if(!Number.isFinite(value)||value===0)throw new Error('Extrusion depth must be nonzero');
  return value;
}
