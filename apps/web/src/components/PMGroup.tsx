import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * A group box of a PropertyManager, as SolidWorks draws them: a header with a chevron that opens and closes it, and its rows. A closed group keeps its
 * rows (only hidden), so that what they hold — the fields a script or a test reaches for — is always there. Shared by the drawing's panel (ADR 0133) and
 * the part's selection panel (E1 §2.2), so the two sidebars lay a group out the same way.
 */
export function PMGroup({ title, icon, open, onToggle, group, hidden, children }: { title: string; icon: IconName; open: boolean; onToggle: () => void; group?: string; hidden?: boolean; children: ReactNode }) {
  return (
    <section className={`sw-group${open ? ' open' : ''}`} data-group={group} hidden={hidden}>
      <button type="button" className="sw-group-head" onClick={onToggle} aria-expanded={open}>
        <Icon name="chevron" className="sw-chevron" />
        <Icon name={icon} className="sw-group-icon" />
        <span>{title}</span>
      </button>
      <div className="sw-group-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
