import { useStore, store } from '../state/store';
import { SKETCH_STATUS_LABEL } from '../strings';

/** Status bar: notices, sketch status (C1.31), rebuild time, volume, unit system. */
export function StatusBar() {
  const notice = useStore((s) => s.notice);
  const result = useStore((s) => s.result);
  const rebuilding = useStore((s) => s.rebuilding);
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selected);
  const editing = useStore((s) => s.editing);
  const bootMs = useStore((s) => s.bootMs);

  const sketchId = [editing?.featureId, selected, ...doc.features.map((f) => f.id)].find((id) => id && doc.features.find((f) => f.id === id)?.type === 'sketch');
  const sketch = result?.features.find((f) => f.id === sketchId)?.sketch;
  const errors = result?.features.filter((f) => f.status === 'error') ?? [];

  return (
    <footer className="status-bar">
      <span className={`notice ${notice?.kind ?? ''}`} onClick={() => store.dismissNotice()}>
        {notice?.text ?? (errors.length > 0 ? `錯誤為何？ ${errors.map((e) => `${doc.features.find((f) => f.id === e.id)?.name}：${e.message}`).join('；')}` : '就緒')}
      </span>
      {sketch && <span className={`sketch-status ${sketch.status}`}>{SKETCH_STATUS_LABEL[sketch.status]}</span>}
      {result?.mass && <span>體積 {result.mass.volume.toFixed(3)} mm³</span>}
      <span>{rebuilding ? '重新計算中…' : result ? `重新計算 ${result.totalMs.toFixed(1)} ms` : ''}</span>
      {bootMs && <span className="muted">核心載入 {Math.round(bootMs.occtMs)} ms</span>}
      <span className="units">MMGS</span>
    </footer>
  );
}
