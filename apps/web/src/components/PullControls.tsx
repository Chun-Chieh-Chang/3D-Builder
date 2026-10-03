import { t } from '@3db/i18n';
import type { Vec3 } from '@3db/model';
import { useStore } from '../state/store';

const AXES: { id: string; label: string; dir: Vec3 }[] = [
  { id: '+z', label: '+Z', dir: [0, 0, 1] },
  { id: '-z', label: '−Z', dir: [0, 0, -1] },
  { id: '+y', label: '+Y', dir: [0, 1, 0] },
  { id: '-y', label: '−Y', dir: [0, -1, 0] },
  { id: '+x', label: '+X', dir: [1, 0, 0] },
  { id: '-x', label: '−X', dir: [-1, 0, 0] },
];

/**
 * The direction the mold opens along, for the analyses of a plastic part (E3.2, E3.3): one of the six axes, the normal of the planar face picked in the view, or the
 * direction turned round. `onPull` is told the new direction and what to call it.
 */
export function PullControls({ pull, label, onPull }: { pull: Vec3; label: string; onPull: (pull: Vec3, label: string) => void }) {
  const selected = useStore((s) => s.selectedFace);
  const axis = AXES.find((a) => a.dir.every((v, i) => v === pull[i]));
  const plane = selected?.kind === 'face' && selected.fingerprint?.type === 'plane' && selected.fingerprint.dir ? selected : null;
  return (
    <>
      <label className="pm-row">
        <span>{t('draftAnalysis.direction')}</span>
        <select value={axis?.id ?? 'face'} onChange={(e) => AXES.some((a) => a.id === e.target.value) && onPull(AXES.find((a) => a.id === e.target.value)!.dir, e.target.value)}>
          {!axis && <option value="face">{label}</option>}
          {AXES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <div className="pm-row">
        <button disabled={!plane} title={plane ? '' : t('draftAnalysis.noPlane')} onClick={() => plane && onPull(plane.fingerprint!.dir as Vec3, t('draftAnalysis.faceDirection', { name: plane.name }))}>
          {t('draftAnalysis.useFace')}
        </button>
        <button onClick={() => onPull([-pull[0], -pull[1], -pull[2]], label)}>{t('draftAnalysis.flip')}</button>
      </div>
    </>
  );
}
