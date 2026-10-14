import { t } from '@3db/i18n';
import { formatNumber, holeRows, raText } from '@3db/drawing';
import {
  CHARACTERISTIC_RULES,
  GEOMETRIC_CHARACTERISTICS,
  SURFACE_FINISH_KINDS,
  type Annotation,
  type DatumReference,
  type GeometricCharacteristic,
  type MaterialCondition,
  type SurfaceFinish,
  type SurfaceFinishKind,
  type ToleranceFrameAnnotation,
} from '@3db/model';
import type { AnnotateWhat } from '../state/drawing';
import { useState } from 'react';
import { store, useStore } from '../state/store';

/** A number box committed on Enter or on leaving (an empty text takes the value back). */
function NumberBox({ value, onCommit, field }: { value: number; onCommit: (v: number) => void; field: string }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== '' && Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <input
      data-field={field}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        e.stopPropagation();
      }}
    />
  );
}

/** A text box committed on Enter or on leaving (an empty text takes what was written away). */
function TextBox({ value, onCommit, field }: { value: string; onCommit: (v: string) => void; field: string }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const commit = () => (text !== value ? onCommit(text) : undefined);
  return (
    <input
      data-field={field}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

/** A text box for a tolerance class, committed on Enter or on leaving; empty takes the class away. */
function ClassBox({ value, onCommit, field }: { value: string; onCommit: (v: string) => void; field: string }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const commit = () => (text.trim() !== value ? onCommit(text.trim()) : undefined);
  return (
    <input
      data-field={field}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        e.stopPropagation();
      }}
    />
  );
}

/** A text area committed when it loses focus (Enter makes a new line, as a note has several). */
function NoteBox({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  return (
    <textarea
      data-field="noteText"
      rows={3}
      value={text}
      title={t('drawingUi.noteTextTip')}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

const TOOLS: { what: AnnotateWhat; label: string }[] = [
  { what: 'note', label: 'drawingUi.toolNote' },
  { what: 'datum', label: 'drawingUi.toolDatum' },
  { what: 'fcf', label: 'drawingUi.toolFcf' },
  { what: 'centreLine', label: 'drawingUi.toolCentreLine' },
  { what: 'centreMark', label: 'drawingUi.toolCentreMark' },
];

/** What an annotation is called in the list. */
function annotationLabel(a: Annotation): string {
  if (a.kind === 'note') return t('drawingUi.annNoteLabel', { text: a.text.split('\n')[0]!.slice(0, 24) });
  if (a.kind === 'datum') return `${t('drawingUi.annKind.datum')} ${a.label}`;
  if (a.kind === 'fcf') return `${t(`drawing.gdt.${a.characteristic}`)} ${a.diameter ? 'Ø' : ''}${formatNumber(a.tolerance, 4)}${a.datums.length ? ' | ' + a.datums.map((d) => d.label).join(' | ') : ''}`;
  return t(`drawingUi.annKind.${a.kind}`);
}

/**
 * The editor of the annotation chosen (D-I3, ADR 0132): what its kind has. A frame offers only what ISO 1101 allows its characteristic: no datums for a form
 * tolerance, Ø and Ⓜ only where they apply, and the datums the drawing has. A change the commands refuse is said and not made.
 */
function AnnotationEditor({ a }: { a: Annotation }) {
  return (
    <>
      <Fastened a={a} />
      <AnnotationFields a={a} />
    </>
  );
}

/** What an annotation is fastened to in the model (D-I2), and a button to let it go; said when the element is gone from the model. */
function Fastened({ a }: { a: Annotation }) {
  const d = store.drawingStore!;
  useStore((s) => s.drw);
  const attach = (a as { attach?: { ref: { kind: string; name: string; in?: string } } }).attach;
  if (!attach) return null;
  const lost = d.attachmentsLost().has(a.id);
  return (
    <div className={`pm-row${lost ? ' warning-text' : ''}`} data-field="attached">
      <span>{lost ? t('drawingUi.attachLost') : t('drawingUi.attachedTo', { kind: t(`drawingUi.elementKind.${attach.ref.kind}` as 'drawingUi.elementKind.edge') })}</span>
      <button className="pm-button" data-action="detach" onClick={() => d.setAnnotation(a.id, { attach: null })}>
        {t('drawingUi.detach')}
      </button>
    </div>
  );
}

function AnnotationFields({ a }: { a: Annotation }) {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const datums = (drw.doc.annotations ?? []).flatMap((x) => (x.kind === 'datum' ? [x.label] : []));
  if (a.kind === 'note')
    return (
      <>
        <label className="pm-row">
          <span>{t('drawingUi.noteText')}</span>
          <NoteBox value={a.text} onCommit={(v) => d.setAnnotation(a.id, { text: v })} />
        </label>
        <label className="pm-row">
          <span>{t('drawingUi.noteHeight')}</span>
          <NumberBox field="noteHeight" value={a.height ?? 3.5} onCommit={(v) => d.setAnnotation(a.id, { height: v === 3.5 ? null : v })} />
        </label>
        {a.leader && (
          <div className="pm-row">
            <button className="pm-button" data-action="removeLeader" onClick={() => d.setAnnotation(a.id, { leader: null, attach: null })}>
              {t('drawingUi.removeLeader')}
            </button>
          </div>
        )}
      </>
    );
  if (a.kind === 'datum')
    return (
      <>
        <label className="pm-row">
          <span>{t('drawingUi.datumLabel')}</span>
          <TextBox field="datumLabel" value={a.label} onCommit={(v) => d.setAnnotation(a.id, { label: v.trim().toUpperCase() })} />
        </label>
        <label className="pm-row">
          <span>{t('drawingUi.finishAngle')}</span>
          <NumberBox field="datumAngle" value={a.angle ?? 90} onCommit={(v) => d.setAnnotation(a.id, { angle: v })} />
        </label>
        <label className="pm-row">
          <span>{t('drawingUi.finishLeader')}</span>
          <NumberBox field="datumLength" value={a.length ?? 6} onCommit={(v) => d.setAnnotation(a.id, { length: v })} />
        </label>
      </>
    );
  if (a.kind === 'fcf') return <FrameEditor a={a} datums={datums} />;
  if (a.kind === 'centreMark')
    return (
      <label className="pm-row">
        <span>{t('drawingUi.centreMarkRadius')}</span>
        <NumberBox field="centreMarkRadius" value={a.radius} onCommit={(v) => d.setAnnotation(a.id, { radius: v })} />
      </label>
    );
  return null;
}

function FrameEditor({ a, datums }: { a: ToleranceFrameAnnotation; datums: string[] }) {
  const d = store.drawingStore!;
  const rules = CHARACTERISTIC_RULES[a.characteristic];
  /** A characteristic chosen: what it does not allow is taken off the frame with it, so the change is one the commands accept. */
  const choose = (c: GeometricCharacteristic) => {
    const r = CHARACTERISTIC_RULES[c];
    const datumsNext: DatumReference[] = r.datums === 'none' ? [] : a.datums.map((x) => (r.material ? x : { label: x.label }));
    if (r.datums === 'required' && datumsNext.length === 0 && datums[0]) datumsNext.push({ label: datums[0] });
    d.setAnnotation(a.id, { characteristic: c, datums: datumsNext, diameter: r.diameter ? (a.diameter ?? null) : null, material: r.material ? (a.material ?? null) : null });
  };
  const setDatum = (i: number, label: string, material?: MaterialCondition | '') => {
    const next = [...a.datums];
    if (label === '') next.splice(i);
    else next[i] = { label, ...(material ? { material } : {}) };
    d.setAnnotation(a.id, { datums: next });
  };
  return (
    <>
      <label className="pm-row">
        <span>{t('drawingUi.fcfCharacteristic')}</span>
        <select data-field="fcfCharacteristic" value={a.characteristic} onChange={(e) => choose(e.target.value as GeometricCharacteristic)}>
          {GEOMETRIC_CHARACTERISTICS.map((c) => (
            <option key={c} value={c}>
              {t(`drawing.gdt.${c}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="pm-row">
        <span>{t('drawingUi.fcfTolerance')}</span>
        <NumberBox field="fcfTolerance" value={a.tolerance} onCommit={(v) => d.setAnnotation(a.id, { tolerance: v })} />
      </label>
      {rules.diameter && (
        <label className="pm-row checkbox">
          <input type="checkbox" data-field="fcfDiameter" checked={!!a.diameter} onChange={(e) => d.setAnnotation(a.id, { diameter: e.target.checked ? true : null })} />
          <span>{t('drawingUi.fcfDiameter')}</span>
        </label>
      )}
      {rules.material && (
        <label className="pm-row">
          <span>{t('drawingUi.fcfMaterial')}</span>
          <select data-field="fcfMaterial" value={a.material ?? ''} onChange={(e) => d.setAnnotation(a.id, { material: e.target.value === '' ? null : e.target.value })}>
            <option value="">{t('drawingUi.fcfMaterialNone')}</option>
            <option value="M">{t('drawingUi.fcfMaterialM')}</option>
            <option value="L">{t('drawingUi.fcfMaterialL')}</option>
          </select>
        </label>
      )}
      {rules.datums === 'none' ? (
        <p className="muted">{t('drawingUi.fcfNoDatumsKind')}</p>
      ) : (
        <>
          {rules.datums === 'required' && a.datums.length === 0 && <p className="warning-text">{t('drawingUi.fcfNeedsDatumKind')}</p>}
          {[0, 1, 2].map((i) =>
            i > a.datums.length ? null : (
              <div className="pm-row" key={i}>
                <span>{t('drawingUi.fcfDatum', { n: i + 1 })}</span>
                <select data-field={`fcfDatum${i}`} value={a.datums[i]?.label ?? ''} onChange={(e) => setDatum(i, e.target.value, a.datums[i]?.material)}>
                  <option value="">{t('drawingUi.fcfDatumNone')}</option>
                  {datums.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                {rules.material && a.datums[i] && (
                  <select data-field={`fcfDatumMaterial${i}`} value={a.datums[i]!.material ?? ''} onChange={(e) => setDatum(i, a.datums[i]!.label, e.target.value as MaterialCondition | '')}>
                    <option value="">{t('drawingUi.fcfMaterialNone')}</option>
                    <option value="M">Ⓜ</option>
                    <option value="L">Ⓛ</option>
                  </select>
                )}
              </div>
            ),
          )}
        </>
      )}
    </>
  );
}

/**
 * The annotations of the selected view (C16.5, C16.6): its centre marks and centre lines, and its hole table with the tolerance class of each size of hole. Every
 * change is a command on the document.
 */
export function AnnotationPanel() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const view = drw.doc.views.find((v) => v.id === drw.selected);
  if (!view) return null;
  const features = drw.features.get(view.id) ?? [];
  const tables = drw.doc.tables.flatMap((x) => (x.view === view.id && x.kind === 'holes' ? [x] : []));
  const centre = view.centreMarks ?? view.kind !== 'section';
  const assembly = drw.boms.has(view.id);
  const boms = drw.doc.tables.flatMap((x) => (x.view === view.id && x.kind === 'bom' ? [x] : []));
  const sizes = [...new Set(holeRows(features).map((r) => formatNumber(2 * r.radius)))];
  const finishes = d.surfaceFinishesOf(view.id);
  const annotations = d.annotationsOf(view.id);
  const currentAnnotation = drw.annotation ? annotations.find((a) => a.id === drw.annotation) : undefined;
  const currentFinish = drw.finish ? finishes.find((f) => f.id === drw.finish) : undefined;
  /** What a symbol is called in the list: its roughness, or how it is made when it has no value. */
  const finishLabel = (f: SurfaceFinish) => (f.ra !== undefined ? raText(f.ra) : t(`drawingUi.finishKind.${f.kind ?? 'machined'}`));
  return (
    <>
      {assembly && (
        <>
          <div className="pm-row">
            <button className="pm-button" data-action="addBomTable" disabled={boms.length > 0} onClick={() => d.addBomTable(view.id)}>
              {t('drawingUi.addBomTable')}
            </button>
          </div>
          {boms.map((table) => (
            <div key={table.id} data-table={table.id}>
              <div className="pm-row">
                <span className="name">{t('bom.title')}</span>
                <button className="pm-button" data-action="tableHome" disabled={!table.at} onClick={() => d.setTable(table.id, { at: null })}>
                  {t('drawingUi.bomAutoPosition')}
                </button>
                <button title={t('drawingUi.deleteTable')} data-action="deleteTable" onClick={() => d.deleteTables([table.id])}>
                  ✕
                </button>
              </div>
              <label className="pm-row checkbox">
                <input type="checkbox" data-field="balloons" checked={!!table.balloons} onChange={(e) => d.setTable(table.id, { balloons: e.target.checked })} />
                <span>{t('drawingUi.balloons')}</span>
                <button className="pm-button" data-action="balloonsAuto" disabled={!table.balloonAt} onClick={(e) => { e.preventDefault(); d.setTable(table.id, { balloonAt: null }); }}>
                  {t('drawingUi.balloonsAuto')}
                </button>
              </label>
            </div>
          ))}
        </>
      )}
      {!assembly && (
      <>
      <label className="pm-row checkbox">
        <input type="checkbox" data-field="centreMarks" checked={centre} onChange={(e) => d.setView(view.id, { centreMarks: e.target.checked })} />
        <span>{t('drawingUi.centreMarks')}</span>
      </label>
      <div className="pm-row">
        <button className="pm-button" data-action="addHoleTable" disabled={sizes.length === 0} onClick={() => d.addHoleTable(view.id)}>
          {t('drawingUi.addHoleTable')}
        </button>
      </div>
      {sizes.length === 0 && <p className="muted">{t('drawingUi.tableEmpty')}</p>}
      {tables.map((table) => (
        <div key={table.id} data-table={table.id}>
          <div className="pm-row">
            <span className="name">{t('drawingUi.holeTable')}</span>
            <button className="pm-button" data-action="tableHome" disabled={!table.at} onClick={() => d.setTable(table.id, { at: null })}>
              {t('drawingUi.tableAutoPosition')}
            </button>
            <button title={t('drawingUi.deleteTable')} data-action="deleteTable" onClick={() => d.deleteTables([table.id])}>
              ✕
            </button>
          </div>
          {sizes.map((size) => (
            <label key={size} className="pm-row">
              <span>{t('drawingUi.tableFit', { d: size })}</span>
              <ClassBox
                field={`tableFit-${size}`}
                value={table.fits?.[size] ?? ''}
                onCommit={(fit) => {
                  const fits = { ...(table.fits ?? {}) };
                  if (fit) fits[size] = fit;
                  else delete fits[size];
                  d.setTable(table.id, { fits });
                }}
              />
            </label>
          ))}
        </div>
      ))}
      <h4>{t('drawingUi.annTools')}</h4>
      <div className="pm-row pm-wrap" data-group="annotateTools">
        {TOOLS.map(({ what, label }) => (
          <button
            key={what}
            className={`pm-button${drw.tool?.kind === 'annotate' && drw.tool.what === what ? ' active' : ''}`}
            data-action={`tool-${what}`}
            title={t(`drawingUi.hint.${what}` as 'drawingUi.hint.note')}
            onClick={() => d.setTool(drw.tool?.kind === 'annotate' && drw.tool.what === what ? null : { kind: 'annotate', what })}
          >
            {t(label as 'drawingUi.toolNote')}
          </button>
        ))}
      </div>
      {annotations.length === 0 && <p className="muted">{t('drawingUi.annNone')}</p>}
      <ul className="selection-box" data-field="annotations">
        {annotations.map((a) => (
          <li
            key={a.id}
            className={drw.selection.some((x) => x.kind === 'annotation' && x.id === a.id) ? 'selected' : ''}
            onClick={(e) => d.pick([{ kind: 'annotation', id: a.id }], e.ctrlKey || e.metaKey ? 'toggle' : 'replace')}
            data-annotation={a.id}
          >
            <span className="name">{annotationLabel(a)}</span>
            <button title={t('drawingUi.annDelete')} onClick={(e) => (e.stopPropagation(), d.deleteAnnotations([a.id]))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {currentAnnotation && <AnnotationEditor a={currentAnnotation} />}
      <h4>{t('drawingUi.surfaceFinishes')}</h4>
      <div className="pm-row">
        <button
          className={`pm-button${drw.tool?.kind === 'surface' ? ' active' : ''}`}
          data-action="toolSurfaceFinish"
          title={t('drawingUi.toolSurfaceFinish')}
          onClick={() => d.setTool(drw.tool?.kind === 'surface' ? null : { kind: 'surface' })}
        >
          {t('drawingUi.addSurfaceFinish')}
        </button>
      </div>
      {finishes.length === 0 && <p className="muted">{t('drawingUi.finishNone')}</p>}
      <ul className="selection-box" data-field="surfaceFinishes">
        {finishes.map((f) => (
          <li
            key={f.id}
            className={drw.selection.some((x) => x.kind === 'finish' && x.id === f.id) ? 'selected' : ''}
            onClick={(e) => (e.ctrlKey || e.metaKey ? d.pick([{ kind: 'finish', id: f.id }], 'toggle') : d.selectSurfaceFinish(f.id))}
            data-finish={f.id}
          >
            <span className="name">{finishLabel(f)}</span>
            <button title={t('drawingUi.finishDelete')} onClick={(e) => (e.stopPropagation(), d.deleteSurfaceFinishes([f.id]))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      {currentFinish && (
        <>
          <label className="pm-row">
            <span>{t('drawingUi.finishKind')}</span>
            <select data-field="finishKind" value={currentFinish.kind ?? 'machined'} onChange={(e) => d.setSurfaceFinish(currentFinish.id, { kind: e.target.value as SurfaceFinishKind })}>
              {SURFACE_FINISH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`drawingUi.finishKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishRa')}</span>
            <NumberBox field="finishRa" value={currentFinish.ra ?? 0} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { ra: v > 0 ? v : null })} />
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishMethod')}</span>
            <TextBox field="finishMethod" value={currentFinish.method ?? ''} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { method: v })} />
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishNote')}</span>
            <TextBox field="finishNote" value={currentFinish.note ?? ''} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { note: v })} />
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishAngle')}</span>
            <NumberBox field="finishAngle" value={currentFinish.angle ?? 90} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { angle: v })} />
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.finishLeader')}</span>
            <NumberBox field="finishLeader" value={currentFinish.leader ?? 0} onCommit={(v) => d.setSurfaceFinish(currentFinish.id, { leader: v > 0 ? v : null })} />
          </label>
        </>
      )}
      </>
      )}
    </>
  );
}
