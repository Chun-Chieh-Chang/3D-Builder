import type { Component } from '@3db/model';
import type { AssemblyResult } from '@3db/regen';

/** Why a component cannot be moved (A3.5): it is fixed, or its mates define it fully. Null when it can. */
export function immovable(c: Component, solution: Pick<AssemblyResult, 'components'> | null | undefined): 'fixed' | 'defined' | null {
  if (c.fixed) return 'fixed';
  return solution?.components.get(c.id)?.dof === 0 ? 'defined' : null;
}

/**
 * What the mouse does on the component under the cursor (C15.3), for the hint at the foot of the graphics
 * area. The left button moves it, or turns it while 「旋轉零組件」 is open; the right button always turns it.
 */
export function dragHint(c: Component, solution: Pick<AssemblyResult, 'components'> | null | undefined, tool: 'move' | 'rotate' | null | undefined): string {
  const why = immovable(c, solution);
  if (why === 'fixed') return '已固定，不能拖曳';
  if (why === 'defined') return '已被結合完全定義，不能拖曳';
  return `左鍵拖曳${tool === 'rotate' ? '旋轉' : '移動'}，右鍵拖曳旋轉`;
}
