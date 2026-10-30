import { ANGLE_STEP, GRID_SPACING, SNAP_ITEMS } from '@3db/sketch/snaps';
import { useEffect, useMemo, useState } from 'react';
import { getLocale, LOCALES, t, type Locale } from '@3db/i18n';
import { PICK_FILTER_LABEL } from '../strings';
import { dimensionName, formatMass, formatQuantity, isDimension, massGrams, MATERIALS, materialById, Parameters, PART_TEMPLATES, settingsOf, type AppearanceTarget, type Command, type DocSettings, type SketchFeature } from '@3db/model';
import { ACTIONS, shortcutOf } from '../actions';
import { conflictWith, formatEvent, overrides, resetOverrides, setOverride, subscribeShortcuts } from '../shortcuts';
import { AUTOSAVE_SECONDS, VIEW_ARROW_STEP } from '../options';
import { store, useStore } from '../state/store';

/** Runs a command; the reason it was refused (as the store worded it), or null when it went through. */
function run(cmd: Command): string | null {
  return store.execute(cmd) ? null : (store.getState().notice?.text ?? '?');
}

/** A text field that commits on Enter or when left; a refusal keeps the text, in red, with the reason on hover. */
function Field({ value, onCommit, placeholder, mono = true, list }: { value: string; onCommit: (v: string) => string | null; placeholder?: string; mono?: boolean; list?: string }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(value);
    setError(null);
  }, [value]);
  const commit = () => {
    if (text.trim() === value) return;
    setError(onCommit(text.trim()));
  };
  return (
    <input
      className={`${error ? 'invalid ' : ''}${mono ? 'mono' : ''}`}
      value={text}
      placeholder={placeholder}
      list={list}
      title={error ?? undefined}
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

function Frame({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const close = () => store.openDialog(null);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide parameters" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{title}</h3>
        <p className="hint">{hint}</p>
        {children}
        <div className="modal-actions">
          <button onClick={close}>{t('eq.close')}</button>
        </div>
      </div>
    </div>
  );
}

/** 方程式 (B5.2, B5.3): global variables, and the driving dimensions of every sketch with their names and values. */
export function EquationsDialog() {
  const open = useStore((s) => s.dialog === 'equations');
  const doc = useStore((s) => s.doc);
  const params = useMemo(() => new Parameters(doc), [doc]);
  const [name, setName] = useState('');
  const [expr, setExpr] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  if (!open) return null;
  const sketches = doc.features.filter((f): f is SketchFeature => f.type === 'sketch');
  const add = () => {
    const error = store.addVariable(name.trim(), expr.trim());
    setAddError(error);
    if (!error) {
      setName('');
      setExpr('');
    }
  };
  return (
    <Frame title={t('eq.title')} hint={t('eq.hint')}>
      <h4>{t('eq.variables')}</h4>
      <table className="eq-table">
        <thead>
          <tr>
            <th>{t('eq.name')}</th>
            <th>{t('eq.expression')}</th>
            <th>{t('eq.value')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {doc.variables.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                {t('eq.none')}
              </td>
            </tr>
          )}
          {doc.variables.map((v) => {
            const r = params.variableValue(v);
            return (
              <tr key={v.id}>
                <td>
                  <Field value={v.name} onCommit={(name) => run({ type: 'setVariable', id: v.id, name })} />
                </td>
                <td>
                  <Field value={v.expr} onCommit={(expr) => run({ type: 'setVariable', id: v.id, expr })} />
                </td>
                <td className={'error' in r ? 'error-text' : ''} title={'error' in r ? r.error : undefined}>
                  {'value' in r ? formatQuantity(r.value) : r.error}
                </td>
                <td>
                  <button title={t('eq.delete')} aria-label={t('eq.delete')} onClick={() => run({ type: 'deleteVariable', id: v.id })}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td>
              <input className={addError ? 'invalid mono' : 'mono'} value={name} placeholder={t('eq.newName')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </td>
            <td>
              <input
                className={addError ? 'invalid mono' : 'mono'}
                value={expr}
                placeholder={t('eq.newExpr')}
                title={addError ?? undefined}
                onChange={(e) => setExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add();
                  e.stopPropagation();
                }}
              />
            </td>
            <td className="error-text">{addError}</td>
            <td>
              <button onClick={add} disabled={!name.trim() || !expr.trim()}>
                {t('eq.add')}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <h4>{t('eq.dimensions')}</h4>
      <table className="eq-table">
        <tbody>
          {sketches.every((s) => !s.constraints.some(isDimension)) && (
            <tr>
              <td className="muted">{t('eq.noDimensions')}</td>
            </tr>
          )}
          {sketches.flatMap((s) =>
            s.constraints.filter(isDimension).map((c) => {
              const r = params.dimensionValue(s, c);
              const shown = dimensionName(c);
              return (
                <tr key={`${s.id}:${c.id}`}>
                  <td className="owner">{s.name}</td>
                  <td>
                    <Field value={shown} mono onCommit={(label) => run({ type: 'setDimensionLabel', featureId: s.id, constraintId: c.id, label: label === shown ? c.label ?? '' : label })} />
                  </td>
                  <td>
                    <Field value={c.value} onCommit={(value) => run({ type: 'setDimension', featureId: s.id, constraintId: c.id, value })} />
                  </td>
                  <td className={'error' in r ? 'error-text' : ''} title={'error' in r ? r.error : `${shown}@${s.name}`}>
                    {'value' in r ? formatQuantity({ v: r.value, L: c.type === 'angle' ? 0 : 1, A: c.type === 'angle' ? 1 : 0 }) : r.error}
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </Frame>
  );
}

/** 材質 (C14.1) and 文件設定 (B8.4): the material of the part and the mass it gives, the standard, the decimals and the mesh quality. */
function MaterialAndSettings() {
  const doc = useStore((s) => s.doc);
  const volume = useStore((s) => s.result?.mass?.volume ?? null);
  const material = doc.material;
  const settings = settingsOf(doc);
  const custom = material !== undefined && material.id === undefined;
  const choose = (value: string) => {
    if (value === '') return void run({ type: 'setMaterial', material: null });
    if (value === 'custom') return void run({ type: 'setMaterial', material: { name: t('material.custom'), density: 1 } });
    const m = materialById(value);
    if (m) run({ type: 'setMaterial', material: { id: m.id, name: t(`material.${m.id}`), density: m.density } });
  };
  return (
    <div className="props-material">
      <h4>{t('material.heading')}</h4>
      <div className="pm-row">
        <select value={material ? (material.id ?? 'custom') : ''} onChange={(e) => choose(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
          <option value="">{t('material.none')}</option>
          {MATERIALS.map((m) => (
            <option key={m.id} value={m.id}>
              {t('material.option', { name: t(`material.${m.id}`), density: m.density })}
            </option>
          ))}
          <option value="custom">{t('material.custom')}</option>
        </select>
      </div>
      {custom && (
        <>
          <label className="pm-row">
            <span>{t('material.name')}</span>
            <Field mono={false} value={material.name} onCommit={(v) => run({ type: 'setMaterial', material: { name: v, density: material.density } })} />
          </label>
          <label className="pm-row">
            <span>{t('material.density')}</span>
            <Field value={String(material.density)} onCommit={(v) => run({ type: 'setMaterial', material: { name: material.name, density: Number(v) } })} />
          </label>
        </>
      )}
      {material && volume !== null && (
        <p className="hint">
          {t('material.massLine', { mass: formatMass(massGrams(volume, material.density)), density: material.density })}
        </p>
      )}
      <p className="hint">{t('material.hint')}</p>
      <h4>{t('settings.heading')}</h4>
      <label className="pm-row">
        <span>{t('settings.draftStandard')}</span>
        <select value={settings.draftStandard} onChange={(e) => run({ type: 'setSettings', settings: { draftStandard: e.target.value as DocSettings['draftStandard'] } })} onKeyDown={(e) => e.stopPropagation()}>
          {(['ISO', 'CNS', 'ANSI', 'JIS', 'GB'] as const).map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <label className="pm-row">
        <span>{t('settings.dimensionPrecision')}</span>
        <Field value={String(settings.dimensionPrecision)} onCommit={(v) => run({ type: 'setSettings', settings: { dimensionPrecision: Number(v) } })} />
      </label>
      <label className="pm-row">
        <span>{t('settings.meshQuality')}</span>
        <select value={settings.meshQuality} onChange={(e) => run({ type: 'setSettings', settings: { meshQuality: e.target.value as DocSettings['meshQuality'] } })} onKeyDown={(e) => e.stopPropagation()}>
          {(['coarse', 'normal', 'fine'] as const).map((x) => (
            <option key={x} value={x}>
              {t(`settings.mesh.${x}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{t('settings.hint')}</p>
    </div>
  );
}

/** 檔案屬性 (B8.3): free text by name (vendor, part number …), also readable by expressions. */
export function PropertiesDialog() {
  const open = useStore((s) => s.dialog === 'properties');
  const properties = useStore((s) => s.doc.properties);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  if (!open) return null;
  const add = () => {
    const error = run({ type: 'setProperty', name, value });
    setAddError(error);
    if (!error) {
      setName('');
      setValue('');
    }
  };
  return (
    <Frame title={t('props.title')} hint={t('props.hint')}>
      <MaterialAndSettings />
      <table className="eq-table">
        <thead>
          <tr>
            <th>{t('props.name')}</th>
            <th>{t('props.value')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {Object.keys(properties).length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                {t('props.none')}
              </td>
            </tr>
          )}
          {Object.entries(properties)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, text]) => (
              <tr key={key}>
                <td className="owner">{key}</td>
                <td>
                  <Field mono={false} value={text} onCommit={(v) => run({ type: 'setProperty', name: key, value: v })} />
                </td>
                <td>
                  <button title={t('props.delete')} aria-label={t('props.delete')} onClick={() => run({ type: 'deleteProperty', name: key })}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          <tr>
            <td>
              <input list="property-names" className={addError ? 'invalid' : ''} value={name} placeholder={t('props.newName')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <datalist id="property-names">
                <option value={t('props.vendor')} />
                <option value={t('props.partNumber')} />
                <option value={t('props.description')} />
              </datalist>
            </td>
            <td>
              <input
                className={addError ? 'invalid' : ''}
                value={value}
                placeholder={t('props.newValue')}
                title={addError ?? undefined}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') add();
                  e.stopPropagation();
                }}
              />
            </td>
            <td>
              <button onClick={add} disabled={!name.trim()}>
                {t('props.add')}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </Frame>
  );
}

/** 外觀 (C14.2): the color of the part, a body, a feature or a face — the one that is selected — and what has been colored so far. */
export function AppearanceDialog() {
  const open = useStore((s) => s.dialog === 'appearance');
  const doc = useStore((s) => s.doc);
  const selected = useStore((s) => s.selected);
  const selectedFace = useStore((s) => s.selectedFace);
  const bodies = useStore((s) => s.result?.bodies) ?? [];
  const [choice, setChoice] = useState('part');
  const [color, setColor] = useState('#3366cc');
  // opened, it is on what is selected, the narrowest of it (a face before its feature, as 「外觀」 of a face's right-click menu means, ADR 0176); the part when nothing is
  const narrowest = selectedFace?.kind === 'face' ? 'face' : selected?.startsWith('body:') ? 'body' : selected && doc.features.some((f) => f.id === selected && f.type !== 'sketch') ? 'feature' : 'part';
  useEffect(() => {
    if (open) setChoice(narrowest);
  }, [open]);
  if (!open) return null;
  const bodyId = selected?.startsWith('body:') ? selected.slice('body:'.length) : null;
  const feature = selected && !bodyId ? doc.features.find((f) => f.id === selected) : undefined;
  const bodyName = (id: string) => bodies.find((b) => b.id === id)?.name ?? id;
  const targets: { key: string; label: string; target: AppearanceTarget }[] = [
    { key: 'part', label: t('appearance.part'), target: { kind: 'part' } },
    ...(bodyId ? [{ key: 'body', label: t('appearance.body', { name: bodyName(bodyId) }), target: { kind: 'body', id: bodyId } as AppearanceTarget }] : []),
    ...(feature && feature.type !== 'sketch' ? [{ key: 'feature', label: t('appearance.feature', { name: feature.name }), target: { kind: 'feature', id: feature.id } as AppearanceTarget }] : []),
    ...(selectedFace?.kind === 'face' ? [{ key: 'face', label: t('appearance.face', { name: selectedFace.name }), target: { kind: 'face', ref: selectedFace } as AppearanceTarget }] : []),
  ];
  const current = targets.find((x) => x.key === choice) ?? targets[targets.length - 1]!;
  const describe = (target: AppearanceTarget): string =>
    target.kind === 'part'
      ? t('appearance.part')
      : target.kind === 'body'
        ? t('appearance.body', { name: bodyName(target.id) })
        : target.kind === 'feature'
          ? t('appearance.feature', { name: doc.features.find((f) => f.id === target.id)?.name ?? target.id })
          : t('appearance.face', { name: target.ref.name });
  return (
    <Frame title={t('appearance.title')} hint={t('appearance.hint')}>
      <label className="pm-row">
        <span>{t('appearance.target')}</span>
        <select value={current.key} onChange={(e) => setChoice(e.target.value)} onKeyDown={(e) => e.stopPropagation()}>
          {targets.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <label className="pm-row">
        <span>{t('appearance.color')}</span>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <div className="modal-actions">
        <button onClick={() => run({ type: 'setAppearance', target: current.target, color })}>{t('appearance.apply')}</button>
        <button onClick={() => run({ type: 'setAppearance', target: current.target, color: null })}>{t('appearance.remove')}</button>
      </div>
      <h4>{t('appearance.list')}</h4>
      <table className="eq-table">
        <tbody>
          {doc.appearances.length === 0 && (
            <tr>
              <td className="muted">{t('appearance.none')}</td>
            </tr>
          )}
          {doc.appearances.map((a, i) => (
            <tr key={i}>
              <td>
                <span className="swatch" style={{ background: a.color }} /> {a.color}
              </td>
              <td className="owner">{describe(a.target)}</td>
              <td>
                <button title={t('appearance.remove')} aria-label={t('appearance.remove')} onClick={() => run({ type: 'setAppearance', target: a.target, color: null })}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

/** 輸出 STEP (F1.1, F1.3, C3.4): the schema, colors, and the coordinate system the part is written in. */
export function StepOptionsDialog() {
  const open = useStore((s) => s.dialog === 'stepOptions');
  const doc = useStore((s) => s.doc);
  const [schema, setSchema] = useState<'AP214' | 'AP242'>('AP214');
  const [colors, setColors] = useState(true);
  const [coordSys, setCoordSys] = useState('');
  if (!open) return null;
  const systems = doc.features.filter((f) => f.type === 'coordSys' && !f.suppressed);
  const close = () => store.openDialog(null);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal parameters" role="dialog" aria-label={t('export.stepTitle')} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('export.stepTitle')}</h3>
        <p className="hint">{t('export.stepHint')}</p>
        <label className="pm-row">
          <span>{t('export.schema')}</span>
          <select value={schema} onChange={(e) => setSchema(e.target.value as 'AP214' | 'AP242')}>
            <option value="AP214">AP214</option>
            <option value="AP242">AP242</option>
          </select>
        </label>
        <label className="pm-row checkbox">
          <input type="checkbox" checked={colors} onChange={(e) => setColors(e.target.checked)} />
          <span>{t('export.colors')}</span>
        </label>
        <label className="pm-row">
          <span>{t('export.coordSys')}</span>
          <select value={coordSys} onChange={(e) => setCoordSys(e.target.value)}>
            <option value="">{t('export.partOrigin')}</option>
            {systems.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button
            onClick={() => {
              close();
              void store.writeStep({ schema, colors, coordSys: coordSys || null });
            }}
          >
            {t('export.go')}
          </button>
          <button onClick={close}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/** 輸出 IGES (F1.4): trimmed surfaces or a B-rep solid, the unit, colors, and the coordinate system the part is written in. */
export function IgesOptionsDialog() {
  const open = useStore((s) => s.dialog === 'igesOptions');
  const doc = useStore((s) => s.doc);
  const [mode, setMode] = useState<'faces' | 'brep'>('faces');
  const [unit, setUnit] = useState<'MM' | 'INCH'>('MM');
  const [colors, setColors] = useState(true);
  const [coordSys, setCoordSys] = useState('');
  if (!open) return null;
  const systems = doc.features.filter((f) => f.type === 'coordSys' && !f.suppressed);
  const close = () => store.openDialog(null);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal parameters" role="dialog" aria-label={t('export.igesTitle')} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('export.igesTitle')}</h3>
        <p className="hint">{t('export.igesHint')}</p>
        <label className="pm-row">
          <span>{t('export.igesMode')}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'faces' | 'brep')}>
            <option value="faces">{t('export.igesFaces')}</option>
            <option value="brep">{t('export.igesBrep')}</option>
          </select>
        </label>
        <label className="pm-row">
          <span>{t('export.unit')}</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as 'MM' | 'INCH')}>
            <option value="MM">mm</option>
            <option value="INCH">inch</option>
          </select>
        </label>
        <label className="pm-row checkbox">
          <input type="checkbox" checked={colors} onChange={(e) => setColors(e.target.checked)} />
          <span>{t('export.colors')}</span>
        </label>
        <label className="pm-row">
          <span>{t('export.coordSys')}</span>
          <select value={coordSys} onChange={(e) => setCoordSys(e.target.value)}>
            <option value="">{t('export.partOrigin')}</option>
            {systems.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button
            onClick={() => {
              close();
              void store.writeIges({ mode, unit, colors, coordSys: coordSys || null });
            }}
          >
            {t('export.go')}
          </button>
          <button onClick={close}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/** 新零件（範本） (B1.4): which kind of part to begin with. */
export function TemplateDialog() {
  const open = useStore((s) => s.dialog === 'template');
  if (!open) return null;
  const close = () => store.openDialog(null);
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal" role="dialog" aria-label={t('template.title')} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('template.title')}</h3>
        <p className="hint">{t('template.hint')}</p>
        <ul className="template-list">
          {PART_TEMPLATES.map((x) => (
            <li key={x.id}>
              <button onClick={() => store.newPartFromTemplate(x.id)}>
                <strong>{t(`template.${x.id}`)}</strong>
                <span className="muted">{t(`template.${x.id}Hint`)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button onClick={close}>{t('export.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

/** 快速鍵 (D3.3): every action with its shortcut; a click on the field and a key combination changes it. */
export function ShortcutsDialog() {
  const open = useStore((s) => s.dialog === 'shortcuts');
  const [, again] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => subscribeShortcuts(() => again((n) => n + 1)), []);
  if (!open) return null;
  const close = () => store.openDialog(null);
  const mine = overrides();
  const labelOf = (id: string) => ACTIONS.find((a) => a.id === id)?.label ?? id;
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal wide parameters" role="dialog" aria-label={t('shortcuts.title')} onPointerDown={(e) => e.stopPropagation()}>
        <h3>{t('shortcuts.title')}</h3>
        <p className="hint">{t('shortcuts.hint')}</p>
        {problem && <p className="error-text">{problem}</p>}
        <div className="shortcut-list">
          <table className="eq-table">
            <tbody>
              {ACTIONS.map((a) => (
                <tr key={a.id}>
                  <td>{a.label}</td>
                  <td>
                    <input
                      className="mono"
                      readOnly
                      aria-label={a.label}
                      value={shortcutOf(a) ?? ''}
                      placeholder={t('shortcuts.press')}
                      onKeyDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.key === 'Escape') return void e.currentTarget.blur();
                        if (e.key === 'Backspace' || e.key === 'Delete') {
                          setProblem(null);
                          return setOverride(a.id, a.shortcut === undefined ? undefined : '');
                        }
                        const combo = formatEvent(e.nativeEvent);
                        if (!combo) return;
                        const other = conflictWith(combo, a.id, ACTIONS, mine);
                        if (other) return setProblem(t('shortcuts.conflict', { keys: combo, action: labelOf(other) }));
                        setProblem(null);
                        setOverride(a.id, combo === a.shortcut ? undefined : combo);
                      }}
                    />
                  </td>
                  <td>{mine[a.id] !== undefined && <button onClick={() => setOverride(a.id, undefined)}>{t('shortcuts.reset')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          {Object.keys(mine).length > 0 && <button onClick={() => resetOverrides()}>{t('shortcuts.reset')}</button>}
          <button onClick={close}>{t('shortcuts.close')}</button>
        </div>
      </div>
    </div>
  );
}

/** 系統選項 (D8.1): the language, autosave, the template of a new part and what can be picked at first; kept in the browser. */
/** The switches of the sketch snaps in the options, in the order the dialog lists them. */
const SNAP_FLAGS = ['enabled', ...SNAP_ITEMS, 'grid', 'angle'] as const;

export function OptionsDialog() {
  const open = useStore((s) => s.dialog === 'options');
  const options = useStore((s) => s.options);
  const [, again] = useState(0);
  if (!open) return null;
  const close = () => store.openDialog(null);
  const language = getLocale();
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal parameters" role="dialog" aria-label={t('options.title')} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>{t('options.title')}</h3>
        <p className="hint">{t('options.hint')}</p>
        <div className="options-grid">
          <label>{t('options.language')}</label>
          <select
            value={language}
            onChange={(e) => {
              void store.setLanguage(e.target.value as Locale).then(() => again((n) => n + 1));
            }}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {t(l === 'en' ? 'options.languageEn' : 'options.languageZh')}
              </option>
            ))}
          </select>
          <label>{t('options.autosave')}</label>
          <input type="checkbox" checked={options.autosave} onChange={(e) => store.setOptions({ autosave: e.target.checked })} />
          <label>{t('options.autosaveSeconds')}</label>
          <input
            type="number"
            min={AUTOSAVE_SECONDS.min}
            max={AUTOSAVE_SECONDS.max}
            disabled={!options.autosave}
            value={options.autosaveSeconds}
            onChange={(e) => e.target.value !== '' && store.setOptions({ autosaveSeconds: Number(e.target.value) })}
          />
          <label htmlFor="option-show-grid">{t('options.showGrid')}</label>
          <input type="checkbox" id="option-show-grid" data-option="showGrid" checked={options.showGrid} onChange={e => store.setOptions({ showGrid: e.target.checked })} />
          <label>{t('options.viewArrowStep')}</label>
          <input
            type="number"
            min={VIEW_ARROW_STEP.min}
            max={VIEW_ARROW_STEP.max}
            step="1"
            value={options.viewArrowStep}
            onChange={(e) => e.target.value !== '' && store.setOptions({ viewArrowStep: Number(e.target.value) })}
          />
          <label>{t('options.viewCubeStep')}</label>
          <input
            type="number"
            min={VIEW_ARROW_STEP.min}
            max={VIEW_ARROW_STEP.max}
            step="1"
            value={options.viewCubeStep}
            onChange={(e) => e.target.value !== '' && store.setOptions({ viewCubeStep: Number(e.target.value) })}
          />
          <label>{t('options.template')}</label>
          <select value={options.defaultTemplate} onChange={(e) => store.setOptions({ defaultTemplate: e.target.value as (typeof PART_TEMPLATES)[number]['id'] })}>
            {PART_TEMPLATES.map((x) => (
              <option key={x.id} value={x.id}>
                {t(`template.${x.id}`)}
              </option>
            ))}
          </select>
          <label>{t('sketch.automaticRelations')}</label><input type="checkbox" checked={options.automaticRelations} onChange={e=>store.setOptions({automaticRelations:e.target.checked})} />
          <label>{t('snap.title')}</label>
          <span className="snap-options">
            {SNAP_FLAGS.map((k) => (
              <label key={k} className={k === 'enabled' ? 'snap-master' : ''}>
                <input type="checkbox" checked={options.snap[k]} disabled={k !== 'enabled' && !options.snap.enabled} onChange={(e) => store.setOptions({ snap: { ...options.snap, [k]: e.target.checked } })} />
                {t(`snap.${k}`)}
              </label>
            ))}
            <label>
              {t('snap.gridSpacing')}
              <input type="number" min={GRID_SPACING.min} max={GRID_SPACING.max} step="0.5" disabled={!options.snap.enabled} value={options.snap.gridSpacing} onChange={(e) => e.target.value !== '' && store.setOptions({ snap: { ...options.snap, gridSpacing: Number(e.target.value) } })} />
            </label>
            <label>
              {t('snap.angleStep')}
              <input type="number" min={ANGLE_STEP.min} max={ANGLE_STEP.max} step="1" disabled={!options.snap.enabled} value={options.snap.angleStep} onChange={(e) => e.target.value !== '' && store.setOptions({ snap: { ...options.snap, angleStep: Number(e.target.value) } })} />
            </label>
          </span>
          <label>{t('options.pickFilter')}</label>
          <span className="pick-filter-options">
            <label>
              <input
                type="radio"
                name="options-pick-filter"
                checked={Object.values(options.pickFilter).every(Boolean)}
                onChange={() => store.setOptions({ pickFilter: { faces: true, edges: true, vertices: true, planes: true } })}
              />
              {t('select.filterAll')}
            </label>
            {(['faces', 'edges', 'vertices', 'planes'] as const).map((k) => (
              <label key={k}>
                <input
                  type="radio"
                  name="options-pick-filter"
                  checked={Object.entries(options.pickFilter).every(([o, v]) => (o === k ? v : !v))}
                  onChange={() => store.setOptions({ pickFilter: { faces: false, edges: false, vertices: false, planes: false, [k]: true } })}
                />
                {PICK_FILTER_LABEL[k]}
              </label>
            ))}
          </span>
          <label>{t('options.pickFilterBar')}</label>
          <input type="checkbox" checked={options.pickFilterBar} onChange={(e) => store.setOptions({ pickFilterBar: e.target.checked })} />
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={close}>
            {t('options.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
