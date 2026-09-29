import { joinPath } from '@3db/model';
import { mateProblem } from './AssemblyTree';
import { useStore, store } from '../state/store';
import { SKETCH_STATUS_LABEL } from '../strings';

/** Status bar: notices, 「錯誤為何？」 (D7.1), sketch status (C1.31), rebuild time, volume, unit system. */
export function StatusBar() {
  const notice = useStore((s) => s.notice);
  const result = useStore((s) => s.result);
  const rebuilding = useStore((s) => s.rebuilding);
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selected);
  const editing = useStore((s) => s.editing);
  const sketchSolve = useStore((s) => s.sketchSolve);
  const bootMs = useStore((s) => s.bootMs);
  const asm = useStore((s) => s.asm);

  if (asm) {
    // The part files the assembly uses (not a part only looked at in 「插入零組件」).
    const statuses = asm.doc.files.map((f) => asm.files.get(joinPath(asm.folder, f.path)));
    const loading = statuses.filter((s) => !s || s.status === 'loading').length;
    const missing = statuses.filter((s) => s?.status === 'missing' || s?.status === 'error').length;
    const mateErrors = asm.doc.mates.filter((m) => mateProblem(asm, m)).length;
    // The assembly as SolidWorks' status bar says it: over-defined, under-defined or fully defined.
    const states = [...(asm.solution?.components.values() ?? [])].map((c) => c.status);
    const definition = !asm.solution || asm.doc.components.length === 0 ? null : states.includes('over') ? { text: '過多定義', cls: 'over' } : states.includes('under') ? { text: '定義不足', cls: 'under' } : { text: '完全定義', cls: 'fully' };
    return (
      <footer className="status-bar">
        <span className={`notice ${notice?.kind ?? ''}`} onClick={() => store.dismissNotice()}>
          {notice?.text ?? '就緒'}
        </span>
        {mateErrors > 0 && (
          <button className="whats-wrong-button error" onClick={() => store.showWhatsWrong(true)} title="列出有錯誤的結合">
            錯誤為何？（{mateErrors} 個結合錯誤）
          </button>
        )}
        {missing > 0 && (
          <button className="whats-wrong-button error" onClick={() => void store.assembly?.openRelink()} title="重新指定找不到的零件檔">
            {missing} 個零件檔無法載入
          </button>
        )}
        <span>{loading > 0 ? `正在載入零件（${loading}）…` : `零組件 ${asm.doc.components.length} 個`}</span>
        {definition && <span className={`sketch-status ${definition.cls}`}>{definition.text}</span>}
        {bootMs && <span className="muted">核心載入 {Math.round(bootMs.occtMs)} ms</span>}
        <span className="units">MMGS</span>
      </footer>
    );
  }

  // Inside a sketch its live solve is the status; otherwise the selected (or first) sketch of the last rebuild.
  const sketchId = [editing?.featureId, selected, ...doc.features.map((f) => f.id)].find((id) => id && doc.features.find((f) => f.id === id)?.type === 'sketch');
  const sketch = editing?.kind === 'sketch' ? sketchSolve : result?.features.find((f) => f.id === sketchId)?.sketch;
  const errors = result?.features.filter((f) => f.status === 'error').length ?? 0;
  const warnings = result?.features.filter((f) => f.status === 'ok' && f.warnings?.length).length ?? 0;
  const editingName = editing?.kind === 'sketch' ? doc.features.find((f) => f.id === editing.featureId)?.name : undefined;

  return (
    <footer className="status-bar">
      <span className={`notice ${notice?.kind ?? ''}`} onClick={() => store.dismissNotice()}>
        {notice?.text ?? (editingName ? `正在編輯：${editingName}` : '就緒')}
      </span>
      {(errors > 0 || warnings > 0) && (
        <button className={`whats-wrong-button ${errors > 0 ? 'error' : 'warning'}`} onClick={() => store.showWhatsWrong(true)} title="列出所有錯誤與警告">
          錯誤為何？（{[errors > 0 && `${errors} 個錯誤`, warnings > 0 && `${warnings} 個警告`].filter(Boolean).join('、')}）
        </button>
      )}
      {sketch && (
        <span className={`sketch-status ${sketch.status}`}>
          {SKETCH_STATUS_LABEL[sketch.status]}
          {editing?.kind === 'sketch' && sketch.status === 'under' ? `（${sketch.dof}）` : ''}
        </span>
      )}
      {result?.mass && editing?.kind !== 'sketch' && <span>體積 {result.mass.volume.toFixed(3)} mm³</span>}
      <span>{rebuilding ? '重新計算中…' : result ? `重新計算 ${result.totalMs.toFixed(1)} ms` : ''}</span>
      {bootMs && <span className="muted">核心載入 {Math.round(bootMs.occtMs)} ms</span>}
      <span className="units">MMGS</span>
    </footer>
  );
}
