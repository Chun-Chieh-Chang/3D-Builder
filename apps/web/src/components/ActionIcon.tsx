import { actionIconUrl } from '../icons/actionIcons';

/** Labels remain visible; artwork is decorative and never replaces the accessible name. */
export function ActionIcon({ id }: { id: string }) {
  const src = actionIconUrl(id);
  return src ? <img className="action-icon" data-action-icon={id} src={src} alt="" aria-hidden="true" draggable={false} /> : null;
}
