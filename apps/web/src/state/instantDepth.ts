/** Pointer motion projected onto the screen image of one model millimetre. */
export function draggedDepth(initial:number, from:readonly number[], to:readonly number[], axis:readonly number[]):number {
  if(![initial,...from,...to,...axis].every(Number.isFinite)) throw new Error('Depth and pointer coordinates must be finite');
  const n=axis[0]!*axis[0]!+axis[1]!*axis[1]!;
  if(n<1e-12) throw new Error('The depth axis has no screen projection');
  const value=initial+((to[0]!-from[0]!)*axis[0]!+(to[1]!-from[1]!)*axis[1]!)/n;
  if(!(value>0) || !Number.isFinite(value)) throw new Error('Depth must be positive');
  return value;
}
