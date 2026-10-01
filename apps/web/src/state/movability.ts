import { t } from '@3db/i18n';
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
  if (why === 'fixed') return t('move.fixed');
  if (why === 'defined') return t('move.defined');
  return t('move.drag', { verb: tool === 'rotate' ? t('move.verbRotate') : t('move.verbMove') });
}
