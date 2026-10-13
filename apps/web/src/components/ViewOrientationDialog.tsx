import { t } from '@3db/i18n';
import { ACTIONS, shortcutOf } from '../actions';
import { store, useStore } from '../state/store';

/** The standard views in SolidWorks' order (Ctrl+1 to Ctrl+8): the actions themselves, so the labels, shortcuts and what can be chosen are theirs. */
const VIEWS = ['view-front', 'view-back', 'view-left', 'view-right', 'view-top', 'view-bottom', 'view-iso', 'view-normal'] as const;

/** 「視角方位」 (the space bar, as in SolidWorks): a standard view in one click. */
export function ViewOrientationDialog() {
  const open = useStore((s) => s.dialog === 'viewOrientation');
  const state = useStore((s) => s);
  if (!open) return null;
  const close = () => store.openDialog(null);
  const actions = VIEWS.map((id) => ACTIONS.find((a) => a.id === id)!);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal view-orientation" role="dialog" aria-label={t('viewOrientation.title')} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('viewOrientation.title')}</h3>
        <div className="view-orientation-list">
          {actions.map((a, i) => (
            <button
              key={a.id}
              data-view={a.id}
              autoFocus={i === 0}
              disabled={!a.enabled(state)}
              title={shortcutOf(a) ?? undefined}
              onClick={() => {
                close();
                a.run();
              }}
            >
              {a.label}
              {shortcutOf(a) && <span className="shortcut">{shortcutOf(a)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
